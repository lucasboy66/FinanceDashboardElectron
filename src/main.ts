import { app, BrowserWindow, Menu } from 'electron';
import * as path from 'path';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { UsbWatcher } from './usb-watcher';

// Load .env from multiple candidate locations
function loadEnv(): Record<string, string> {
  // extraResources puts .env at Contents/Resources/.env
  // app.getAppPath() = Contents/Resources/app.asar → ../.env = Contents/Resources/.env
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
  // Remove default menu (hides View > Developer Tools, Edit, etc.)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ]));

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Monday Finance',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  });

  mainWindow.loadURL(DASHBOARD_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Start USB watcher for auto-login
  usbWatcher = new UsbWatcher();
  usbWatcher.onTokenFound((derivedToken) => {
    mainWindow?.webContents.send('usb-token-detected', derivedToken);
  });
  usbWatcher.start();
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
