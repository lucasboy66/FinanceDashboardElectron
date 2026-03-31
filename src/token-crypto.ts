import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-cbc';

/**
 * Derive a 32-byte AES key from the drive serial string.
 */
function deriveKey(driveSerial: string): Buffer {
  return createHash('sha256').update(driveSerial).digest();
}

/**
 * Encrypt a UUID using the drive serial as the key.
 * Returns a hex string: iv (32 hex) + encrypted data.
 */
export function encryptToken(uuid: string, driveSerial: string): string {
  const key = deriveKey(driveSerial);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(uuid, 'utf-8'), cipher.final()]);
  return iv.toString('hex') + encrypted.toString('hex');
}

/**
 * Decrypt a .monday-token file content using the drive serial as the key.
 * Returns the original UUID string.
 */
export function decryptToken(encryptedHex: string, driveSerial: string): string | null {
  try {
    const key = deriveKey(driveSerial);
    const iv = Buffer.from(encryptedHex.slice(0, 32), 'hex');
    const data = Buffer.from(encryptedHex.slice(32), 'hex');
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf-8');
  } catch {
    return null;
  }
}
