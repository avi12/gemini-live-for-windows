// Live announces itself with a tone each time it starts and each time it pauses: two short files
// from Google's static host. Live also pauses by itself every half minute, and the bridge resumes it,
// which would play both tones again and again. So the tones are held back, except for a moment after
// the user starts or ends Live themselves.

const TONE_SOURCE = /^https:\/\/gemini\.gstatic\.com\/.+\.ogg(?:$|\?)/;

/** Holds back Live's tones. The gate is `allowFor`: tones may play for that many milliseconds. */
export function muteTones() {
  const audible = { until: 0 };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function playGated(this: HTMLMediaElement) {
    const isTone = TONE_SOURCE.test(this.currentSrc);
    const isHeldBack = isTone && Date.now() > audible.until;
    if (isHeldBack) {
      return Promise.resolve();
    }

    return play.call(this);
  };

  return {
    allowFor(milliseconds: number) {
      audible.until = Date.now() + milliseconds;
    }
  };
}
