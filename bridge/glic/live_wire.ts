// Transcript from the Live wire. Glic's caption overlay labels some of Gemini's own speech "You:"
// (the "Let me check on that" filler before a tool call, sometimes whole answers), but the Live
// channel itself never confuses the two: the user's words arrive as the server's input
// transcription and Gemini's as its output transcription. So read them off the wire. Frame layout:
// docs/live-transcript-wire.md.
import { Direction } from "./glic_protocol";
import type { Utterance } from "./transcript";

/** The Live channel; its long-poll GETs are the downlink (POSTs carry the mic up). */
const LIVE_CHANNEL_PATH = "/v1/processSession";

/** Field indexes in a server message, MSG. */
enum MsgField {
  SEQ = 0,
  SERVER_CONTENT = 1,
  STATUS = 3,
  INPUT_TRANSCRIPTION = 7
}

/** Field indexes in MSG[ServerContent]. */
enum ContentField {
  GENERATION_COMPLETE = 2,
  INTERRUPTED = 3,
  OUTPUT_TRANSCRIPTION = 5
}

/** The first string anywhere in a nested array, depth first. */
function firstString(value: unknown) {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      return current;
    }

    if (Array.isArray(current)) {
      pending.push(...[...current].reverse());
    }
  }
  return null;
}

/**
 * Follows every Live downlink Glic opens and hands `relay` each utterance as it grows, keyed by
 * its index in the session.
 */
