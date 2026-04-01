import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function getDriveSerial(devicePath: string): Promise<string | null> {
  try {
    if (process.platform === 'darwin') {
      return await getMacSerial(devicePath);
    } else if (process.platform === 'win32') {
      return await getWindowsSerial(devicePath);
    }
    return null;
  } catch {
    return null;
  }
}

async function getMacSerial(devicePath: string): Promise<string | null> {
  const bsdName = devicePath.replace('/dev/', '');

  // Primary: ioreg plist — bypasses TCC, works on all macOS versions including Tahoe.
  // IOUSBHostDevice has "USB Serial Number" before its children subtree which contains
  // IOMedia with "BSD Name". Search backward from BSD name to find nearest serial.
  try {
    const { stdout } = await execFileAsync('ioreg', ['-r', '-c', 'IOUSBHostDevice', '-l', '-a']);
    if (stdout.trim()) {
      const serial = extractSerialFromIoregPlist(stdout, bsdName);
      if (serial) return serial;
    }
  } catch {
    // ioreg not available
  }

  // Fallback: system_profiler text (works on macOS 14 and below)
  try {
    const { stdout } = await execFileAsync('system_profiler', ['SPUSBDataType']);
    if (stdout.trim()) {
      const serial = parseUsbSerialText(stdout, bsdName);
      if (serial) return serial;
    }
  } catch {
    // system_profiler not available
  }

  return null;
}

function extractSerialFromIoregPlist(xml: string, bsdName: string): string | null {
  const bsdRegex = new RegExp(
    `<key>BSD Name<\\/key>\\s*<string>(${bsdName}|${bsdName}s\\d+)<\\/string>`
  );
  const bsdMatch = bsdRegex.exec(xml);
  if (!bsdMatch) return null;

  // USB Serial Number lives in the parent IOUSBHostDevice dict which appears
  // AFTER the children (BSD Name is deep in children). Search forward.
  const following = xml.substring(bsdMatch.index);
  const serialMatch = following.match(/<key>USB Serial Number<\/key>\s*<string>([^<]+)<\/string>/);
  if (serialMatch?.[1]?.trim()) return serialMatch[1].trim();

  return null;
}

function parseUsbSerialText(output: string, bsdName: string): string | null {
  const lines = output.split('\n');
  const blockStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^( {4,12})(\S.*):$/)) blockStarts.push(i);
  }
  for (let b = 0; b < blockStarts.length; b++) {
    const start = blockStarts[b];
    const end = b + 1 < blockStarts.length ? blockStarts[b + 1] : lines.length;
    const block = lines.slice(start, end);
    if (!block.join('\n').includes(`BSD Name: ${bsdName}`)) continue;
    for (const line of block) {
      const m = line.match(/^\s+Serial Number:\s*(.+)\s*$/);
      if (m?.[1]?.trim()) return m[1].trim();
    }
  }
  return null;
}

async function getWindowsSerial(devicePath: string): Promise<string | null> {
  const driveIndex = devicePath.match(/PhysicalDrive(\d+)/)?.[1];
  if (!driveIndex) return null;

  const ps = `(Get-WmiObject Win32_DiskDrive -Filter "Index=${driveIndex}").SerialNumber`;
  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', ps]);

  const serial = stdout.trim();
  if (serial) return serial;

  return null;
}
