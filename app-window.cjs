'use strict'
// 应用子窗的公共件：每个接入的应用只提供「怎么拿到地址」，窗口行为在这里统一。
//
// 每个窗口：自己的 session 分区、自己的渲染进程、sandbox、无 preload、禁弹窗、
// 只允许留在自己的 origin、标题不被页面改掉、关掉节流。
const { BrowserWindow } = require('electron')

const windows = new Map()

const DEFAULTS = {
  width: 980,
  height: 760,
  minWidth: 520,
  minHeight: 420,
  backgroundColor: '#0b0f14',
}

async function openAppWindow({ id, title, url, partition, width, height }) {
  const existing = windows.get(id)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return { ok: true, reused: true, url: existing.webContents.getURL() }
  }

  const origin = new URL(url).origin
  const window = new BrowserWindow({
    title,
    ...DEFAULTS,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      partition,
    },
  })
  windows.set(id, window)

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => {
    if (target !== origin && !target.startsWith(`${origin}/`)) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(title)
  })
  window.on('closed', () => {
    if (windows.get(id) === window) windows.delete(id)
  })

  await window.loadURL(url)
  return { ok: true, url }
}

function closeAppWindow(id) {
  const window = windows.get(id)
  if (window && !window.isDestroyed()) window.close()
  windows.delete(id)
}

/** 注册 `<id>:open` / `<id>:close` 两个 IPC；`load()` 负责把应用拉起来并给出地址。 */
function registerAppIpc(ipcMain, { id, title, partition, load, width, height }) {
  ipcMain.handle(`${id}:open`, async () => {
    try {
      return await openAppWindow({ id, title, partition, width, height, url: await load() })
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  })
  ipcMain.handle(`${id}:close`, () => {
    closeAppWindow(id)
    return { ok: true }
  })
}

module.exports = { openAppWindow, closeAppWindow, registerAppIpc }
