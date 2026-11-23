export interface CtcSymbol {
  readonly index: number;
  readonly step: number;
}

// The labels a CTC recogniser spoke, in order: each step's best class, a repeat of the last class
// folded into one, and the blank dropped
export function decodeCtc({
  scores,
  stepCount,
  classCount,
  blank
}: {
  scores: ArrayLike<number>;
  stepCount: number;
  classCount: number;
  blank: number;
}) {
  const symbols: CtcSymbol[] = [];
  let previous = -1;
  for (let step = 0; step < stepCount; step++) {
    let best = 0;
    let bestScore = -1;
    for (let iClass = 0; iClass < classCount; iClass++) {
      const score = scores[step * classCount + iClass] ?? 0;
      if (score > bestScore) {
        bestScore = score;
        best = iClass;
      }
    }

    const isSymbol = best !== previous && best !== blank;
    if (isSymbol) {
      symbols.push({
        index: best,
        step
      });
    }

    previous = best;
  }
  return symbols;
}
