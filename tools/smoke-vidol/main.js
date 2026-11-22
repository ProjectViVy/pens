'use strict'
// DivaVidol 冒烟：加载真面板、点「DivaVidol」，等 Next 起来，断言窗口与页面，再从面板点停止。
//
//   electron --no-sandbox --user-data-dir=<可写目录> tools/smoke-vidol
//
// 首次运行要等 Next 编译（可能 1–3 分钟），窗口超时给到 5 分钟。
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

process.env.PENS_SMOKE = '1'
const ROOT = path.join(__dirname, '..', '..')
require(path.join(ROOT, 'main.cjs'))
const { stopStage } = require(path.join(ROOT, 'stage-session.cjs'))
const { stopVidol } = require(path.join(ROOT, 'vidol-session.cjs'))

const OUT = process.env.PENS_SMOKE_OUT || path.join(ROOT, '.artifacts', 'smoke-vidol')
fs.mkdirSync(OUT, { recursive: true })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const LOGFILE = path.join(OUT, 'smoke.log')
const say = (...parts) => {
  const line = '[smoke-vidol] ' + parts.join(' ').replace(/\s+/g, ' ').slice(0, 4000) + '\n'
  try { fs.appendFileSync(LOGFILE, line) } catch { /* ignore */ }
  process.stdout.write(line)
}
say('boot ' + new Date().toISOString())

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await wait(500)
  }
  throw new Error('超时：' + label)
}

async function capture(window, name) {
  try {
    const image = await window.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, name), image.toPNG())
    return image.toPNG().length
  } catch (error) {
    return 'capture-failed: ' + (error?.message ?? error)
  }
}

const report = { ok: false }

app.whenReady().then(async () => {
  const panel = await waitFor(() => BrowserWindow.getAllWindows()[0], 20000, '面板窗口')
  say('panel title=' + panel.getTitle())
  report.panelTitle = panel.getTitle()
  await wait(1200)

  const tiles = await panel.webContents.executeJavaScript(
    `[...document.querySelectorAll('[data-open]')].map((el) => el.dataset.open)`
  )
  report.panelTiles = tiles
  say('tiles=' + JSON.stringify(tiles))
  if (!tiles.includes('vidol')) throw new Error('面板里没有 DivaVidol 入口')

  await panel.webContents.executeJavaScript(`document.querySelector('[data-open="vidol"]').click(); true`)
  const startedAt = Date.now()
  say('clicked vidol')

  const window = await waitFor(
    () => BrowserWindow.getAllWindows().find((w) => w !== panel && !w.isDestroyed() && w.getTitle() === 'DivaVidol'),
    300000,
    'DivaVidol 窗口'
  )
  report.bootSeconds = Math.round((Date.now() - startedAt) / 1000)
  say('window title=' + window.getTitle() + ' boot=' + report.bootSeconds + 's')
  report.title = window.getTitle()
  report.isSeparateWindow = window !== panel

  report.require = await window.webContents.executeJavaScript('typeof require')
  report.process = await window.webContents.executeJavaScript('typeof process')

  const body = await waitFor(
    () => window.webContents.executeJavaScript(`document.body && document.body.innerText.trim().length > 20 ? document.body.innerText.slice(0, 600) : null`),
    90000,
    'DivaVidol 页面内容'
  )
  report.bodySample = String(body).replace(/\s+/g, ' ').slice(0, 300)
  say('body=' + report.bodySample)

  report.url = window.webContents.getURL()
  report.size = await window.webContents.executeJavaScript('${innerWidth}x${innerHeight}' + '').catch(() => null)
  say('url=' + report.url + ' size=' + JSON.stringify(report.size))
  report.shot = await capture(window, 'vidol.png')
  report.runList = await panel.webContents.executeJavaScript(
    `document.querySelector('#run-list') ? document.querySelector('#run-list').innerText : null`
  )

  await panel.webContents.executeJavaScript(`document.querySelector('[data-stop="vidol"]').click(); true`)
  await wait(1500)
  report.windowsAfterStop = BrowserWindow.getAllWindows().length
  report.vidolWindowAfterStop = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.getTitle() === 'DivaVidol')

  report.ok = true
  say('report=' + JSON.stringify(report))
  stopVidol()
  stopStage()
  await wait(500)
  app.exit(0)
}).catch(async (error) => {
  report.error = String(error?.message ?? error)
  say('FAIL ' + report.error)
  say('report=' + JSON.stringify(report))
  stopVidol()
  stopStage()
  await wait(300)
  app.exit(1)
})
