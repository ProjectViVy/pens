'use strict'
// 冒烟测试：起真 Electron，点一下「数字人」，确认子窗口出现、舞台真的在渲染。
// 产物：$PENS_SMOKE_OUT 下的 panel.png / stage.png 与一行行读数。
const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { stopStage } = require('../stage-session.cjs')
const { registerStageIpc, setModelsDir } = require('../stage-window.cjs')

const ROOT = path.join(__dirname, '..')
const OUT = process.env.PENS_SMOKE_OUT || path.join(ROOT, '.artifacts', 'smoke')
fs.mkdirSync(OUT, { recursive: true })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...parts) => console.log('[smoke]', ...parts)
const errors = []

setModelsDir(() => {
  const local = path.join(ROOT, 'apps', 'stage-app', 'models')
  return fs.existsSync(local) ? local : undefined
})
registerStageIpc(ipcMain)

async function capture(window, name) {
  const image = await window.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, name), image.toPNG())
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)

  const panel = new BrowserWindow({
    title: 'PENS smoke',
    width: 1280,
    height: 900,
    show: true,
    webPreferences: {
      preload: path.join(ROOT, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  panel.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) errors.push(`panel: ${message}`)
  })

  await panel.loadFile(path.join(ROOT, 'index.html'))
  await wait(800)
  await capture(panel, 'panel.png')

  const tile = await panel.webContents.executeJavaScript(
    `!!document.querySelector('[data-open="digitalhuman"]')`
  )
  log('digitalhuman tile present:', tile)
  if (!tile) throw new Error('数字人入口不存在')

  await panel.webContents.executeJavaScript(
    `document.querySelector('[data-open="digitalhuman"]').click(); true`
  )

  let stage = null
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    stage = BrowserWindow.getAllWindows().find((window) => window !== panel && !window.isDestroyed())
    if (stage) break
    await wait(300)
  }
  if (!stage) throw new Error('30 秒内没有出现数字人窗口')

  stage.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) errors.push(`stage: ${message}`)
  })
  log('stage window:', stage.getTitle(), stage.webContents.getURL())
  log('stage has node require:', await stage.webContents.executeJavaScript('typeof require'))

  await wait(8000)
  await capture(stage, 'stage.png')
  const canvas = await stage.webContents.executeJavaScript(
    `JSON.stringify([...document.querySelectorAll('canvas')].map(c => ({ w: c.width, h: c.height })))`
  )
  log('stage canvases:', canvas)
  log('panel running list:', JSON.stringify(await panel.webContents.executeJavaScript(
    `document.querySelector('#run-list') ? document.querySelector('#run-list').innerText : null`
  )))
  log('console errors:', JSON.stringify(errors.slice(0, 8)))
  console.log('SMOKE_OK')
  stopStage()
  await wait(300)
  app.exit(0)
}).catch((error) => {
  console.error('SMOKE_FAIL', error)
  stopStage()
  app.exit(1)
})
