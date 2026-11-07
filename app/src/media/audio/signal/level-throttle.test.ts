import { createLevelThrottle } from "./level-throttle.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const NUMBER_30 = 30;
const NUMBER_24 = 24;
const NUMBER_0_POINT_5 = 0.5;
const NUMBER_10 = 10;
const NUMBER_100 = 100;
const NUMBER_0_POINT_8 = 0.8;
const NUMBER_0_POINT_1 = 0.1;
const NUMBER_0_POINT_9 = 0.9;
const NUMBER_0_POINT_2 = 0.2;
const NUMBER_20 = 20;
const NUMBER_0_POINT_3 = 0.3;
const NUMBER_0_POINT_4 = 0.4;

const INTERVAL = 33;

function setup() {
  let time = 0;
  const throttle = createLevelThrottle({
    intervalMilliseconds: INTERVAL,
    now: () => time
  });
  return {
    throttle,
    advance(milliseconds: number) {
      time += milliseconds;
    }
  };
}

describe("level throttle", () => {
  it("reports the first peak at once", () => {
    const { throttle } = setup();
    assert.equal(throttle.offer(NUMBER_0_POINT_4), NUMBER_0_POINT_4);
  });

  it("holds reports back inside the interval", () => {
    const { throttle, advance } = setup();
    throttle.offer(NUMBER_0_POINT_1);
    advance(NUMBER_10);
    assert.equal(throttle.offer(NUMBER_0_POINT_2), undefined);
    advance(NUMBER_10);
    assert.equal(throttle.offer(NUMBER_0_POINT_2), undefined);
  });

  it("releases the loudest peak seen since the last report", () => {
    const { throttle, advance } = setup();
    throttle.offer(NUMBER_0_POINT_1);
    advance(NUMBER_10);
    throttle.offer(NUMBER_0_POINT_9);
    advance(NUMBER_10);
    throttle.offer(NUMBER_0_POINT_3);
    advance(NUMBER_20);
    assert.equal(throttle.offer(NUMBER_0_POINT_2), NUMBER_0_POINT_9);
  });

  it("starts the next window fresh", () => {
    const { throttle, advance } = setup();
    throttle.offer(NUMBER_0_POINT_9);
    advance(INTERVAL);
    assert.equal(throttle.offer(NUMBER_0_POINT_1), NUMBER_0_POINT_1);
  });

  it("reports silence after speech, so the glow can fall", () => {
    const { throttle, advance } = setup();
    throttle.offer(NUMBER_0_POINT_8);
    advance(INTERVAL);
    assert.equal(throttle.offer(0), 0);
  });

  it("holds a report at the edge of the interval, releases at exactly the interval", () => {
    const { throttle, advance } = setup();
    throttle.offer(NUMBER_0_POINT_5);
    advance(INTERVAL - 1);
    assert.equal(throttle.offer(NUMBER_0_POINT_5), undefined);
    advance(1);
    assert.equal(throttle.offer(NUMBER_0_POINT_5), NUMBER_0_POINT_5);
  });

  it("releases about thirty reports a second at a 10 ms poll", () => {
    const { throttle, advance } = setup();
    let reports = 0;
    for (let iPoll = 0; iPoll < NUMBER_100; iPoll++) {
      advance(NUMBER_10);
      const isReported = throttle.offer(NUMBER_0_POINT_5) !== undefined;
      if (isReported) {
        reports += 1;
      }
    }
    assert.ok(reports >= NUMBER_24 && reports <= NUMBER_30, String(reports));
  });
});
