const { app, BrowserWindow, dialog, Menu } = require('electron');

async function openDemoWindow() {
  const window = new BrowserWindow({
    title: 'PENS',
    width: 1280,
    height: 900,
    minWidth: 480,
    minHeight: 420,
    backgroundColor: '#e8f3fa',
    show: false,
    webPreferences: {
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
  await window.loadFile('index.html');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  return openDemoWindow();
}).catch((error) => {
  dialog.showErrorBox('PENS 启动失败', error.message);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
