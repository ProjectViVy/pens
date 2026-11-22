'use strict'
// 数字人窗口：舞台在独立进程里跑，这里只开一个浏览器窗给它。
const { BrowserWindow } = require('electron')
const { ensureStage } = require('./stage-session.cjs')

let stageWindow = null
let resolveModelsDir = () => undefined
let registered = false

/** 由宿主决定模型目录（环境变量 / stage-app/models / 交给舞台自己报缺）。 */
function setModelsDir(fn) {
  if (typeof fn === 'function') resolveModelsDir = fn
}

async function openStageWindow() {
  const session = await ensureStage({ modelsDir: resolveModelsDir() })
  if (stageWindow && !stageWindow.isDestroyed()) {
    stageWindow.show()
    stageWindow.focus()
    return { ok: true, reused: true, url: session.url }
  }

  const allowedOrigin = new URL(session.url).origin
  const window = new BrowserWindow({
    title: '数字人',
    width: 980,
    height: 760,
    minWidth: 520,
    minHeight: 420,
    backgroundColor: '#0b0f14',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      partition: 'persist:pens-stage',
    },
  })
  stageWindow = window

  // 子窗不加载任何本地代码、不共享面板的存储：它只认识这一个 origin。
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${allowedOrigin}/`) && url !== `${allowedOrigin}`) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())
  // 页面自己的 title 是「舞台」，但这个人看到的是「数字人」——别被页面改掉。
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle('数字人')
  })
  window.on('closed', () => {
    if (stageWindow === window) stageWindow = null
  })
  await window.loadURL(session.url)
  return { ok: true, url: session.url }
}

function registerStageIpc(ipcMain) {
  if (registered) return
  registered = true
  ipcMain.handle('stage:open', async () => {
    try {
      return await openStageWindow()
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  })
  ipcMain.handle('stage:close', () => {
    if (stageWindow && !stageWindow.isDestroyed()) stageWindow.close()
    return { ok: true }
  })
}

module.exports = { openStageWindow, registerStageIpc, setModelsDir }
