import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { listRemovableDrives } from './drives';
import { getDriveSerial } from './drive-serial';
import { decryptToken } from './token-crypto';

const TOKEN_FILENAME = '.monday-token';
const POLL_INTERVAL_MS = 2000;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class UsbWatcher {
  private interval: NodeJS.Timeout | null = null;
  private knownTokens = new Set<string>();
  private callback: ((derivedToken: string) => void) | null = null;

  onTokenFound(cb: (derivedToken: string) => void): void {
    this.callback = cb;
  }

  start(): void {
    this.scan();
    this.interval = setInterval(() => this.scan(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async scan(): Promise<void> {
    try {
      const drives = await listRemovableDrives();

      for (const drive of drives) {
        const serial = await getDriveSerial(drive.device);
        if (!serial) continue;

        const tokenPath = join(drive.mountpoint, TOKEN_FILENAME);
        try {
          const fileContent = readFileSync(tokenPath, 'utf-8').trim();

          // Try decrypt first (encrypted tokens), fall back to plain UUID (legacy)
          let uuid = decryptToken(fileContent, serial);
          if (!uuid || !UUID_V4_REGEX.test(uuid)) {
            // Legacy: file contains plain UUID
            if (UUID_V4_REGEX.test(fileContent)) uuid = fileContent;
            else continue;
          }

          const derivedToken = createHash('sha256')
            .update(uuid + serial)
            .digest('hex');

          if (!this.knownTokens.has(derivedToken)) {
            this.knownTokens.add(derivedToken);
            this.callback?.(derivedToken);
          }
        } catch {
          // No token file or decryption failed — expected
        }
      }
    } catch (err) {
      console.error('[UsbWatcher] scan error:', err);
    }
  }
}
