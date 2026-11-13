import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  barPlacement,
  BarSide,
  brackets,
  cornerRadius,
  followCorner,
  grabCorner,
  isFallingCorner,
  joinWords,
  loopSelection,
  moved,
  nearestCorner,
  pixelRegion,
  roundedRectsPath,
  scrimPath,
  textWords,
  wordAt,
  wordsBetween,
  wordsIn,
  wordsOnLine
} from "@/overlays/circle/gesture/geometry.ts";
import type { TextWord } from "@/overlays/circle/gesture/geometry.ts";

const SCREEN = {
  width: 1920,
  height: 1080
};
const SELECTION_RADIUS_EXPECTED = 24;
const SHRUNK_RADIUS_EXPECTED = 15;
const BAR_MARGIN_EXPECTED = 16;
const FOURTH_WORD = 3;
const WORD_TWO = 2;
const WORD_FOUR = 4;
const WORD_FIVE = 5;
const TWO_TO_FIVE = [WORD_TWO, FOURTH_WORD, WORD_FOUR, WORD_FIVE];
const ALL_WORDS = [0, 1, WORD_TWO, FOURTH_WORD];
const SECOND_LINE_WORDS = [WORD_TWO, FOURTH_WORD];
const NOT_A_WORD = 99;
const BAR = {
  width: 300,
  height: 64
};

const WORDS: readonly TextWord[] = [
  {
    text: "alpha",
    bounds: {
      x: 10,
      y: 10,
      width: 50,
      height: 20
    },
    line: 0
  },
  {
    text: "beta",
    bounds: {
      x: 70,
      y: 10,
      width: 40,
      height: 20
    },
    line: 0
  },
  {
    text: "gamma",
    bounds: {
      x: 10,
      y: 50,
      width: 60,
      height: 20
    },
    line: 1
  },
  {
    text: "delta",
    bounds: {
      x: 80,
      y: 50,
      width: 50,
      height: 20
    },
    line: 1
  }
];

describe("loopSelection", () => {
  it("pads the bounding box of the loop", () => {
    const selection = loopSelection({
      loop: [
        {
          x: 100,
          y: 100
        },
        {
          x: 300,
          y: 200
        },
        {
          x: 150,
          y: 120
        }
      ],
      screen: SCREEN
    });
    assert.deepEqual(selection, {
      x: 84,
      y: 84,
      width: 232,
      height: 132
    });
  });

  it("keeps the selection on the screen", () => {
    const selection = loopSelection({
      loop: [
        {
          x: 0,
          y: 0
        },
        {
          x: 50,
          y: 50
        }
      ],
      screen: SCREEN
    });
    assert.deepEqual(selection, {
      x: 0,
      y: 0,
      width: 66,
      height: 66
    });
  });

  it("ignores a loop with no points", () => {
    assert.equal(
      loopSelection({
        loop: [],
        screen: SCREEN
      }),
      undefined
    );
  });

  it("ignores a click", () => {
    assert.equal(
      loopSelection({
        loop: [
          {
            x: 5,
            y: 5
          }
        ],
        screen: SCREEN
      }),
      undefined
    );
  });

  it("ignores a stroke narrower than the minimum", () => {
    const loop = [
      {
        x: 0,
        y: 0
      },
      {
        x: 9.9,
        y: 200
      }
    ];
    assert.equal(
      loopSelection({
        loop,
        screen: SCREEN
      }),
      undefined
    );
  });

  it("ignores a stroke shorter than the minimum", () => {
    const loop = [
      {
        x: 0,
        y: 0
      },
      {
        x: 200,
        y: 9.9
      }
    ];
    assert.equal(
      loopSelection({
        loop,
        screen: SCREEN
      }),
      undefined
    );
  });

  it("accepts a stroke exactly the minimum size", () => {
    const loop = [
      {
        x: 100,
        y: 100
      },
      {
        x: 110,
        y: 110
      }
    ];
    assert.notEqual(
      loopSelection({
        loop,
        screen: SCREEN
      }),
      undefined
    );
  });

  it("ignores a loop wholly off the screen", () => {
    const loop = [
      {
        x: 5000,
        y: 5000
      },
      {
        x: 5100,
        y: 5100
      }
    ];
    assert.equal(
      loopSelection({
        loop,
        screen: SCREEN
      }),
      undefined
    );
  });
});

