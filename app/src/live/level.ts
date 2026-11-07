const MIN_PEAK = 0;
const MAX_PEAK = 1;

function clampPeak(peak: number) {
  return Math.min(MAX_PEAK, Math.max(MIN_PEAK, peak));
}

// A muted mic reads silent even though the capture still hears the room
export function micLevel({ peak, isMuted }: {
  peak: number;
  isMuted: boolean;
}) {
  return isMuted ? MIN_PEAK : clampPeak(peak);
}

export function speakerLevel(peak: number) {
  return clampPeak(peak);
}
