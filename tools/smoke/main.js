'use strict'
// 冒烟测试入口：以「应用目录」方式启动（不是裸脚本，Electron 对裸脚本会崩）。
// 它加载真面板、真点一下「数字人」，然后把读数写成 JSON。
//
//   electron tools/smoke --no-sandbox
//
// 只做读数与断言，不截图（截图由 headless Chrome 对页面单独做）。
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

process.env.PENS_SMOKE = '1'
const ROOT = path.join(__dirname, '..', '..')
require(path.join(ROOT, 'main.cjs'))
const { stopStage } = require(path.join(ROOT, 'stage-session.cjs'))

const OUT = process.env.PENS_SMOKE_OUT || path.join(ROOT, '.artifacts', 'smoke')
fs.mkdirSync(OUT, { recursive: true })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const LOGFILE = path.join(OUT, 'smoke.log')
const say = (...parts) => {
  const line = '[smoke] ' + parts.join(' ').replace(/\s+/g, ' ').slice(0, 4000) + '\n'
  try { fs.appendFileSync(LOGFILE, line) } catch { /* ignore */ }
  process.stdout.write(line)
}
say('boot ' + new Date().toISOString())

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await wait(250)
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
  say('ready fired')
  const panel = await waitFor(() => BrowserWindow.getAllWindows()[0], 20000, '面板窗口')
  say('panel found')
  say('panel title=' + panel.getTitle() + ' url=' + panel.webContents.getURL())
  await wait(1200)

  const tiles = await panel.webContents.executeJavaScript(`
    (() => {
      const ids = [...document.querySelectorAll('[data-open]')].map((el) => el.dataset.open)
      const pages = [...document.querySelectorAll('.page-tab, [data-page]')].map((el) => el.textContent.trim())
      return { ids, placeholderText: document.body.innerText.includes('准备中'), pages }
    })()
  `)
  say('panel tiles=' + JSON.stringify(tiles.ids))
  report.panelTiles = tiles.ids
  report.placeholderTextPresent = tiles.placeholderText
  report.panelShot = await capture(panel, 'panel.png')
  if (!tiles.ids.includes('digitalhuman')) throw new Error('面板里没有数字人入口')
  if (tiles.placeholderText) throw new Error('面板里还有占位文案')

  await panel.webContents.executeJavaScript(`document.querySelector('[data-open="digitalhuman"]').click(); true`)
  say('clicked digitalhuman')

  const stage = await waitFor(
    () => BrowserWindow.getAllWindows().find((window) => window !== panel && !window.isDestroyed()),
    40000,
    '数字人子窗口'
  )
  await wait(1000)
  say('stage title=' + stage.getTitle() + ' url=' + stage.webContents.getURL())
  report.stageTitle = stage.getTitle()
  report.stageUrl = stage.webContents.getURL()
  report.stageIsSeparateWindow = stage !== panel

  report.stageRequire = await stage.webContents.executeJavaScript('typeof require')
  report.stageProcess = await stage.webContents.executeJavaScript('typeof process')
  report.stageCanvases = await stage.webContents.executeJavaScript(
    `JSON.stringify([...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height })))`
  )

  await wait(9000)
  report.stageShot = await capture(stage, 'stage.png')
  report.stageCanvasesAfter = await stage.webContents.executeJavaScript(
    `JSON.stringify([...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height })))`
  )
  report.runList = await panel.webContents.executeJavaScript(
    `document.querySelector('#run-list') ? document.querySelector('#run-list').innerText : null`
  )

  // 面板藏起来时，子窗该继续按自己的帧率跑（backgroundThrottling: false + 独立渲染进程）。
  const fps = () => stage.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let frames = 0
      const start = performance.now()
      const step = () => {
        frames += 1
        if (performance.now() - start < 1500) requestAnimationFrame(step)
        else resolve(Math.round(frames / 1.5))
      }
      requestAnimationFrame(step)
    })
  `)
  report.fpsPanelVisible = await fps()
  panel.hide()
  await wait(400)
  report.panelVisibleWhileMeasuring = panel.isVisible()
  report.fpsPanelHidden = await fps()
  panel.show()

  // 面板上点「停止」：子窗要真的关掉，而不是只从列表里消失。
  await panel.webContents.executeJavaScript(`document.querySelector('[data-stop="digitalhuman"]').click(); true`)
  await wait(1500)
  report.windowsAfterStop = BrowserWindow.getAllWindows().length
  report.stageWindowAfterStop = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.getTitle() === '数字人')

  report.ok = true
  say('report=' + JSON.stringify(report))
  stopStage()
  await wait(400)
  app.exit(0)
}).catch(async (error) => {
  report.error = String(error?.message ?? error)
  say('FAIL ' + report.error)
  say('report=' + JSON.stringify(report))
  stopStage()
  await wait(300)
  app.exit(1)
})
