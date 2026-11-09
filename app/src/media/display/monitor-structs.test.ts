import {
  DevModeLayout,
  DisplayDeviceLayout,
  MonitorInfoLayout,
  parseDisplayDevice,
  parseModeBounds,
  parseModeRefreshRate,
  parseMonitorInfo,
  wideStringAt
} from "./monitor-structs.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const NUMBER_2160 = 2160;
const NUMBER_3840 = 3840;
const NEGATIVE_NUMBER_134 = -134;
const NEGATIVE_NUMBER_3840 = -3840;
const NUMBER_1978 = 1978;
const NEGATIVE_NUMBER_10 = -10;
const NUMBER_2026 = 2026;
const NUMBER_220 = 220;
const NUMBER_840 = 840;
const NUMBER_104 = 104;
const NUMBER_120 = 120;

function writeWide({ bytes, offset, text }: {
  bytes: Buffer;
  offset: number;
  text: string;
}) {
  bytes.write(`${text}\0`, offset, "utf16le");
}

describe("struct sizes", () => {
  it("match the Windows headers on x64", () => {
    assert.equal(MonitorInfoLayout.size, NUMBER_104);
    assert.equal(DisplayDeviceLayout.size, NUMBER_840);
    assert.equal(DevModeLayout.size, NUMBER_220);
  });
});

describe("MONITORINFOEXW", () => {
  function build({ flags, deviceName }: {
    flags: number;
    deviceName: string;
  }) {
    const bytes = Buffer.alloc(MonitorInfoLayout.size);
    bytes.writeUInt32LE(MonitorInfoLayout.size, 0);
    bytes.writeInt32LE(NEGATIVE_NUMBER_3840, MonitorInfoLayout.monitorLeft);
    bytes.writeInt32LE(NEGATIVE_NUMBER_134, MonitorInfoLayout.monitorTop);
    bytes.writeInt32LE(0, MonitorInfoLayout.monitorRight);
    bytes.writeInt32LE(NUMBER_2026, MonitorInfoLayout.monitorBottom);
    bytes.writeInt32LE(NEGATIVE_NUMBER_3840, MonitorInfoLayout.workLeft);
    bytes.writeInt32LE(NEGATIVE_NUMBER_134, MonitorInfoLayout.workTop);
    bytes.writeInt32LE(NEGATIVE_NUMBER_10, MonitorInfoLayout.workRight);
    bytes.writeInt32LE(NUMBER_1978, MonitorInfoLayout.workBottom);
    bytes.writeUInt32LE(flags, MonitorInfoLayout.flags);
    writeWide({
      bytes,
      offset: MonitorInfoLayout.deviceName,
      text: deviceName
    });
    return bytes;
  }

  it("reads the rectangles, including negative coordinates, and the device name", () => {
    const raw = parseMonitorInfo(
      build({
        flags: 0,
        deviceName: "\\\\.\\DISPLAY14"
      })
    );
    assert.deepEqual(raw, {
      deviceName: "\\\\.\\DISPLAY14",
      isPrimary: false,
      left: -3840,
      top: -134,
      right: 0,
      bottom: 2026,
      workRight: -10,
      workBottom: 1978
    });
  });

  it("reads the primary flag", () => {
    assert.equal(
      parseMonitorInfo(
        build({
          flags: 1,
          deviceName: "\\\\.\\DISPLAY1"
        })
      ).isPrimary, true
    );
  });
});

describe("DISPLAY_DEVICEW", () => {
  function build({ flags, name }: {
    flags: number;
    name: string;
  }) {
    const bytes = Buffer.alloc(DisplayDeviceLayout.size);
    bytes.writeUInt32LE(DisplayDeviceLayout.size, 0);
    writeWide({
      bytes,
      offset: DisplayDeviceLayout.deviceName,
      text: name
    });
    bytes.writeUInt32LE(flags, DisplayDeviceLayout.stateFlags);
    return bytes;
  }

  it("reads the name and whether it is on the desktop", () => {
    assert.deepEqual(
      parseDisplayDevice(
        build({
          flags: 0x5,
          name: "\\\\.\\DISPLAY13"
        })
      ), {
        deviceName: "\\\\.\\DISPLAY13",
        isOnDesktop: true,
        isMirroringDriver: false
      }
    );
  });

  it("flags a device that is off the desktop, and a mirroring driver", () => {
    const parsed = parseDisplayDevice(
      build({
        flags: 0x8,
        name: "x"
      })
    );
    assert.equal(parsed.isOnDesktop, false);
    assert.equal(parsed.isMirroringDriver, true);
  });
});

describe("DEVMODEW", () => {
  it("turns position and pixel size into bounds", () => {
    const bytes = Buffer.alloc(DevModeLayout.size);
    bytes.writeInt32LE(NEGATIVE_NUMBER_3840, DevModeLayout.positionX);
    bytes.writeInt32LE(NEGATIVE_NUMBER_134, DevModeLayout.positionY);
    bytes.writeUInt32LE(NUMBER_3840, DevModeLayout.pixelsWidth);
    bytes.writeUInt32LE(NUMBER_2160, DevModeLayout.pixelsHeight);
    assert.deepEqual(parseModeBounds(bytes), {
      left: -3840,
      top: -134,
      right: 0,
      bottom: 2026
    });
  });

  it("reads the refresh rate from dmDisplayFrequency", () => {
    const bytes = Buffer.alloc(DevModeLayout.size);
    bytes.writeUInt32LE(NUMBER_120, DevModeLayout.displayFrequency);
    assert.equal(parseModeRefreshRate(bytes), NUMBER_120);
  });
});

describe("wide strings", () => {
  it("stops at the terminator, and at the field's end when there is none", () => {
    const bytes = Buffer.from("ab\0cd", "utf16le");
    assert.equal(
      wideStringAt({
        bytes,
        offset: 0,
        maxChars: 5
      }), "ab"
    );
    assert.equal(
      wideStringAt({
        bytes: Buffer.from("abcd", "utf16le"),
        offset: 0,
        maxChars: 2
      }), "ab"
    );
  });
});
