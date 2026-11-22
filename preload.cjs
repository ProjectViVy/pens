// 面板与主进程之间只有两个动作：开数字人、关数字人。不给渲染层任何别的能力。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pens', {
  openStage: () => ipcRenderer.invoke('stage:open'),
  closeStage: () => ipcRenderer.invoke('stage:close'),
})