export function tapLiveTranscript(relay: (index: number, utterance: Utterance) => void) {
  /** Utterances in the order the wire opened them; the array index is the transcript index. */
  let utterances: Utterance[] = [];
  /** Index of the user utterance still being transcribed, or -1. */
  let openUser = -1;
  /** A user utterance Gemini's reply closed before its final transcript arrived, or -1. */
  let unfinishedUser = -1;
  /** Index of the Gemini utterance still being spoken, or -1. */
  let openAssistant = -1;
  let hasWireSeen = false;
  let unansweredSince: number | null = null;

  function utteranceAt(index: number) {
    const utterance = utterances[index];
    if (utterance === undefined) {
      throw new Error(`No utterance at index ${index}`);
    }

    return utterance;
  }

  function relayUtterance(index: number) {
    relay(index, utteranceAt(index));
  }

  /** Opens a new utterance; its index. */
  function openUtterance(direction: Direction) {
    return (
      utterances.push({
        direction,
        text: ""
      }) - 1
    );
  }

  /** The user utterance an input transcript belongs to: the open one, or else a new one. */
  function inputUtterance(isFinal: boolean) {
    if (openUser >= 0) {
      return openUser;
    }

    const isClosingUserUtterance = isFinal && unfinishedUser >= 0;
    // A late final belongs to the utterance Gemini's reply closed, not to a new one.
    if (isClosingUserUtterance) {
      return unfinishedUser;
    }

    return openUtterance(Direction.USER);
  }

  /**
   * Input transcription, MSG[7]: the user's whole utterance so far, `[[text]]` while partial and
   * `[null, [text]]` once final. Cumulative, so it replaces; the final one closes the utterance.
   */
  function onInputTranscript(field: unknown[]) {
    const text = firstString(field);
    if (text === null) {
      return;
    }

    const isFinal = field[0] === null;
    const index = inputUtterance(isFinal);
    utteranceAt(index).text = text;
    openUser = isFinal ? -1 : index;
    unfinishedUser = -1;
    unansweredSince = Date.now();
    relayUtterance(index);
  }

  /**
   * Output transcription, MSG[1][5] = [fragment, startTime, endTime, first]: one piece of what
   * Gemini is saying, `first` = 1 on a generation's opening fragment. Appended.
   */
  function onOutputTranscript(field: unknown[]) {
    const [fragment, , , first] = field;
    if (typeof fragment !== "string") {
      return;
    }

    const isNewAssistantUtterance = openAssistant < 0 || first === 1;
    if (isNewAssistantUtterance) {
      openAssistant = openUtterance(Direction.ASSISTANT);
      // Gemini answering means the user's turn is over, even if its final transcript never came.
      unfinishedUser = openUser;
      openUser = -1;
    }

    utteranceAt(openAssistant).text += fragment;
    relayUtterance(openAssistant);
  }

  /**
   * Routes one server message. MSG = [seq, serverContent, ...]; inside serverContent, [5] is the
   * output transcription, [2] generation complete and [3] interrupted (barge-in) - both of which
   * end Gemini's utterance. Audio ([0] config, [1] mp3) and acks are ignored, but any
   * serverContent or tool status means Gemini is answering.
   */
  function onServerMessage(msg: unknown) {
    const isNotSequencedMessage = !Array.isArray(msg) || typeof msg[MsgField.SEQ] !== "string";
    if (isNotSequencedMessage) {
      return;
    }

    const input: unknown = msg[MsgField.INPUT_TRANSCRIPTION];
    if (Array.isArray(input)) {
      hasWireSeen = true;
      onInputTranscript(input);
    }

    if (Array.isArray(msg[MsgField.STATUS])) {
      unansweredSince = null;
    }

    const content: unknown = msg[MsgField.SERVER_CONTENT];
    if (!Array.isArray(content)) {
      return;
    }

    unansweredSince = null;

    const output: unknown = content[ContentField.OUTPUT_TRANSCRIPTION];
    if (Array.isArray(output)) {
      hasWireSeen = true;
      onOutputTranscript(output);
    }

    const isTurnEnded = content[ContentField.GENERATION_COMPLETE] != null || content[ContentField.INTERRUPTED] != null;
    if (isTurnEnded) {
      openAssistant = -1;
    }
  }

  /**
   * One WebChannel chunk: [[arrayId, payload], ...], where a content payload is
   * [[null, MSG], ...] and the rest are ["noop"], acks and status.
   */
  function onChannelChunk(chunk: string) {
    let frames: unknown;
    try {
      frames = JSON.parse(chunk);
    } catch {
      return;
    }

    if (!Array.isArray(frames)) {
      return;
    }

    for (const frame of frames) {
      const payload: unknown = Array.isArray(frame) ? frame[1] : null;
      if (!Array.isArray(payload)) {
        continue;
      }

      for (const entry of payload) {
        const isNullKeyedEntry = Array.isArray(entry) && entry[0] === null;
        if (isNullKeyedEntry) {
          onServerMessage(entry[1]);
        }
      }
    }
  }

  /** Parses one completed chunk; a frame we misread costs a caption, never Glic's own processing. */
  function readChunk(chunk: string) {
    try {
      onChannelChunk(chunk);
    } catch {
      // Dropped: see above.
    }
  }

  /**
   * Follows a downlink XHR as it streams. The body is "<length>\n<chunk>" repeated, length in
   * UTF-16 units, so each read parses only the chunks completed since the last one. Reading
   * responseText takes nothing from Glic, whose own handler sees the same text.
   */
  function tapDownlink(xhr: XMLHttpRequest) {
    let offset = 0;
    function read() {
      let text: string;
      try {
        text = xhr.responseText;
      } catch {
        return; // a binary responseType: not a WebChannel downlink
      }
      while (true) {
        const newline = text.indexOf("\n", offset);
        if (newline < 0) {
          return;
        }

        const length = Number(text.slice(offset, newline));
        const end = newline + 1 + length;
        const isTruncatedFrame = !Number.isInteger(length) || text.length < end;
        if (isTruncatedFrame) {
          return;
        }

        const chunk = text.slice(newline + 1, end);
        offset = end;
        readChunk(chunk);
      }
    }
    xhr.addEventListener("progress", read);
    xhr.addEventListener("readystatechange", read);
  }

  // Glic's WebChannel uses XMLHttpRequest (not fetch). Patch the prototype at document-start so
  // every channel XHR it creates is followed; only listeners are added, nothing is replaced.
  try {
    // Both of open's overloads in one signature, so the patch forwards exactly the arguments Glic
    // passed, whichever overload it called.
    type OpenRest = [async?: boolean, username?: string | null, password?: string | null];
    const xhrOpen: (this: XMLHttpRequest, method: string, url: string | URL, ...rest: OpenRest) => void =
      XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    const downlinks = new WeakSet<XMLHttpRequest>();
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: OpenRest
    ) {
      const isToUpperCaseGETAndIncludes =
        String(method).toUpperCase() === "GET" && String(url).includes(LIVE_CHANNEL_PATH);
      if (isToUpperCaseGETAndIncludes) {
        downlinks.add(this);
      } else {
        downlinks.delete(this);
      }

      xhrOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest,
      ...args: [Document | XMLHttpRequestBodyInit | null | undefined]
    ) {
      if (downlinks.has(this)) {
        tapDownlink(this);
      }

      return xhrSend.apply(this, args);
    };
  } catch {
    // Frozen XHR: the caption scrape still runs.
  }

  return {
    reset() {
      utterances = [];
      openUser = -1;
      unfinishedUser = -1;
      openAssistant = -1;
      unansweredSince = null;
    },
    seen: () => hasWireSeen,
    unansweredSince: () => unansweredSince
  };
}