describe("moved", () => {
  const selection = {
    x: 100,
    y: 100,
    width: 100,
    height: 50
  };
  const screen = {
    width: 800,
    height: 600
  };

  it("puts the grabbed spot under the pointer", () => {
    const result = moved({
      selection,
      grip: {
        x: 10,
        y: 20
      },
      pointer: {
        x: 300,
        y: 400
      },
      screen
    });
    assert.deepEqual(result, {
      x: 290,
      y: 380,
      width: 100,
      height: 50
    });
  });

  it("stops at the top-left edge", () => {
    const result = moved({
      selection,
      grip: {
        x: 10,
        y: 10
      },
      pointer: {
        x: 5,
        y: 5
      },
      screen
    });
    assert.deepEqual(result, {
      x: 0,
      y: 0,
      width: 100,
      height: 50
    });
  });

  it("stops at the bottom-right edge", () => {
    const result = moved({
      selection,
      grip: {
        x: 0,
        y: 0
      },
      pointer: {
        x: 790,
        y: 590
      },
      screen
    });
    assert.deepEqual(result, {
      x: 700,
      y: 550,
      width: 100,
      height: 50
    });
  });

  it("pins a selection larger than the screen to the origin", () => {
    const huge = {
      x: 0,
      y: 0,
      width: 900,
      height: 700
    };
    const result = moved({
      selection: huge,
      grip: {
        x: 0,
        y: 0
      },
      pointer: {
        x: 50,
        y: 50
      },
      screen
    });
    assert.deepEqual(result, huge);
  });

  it("moves a region by a travelled distance with no grip", () => {
    const start = {
      x: 100,
      y: 100,
      width: 300,
      height: 200
    };
    const result = moved({
      selection: start,
      grip: {
        x: 0,
        y: 0
      },
      pointer: {
        x: 150,
        y: 90
      },
      screen: SCREEN
    });
    assert.deepEqual(result, {
      x: 150,
      y: 90,
      width: 300,
      height: 200
    });
  });
});

describe("nearestCorner", () => {
  const selection = {
    x: 100,
    y: 100,
    width: 200,
    height: 100
  };

  it("finds the corner under a press", () => {
    assert.deepEqual(
      nearestCorner({
        selection,
        point: {
          x: 110,
          y: 110
        }
      }),
      {
        x: 100,
        y: 100
      }
    );
    assert.deepEqual(
      nearestCorner({
        selection,
        point: {
          x: 295,
          y: 105
        }
      }),
      {
        x: 300,
        y: 100
      }
    );
    assert.deepEqual(
      nearestCorner({
        selection,
        point: {
          x: 295,
          y: 195
        }
      }),
      {
        x: 300,
        y: 200
      }
    );
    assert.deepEqual(
      nearestCorner({
        selection,
        point: {
          x: 105,
          y: 195
        }
      }),
      {
        x: 100,
        y: 200
      }
    );
  });

  it("reaches exactly the reach and no further", () => {
    assert.deepEqual(
      nearestCorner({
        selection,
        point: {
          x: 128,
          y: 100
        }
      }),
      {
        x: 100,
        y: 100
      }
    );
    assert.equal(
      nearestCorner({
        selection,
        point: {
          x: 129,
          y: 100
        }
      }),
      undefined
    );
  });

  it("finds none in the middle", () => {
    assert.equal(
      nearestCorner({
        selection,
        point: {
          x: 200,
          y: 150
        }
      }),
      undefined
    );
  });

  it("takes the first of two equally near corners", () => {
    const thin = {
      x: 0,
      y: 0,
      width: 10,
      height: 10
    };
    assert.deepEqual(
      nearestCorner({
        selection: thin,
        point: {
          x: 5,
          y: 5
        }
      }),
      {
        x: 0,
        y: 0
      }
    );
  });
});

