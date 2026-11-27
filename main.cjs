const { app, BrowserWindow, dialog, Menu, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { stopStage, STAGE_DIR } = require('./stage-session.cjs')
const { registerStageIpc, setModelsDir } = require('./stage-window.cjs')
const { registerVidolIpc } = require('./vidol-window.cjs')
const { stopVidol } = require('./vidol-session.cjs')

/** 模型：环境变量优先，其次 stage-app 自己的 models/，都没有就让舞台自己报缺。 */
function modelsDir() {
  if (process.env.PENS_STAGE_MODELS) return process.env.PENS_STAGE_MODELS
  const local = path.join(STAGE_DIR, 'models')
  return fs.existsSync(local) ? local : undefined
}

setModelsDir(modelsDir)
registerStageIpc(ipcMain)
registerVidolIpc(ipcMain)

async function openPanelWindow() {
  const window = new BrowserWindow({
    title: 'PENS',
    width: 1280,
    height: 900,
    minWidth: 480,
    minHeight: 420,
    backgroundColor: '#e8f3fa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      if (!input.isAutoRepeat) window.setFullScreen(!window.isFullScreen());
    }
  });

  window.once('ready-to-show', () => window.show());
  await window.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  return openPanelWindow();
}).catch((error) => {
  dialog.showErrorBox('PENS 启动失败', error.message);
  app.exit(1);
});

app.on('before-quit', () => { stopStage(); stopVidol() })
app.on('window-all-closed', () => app.quit());
