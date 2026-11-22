'use strict'
// DivaVidol：lobe-vidol 作为独立服务跑，窗口同样交给 app-window.cjs。
const { registerAppIpc } = require('./app-window.cjs')
const { ensureVidol } = require('./vidol-session.cjs')

let registered = false

function registerVidolIpc(ipcMain) {
  if (registered) return
  registered = true
  registerAppIpc(ipcMain, {
    id: 'vidol',
    title: 'DivaVidol',
    partition: 'persist:pens-vidol',
    width: 1200,
    height: 840,
    load: async () => (await ensureVidol()).url,
  })
}

module.exports = { registerVidolIpc }
