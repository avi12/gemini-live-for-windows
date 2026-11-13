// Keeps the loudest peak seen since the last report and releases it at most once per interval, so the
// glow is not flooded: it follows the peak, and the peak is never lost between reports.
export function createLevelThrottle({
  intervalMilliseconds,
  now
}: {
  intervalMilliseconds: number;
  now: () => number;
}) {
  let heldPeak = 0;
  let lastReportAt = Number.NEGATIVE_INFINITY;

  function offer(peak: number) {
    heldPeak = Math.max(heldPeak, peak);
    const current = now();
    const isValueBelowIntervalMilliseconds = current - lastReportAt < intervalMilliseconds;
    if (isValueBelowIntervalMilliseconds) {
      return undefined;
    }

    const report = heldPeak;
    heldPeak = 0;
    lastReportAt = current;
    return report;
  }

  return { offer };
}
