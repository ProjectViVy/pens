/**
 * 舞台性能取证（只依赖 Node 内置能力，不装 playwright/CDP 包）
 *
 * 用法：
 *   1. 先起一个生产服务： node node_modules/next/dist/bin/next start -p 3100
 *   2. 再跑本脚本：        node scripts/perfProbe.mjs http://127.0.0.1:3100
 *
 * 它测三件事，都是「真的画了多少帧」而不是推测：
 *   - 舞台待机：帧率应该落在 30 帧那一档
 *   - 设置抽屉打开：应该降到 20 帧低功耗预览，主线程耗时同步下降
 *   - 进 /settings 页：舞台卸载，渲染帧率必须是 0（连 rAF 都不再排）
 *
 * 页面上要读到 `viewer.perfStats()`，所以第一条 URL 带 `?perfprobe=1`
 * （见 features/CharacterViewer 里的取证钩子）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3100').replace(/\/$/, '');
const PORT = Number(process.env.PROBE_PORT ?? 9333);
const OUT = join(process.cwd(), 'perf-report.json');
const PROFILE = join(process.cwd(), '.perf-tmp');
/**
 * 视口尺寸
 *
 * headless 默认没有 GPU，WebGL 走 SwiftShader 软件光栅化：1280×800 下
 * 一帧要 200ms，帧率完全被渲染能力卡住，看不出 30/20 帧的节拍。
 * 缩到小视口，每帧便宜下来，测到的才是「我们的帧率上限」。
 */
const [VW, VH] = (process.env.PROBE_VIEWPORT ?? '480x360').split('x').map(Number);

/** 找一个能用的 Chrome：环境变量优先，其次 Playwright 自带的 headless shell */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.LOCALAPPDATA &&
      join(
        process.env.LOCALAPPDATA,
        'ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe',
      ),
    process.env.LOCALAPPDATA &&
      join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1234/chrome-win/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path));
}

/** 极简 CDP 客户端：一条 WebSocket 上按 id 分发回包，另支持按事件名订阅 */
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id) {
        const handler = this.handlers.get(msg.method);
        if (handler) handler(msg.params ?? {});
        return;
      }
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else waiter.resolve(msg.result ?? {});
    });
  }

  on(method, handler) {
    this.handlers.set(method, handler);
  }

  async open() {
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        this.ws.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => reject(new Error('CDP WebSocket 连不上'));
      this.ws.addEventListener('open', onOpen, { once: true });
      this.ws.addEventListener('error', onError, { once: true });
    });
    return this;
  }

  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { reject, resolve }));
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`页面里执行失败：${detail}`);
    }
    return result.result.value;
  }

  close() {
    this.ws.close();
  }
}

const METRICS = [
  'TaskDuration',
  'ScriptDuration',
  'LayoutDuration',
  'RecalcStyleDuration',
  'JSHeapUsedSize',
  'Nodes',
];

/**
 * 从「执行 action」到「画布重新出了第一帧」要多久（毫秒）
 *
 * 用来回答「关掉设置再打开是不是秒回」：这段时间里包含新画布挂载、
 * 新 WebGLRenderer 创建、环境贴图重建和贴图重新上传。
 * 顺便分开记录「画布什么时候挂上」——用来判断慢在 React 挂载还是慢在 GL 重建。
 */
async function timeToFirstFrame(cdp, action, { timeout = 20_000 } = {}) {
  const before = await cdp.evaluate('window.__divaPerf.viewer.frameCount');
  const t0 = performance.now();
  await cdp.evaluate(action);
  let canvasMs = null;
  for (;;) {
    if (canvasMs === null && (await cdp.evaluate(`!!document.querySelector('#vrm-canvas')`).catch(() => false))) {
      canvasMs = Math.round(performance.now() - t0);
    }
    const now = await cdp.evaluate('window.__divaPerf.viewer.frameCount');
    if (now > before) {
      return { canvasMs, firstFrameMs: Math.round(performance.now() - t0) };
    }
    if (performance.now() - t0 > timeout) throw new Error('等不到重载后的第一帧');
    await sleep(40);
  }
}

