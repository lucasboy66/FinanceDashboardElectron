import { app, BrowserWindow, ipcMain, session, Menu } from 'electron';
import * as path from 'path';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { UsbWatcher } from './usb-watcher';
import { listRemovableDrives } from './drives';
import { getDriveSerial } from './drive-serial';
import { decryptToken } from './token-crypto';

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
      devTools: true,
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

  // On every page load (initial load or reload after JS error), resend cached token
  mainWindow.webContents.on('did-finish-load', () => {
    if (lastDetectedToken) {
      mainWindow?.webContents.send('usb-token-detected', lastDetectedToken);
    } else {
      // Page reloaded but watcher already saw the drive — force a re-scan
      usbWatcher?.clearKnown();
    }
  });

  // Allow frontend to pull the last token after mounting (fixes race condition)
  ipcMain.removeHandler('get-current-token');
  ipcMain.handle('get-current-token', () => lastDetectedToken);

  // Debug: scan USB and return raw results — call from devtools: await window.electronAPI.debugScan()
  ipcMain.removeHandler('debug-usb-scan');
  ipcMain.handle('debug-usb-scan', async () => {
    try {
      const drives = await listRemovableDrives();

      // Capture raw ioreg output for diagnosis
      let rawUsbJson: unknown = null;
      try {
        const { execFile: ef } = await import('child_process');
        const { promisify: prom } = await import('util');
        const execFileAsync2 = prom(ef);
        const { stdout } = await execFileAsync2('ioreg', ['-r', '-c', 'IOUSBHostDevice', '-l', '-a']);
        // Find USB Serial Number and BSD Name positions for diagnosis
        const serialIdx = stdout.indexOf('<key>USB Serial Number</key>');
        const bsdIdx = stdout.indexOf('<key>BSD Name</key>');
        rawUsbJson = {
          source: 'ioreg_IOUSBHostDevice',
          totalLength: stdout.length,
          usbSerialFoundAt: serialIdx,
          bsdNameFoundAt: bsdIdx,
          aroundSerial: serialIdx >= 0 ? stdout.slice(Math.max(0, serialIdx - 50), serialIdx + 200) : null,
          aroundBsd: bsdIdx >= 0 ? stdout.slice(Math.max(0, bsdIdx - 50), bsdIdx + 200) : null,
        };
      } catch (e) {
        rawUsbJson = `ERROR: ${e}`;
      }

      const results = await Promise.all(drives.map(async (d) => {
        const serial = await getDriveSerial(d.device).catch(e => `ERROR: ${e}`);
        const tokenPath = join(d.mountpoint, '.monday-token');
        const tokenExists = existsSync(tokenPath);
        let tokenContent: string | null = null;
        if (tokenExists) {
          try { tokenContent = readFileSync(tokenPath, 'utf-8').trim(); } catch (e) { tokenContent = `READ_ERROR: ${e}`; }
        }
        let decryptResult: string | null = null;
        let decryptError: string | null = null;
        if (tokenContent && serial && typeof serial === 'string') {
          try { decryptResult = decryptToken(tokenContent, serial); } catch (e) { decryptError = String(e); }
        }
        return { device: d.device, mountpoint: d.mountpoint, serial, tokenExists, tokenContent, decryptResult, decryptError, lastDetectedToken };
      }));
      return { drives: results, lastDetectedToken, rawUsbJson };
    } catch (e) {
      return { error: String(e), lastDetectedToken };
    }
  });
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Monday Finance',
      submenu: [
        { label: 'About Monday Finance', role: 'about' },
        { type: 'separator' },
        { label: 'Quit', role: 'quit', accelerator: 'CmdOrCtrl+Q' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => { mainWindow?.webContents.toggleDevTools(); },
        },
        { type: 'separator' },
        { label: 'Reload', role: 'reload', accelerator: 'CmdOrCtrl+R' },
        { label: 'Actual Size', role: 'resetZoom' },
        { label: 'Zoom In', role: 'zoomIn' },
        { label: 'Zoom Out', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Full Screen', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', role: 'minimize' },
        { label: 'Zoom', role: 'zoom' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => { createWindow(); buildMenu(); });

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
