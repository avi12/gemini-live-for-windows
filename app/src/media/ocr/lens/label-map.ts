const VARINT_CONTINUES = 0x80;
const VARINT_PAYLOAD = 0x7f;
const VARINT_BITS = 7;
const WIRE_VARINT = 0;
const WIRE_64_BITS = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_32_BITS = 5;
const WIRE_TYPE_MASK = 7;
const WIRE_TYPE_BITS = 3;
const FIELD_ENTRY = 1;
const FIELD_TEXT = 1;
const FIELD_INDEX = 2;
const BYTES_64_BITS = 8;
const BYTES_32_BITS = 4;

interface Field {
  readonly number: number;
  readonly value: number | Uint8Array;
}

function readVarint({ bytes, from }: { bytes: Uint8Array; from: number }) {
  let value = 0;
  let shift = 0;
  let offset = from;
  for (;;) {
    const byte = bytes[offset] ?? 0;
    offset++;
    value += (byte & VARINT_PAYLOAD) * 2 ** shift;
    shift += VARINT_BITS;
    const isLast = (byte & VARINT_CONTINUES) === 0;
    if (isLast) {
      return {
        value,
        next: offset
      };
    }
  }
}

function readFields(bytes: Uint8Array) {
  const fields: Field[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint({
      bytes,
      from: offset
    });
    offset = key.next;
    const wireType = key.value & WIRE_TYPE_MASK;
    const number = Math.floor(key.value / 2 ** WIRE_TYPE_BITS);
    if (wireType === WIRE_VARINT) {
      const varint = readVarint({
        bytes,
        from: offset
      });
      offset = varint.next;
      fields.push({
        number,
        value: varint.value
      });
    } else if (wireType === WIRE_LENGTH_DELIMITED) {
      const length = readVarint({
        bytes,
        from: offset
      });
      offset = length.next + length.value;
      fields.push({
        number,
        value: bytes.subarray(length.next, offset)
      });
    } else {
      offset += wireType === WIRE_64_BITS ? BYTES_64_BITS : BYTES_32_BITS;
      const isKnownWidth = wireType === WIRE_64_BITS || wireType === WIRE_32_BITS;
      if (!isKnownWidth) {
        throw new Error(`label map: unknown wire type ${wireType}`);
      }
    }
  }
  return fields;
}

// A recogniser's label map (protobuf: repeated entries of text and class index) as the text of each
// class index
export function parseLabelMap(bytes: Uint8Array) {
  const decoder = new TextDecoder();
  const labels = new Map<number, string>();
  for (const entry of readFields(bytes)) {
    const isEntryMessage = entry.number === FIELD_ENTRY && typeof entry.value !== "number";
    if (!isEntryMessage) {
      continue;
    }

    const parts = readFields(entry.value);
    const text = parts.find(part => part.number === FIELD_TEXT)?.value;
    const index = parts.find(part => part.number === FIELD_INDEX)?.value;
    labels.set(typeof index === "number" ? index : 0, typeof text === "object" ? decoder.decode(text) : "");
  }
  return labels;
}
