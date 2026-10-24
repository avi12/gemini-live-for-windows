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
  Seq = 0,
  ServerContent = 1,
  InputTranscription = 7
}

/** Field indexes in MSG[ServerContent]. */
enum ContentField {
  GenerationComplete = 2,
  Interrupted = 3,
  OutputTranscription = 5
}

export interface WireTranscript {
  /** Forgets the previous session's utterances; indices restart at 0. */
  reset(): void;
  /** Whether the wire has carried a transcript, so the caption scrape is not needed. */
  seen(): boolean;
}

/** The first string anywhere in a nested array, depth first. */
function firstString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  for (const item of value) {
    const found = firstString(item);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Follows every Live downlink Glic opens and hands `relay` each utterance as it grows, keyed by
 * its index in the session.
 */
export function tapLiveTranscript(relay: (index: number, utterance: Utterance) => void): WireTranscript {
  /** Utterances in the order the wire opened them; the array index is the transcript index. */
  let utterances: Utterance[] = [];
  /** Index of the user utterance still being transcribed, or -1. */
  let openUser = -1;
  /** A user utterance Gemini's reply closed before its final transcript arrived, or -1. */
  let unfinishedUser = -1;
  /** Index of the Gemini utterance still being spoken, or -1. */
  let openAssistant = -1;
  let wireSeen = false;

  function relayUtterance(index: number): void {
    relay(index, utterances[index]!);
  }

  /** Opens a new utterance; its index. */
  function openUtterance(direction: Direction): number {
    return utterances.push({
      direction,
      text: ""
    }) - 1;
  }

  /** The user utterance an input transcript belongs to: the open one, or else a new one. */
  function inputUtterance(isFinal: boolean): number {
    if (openUser >= 0) {
      return openUser;
    }

    // A late final belongs to the utterance Gemini's reply closed, not to a new one.
    if (isFinal && unfinishedUser >= 0) {
      return unfinishedUser;
    }

    return openUtterance(Direction.User);
  }

  /**
   * Input transcription, MSG[7]: the user's whole utterance so far, `[[text]]` while partial and
   * `[null, [text]]` once final. Cumulative, so it replaces; the final one closes the utterance.
   */
  function onInputTranscript(field: unknown[]): void {
    const text = firstString(field);
    if (text === null) {
      return;
    }

    const isFinal = field[0] === null;
    const index = inputUtterance(isFinal);
    utterances[index]!.text = text;
    openUser = isFinal ? -1 : index;
    unfinishedUser = -1;
    relayUtterance(index);
  }

  /**
   * Output transcription, MSG[1][5] = [fragment, startTime, endTime, first]: one piece of what
   * Gemini is saying, `first` = 1 on a generation's opening fragment. Appended.
   */
  function onOutputTranscript(field: unknown[]): void {
    const [fragment, , , first] = field;
    if (typeof fragment !== "string") {
      return;
    }

    if (openAssistant < 0 || first === 1) {
      openAssistant = openUtterance(Direction.Assistant);
      // Gemini answering means the user's turn is over, even if its final transcript never came.
      unfinishedUser = openUser;
      openUser = -1;
    }

    utterances[openAssistant]!.text += fragment;
    relayUtterance(openAssistant);
  }

  /**
   * Routes one server message. MSG = [seq, serverContent, ...]; inside serverContent, [5] is the
   * output transcription, [2] generation complete and [3] interrupted (barge-in) - both of which
   * end Gemini's utterance. Audio ([0] config, [1] mp3) and acks are ignored.
   */
  function onServerMessage(msg: unknown): void {
    if (!Array.isArray(msg) || typeof msg[MsgField.Seq] !== "string") {
      return;
    }

    const input: unknown = msg[MsgField.InputTranscription];
    if (Array.isArray(input)) {
      wireSeen = true;
      onInputTranscript(input);
    }

    const content: unknown = msg[MsgField.ServerContent];
    if (!Array.isArray(content)) {
      return;
    }

    const output: unknown = content[ContentField.OutputTranscription];
    if (Array.isArray(output)) {
      wireSeen = true;
      onOutputTranscript(output);
    }

    if (content[ContentField.GenerationComplete] != null || content[ContentField.Interrupted] != null) {
      openAssistant = -1;
    }
  }

  /**
   * One WebChannel chunk: [[arrayId, payload], ...], where a content payload is
   * [[null, MSG], ...] and the rest are ["noop"], acks and status.
   */
  function onChannelChunk(chunk: string): void {
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
        if (Array.isArray(entry) && entry[0] === null) {
          onServerMessage(entry[1]);
        }
      }
    }
  }

  /** Parses one completed chunk; a frame we misread costs a caption, never Glic's own processing. */
  function readChunk(chunk: string): void {
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
  function tapDownlink(xhr: XMLHttpRequest): void {
    let offset = 0;
    function read(): void {
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
        if (!Number.isInteger(length) || text.length < end) {
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
      if (String(method).toUpperCase() === "GET" && String(url).includes(LIVE_CHANNEL_PATH)) {
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
    },
    seen: () => wireSeen
  };
}
