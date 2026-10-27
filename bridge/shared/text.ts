// Text as the pages show it, read the same way by both page bridges.

/** The text with each run of whitespace as one space, trimmed. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** An element's aria-label and its visible text together, to match a control by either. */
export function labelAndText(element: Element): string {
  return `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`;
}
