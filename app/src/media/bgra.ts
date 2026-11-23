// The 32-bit pixel layout GDI and WinRT hand the app: blue, green, red, then alpha, one byte each
export const Bgra = {
  BYTES_PER_PIXEL: 4,
  BLUE_OFFSET: 0,
  GREEN_OFFSET: 1,
  RED_OFFSET: 2
} as const;
