const { app, BrowserWindow, shell, dialog } = require('electron');

const PORT = process.env.PORT || 5172;
let mainWindow = null;
let serverModule = null;
let isQuitting = false;

function startServer() {
  process.env.ELECTRON_APP = 'true';
  process.env.PORT = String(PORT);
  process.env.OBS_LIVE_HELPER_DATA_DIR = app.getPath('userData');

  // runtimePaths must be required only after OBS_LIVE_HELPER_DATA_DIR is set.
  const runtimePaths = require('./services/runtimePaths');
  runtimePaths.ensureRuntimeDirs();

  serverModule = require('./server');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'OBS Live Helper',
    backgroundColor: '#070b18',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/html/dashboard.html`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}/`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function shutdown() {
  if (isQuitting) return;
  isQuitting = true;

  try {
    if (serverModule && typeof serverModule.shutdown === 'function') {
      await serverModule.shutdown();
    }
  } catch (err) {
    console.error('Shutdown error:', err);
  }
}

app.whenReady().then(() => {
  try {
    startServer();
    setTimeout(createWindow, 900);
  } catch (err) {
    console.error(err);
    dialog.showErrorBox('OBS Live Helper 啟動失敗', err.stack || err.message || String(err));
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  await shutdown();
  app.quit();
});

app.on('before-quit', async event => {
  if (isQuitting) return;
  event.preventDefault();
  await shutdown();
  app.exit(0);
});