describe("isFallingCorner", () => {
  const selection = {
    x: 100,
    y: 100,
    width: 200,
    height: 100
  };

  it("is true for top-left and bottom-right", () => {
    assert.equal(
      isFallingCorner({
        selection,
        corner: {
          x: 100,
          y: 100
        }
      }),
      true
    );
    assert.equal(
      isFallingCorner({
        selection,
        corner: {
          x: 300,
          y: 200
        }
      }),
      true
    );
  });

  it("is false for top-right and bottom-left", () => {
    assert.equal(
      isFallingCorner({
        selection,
        corner: {
          x: 300,
          y: 100
        }
      }),
      false
    );
    assert.equal(
      isFallingCorner({
        selection,
        corner: {
          x: 100,
          y: 200
        }
      }),
      false
    );
  });
});

describe("cornerRadius", () => {
  it("is the selection radius on a big area", () => {
    assert.equal(
      cornerRadius({
        x: 0,
        y: 0,
        width: 400,
        height: 300
      }),
      SELECTION_RADIUS_EXPECTED
    );
  });

  it("shrinks with the bracket arm on a small area", () => {
    assert.equal(
      cornerRadius({
        x: 0,
        y: 0,
        width: 30,
        height: 100
      }),
      SHRUNK_RADIUS_EXPECTED
    );
  });
});

describe("corner grip", () => {
  const selection = {
    x: 100,
    y: 100,
    width: 200,
    height: 100
  };

  it("keeps the opposite corner as the anchor", () => {
    const grip = grabCorner({
      selection,
      corner: {
        x: 300,
        y: 200
      }
    });
    assert.deepEqual(grip, {
      anchor: {
        x: 100,
        y: 100
      },
      direction: {
        x: 1,
        y: 1
      }
    });
  });

  it("grabs the top-left with the anchor at the bottom-right", () => {
    const grip = grabCorner({
      selection,
      corner: {
        x: 100,
        y: 100
      }
    });
    assert.deepEqual(grip, {
      anchor: {
        x: 300,
        y: 200
      },
      direction: {
        x: -1,
        y: -1
      }
    });
  });

  it("grabs the top-right and bottom-left", () => {
    assert.deepEqual(
      grabCorner({
        selection,
        corner: {
          x: 300,
          y: 100
        }
      }),
      {
        anchor: {
          x: 100,
          y: 200
        },
        direction: {
          x: 1,
          y: -1
        }
      }
    );
    assert.deepEqual(
      grabCorner({
        selection,
        corner: {
          x: 100,
          y: 200
        }
      }),
      {
        anchor: {
          x: 300,
          y: 100
        },
        direction: {
          x: -1,
          y: 1
        }
      }
    );
  });

  it("follows the pointer", () => {
    const grip = grabCorner({
      selection,
      corner: {
        x: 300,
        y: 200
      }
    });
    const result = followCorner({
      grip,
      pointer: {
        x: 500,
        y: 400
      },
      screen: SCREEN
    });
    assert.deepEqual(result, {
      x: 100,
      y: 100,
      width: 400,
      height: 300
    });
  });

  it("never shrinks below the minimum", () => {
    const grip = grabCorner({
      selection,
      corner: {
        x: 300,
        y: 200
      }
    });
    const result = followCorner({
      grip,
      pointer: {
        x: 105,
        y: 105
      },
      screen: SCREEN
    });
    assert.deepEqual(result, {
      x: 100,
      y: 100,
      width: 20,
      height: 20
    });
  });

  it("does not flip past the anchor", () => {
    const grip = grabCorner({
      selection,
      corner: {
        x: 300,
        y: 200
      }
    });
    const result = followCorner({
      grip,
      pointer: {
        x: 50,
        y: 50
      },
      screen: SCREEN
    });
    assert.deepEqual(result, {
      x: 100,
      y: 100,
      width: 20,
      height: 20
    });
  });

  it("follows a top-left grab to the screen corner", () => {
    const grip = grabCorner({
      selection,
      corner: {
        x: 100,
        y: 100
      }
    });
    const result = followCorner({
      grip,
      pointer: {
        x: -40,
        y: -40
      },
      screen: SCREEN
    });
    assert.deepEqual(result, {
      x: 0,
      y: 0,
      width: 300,
      height: 200
    });
  });

  it("stays on the screen", () => {
    const grip = grabCorner({
      selection,
      corner: {
        x: 300,
        y: 200
      }
    });
    const result = followCorner({
      grip,
      pointer: {
        x: 5000,
        y: 5000
      },
      screen: SCREEN
    });
    assert.deepEqual(result, {
      x: 100,
      y: 100,
      width: 1820,
      height: 980
    });
  });
});

