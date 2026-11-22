// 面板与主进程之间只有四个动作：开关数字人、开关 DivaVidol。不给渲染层任何别的能力。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pens', {
  openStage: () => ipcRenderer.invoke('stage:open'),
  closeStage: () => ipcRenderer.invoke('stage:close'),
  openVidol: () => ipcRenderer.invoke('vidol:open'),
  closeVidol: () => ipcRenderer.invoke('vidol:close'),
})
