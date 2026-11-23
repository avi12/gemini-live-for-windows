import type { CtcSymbol } from "./ctc.ts";

const HEBREW_LETTER = /[א-ת]/u;
const LEFT_TO_RIGHT_CHARACTER = /[0-9A-Za-z]/u;
const LATIN_LETTER = /[A-Za-z]/u;
const NUMBER_JOINERS = new Set([".", ",", ":", "/", "-"]);
const DIVIDER = "|";
// Fewer Hebrew letters than this on a line is an icon or a divider read as a letter, not text
const MIN_HEBREW_LETTERS = 3;
const SPECK = /^(?:['"`]+|-{2,})$/u;
const MIN_WORDS_TO_TRIM = 3;

export interface VisualWord {
  // In reading order, as typed
  readonly text: string;
  // The recogniser's steps the word spans, left to right on the picture
  readonly firstStep: number;
  readonly lastStep: number;
}

function isSpace(label: string) {
  return label.trim().length === 0;
}

function hasHebrew(text: string) {
  return HEBREW_LETTER.test(text);
}

function isLeftToRight(unit: string | undefined) {
  return unit !== undefined && LEFT_TO_RIGHT_CHARACTER.test(unit);
}

// Which units of a word read left to right: letters and digits, and a joiner between two of them
// (the dots of a date, the colon of a time)
function leftToRightFlags(units: readonly string[]) {
  return units.map(
    (unit, iUnit) =>
      isLeftToRight(unit) ||
      (NUMBER_JOINERS.has(unit) && isLeftToRight(units[iUnit - 1]) && isLeftToRight(units[iUnit + 1]))
  );
}

// What a word drawn left to right reads as: Hebrew runs right to left, so its letters turn around, but
// each run of digits and Latin letters inside it keeps its own order
function toTyped(visualUnits: readonly string[]) {
  const flags = leftToRightFlags(visualUnits).toReversed();
  const typed: string[] = [];
  let run: string[] = [];
  for (const [iUnit, unit] of [...visualUnits].reverse().entries()) {
    if (flags[iUnit]) {
      run.push(unit);
      continue;
    }

    typed.push(...run.reverse(), unit);
    run = [];
  }
  typed.push(...run.reverse());
  return typed.join("");
}

interface WordSpan {
  units: string[];
  firstStep: number;
  lastStep: number;
}

// The words a recogniser drew across a line, left to right, split at its space symbols
export function groupWords({
  symbols,
  labels
}: {
  symbols: readonly CtcSymbol[];
  labels: ReadonlyMap<number, string>;
}) {
  const words: WordSpan[] = [];
  let open: WordSpan | undefined;
  for (const symbol of symbols) {
    const label = labels.get(symbol.index) ?? "";
    if (isSpace(label)) {
      open = undefined;
      continue;
    }

    // A divider is a word of its own, so it takes its place between the words either side of it
    if (label === DIVIDER) {
      words.push({
        units: [label],
        firstStep: symbol.step,
        lastStep: symbol.step
      });
      open = undefined;
      continue;
    }

    if (open === undefined) {
      open = {
        units: [],
        firstStep: symbol.step,
        lastStep: symbol.step
      };
      words.push(open);
    }

    open.units.push(label);
    open.lastStep = symbol.step;
  }
  return words.map(word => ({
    text: hasHebrew(word.units.join("")) ? toTyped(word.units) : word.units.join(""),
    firstStep: word.firstStep,
    lastStep: word.lastStep
  })) satisfies VisualWord[];
}

function isLatinWord(text: string) {
  return LATIN_LETTER.test(text) && !hasHebrew(text);
}

// The words of one line in the order they are read. A mostly Hebrew line reads right to left, so its
// words, its numbers and its dividers come in reverse; only a run of English words keeps its own left to
// right order
export function readingOrder<Word extends VisualWord>(words: readonly Word[]) {
  const letters = Array.from(words.map(word => word.text).join("")).filter(character => /\p{L}/u.test(character));
  const hebrewLetters = letters.filter(character => hasHebrew(character)).length;
  const isRightToLeft = hebrewLetters * 2 > letters.length;
  if (!isRightToLeft) {
    return [...words];
  }

  const ordered: Word[] = [];
  let run: Word[] = [];
  for (const word of [...words].reverse()) {
    if (isLatinWord(word.text)) {
      run.push(word);
      continue;
    }

    ordered.push(...run.reverse(), word);
    run = [];
  }
  ordered.push(...run.reverse());
  return ordered;
}

// Without the specks a recogniser reads out of an icon beside a line or out of a stray mark between
// words: a lone letter, and a word made only of apostrophes or dashes
export function withoutSpecks<Word extends VisualWord>(words: readonly Word[]) {
  const kept = words.filter(word => !SPECK.test(word.text));
  const hasRoomToTrim = kept.length >= MIN_WORDS_TO_TRIM;
  if (!hasRoomToTrim) {
    return kept;
  }

  return kept.filter(word => Array.from(word.text).length > 1 || !/\p{L}/u.test(word.text));
}

export function isMostlyHebrew(text: string) {
  const letters = Array.from(text).filter(character => /\p{L}/u.test(character));
  const hebrew = letters.filter(character => hasHebrew(character));
  return hebrew.length >= MIN_HEBREW_LETTERS && hebrew.length * 2 >= letters.length;
}
