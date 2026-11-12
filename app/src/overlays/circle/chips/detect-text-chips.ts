import { ChipKind, createChip } from "./chip.ts";
import type { Chip } from "./chip.ts";
import { webAddress } from "./open-uri.ts";

const MAX_TEXT_CHIPS = 6;
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;
const MIN_BARE_PHONE_DIGITS = 9;

// Direction marks and embeddings that OCR and bidirectional text leave around words
const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g;
// Punctuation that wraps a word but is never part of an address: Latin and Hebrew quotes, brackets,
// the geresh and gershayim, and sentence marks. A slash stays: it ends many addresses
const LEADING_WRAPPING = /^[\s"'`()[\]{}<>.,;:!?׳״“”‘’«»]+/;
const TRAILING_WRAPPING = /[\s"'`()[\]{}<>.,;:!?׳״“”‘’«»]+$/;
// A Hebrew prefix letter joined by a hyphen or maqaf: "ב-example.com", "ל־a@b.co"
const HEBREW_PREFIX = /^[א-ת]{1,3}[-־]/;

const EMAIL = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;
const SCHEME_URL = /^https?:\/\/[^\s/$.?#]\S*$/i;
const WWW_URL = /^www\.[^\s.]+\.\S+$/i;
const BARE_URL = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]\S*)?$/i;
const HOST_END = /[/:?#]/;
// A bare "name.tld" is a link only for a top-level domain people write on screens: "file.txt" and
// "e.g" are not
const KNOWN_TOP_LEVEL_DOMAINS = new Set([
  "com",
  "org",
  "net",
  "io",
  "dev",
  "app",
  "co",
  "me",
  "ai",
  "edu",
  "gov",
  "info",
  "il",
  "uk",
  "de",
  "fr",
  "ru",
  "tv"
]);

const PHONE_CANDIDATE = /(?<![\w+])\+?\(?\d[\d\s().-]{5,}\d(?!\w)/g;
const DATE_SHAPE = /^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$/;
const NON_DIGITS = /\D/g;
const PHONE_SEPARATORS = /[-()]/;

function cleanToken(token: string) {
  return token
    .replace(LEADING_WRAPPING, "")
    .replace(TRAILING_WRAPPING, "")
    .replace(HEBREW_PREFIX, "");
}

function isKnownBareDomain(token: string) {
  const isBare = BARE_URL.test(token);
  if (!isBare) {
    return false;
  }

  const host = token.split(HOST_END)[0] ?? "";
  const topLevel = host.split(".").at(-1)?.toLowerCase() ?? "";
  return KNOWN_TOP_LEVEL_DOMAINS.has(topLevel);
}

function addressOf(token: string) {
  const isSchemed = SCHEME_URL.test(token);
  if (isSchemed) {
    return webAddress(token);
  }

  const isBareLink = WWW_URL.test(token) || isKnownBareDomain(token);
  if (!isBareLink) {
    return undefined;
  }

  return webAddress(`https://${token}`);
}

function tokenChip(token: string) {
  if (EMAIL.test(token)) {
    return createChip({
      kind: ChipKind.email,
      label: token,
      value: token
    });
  }

  const address = addressOf(token);
  const isLink = address !== undefined;
  if (!isLink) {
    return undefined;
  }

  return createChip({
    kind: ChipKind.url,
    label: token,
    value: address
  });
}

// What looks like a telephone number: seven to fifteen digits, not a date, and shaped like one
// (brackets or hyphens, or a plus or a leading zero before nine digits or more), so a run of plain
// numbers is left alone
function isPhoneShaped(candidate: string) {
  const digitCount = candidate.replace(NON_DIGITS, "").length;
  const isDigitCountPlausible = digitCount >= MIN_PHONE_DIGITS && digitCount <= MAX_PHONE_DIGITS;
  const isRejected = !isDigitCountPlausible || DATE_SHAPE.test(candidate);
  if (isRejected) {
    return false;
  }

  if (PHONE_SEPARATORS.test(candidate)) {
    return true;
  }

  const isMarked = candidate.startsWith("+") || candidate.startsWith("0");
  return isMarked && digitCount >= MIN_BARE_PHONE_DIGITS;
}

function phoneChips(text: string) {
  const chips: Chip[] = [];
  for (const [match] of text.matchAll(PHONE_CANDIDATE)) {
    const candidate = match.trim();
    if (!isPhoneShaped(candidate)) {
      continue;
    }

    const plus = candidate.startsWith("+") ? "+" : "";
    chips.push(
      createChip({
        kind: ChipKind.phone,
        label: candidate,
        value: `${plus}${candidate.replace(NON_DIGITS, "")}`
      })
    );
  }

  return chips;
}

// The links, e-mail addresses and phone numbers in one line of text, in the order they are read. The
// text is the recognizer's logical order, so a Hebrew line is not reversed here. Pure: nothing is
// opened and nothing is looked up
export function detectTextChips(text: string) {
  const tokens = text.replace(BIDI_MARKS, "").split(/\s+/);
  const found: Chip[] = [];
  const rest: string[] = [];
  for (const token of tokens) {
    const chip = tokenChip(cleanToken(token));
    const isPlain = chip === undefined;
    if (isPlain) {
      rest.push(token);
      continue;
    }

    found.push(chip);
  }

  return [...found, ...phoneChips(rest.join(" "))];
}

// The chips of every line, each found once, a handful at most
function detectLineChips(lines: readonly string[]) {
  const unique = new Map<string, Chip>();
  for (const line of lines) {
    for (const chip of detectTextChips(line)) {
      unique.set(chip.id, chip);
    }
  }

  return [...unique.values()].slice(0, MAX_TEXT_CHIPS);
}

// What a selection shows: each QR code first (decoded pixels, trusted over OCR), then what the words
// say
export function detectChips({ lines, codes }: {
  lines: readonly string[];
  codes: readonly string[];
}) {
  const decoded = codes
    .filter(code => code.length > 0)
    .map(code => createChip({
      kind: ChipKind.qr,
      label: code,
      value: code
    }));
  const unique = new Map(decoded.map(chip => [chip.id, chip]));
  for (const chip of detectLineChips(lines)) {
    unique.set(chip.id, chip);
  }

  return [...unique.values()];
}
