import type { CaptureScheduler } from "./capture-schema.ts";

export const timerScheduler: CaptureScheduler = {
  repeat({ intervalMilliseconds, run }) {
    let deadline = performance.now() + intervalMilliseconds;
    let timer: NodeJS.Timeout | undefined;

    function arm() {
      timer = setTimeout(fire, Math.max(0, Math.floor(deadline - performance.now())));
    }

    function fire() {
      run();
      deadline = Math.max(deadline + intervalMilliseconds, performance.now());
      arm();
    }

    arm();
    return () => clearTimeout(timer);
  }
};