/** 从「执行 action」到「舞台上真的不再出帧」要多久（毫秒） */
async function timeToNoMoreFrames(cdp, action, { timeout = 10_000 } = {}) {
  await cdp.evaluate(action);
  const t0 = performance.now();
  let last = await cdp.evaluate('window.__divaPerf.viewer.frameCount');
  let stableSince = performance.now();
  for (;;) {
    await sleep(40);
    const now = await cdp.evaluate('window.__divaPerf.viewer.frameCount');
    if (now !== last) {
      last = now;
      stableSince = performance.now();
    } else if (performance.now() - stableSince > 400) {
      return Math.round(stableSince - t0);
    }
    if (performance.now() - t0 > timeout) throw new Error('停不下来：还在出帧');
  }
}

async function readMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const map = Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  return Object.fromEntries(METRICS.map((name) => [name, map[name] ?? 0]));
}

/** 等页面进入某个状态，超时就抛错（不要静默继续，否则测的是错的页面） */
async function waitFor(cdp, expression, { label, timeout = 60_000, interval = 400 } = {}) {
  const started = Date.now();
  for (;;) {
    const ok = await cdp.evaluate(expression).catch(() => false);
    if (ok) return;
    if (Date.now() - started > timeout) {
      const where = await cdp
        .evaluate(
          `JSON.stringify({
             href: location.href,
             ready: document.readyState,
             perf: !!window.__divaPerf,
             isReady: window.__divaPerf?.viewer?.isReady ?? null,
             canvases: document.querySelectorAll('canvas').length,
             bodyLen: document.body?.innerHTML?.length ?? 0,
           })`,
        )
        .catch((error) => `读页面状态也失败：${error.message}`);
      throw new Error(`等待超时：${label ?? expression}\n页面状态：${where}`);
    }
    await sleep(interval);
  }
}

/**
 * 测一个时间窗口
 *
 * fps 用的是 `viewer.perfStats().frameCount`（真正调了 renderer.render 的次数），
 * raf/s 是页面上 rAF 回调的次数；两者一起看能区分「循环在跑但没画」和「循环在跑」。
 * 设置页没有 viewer，所以 stats 取不到时按只有 raf 的页面处理。
 */
async function measure(cdp, label, ms, { withViewer = true } = {}) {
  const hasViewer = withViewer && (await cdp.evaluate('!!window.__divaPerf').catch(() => false));
  const before = await readMetrics(cdp);
  const frames0 = hasViewer ? await cdp.evaluate('window.__divaPerf.viewer.frameCount') : 0;
  const raf0 = await cdp.evaluate('window.__rafCount');
  const t0 = performance.now();

  await sleep(ms);

  const elapsed = (performance.now() - t0) / 1000;
  const after = await readMetrics(cdp);
  const raf1 = await cdp.evaluate('window.__rafCount');
  const frames1 = hasViewer ? await cdp.evaluate('window.__divaPerf.viewer.frameCount') : 0;
  const stats = hasViewer ? await cdp.evaluate('window.__divaPerf.viewer.perfStats()') : null;
  const canvasPx = hasViewer
    ? await cdp
        .evaluate(
          `(() => { const c = document.querySelector('#vrm-canvas');
             return c ? c.width + 'x' + c.height : null; })()`,
        )
        .catch(() => null)
    : null;

  const perSec = (value) => Math.round(value * 10) / 10;
  const frames = frames1 - frames0;
  const taskMs = (after.TaskDuration - before.TaskDuration) * 1000;
  return {
    canvasPx,
    frames,
    heapMB: Math.round((after.JSHeapUsedSize / 1024 / 1024) * 10) / 10,
    label,
    layoutMsPerSec: perSec(((after.LayoutDuration - before.LayoutDuration) * 1000) / elapsed),
    loopActive: stats?.loopActive ?? null,
    pixelRatio: stats?.pixelRatio ?? null,
    rafPerSec: perSec((raf1 - raf0) / elapsed),
    renderFps: perSec(frames / elapsed),
    sceneChildren: stats?.sceneChildren ?? null,
    scriptMsPerSec: perSec(((after.ScriptDuration - before.ScriptDuration) * 1000) / elapsed),
    seconds: Math.round(elapsed * 100) / 100,
    suspended: stats?.suspended ?? null,
    taskMsPerFrame: frames ? Math.round((taskMs / frames) * 10) / 10 : null,
    taskMsPerSec: perSec(taskMs / elapsed),
    triangles: stats?.triangles ?? null,
  };
}