describe("brackets", () => {
  it("draws a rounded L at each corner", () => {
    const path = brackets({
      x: 0,
      y: 0,
      width: 100,
      height: 100
    });
    assert.equal(
      path,
      [
        "M44,0 L24,0 A24,24 0 0 0 0,24 L0,44",
        "M56,0 L76,0 A24,24 0 0 1 100,24 L100,44",
        "M56,100 L76,100 A24,24 0 0 0 100,76 L100,56",
        "M44,100 L24,100 A24,24 0 0 1 0,76 L0,56"
      ].join(" ")
    );
  });

  it("follows the area's offset", () => {
    const path = brackets({
      x: 10,
      y: 20,
      width: 100,
      height: 100
    });
    assert.ok(path.startsWith("M54,20 L34,20 A24,24 0 0 0 10,44 L10,64"));
  });

  it("shortens the arms and the radius on a small area", () => {
    const path = brackets({
      x: 0,
      y: 0,
      width: 20,
      height: 20
    });
    assert.ok(path.startsWith("M10,0 L10,0 A10,10 0 0 0 0,10 L0,10"));
  });

  it("bends the same way at opposite corners", () => {
    const sweeps = brackets({
      x: 0,
      y: 0,
      width: 200,
      height: 200
    }).match(/ 0 0 ([01]) /g);
    assert.deepEqual(sweeps, [" 0 0 0 ", " 0 0 1 ", " 0 0 0 ", " 0 0 1 "]);
  });
});

describe("scrimPath", () => {
  it("is just the screen without a selection", () => {
    assert.equal(
      scrimPath({
        screen: {
          width: 800,
          height: 600
        },
        selection: undefined
      }),
      "F0 M0,0 H800 V600 H0 Z"
    );
  });

  it("cuts a rounded hole out of the screen", () => {
    const path = scrimPath({
      screen: {
        width: 800,
        height: 600
      },
      selection: {
        x: 100,
        y: 100,
        width: 200,
        height: 100
      }
    });
    assert.equal(
      path,
      [
        "F0 M0,0 H800 V600 H0 Z",
        "M124,100 H276 A24,24 0 0 1 300,124 V176 A24,24 0 0 1 276,200 H124",
        "A24,24 0 0 1 100,176 V124 A24,24 0 0 1 124,100 Z"
      ].join(" ")
    );
  });
});

