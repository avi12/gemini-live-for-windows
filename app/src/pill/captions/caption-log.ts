import type { FoundLink } from "@/contracts/live-engine.ts";
import { findLinks, shortTitle } from "@/pill/captions/link-extractor.ts";
import type { ExtractedLink } from "@/pill/captions/link-extractor.ts";
import type { PillLine, PillLink } from "@/pill/types.ts";

export const MAX_LINES = 6;
const LINE_ID_PREFIX = "line-";
const LINK_ID_PREFIX = "link-";

export interface CaptionLogOptions {
  onChange(): void;
  onLinkAdded?(uri: string): void;
}

function createIdSource() {
  let nextId = 0;
  return function takeId(prefix: string) {
    const id = `${prefix}${nextId}`;
    nextId += 1;
    return id;
  };
}

function createLineBook(takeId: (prefix: string) => string) {
  let lines: readonly PillLine[] = [];

  function append({ text, isUser, isNote }: Omit<PillLine, "id">) {
    const added = [...lines, {
      id: takeId(LINE_ID_PREFIX),
      text,
      isUser,
      isNote
    }];
    lines = added.slice(-MAX_LINES);
  }

  return {
    get lines() {
      return lines;
    },
    clear() {
      lines = [];
    },
    append,
    // The engine sends the current utterance's full text; a new one starts when the speaker
    // changes, and a note is never continued
    show({ text, isUser }: {
      text: string;
      isUser: boolean;
    }) {
      const last = lines.at(-1);
      const isContinuing = last !== undefined && !last.isNote && last.isUser === isUser;
      if (isContinuing) {
        lines = [...lines.slice(0, -1), {
          ...last,
          text
        }];
        return;
      }

      append({
        text,
        isUser,
        isNote: false
      });
    }
  };
}

function createLinkBook({ takeId, onLinkAdded }: {
  takeId: (prefix: string) => string;
  onLinkAdded: CaptionLogOptions["onLinkAdded"];
}) {
  let links: readonly PillLink[] = [];
  const addresses = new Set<string>();

  return {
    get links() {
      return links;
    },
    clear() {
      links = [];
      addresses.clear();
    },
    add(found: readonly ExtractedLink[]) {
      for (const link of found) {
        const key = link.uri.toLowerCase();
        const isNew = URL.canParse(link.uri) && !addresses.has(key);
        if (!isNew) {
          continue;
        }

        addresses.add(key);
        links = [...links, {
          id: takeId(LINK_ID_PREFIX),
          title: link.title,
          uri: link.uri,
          address: shortTitle(link.uri),
          isSearch: link.isSearch
        }];
        onLinkAdded?.(link.uri);
      }
    }
  };
}

// What the caption card says: the last few lines of transcript and every link Gemini mentioned.
// Each line keeps its id, so the window can fade a new one in while the current one updates.
export function createCaptionLog({ onChange, onLinkAdded }: CaptionLogOptions) {
  const takeId = createIdSource();
  const lineBook = createLineBook(takeId);
  const linkBook = createLinkBook({
    takeId,
    onLinkAdded
  });

  return {
    get lines() {
      return lineBook.lines;
    },
    get links() {
      return linkBook.links;
    },
    clear() {
      lineBook.clear();
      linkBook.clear();
      onChange();
    },
    show({ text, isUser }: {
      text: string;
      isUser: boolean;
    }) {
      lineBook.show({
        text,
        isUser
      });

      if (!isUser) {
        linkBook.add(findLinks(text));
      }

      onChange();
    },
    showLinks(found: readonly FoundLink[]) {
      linkBook.add(
        found.map(link => ({
          ...link,
          isSearch: false
        }))
      );
      onChange();
    },
    // A line of our own, like why the session ended, shown on Gemini's side
    addNote(text: string) {
      lineBook.append({
        text,
        isUser: false,
        isNote: true
      });
      onChange();
    }
  };
}

export type CaptionLog = ReturnType<typeof createCaptionLog>;
