import type { Monitor } from "@/contracts/monitor.ts";

// Two displays side by side, as the tests' fake world has them
export const PRIMARY: Monitor = {
  deviceName: "\\\\.\\DISPLAY1",
  index: 1,
  isPrimary: true,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  workRight: 1920,
  workBottom: 1040,
  refreshRateHertz: 60
};

export const SECONDARY: Monitor = {
  deviceName: "\\\\.\\DISPLAY2",
  index: 2,
  isPrimary: false,
  x: 1920,
  y: 0,
  width: 2560,
  height: 1440,
  workRight: 4480,
  workBottom: 1400,
  refreshRateHertz: 120
};