async function main() {
  const chrome = findChrome();
  if (!chrome) throw new Error('找不到 Chrome，请用 CHROME_PATH 指定');
  const server = await fetch(`${BASE}/`).catch(() => null);
  if (!server) throw new Error(`${BASE} 打不开：先起 next start`);

  if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true });
  console.log(`Chrome: ${chrome}`);
  const child = spawn(
    chrome,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--mute-audio',
      // headless 默认可能没有 GPU，允许软件 WebGL，否则拿不到任何帧
      '--enable-unsafe-swiftshader',
      '--window-size=1280,800',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp;
  try {
    // 等 DevTools 端口起来
    let version;
    for (let i = 0; i < 60; i++) {
      version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null);
      if (version) break;
      await sleep(300);
    }
    if (!version) throw new Error('Chrome 的 DevTools 端口没起来');

    const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) =>
      r.json(),
    );
    cdp = await new Cdp(target.webSocketDebuggerUrl).open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Performance.enable');
    await cdp.send('Log.enable');
    // 页面的报错直接打到终端：探针失败时先看这个，不要猜
    cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails;
      console.error(`[页面异常] ${details?.exception?.description ?? details?.text ?? '未知'}`);
    });
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type !== 'error') return;
      const text = (params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
      console.error(`[页面 console.error] ${text}`);
    });
    cdp.on('Log.entryAdded', (params) => {
      if (params.entry?.level !== 'error') return;
      console.error(`[页面日志] ${params.entry.text}`);
    });
    // 固定视口，保证几次测量面对的是同样的像素量
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height: VH,
      mobile: false,
      width: VW,
    });

    // 计数器要在页面脚本之前装好
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          window.__rafCount = 0;
          window.__webglContexts = 0;
          const raf = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (cb) => raf((t) => { window.__rafCount++; return cb(t); });
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
            const ctx = getContext.call(this, type, ...rest);
            if (String(type).includes('webgl')) window.__webglContexts++;
            return ctx;
          };
        })();
      `,
    });

    // 一、舞台待机
    await cdp.send('Page.navigate', { url: `${BASE}/?perfprobe=1` });
    await waitFor(cdp, `!!window.__divaPerf?.viewer?.isReady`, { label: '画布挂上' });
    await waitFor(cdp, `!!window.__divaPerf?.viewer?.currentEnvironment`, {
      label: '房间铺好',
      timeout: 120_000,
    });
    await sleep(2500);
    const idle = await measure(cdp, '舞台待机', 10_000);
    const webglAtIdle = await cdp.evaluate('window.__webglContexts');
    // 截图：关了 preserveDrawingBuffer 之后必须「先画后读」在同一个任务里完成
    const screenshotOk = await cdp
      .evaluate(
        `(() => { const data = window.__divaPerf.viewer.captureImage('image/png');
           return typeof data === 'string' && data.startsWith('data:image/png') && data.length > 5000; })()`,
      )
      .catch(() => false);

    // 二、打开设置：前台必须当场就没了（不是降帧，是整个舞台卸载）
    await cdp.send('Page.navigate', { url: `${BASE}/?perfprobe=1&dev=1&panel=1` });
    await waitFor(cdp, `!!window.__divaPerf?.viewer?.currentEnvironment`, {
      label: '房间铺好（面板）',
      timeout: 120_000,
    });
    await waitFor(cdp, `document.querySelectorAll('#vrm-canvas').length === 0`, {
      label: '带面板时画布已卸载',
      timeout: 30_000,
    });
    await sleep(1500);
    const drawer = await measure(cdp, '设置打开（舞台已卸载）', 8000);

    // 二·b、关掉设置：重新挂画布 + 重建渲染器，量「回到第一帧」要多久
    await cdp.evaluate(`(() => {
      window.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
      }).observe({ entryTypes: ['longtask'] });
    })()`);
    const reopenMs = await timeToFirstFrame(cdp, 'window.__divaPerf.setPanel(false)');
    const reopenLongTasks = await cdp.evaluate('window.__longTasks').catch(() => []);
    const reopen = await measure(cdp, '关闭设置后重载', 8000);
    await waitFor(cdp, `!!window.__divaPerf?.viewer?.currentEnvironment`, { label: '房间回来了' });
    const webglAfterReopen = await cdp.evaluate('window.__webglContexts');
    // 存一张重载之后的画面：证明「重载」之后画的是对的，不是一块黑
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(new URL('../perf-reopen.png', import.meta.url), Buffer.from(shot.data, 'base64'));

    // 三、整页进设置：舞台应该彻底不画了
    await cdp.send('Page.navigate', { url: `${BASE}/settings/common` });
    await waitFor(cdp, `location.pathname === '/settings/common' && document.readyState === 'complete'`, {
      label: '设置页打开',
    });
    await sleep(2500);
    const settingsPage = await measure(cdp, '/settings 页', 6000, { withViewer: false });
    const webglOnSettings = await cdp.evaluate('window.__webglContexts');

    /*
     * 四、轻场景对照：把房间的 .glb 拦掉，只留人物
     *
     * headless 没有 GPU，WebGL 走 SwiftShader：带房间的 36 万个三角形一帧要 100ms，
     * 帧率完全被渲染能力卡住，看不出 30 帧的节拍。
     * 拦掉房间之后每帧便宜下来，量到的才是「我们自己的帧率上限」。
     */
    let blockRooms = true;
    await cdp.send('Fetch.enable', {
      patterns: [{ requestStage: 'Request', urlPattern: '*/environments/*.glb' }],
    });
    cdp.on('Fetch.requestPaused', (params) => {
      if (blockRooms) {
        cdp.send('Fetch.failRequest', { errorReason: 'Failed', requestId: params.requestId }).catch(() => {});
      } else {
        cdp.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
      }
    });

    await cdp.send('Page.navigate', { url: `${BASE}/?perfprobe=1` });
    await waitFor(cdp, `!!window.__divaPerf?.viewer?.model`, { label: '人物就位（无房间）' });
    await sleep(3000);
    const lightIdle = await measure(cdp, '轻场景待机（无房间）', 10_000);

    // 打开设置：这里同样走 store，画布应当立刻消失、frameCount 不再增长
    const stopMs = await timeToNoMoreFrames(cdp, 'window.__divaPerf.setPanel(true)');
    const lightDrawer = await measure(cdp, '轻场景 + 设置打开', 6000);
    const lightReopenMs = await timeToFirstFrame(cdp, 'window.__divaPerf.setPanel(false)');
    const lightReopen = await measure(cdp, '轻场景 + 关闭设置后重载', 6000);

    // 交互唤醒：鼠标动一下应该立刻回到满帧
    await cdp.evaluate('window.__divaPerf.viewer.wake(4000)');
    const lightWake = await measure(cdp, '轻场景 + 交互叫醒', 3_000);
    blockRooms = false;

    const report = {
      base: BASE,
      createdAt: new Date().toISOString(),
      reopenMs: { full: reopenMs, light: lightReopenMs },
      reopenLongTasks,
      screenshotOk,
      stopMs,
      viewport: `${VW}x${VH}`,
      webglContexts: {
        atIdle: webglAtIdle,
        afterReopen: webglAfterReopen,
        onSettingsPage: webglOnSettings,
      },
      samples: [idle, drawer, reopen, settingsPage, lightIdle, lightDrawer, lightReopen, lightWake],
    };
    writeFileSync(OUT, JSON.stringify(report, null, 2));

    console.table(report.samples);
    console.log(`截图可用：${screenshotOk ? '是' : '否'}`);
    console.log(
      `打开设置 → 停帧：${stopMs} ms；关闭设置 → 画布/第一帧：全场景 ${reopenMs.canvasMs}/${reopenMs.firstFrameMs} ms，轻场景 ${lightReopenMs.canvasMs}/${lightReopenMs.firstFrameMs} ms`,
    );
    console.log(
      `WebGL 上下文创建次数：舞台 ${webglAtIdle}，关闭设置重载后 ${webglAfterReopen}，设置页 ${webglOnSettings}`,
    );
    console.log(`明细已写入 ${OUT}`);
  } finally {
    cdp?.close();
    child.kill();
  }
}

main().catch((error) => {
  console.error(`取证失败：${error.message}`);
  process.exitCode = 1;
});