describe("barPlacement", () => {
  it("goes centred just below the selection", () => {
    const result = barPlacement({
      selection: {
        x: 800,
        y: 300,
        width: 200,
        height: 200
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.deepEqual(result, {
      side: BarSide.BELOW,
      origin: {
        x: 750,
        y: 512
      }
    });
  });

  it("goes beside, toward the wider half, when there is no room below", () => {
    const result = barPlacement({
      selection: {
        x: 800,
        y: 900,
        width: 200,
        height: 150
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.deepEqual(result, {
      side: BarSide.RIGHT,
      origin: {
        x: 1012,
        y: 943
      }
    });
  });

  it("goes to the left for a selection on the right half", () => {
    const result = barPlacement({
      selection: {
        x: 1100,
        y: 900,
        width: 200,
        height: 150
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.deepEqual(result, {
      side: BarSide.LEFT,
      origin: {
        x: 788,
        y: 943
      }
    });
  });

  it("prefers the right for a selection on the left half", () => {
    const result = barPlacement({
      selection: {
        x: 100,
        y: 900,
        width: 200,
        height: 150
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.equal(result.side, BarSide.RIGHT);
  });

  it("falls back to the left side when the right has no room", () => {
    const result = barPlacement({
      selection: {
        x: 1500,
        y: 900,
        width: 300,
        height: 150
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.equal(result.side, BarSide.LEFT);
  });

  it("goes above when neither side has room, clamped on screen", () => {
    const result = barPlacement({
      selection: {
        x: 50,
        y: 900,
        width: 200,
        height: 150
      },
      bar: BAR,
      screen: {
        width: 400,
        height: 1080
      }
    });
    assert.deepEqual(result, {
      side: BarSide.ABOVE,
      origin: {
        x: 16,
        y: 824
      }
    });
  });

  it("goes inside the bottom edge when the selection fills the screen", () => {
    const result = barPlacement({
      selection: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.deepEqual(result, {
      side: BarSide.INSIDE,
      origin: {
        x: 810,
        y: 1000
      }
    });
  });

  it("clamps a bar that sticks out to the margin", () => {
    const result = barPlacement({
      selection: {
        x: 0,
        y: 300,
        width: 40,
        height: 40
      },
      bar: BAR,
      screen: SCREEN
    });
    assert.equal(result.origin.x, BAR_MARGIN_EXPECTED);
  });
});

describe("pixelRegion", () => {
  const window = {
    width: 960,
    height: 540
  };
  const still = {
    width: 1920,
    height: 1080
  };

  it("maps DIPs to pixels, rounding outward", () => {
    const result = pixelRegion({
      selection: {
        x: 10.2,
        y: 20.5,
        width: 100.1,
        height: 50
      },
      window,
      still
    });
    assert.deepEqual(result, {
      x: 20,
      y: 41,
      width: 201,
      height: 100
    });
  });

  it("is the identity at a scale of one", () => {
    const result = pixelRegion({
      selection: {
        x: 5,
        y: 6,
        width: 7,
        height: 8
      },
      window: still,
      still
    });
    assert.deepEqual(result, {
      x: 5,
      y: 6,
      width: 7,
      height: 8
    });
  });

  it("keeps the region inside the still", () => {
    const result = pixelRegion({
      selection: {
        x: 900,
        y: 500,
        width: 100,
        height: 100
      },
      window,
      still
    });
    assert.deepEqual(result, {
      x: 1800,
      y: 1000,
      width: 120,
      height: 80
    });
  });

  it("is undefined for a selection off the still", () => {
    assert.equal(
      pixelRegion({
        selection: {
          x: 2000,
          y: 0,
          width: 10,
          height: 10
        },
        window,
        still
      }),
      undefined
    );
  });
});

describe("textWords", () => {
  it("maps pixels to DIPs and numbers the lines", () => {
    const result = textWords({
      lines: [
        {
          words: [
            {
              text: "a",
              bounds: {
                x: 20,
                y: 40,
                width: 100,
                height: 60
              }
            }
          ]
        },
        {
          words: [
            {
              text: "b",
              bounds: {
                x: 0,
                y: 200,
                width: 10,
                height: 10
              }
            },
            {
              text: "c",
              bounds: {
                x: 10,
                y: 200,
                width: 10,
                height: 10
              }
            }
          ]
        }
      ],
      still: {
        width: 1000,
        height: 1000
      },
      window: {
        width: 500,
        height: 250
      }
    });
    assert.deepEqual(result, [
      {
        text: "a",
        bounds: {
          x: 10,
          y: 10,
          width: 50,
          height: 15
        },
        line: 0
      },
      {
        text: "b",
        bounds: {
          x: 0,
          y: 50,
          width: 5,
          height: 2.5
        },
        line: 1
      },
      {
        text: "c",
        bounds: {
          x: 5,
          y: 50,
          width: 5,
          height: 2.5
        },
        line: 1
      }
    ]);
  });

  it("is empty without lines", () => {
    assert.deepEqual(
      textWords({
        lines: [],
        still: {
          width: 10,
          height: 10
        },
        window: {
          width: 5,
          height: 5
        }
      }),
      []
    );
  });
});

describe("wordAt", () => {
  it("finds the word under the point", () => {
    assert.equal(
      wordAt({
        words: WORDS,
        point: {
          x: 30,
          y: 20
        }
      }),
      0
    );
    assert.equal(
      wordAt({
        words: WORDS,
        point: {
          x: 100,
          y: 60
        }
      }),
      FOURTH_WORD
    );
  });

  it("counts the slop around a word", () => {
    assert.equal(
      wordAt({
        words: WORDS,
        point: {
          x: 7,
          y: 10
        }
      }),
      0
    );
    assert.equal(
      wordAt({
        words: WORDS,
        point: {
          x: 6.9,
          y: 10
        }
      }),
      -1
    );
  });

  it("is -1 over none", () => {
    assert.equal(
      wordAt({
        words: WORDS,
        point: {
          x: 500,
          y: 500
        }
      }),
      -1
    );
    assert.equal(
      wordAt({
        words: [],
        point: {
          x: 0,
          y: 0
        }
      }),
      -1
    );
  });
});

describe("wordsBetween", () => {
  it("runs forward", () => {
    assert.deepEqual(
      wordsBetween({
        first: 2,
        second: 5
      }),
      TWO_TO_FIVE
    );
  });

  it("runs backward as forward", () => {
    assert.deepEqual(
      wordsBetween({
        first: 5,
        second: 2
      }),
      TWO_TO_FIVE
    );
  });

  it("is one word for the same word", () => {
    assert.deepEqual(
      wordsBetween({
        first: 3,
        second: 3
      }),
      [FOURTH_WORD]
    );
  });
});

describe("wordsIn", () => {
  it("selects what a rubber band touches", () => {
    assert.deepEqual(
      wordsIn({
        words: WORDS,
        area: {
          x: 0,
          y: 0,
          width: 65,
          height: 40
        }
      }),
      [0]
    );
    assert.deepEqual(
      wordsIn({
        words: WORDS,
        area: {
          x: 0,
          y: 0,
          width: 200,
          height: 200
        }
      }),
      ALL_WORDS
    );
  });

  it("counts a touching edge", () => {
    assert.deepEqual(
      wordsIn({
        words: WORDS,
        area: {
          x: 60,
          y: 10,
          width: 10,
          height: 10
        }
      }),
      [0, 1]
    );
  });

  it("selects none from empty space", () => {
    assert.deepEqual(
      wordsIn({
        words: WORDS,
        area: {
          x: 300,
          y: 300,
          width: 10,
          height: 10
        }
      }),
      []
    );
  });
});

describe("wordsOnLine", () => {
  it("collects the whole line", () => {
    assert.deepEqual(
      wordsOnLine({
        words: WORDS,
        index: 1
      }),
      [0, 1]
    );
    assert.deepEqual(
      wordsOnLine({
        words: WORDS,
        index: 2
      }),
      SECOND_LINE_WORDS
    );
  });
});

describe("joinWords", () => {
  it("puts spaces between words and a newline between lines", () => {
    assert.equal(
      joinWords({
        words: WORDS,
        picked: [0, 1, 2]
      }),
      "alpha beta\ngamma"
    );
  });

  it("is one line for words on one line", () => {
    assert.equal(
      joinWords({
        words: WORDS,
        picked: SECOND_LINE_WORDS
      }),
      "gamma delta"
    );
  });

  it("is empty for none", () => {
    assert.equal(
      joinWords({
        words: WORDS,
        picked: []
      }),
      ""
    );
  });

  it("skips an index that is not a word", () => {
    assert.equal(
      joinWords({
        words: WORDS,
        picked: [0, NOT_A_WORD]
      }),
      "alpha"
    );
  });
});

describe("roundedRectsPath", () => {
  it("draws every box as one nonzero path", () => {
    const path = roundedRectsPath({
      rects: [
        {
          x: 0,
          y: 0,
          width: 10,
          height: 10
        },
        {
          x: 20,
          y: 0,
          width: 10,
          height: 10
        }
      ],
      radius: 3
    });
    assert.ok(
      path.startsWith("F1 M3,0 H7 A3,3 0 0 1 10,3 V7 A3,3 0 0 1 7,10 H3 A3,3 0 0 1 0,7 V3 A3,3 0 0 1 3,0 Z M23,0")
    );
  });

  it("shrinks the radius for a tiny box", () => {
    const path = roundedRectsPath({
      rects: [
        {
          x: 0,
          y: 0,
          width: 4,
          height: 4
        }
      ],
      radius: 3
    });
    assert.ok(path.startsWith("F1 M2,0 H2 A2,2"));
  });

  it("is empty of figures without boxes", () => {
    assert.equal(
      roundedRectsPath({
        rects: [],
        radius: 3
      }),
      "F1 "
    );
  });
});
