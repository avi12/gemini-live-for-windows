// Byte layouts of the Win32 structs the display calls fill (x64). Parsing is pure so it is tested with
// hand-built buffers; the calls that fill them live in display-native.ts.

const WIDE_CHAR_BYTES = 2;
const DEVICE_NAME_CHARS = 32;
const DISPLAY_DEVICE_STRING_CHARS = 128;
const DWORD_BYTES = 4;
const RECT_EDGES = 4;
const RECT_BYTES = RECT_EDGES * DWORD_BYTES;

const MONITOR_INFO_FLAG_PRIMARY = 0x1;
const DISPLAY_DEVICE_FLAG_ATTACHED_TO_DESKTOP = 0x1;
const DISPLAY_DEVICE_FLAG_MIRRORING_DRIVER = 0x8;

// MONITORINFOEXW: cbSize, rcMonitor, rcWork, dwFlags, szDevice[32]
export const MonitorInfoLayout = {
  size: DWORD_BYTES + 2 * RECT_BYTES + DWORD_BYTES + DEVICE_NAME_CHARS * WIDE_CHAR_BYTES,
  monitorLeft: 4,
  monitorTop: 8,
  monitorRight: 12,
  monitorBottom: 16,
  workLeft: 20,
  workTop: 24,
  workRight: 28,
  workBottom: 32,
  flags: 36,
  deviceName: 40
} as const;

// DISPLAY_DEVICEW: cb, DeviceName[32], DeviceString[128], StateFlags, DeviceID[128], DeviceKey[128]
export const DisplayDeviceLayout = {
  size: DWORD_BYTES
    + DEVICE_NAME_CHARS * WIDE_CHAR_BYTES
    + DISPLAY_DEVICE_STRING_CHARS * WIDE_CHAR_BYTES
    + DWORD_BYTES
    + 2 * DISPLAY_DEVICE_STRING_CHARS * WIDE_CHAR_BYTES,
  deviceName: 4,
  stateFlags: 324
} as const;

// DEVMODEW, the display half of its union: dmPosition, then the pixel size of the current mode
export const DevModeLayout = {
  size: 220,
  sizeField: 68,
  positionX: 76,
  positionY: 80,
  pixelsWidth: 172,
  pixelsHeight: 176,
  displayFrequency: 184
} as const;

export const ENUM_CURRENT_SETTINGS = 0xffffffff;

export interface RawDisplay {
  deviceName: string;
  isPrimary: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
  workRight: number;
  workBottom: number;
  refreshRateHertz: number;
}

export interface ModeBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function wideStringAt({ bytes, offset, maxChars }: {
  bytes: Buffer;
  offset: number;
  maxChars: number;
}) {
  const text = bytes.toString("utf16le", offset, offset + maxChars * WIDE_CHAR_BYTES);
  const end = text.indexOf("\0");
  return end === -1 ? text : text.slice(0, end);
}

export function parseMonitorInfo(bytes: Buffer) {
  return {
    deviceName: wideStringAt({
      bytes,
      offset: MonitorInfoLayout.deviceName,
      maxChars: DEVICE_NAME_CHARS
    }),
    isPrimary: (bytes.readUInt32LE(MonitorInfoLayout.flags) & MONITOR_INFO_FLAG_PRIMARY) !== 0,
    left: bytes.readInt32LE(MonitorInfoLayout.monitorLeft),
    top: bytes.readInt32LE(MonitorInfoLayout.monitorTop),
    right: bytes.readInt32LE(MonitorInfoLayout.monitorRight),
    bottom: bytes.readInt32LE(MonitorInfoLayout.monitorBottom),
    workRight: bytes.readInt32LE(MonitorInfoLayout.workRight),
    workBottom: bytes.readInt32LE(MonitorInfoLayout.workBottom)
  };
}

export function parseDisplayDevice(bytes: Buffer) {
  const stateFlags = bytes.readUInt32LE(DisplayDeviceLayout.stateFlags);
  return {
    deviceName: wideStringAt({
      bytes,
      offset: DisplayDeviceLayout.deviceName,
      maxChars: DEVICE_NAME_CHARS
    }),
    isOnDesktop: (stateFlags & DISPLAY_DEVICE_FLAG_ATTACHED_TO_DESKTOP) !== 0,
    isMirroringDriver: (stateFlags & DISPLAY_DEVICE_FLAG_MIRRORING_DRIVER) !== 0
  };
}

export function parseModeRefreshRate(bytes: Buffer) {
  return bytes.readUInt32LE(DevModeLayout.displayFrequency);
}

export function parseModeBounds(bytes: Buffer) {
  const left = bytes.readInt32LE(DevModeLayout.positionX);
  const top = bytes.readInt32LE(DevModeLayout.positionY);
  return {
    left,
    top,
    right: left + bytes.readUInt32LE(DevModeLayout.pixelsWidth),
    bottom: top + bytes.readUInt32LE(DevModeLayout.pixelsHeight)
  };
}
