import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface RemovableDrive {
  device: string;       // parent disk e.g. /dev/disk10
  mountpoint: string;   // e.g. /Volumes/NO NAME
  description: string;
  size: number;
}

export async function listRemovableDrives(): Promise<RemovableDrive[]> {
  if (process.platform === 'darwin') {
    return listMacDrives();
  } else if (process.platform === 'win32') {
    return listWindowsDrives();
  }
  return [];
}

async function listMacDrives(): Promise<RemovableDrive[]> {
  const drives: RemovableDrive[] = [];

  const { stdout: listOut } = await execFileAsync('diskutil', ['list']);

  // Find external physical disks: /dev/disk10 (external, physical)
  const externalRegex = /\/dev\/(disk\d+)\s+\(external,\s+physical\)/g;
  const externalDisks: string[] = [];
  let match;
  while ((match = externalRegex.exec(listOut)) !== null) {
    externalDisks.push(match[1]);
  }

  for (const baseDisk of externalDisks) {
    // Find partitions (e.g. disk10s1)
    const partRegex = new RegExp(`(${baseDisk}s\\d+)`, 'g');
    const partitions: string[] = [];
    let partMatch;
    while ((partMatch = partRegex.exec(listOut)) !== null) {
      partitions.push(partMatch[1]);
    }
    if (partitions.length === 0) partitions.push(baseDisk);

    for (const part of partitions) {
      try {
        const { stdout: info } = await execFileAsync('diskutil', ['info', part]);

        const mountMatch = info.match(/Mount Point:\s+(.+)/);
        const mp = mountMatch?.[1]?.trim();
        if (!mp || mp === 'Not applicable') continue;

        const volName = info.match(/Volume Name:\s+(.+)/)?.[1]?.trim();
        const sizeMatch = info.match(/Disk Size:\s+[\d.]+ \w+ \((\d+) Bytes\)/);
        const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;

        drives.push({
          device: `/dev/${baseDisk}`,
          mountpoint: mp,
          description: volName || baseDisk,
          size,
        });
      } catch {
        // partition not accessible
      }
    }
  }

  return drives;
}

async function listWindowsDrives(): Promise<RemovableDrive[]> {
  // PowerShell: list removable drives with physical disk index
  const ps = `Get-WmiObject Win32_LogicalDisk -Filter "DriveType=2" | ForEach-Object {
    $ld = $_; $part = Get-WmiObject -Query "ASSOCIATORS OF {Win32_LogicalDisk.DeviceID='$($ld.DeviceID)'} WHERE AssocClass=Win32_LogicalDiskToPartition";
    $disk = if($part){Get-WmiObject -Query "ASSOCIATORS OF {Win32_DiskPartition.DeviceID='$($part.DeviceID)'} WHERE AssocClass=Win32_DiskDriveToDiskPartition"}else{$null};
    [PSCustomObject]@{Drive=$ld.DeviceID;Name=$ld.VolumeName;Size=$ld.Size;DiskIndex=if($disk){$disk.Index}else{-1}}
  } | ConvertTo-Json -Compress`;

  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', ps]);
  const drives: RemovableDrive[] = [];

  try {
    const parsed = JSON.parse(stdout);
    const items = Array.isArray(parsed) ? parsed : [parsed];

    for (const item of items) {
      if (!item.Drive) continue;
      const diskIndex = item.DiskIndex ?? -1;
      drives.push({
        device: diskIndex >= 0 ? `\\\\.\\PhysicalDrive${diskIndex}` : item.Drive,
        mountpoint: item.Drive + '\\',
        description: item.Name || item.Drive,
        size: parseInt(item.Size, 10) || 0,
      });
    }
  } catch {
    // parse failure — no drives or unexpected output
  }

  return drives;
}
