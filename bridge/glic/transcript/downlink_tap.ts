// The Live downlink as Glic receives it: its WebChannel long-poll GETs, followed as they stream and
// cut into the server messages they carry. Frame layout: docs/live-transcript-wire.md.

/** The Live channel; its long-poll GETs are the downlink (POSTs carry the mic up). */
const LIVE_CHANNEL_PATH = "/v1/processSession";

/**
 * Follows every Live downlink Glic opens and hands `onServerMessage` each server message, MSG, as
 * its chunk completes.
 */
export function tapLiveDownlinks(onServerMessage: (msg: unknown) => void) {
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
    type SendArguments = [Document | XMLHttpRequestBodyInit | null | undefined];
    // The two methods as plain function properties, so they can be kept and called on each request.
    interface PatchablePrototype {
      open: (this: XMLHttpRequest, method: string, url: string | URL, ...rest: OpenRest) => void;
      send: (this: XMLHttpRequest, ...args: SendArguments) => void;
    }
    const xhrPrototype: PatchablePrototype = XMLHttpRequest.prototype;
    const xhrOpen = xhrPrototype.open;
    const xhrSend = xhrPrototype.send;
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
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: SendArguments) {
      if (downlinks.has(this)) {
        tapDownlink(this);
      }

      return xhrSend.apply(this, args);
    };
  } catch {
    // Frozen XHR: the caption scrape still runs.
  }
}
