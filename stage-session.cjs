'use strict'
// 舞台会话：面板只负责「把舞台进程拉起来、拿到地址」，不碰它的渲染。
//
// 舞台自己是一个独立进程（apps/stage-app/server.mjs），页面通过 loopback HTTP 打开。
// 面板与它之间只有两件事：一条带令牌的地址、一个可关闭的句柄。
const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')
const crypto = require('node:crypto')

const STAGE_DIR = path.join(__dirname, 'apps', 'stage-app')
const ENTRY = path.join(STAGE_DIR, 'server.mjs')
const READY_TIMEOUT_MS = 12000

let session = null
let pending = null

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 向系统要一个当前可用的本机端口（Windows 有保留端口段，写死端口会 EACCES）。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function alive(port, token) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ping?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(800),
    })
    return response.ok
  } catch {
    return false
  }
}

async function boot(modelsDir) {
  const port = await freePort()
  const token = crypto.randomBytes(18).toString('base64url')
  // 在 Electron 里 process.execPath 是 electron.exe：必须让它退化成 node 才能跑 server.mjs。
  // NODE_OPTIONS 不往下传：宿主注入的加载器会把一个本地小服务拖进来，没好处。
  const env = { ...process.env }
  delete env.NODE_OPTIONS
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
  const child = spawn(process.execPath, [ENTRY], {
    cwd: STAGE_DIR,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...env,
      STAGE_HOST: '127.0.0.1',
      STAGE_PORT: String(port),
      STAGE_TOKEN: token,
      ...(modelsDir ? { STAGE_MODELS: modelsDir } : {}),
    },
  })

  let exitCode = null
  child.once('exit', (code) => { exitCode = code ?? -1 })
  child.once('error', (error) => { exitCode = error.message })

  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (exitCode !== null) throw new Error(`舞台进程退出了（${exitCode}）`)
    if (await alive(port, token)) {
      return {
        url: `http://127.0.0.1:${port}/`,
        token,
        port,
        pid: child.pid,
        stop() {
          try { child.kill() } catch { /* 已经退了 */ }
        },
      }
    }
    await delay(150)
  }
  try { child.kill() } catch { /* ignore */ }
  throw new Error('舞台在 12 秒内没有就绪')
}

/**
 * 拿到一个可用的舞台会话；重复调用复用同一个进程。
 * @param {{ modelsDir?: string }} [options]
 */
async function ensureStage(options = {}) {
  if (session) {
    if (await alive(session.port, session.token)) return session
    session = null
  }
  if (!pending) {
    pending = boot(options.modelsDir)
      .then((result) => { session = result; return result })
      .finally(() => { pending = null })
  }
  return pending
}

/** 面板退出时收尾；舞台页面窗口关掉不影响这里（它只是浏览器窗口）。 */
function stopStage() {
  if (session) {
    session.stop()
    session = null
  }
}

module.exports = { ensureStage, stopStage, STAGE_DIR }
