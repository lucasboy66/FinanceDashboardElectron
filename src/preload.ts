import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  onTokenDetected: (callback: (derivedToken: string) => void) => {
    ipcRenderer.on('usb-token-detected', (_event, derivedToken: string) => {
      callback(derivedToken);
    });
  },
  removeTokenListeners: () => {
    ipcRenderer.removeAllListeners('usb-token-detected');
  },
  getCurrentToken: (): Promise<string | null> => ipcRenderer.invoke('get-current-token'),
  debugScan: (): Promise<unknown> => ipcRenderer.invoke('debug-usb-scan'),
});
