import { BlockKind, type ScreenView } from "./protocols/glic.ts";

// Added to a web request so the text turn searches and cites, in whatever language it was asked.
// It also says what NOT to do: a text turn starts a fresh chat, and without it asks the user for
// details they have already given. The screen context above is what "this" refers to.
const WEB_SEARCH_ASK = "(This is a new chat, so use only the context above. Don't ask me for details: search the web,"
  + " find the original source, and link the exact pages you used.)";
const MAX_CONTEXT_CHARS = 300;
const SCREEN_HEADINGS = 3;
const SCREEN_TEXT_CHARS = 600;

// Glic's captions are markdown source ("17\.3"); show them as the words that were spoken
const MARKDOWN_ESCAPE = /\\([\\`*_{}[\]()#+\-.!>|~])/g;

export function unescapeMarkdown(text: string) {
  return text.replaceAll(MARKDOWN_ESCAPE, "$1");
}

// Keeps a prompt quick to type: the text turn is typed one trusted key event per character
export function clip({ text, limit = MAX_CONTEXT_CHARS }: {
  text: string;
  limit?: number;
}) {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

// What a fresh text turn needs to know what "this article" is: the window's title, then its
// headlines and the start of its text, since a title alone is often just the site's name
export function describeScreen(screen: ScreenView) {
  const parts: string[] = [];
  const hasTitle = screen.title.length > 0;
  if (hasTitle) {
    parts.push(`a window titled "${clip({ text: screen.title })}"`);
  }

  const headings = screen.blocks
    .filter(block => block.kind === BlockKind.heading)
    .slice(0, SCREEN_HEADINGS);
  for (const heading of headings) {
    parts.push(`heading "${clip({ text: heading.text })}"`);
  }

  const text = screen.blocks.map(block => block.text).join(" ");
  const hasText = text.length > 0;
  if (hasText) {
    parts.push(
      `text beginning "${clip({
        text,
        limit: SCREEN_TEXT_CHARS
      })}"`
    );
  }

  return parts.join("; ");
}

// The request as the text turn needs it. That turn sees neither the screen nor what Live said, so
// "the article I'm looking at" means nothing there: name the window on screen and Live's last
// words, then ask it to search and link its sources.
export function webSearchPrompt({ request, screen, lastGeminiLine }: {
  request: string;
  screen: ScreenView | null;
  lastGeminiLine: string;
}) {
  let prompt = request;
  if (screen) {
    prompt += ` (On my screen: ${describeScreen(screen)})`;
  }

  const hasLastLine = lastGeminiLine.length > 0;
  if (hasLastLine) {
    prompt += ` (You just told me: "${clip({ text: lastGeminiLine })}".)`;
  }

  return `${prompt} ${WEB_SEARCH_ASK}`;
}
