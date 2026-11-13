import { argHandle, argPointer, argU32, argWideString, bindFunction, Win32Type, withMemory } from "@/win32/bind.ts";
import { foregroundWindowHandle, readCursorPosition } from "@/win32/user32.ts";

import {
  DevModeLayout,
  DisplayDeviceLayout,
  ENUM_CURRENT_SETTINGS,
  MonitorInfoLayout,
  parseDisplayDevice,
  parseModeBounds,
  parseModeRefreshRate,
  parseMonitorInfo
} from "./monitor-structs.ts";
import type { ModeBounds, RawDisplay } from "./monitor-structs.ts";
import type { DisplayNative } from "./monitors.ts";

const MONITOR_DEFAULT_TO_NEAREST = 2;
const MAX_DEVICES = 64;
const RECT_BYTES = 16;
const RECT_TOP_OFFSET = 4;
const RECT_RIGHT_OFFSET = 8;
const RECT_BOTTOM_OFFSET = 12;
const CURSOR_PROBE_PIXELS = 1;
const NO_FLAGS = 0;

const enumDisplayDevices = bindFunction({
  library: "user32.dll",
  entryPoint: "EnumDisplayDevicesW",
  parameters: [Win32Type.POINTER, Win32Type.U32, Win32Type.POINTER, Win32Type.U32],
  returns: Win32Type.BOOL32
});

const enumDisplaySettings = bindFunction({
  library: "user32.dll",
  entryPoint: "EnumDisplaySettingsW",
  parameters: [Win32Type.POINTER, Win32Type.U32, Win32Type.POINTER],
  returns: Win32Type.BOOL32
});

const monitorFromRect = bindFunction({
  library: "user32.dll",
  entryPoint: "MonitorFromRect",
  parameters: [Win32Type.POINTER, Win32Type.U32],
  returns: Win32Type.HANDLE
});

const monitorFromWindow = bindFunction({
  library: "user32.dll",
  entryPoint: "MonitorFromWindow",
  parameters: [Win32Type.HANDLE, Win32Type.U32],
  returns: Win32Type.HANDLE
});

const getMonitorInfo = bindFunction({
  library: "user32.dll",
  entryPoint: "GetMonitorInfoW",
  parameters: [Win32Type.HANDLE, Win32Type.POINTER],
  returns: Win32Type.BOOL32
});

function attachedDeviceNames() {
  const names: string[] = [];
  for (let iDevice = 0; iDevice < MAX_DEVICES; iDevice++) {
    const device = withMemory({
      size: DisplayDeviceLayout.size,
      use(memory) {
        memory.writeU32(0, DisplayDeviceLayout.size);
        const found = enumDisplayDevices([argPointer(null), argU32(iDevice), argPointer(memory), argU32(NO_FLAGS)]);
        const isFound = found.number !== 0;
        return isFound ? parseDisplayDevice(memory.readBytes(0, DisplayDeviceLayout.size)) : undefined;
      }
    });
    const isDeviceMissing = device === undefined;
    if (isDeviceMissing) {
      break;
    }

    const isRealDisplay = device.isOnDesktop && !device.isMirroringDriver;
    if (isRealDisplay) {
      names.push(device.deviceName);
    }
  }
  return names;
}

function currentMode(deviceName: string) {
  return withMemory({
    size: DevModeLayout.SIZE,
    use(memory) {
      memory.writeU16(DevModeLayout.SIZE_FIELD, DevModeLayout.SIZE);
      const read = enumDisplaySettings([argWideString(deviceName), argU32(ENUM_CURRENT_SETTINGS), argPointer(memory)]);
      const isRead = read.number !== 0;
      if (!isRead) {
        return undefined;
      }

      const bytes = memory.readBytes(0, DevModeLayout.SIZE);
      return {
        bounds: parseModeBounds(bytes),
        refreshRateHertz: parseModeRefreshRate(bytes)
      };
    }
  });
}

function monitorInfoOf(monitor: bigint) {
  return withMemory({
    size: MonitorInfoLayout.size,
    use(memory) {
      memory.writeU32(0, MonitorInfoLayout.size);
      const isRead = getMonitorInfo([argHandle(monitor), argPointer(memory)]).number !== 0;
      return isRead ? parseMonitorInfo(memory.readBytes(0, MonitorInfoLayout.size)) : undefined;
    }
  });
}

function monitorAtRect(bounds: ModeBounds) {
  return withMemory({
    size: RECT_BYTES,
    use(memory) {
      memory.writeI32(0, bounds.left);
      memory.writeI32(RECT_TOP_OFFSET, bounds.top);
      memory.writeI32(RECT_RIGHT_OFFSET, bounds.right);
      memory.writeI32(RECT_BOTTOM_OFFSET, bounds.bottom);
      return monitorFromRect([argPointer(memory), argU32(MONITOR_DEFAULT_TO_NEAREST)]).address;
    }
  });
}

function listRawDisplays() {
  const displays: RawDisplay[] = [];
  for (const deviceName of attachedDeviceNames()) {
    const mode = currentMode(deviceName);
    const info = mode === undefined ? undefined : monitorInfoOf(monitorAtRect(mode.bounds));
    const hasInfo = info !== undefined;
    if (hasInfo) {
      displays.push({
        ...info,
        refreshRateHertz: mode?.refreshRateHertz ?? 0
      });
    }
  }
  return displays;
}

function foregroundDisplayName() {
  const monitor = monitorFromWindow([argHandle(foregroundWindowHandle()), argU32(MONITOR_DEFAULT_TO_NEAREST)]).address;
  return monitorInfoOf(monitor)?.deviceName;
}

function cursorDisplayName() {
  const cursor = readCursorPosition();
  const isCursorUnknown = cursor === undefined;
  if (isCursorUnknown) {
    return undefined;
  }

  const monitor = monitorAtRect({
    left: cursor.x,
    top: cursor.y,
    right: cursor.x + CURSOR_PROBE_PIXELS,
    bottom: cursor.y + CURSOR_PROBE_PIXELS
  });
  return monitorInfoOf(monitor)?.deviceName;
}

export function createDisplayNative() {
  return {
    listRawDisplays,
    foregroundDisplayName,
    cursorDisplayName
  } satisfies DisplayNative;
}
