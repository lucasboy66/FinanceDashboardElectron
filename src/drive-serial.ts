import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Reads the hardware serial number of a USB drive given its device path.
 * macOS: uses system_profiler SPUSBDataType to find the USB serial by BSD Name
 * Windows: uses wmic diskdrive to get SerialNumber by drive index
 */
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
  // devicePath from drivelist looks like /dev/disk10
  const bsdName = devicePath.replace('/dev/', ''); // e.g. "disk10"

  // system_profiler returns all USB devices with their BSD names and serial numbers
  const { stdout } = await execFileAsync('system_profiler', ['SPUSBDataType']);

  // Split into device blocks and find the one containing our BSD name
  const blocks = stdout.split(/\n(?=\s{8}\S)/);
  for (const block of blocks) {
    if (block.includes(`BSD Name: ${bsdName}`)) {
      // Look upward in the full output for the Serial Number of this device's parent
      const blockStart = stdout.indexOf(block);
      const preceding = stdout.substring(0, blockStart);
      // Find the last "Serial Number:" before this BSD Name entry
      const serialMatches = [...preceding.matchAll(/Serial Number:\s*(.+)/g)];
      if (serialMatches.length > 0) {
        const serial = serialMatches[serialMatches.length - 1][1].trim();
        if (serial) return serial;
      }
    }
  }

  // Fallback: try ioreg for USB Serial Number
  try {
    const { stdout: ioregOut } = await execFileAsync('ioreg', [
      '-r', '-c', 'IOUSBHostDevice', '-l',
    ]);
    const serialMatch = ioregOut.match(/"USB Serial Number"\s*=\s*"([^"]+)"/);
    if (serialMatch?.[1]) {
      return serialMatch[1];
    }
  } catch {
    // ioreg not available or no match
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
