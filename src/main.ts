import { app, BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'path';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { UsbWatcher } from './usb-watcher';

const isDev = !app.isPackaged;

// Load .env from multiple candidate locations
function loadEnv(): Record<string, string> {
  const candidates = [
    join(app.getAppPath(), '..', '.env'),   // bundled: Contents/Resources/.env
    join(process.cwd(), '.env'),            // dev: project root
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const env: Record<string, string> = {};
      readFileSync(p, 'utf-8').split('\n').forEach(line => {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
        if (match) env[match[1]] = match[2];
      });
      return env;
    }
  }
  return {};
}

const dotenv = loadEnv();
const DASHBOARD_URL = process.env.DASHBOARD_URL || dotenv.DASHBOARD_URL || 'https://findash.sykventure.com';

let mainWindow: BrowserWindow | null = null;
let usbWatcher: UsbWatcher | null = null;
let lastDetectedToken: string | null = null;

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    frame: false,
    titleBarStyle: 'hidden',
    title: 'Monday Finance',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
      allowRunningInsecureContent: false,
      webSecurity: true,
    },
  });

  // Block navigation to unexpected URLs (prevents redirect attacks)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = new URL(DASHBOARD_URL).origin;
    if (!url.startsWith(allowed)) event.preventDefault();
  });

  // Block new window creation (prevents window.open abuse)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Set strict permissions — deny everything the app doesn't need
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['clipboard-read', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });

  mainWindow.loadURL(DASHBOARD_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Start USB watcher for auto-login
  usbWatcher = new UsbWatcher();
  usbWatcher.onTokenFound((derivedToken) => {
    lastDetectedToken = derivedToken;
    mainWindow?.webContents.send('usb-token-detected', derivedToken);
  });
  usbWatcher.start();

  // Allow frontend to pull the last token after mounting (fixes race condition)
  ipcMain.removeHandler('get-current-token');
  ipcMain.handle('get-current-token', () => lastDetectedToken);
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  usbWatcher?.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
