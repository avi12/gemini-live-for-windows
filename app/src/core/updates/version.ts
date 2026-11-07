const PART_COUNT = 4;
const VERSION_PATTERN = /^\d+(\.\d+){1,3}$/;

// Two to four numeric parts, as .NET's Version accepts; a missing part counts as zero
export function parseVersion(text: string) {
  if (!VERSION_PATTERN.test(text)) {
    return undefined;
  }

  const parts = text.split(".").map(Number);
  return Array.from({ length: PART_COUNT }, (_, iPart) => parts[iPart] ?? 0);
}

function partsOrThrow(text: string) {
  const parts = parseVersion(text);
  if (!parts) {
    throw new RangeError(`not a version: ${text}`);
  }

  return parts;
}

export function compareVersions({ left, right }: {
  left: string;
  right: string;
}) {
  const leftParts = partsOrThrow(left);
  const rightParts = partsOrThrow(right);
  for (const [iPart, leftPart] of leftParts.entries()) {
    const difference = leftPart - (rightParts[iPart] ?? 0);
    const isDifferent = difference !== 0;
    if (isDifferent) {
      return Math.sign(difference);
    }
  }

  return 0;
}
