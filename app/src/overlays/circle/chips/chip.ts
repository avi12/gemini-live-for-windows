import { isOpenableUri, mailtoUri, webAddress } from "./open-uri.ts";

export const ChipKind = {
  url: "url",
  email: "email",
  phone: "phone",
  qr: "qr"
} as const;
export type ChipKind = typeof ChipKind[keyof typeof ChipKind];

// What the chip says it is, above what it found
export const CHIP_TITLES = {
  [ChipKind.url]: "Link",
  [ChipKind.email]: "Email",
  [ChipKind.phone]: "Phone",
  [ChipKind.qr]: "QR code"
} as const satisfies Record<ChipKind, string>;

// Something found on the selected part of the screen
export interface Chip {
  readonly id: string;
  readonly kind: ChipKind;
  // As the screen shows it
  readonly label: string;
  // What opening or copying uses: the address, the e-mail address, the digits, the decoded text
  readonly value: string;
}

export const ChipActionKind = {
  open: "open",
  copy: "copy"
} as const;
export type ChipActionKind = typeof ChipActionKind[keyof typeof ChipActionKind];

export const CHIP_ACTION_LABELS = {
  [ChipActionKind.open]: "Open",
  [ChipActionKind.copy]: "Copy"
} as const satisfies Record<ChipActionKind, string>;

export interface ChipAction {
  readonly kind: ChipActionKind;
  // The address to open or the text to copy
  readonly target: string;
}

export function createChip({ kind, label, value }: {
  kind: ChipKind;
  label: string;
  value: string;
}) {
  return {
    id: `${kind}:${value}`,
    kind,
    label,
    value
  } satisfies Chip;
}

function qrActions(text: string) {
  const copy = {
    kind: ChipActionKind.copy,
    target: text
  } satisfies ChipAction;
  const address = webAddress(text);
  const isOpenable = address !== undefined && isOpenableUri(address);
  if (!isOpenable) {
    return [copy];
  }

  return [copy, {
    kind: ChipActionKind.open,
    target: address
  } satisfies ChipAction];
}

// What a click on the chip can do: a link and an e-mail address open, a phone number is copied
// (never dialled), and a code shows its text with Copy, and Open only when the text is a web address
export function chipActions(chip: Chip) {
  switch (chip.kind) {
    case ChipKind.url:
      return [{
        kind: ChipActionKind.open,
        target: chip.value
      }] satisfies ChipAction[];
    case ChipKind.email:
      return [{
        kind: ChipActionKind.open,
        target: mailtoUri(chip.value)
      }] satisfies ChipAction[];
    case ChipKind.phone:
      return [{
        kind: ChipActionKind.copy,
        target: chip.value
      }] satisfies ChipAction[];
    case ChipKind.qr:
      return qrActions(chip.value);
  }
}
