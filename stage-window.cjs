'use strict'
// 数字人：舞台进程独立跑，窗口交给 app-window.cjs 统一处理。
const { registerAppIpc } = require('./app-window.cjs')
const { ensureStage } = require('./stage-session.cjs')

let resolveModelsDir = () => undefined
let registered = false

/** 由宿主决定模型目录（环境变量 / stage-app/models / 交给舞台自己报缺）。 */
function setModelsDir(fn) {
  if (typeof fn === 'function') resolveModelsDir = fn
}

function registerStageIpc(ipcMain) {
  if (registered) return
  registered = true
  registerAppIpc(ipcMain, {
    id: 'stage',
    title: '数字人',
    partition: 'persist:pens-stage',
    load: async () => (await ensureStage({ modelsDir: resolveModelsDir() })).url,
  })
}

module.exports = { registerStageIpc, setModelsDir }
