# Live transcript from the wire

Glic's caption overlay (`captions-scroller`, `<b>You:</b>` / `<b>Gemini:</b>`) sometimes labels
Gemini's own speech "You:" - typically the filler it says before a tool call ("Let me check on
that for you."), sometimes a whole answer. The Live channel never mixes the two up, so
`glic_bridge.js` reads speaker roles off the wire and keeps the caption scrape only as a fallback
for when the wire carries no transcript (`wireSeen` stays false).

Captured live in the app's hidden page on 2026-10-06 (CDP on `localhost:9333`, a synthetic mic
fed with SAPI speech).

## Transport

- Live = Closure WebChannel to `https://geminiweb-pa.clients6.google.com/v1/processSession`.
- Glic uses **XMLHttpRequest**, not fetch (`performance` resource entries: `initiatorType`
  `xmlhttprequest`). POSTs carry the uplink; long-poll **GETs** are the downlink.
- The bridge patches `XMLHttpRequest.prototype.open/send` at document-start and, for GETs to
  `/v1/processSession`, adds `progress` + `readystatechange` listeners that read `responseText`.
  Nothing of Glic's is replaced or consumed; its own handler sees the same text.

## Downlink framing

Body = repeated `<length>\n<chunk>`, length in UTF-16 units (Closure's `ChannelRequest`). Each
chunk is JSON: `[[arrayId, payload], ...]`.

- `payload = ["noop"]` - keepalive.
- `payload = [[null, MSG], ...]` - server message(s). `MSG[0]` is a string sequence number.
- `payload = [[null,null,null,null,null,[[["<seq>",n],...]]]]` - input acks (ignored).

Inside `MSG`:

| Field | Meaning | Example |
|---|---|---|
| `MSG[7]` | **Input transcription** (user), cumulative. `[[text]]` partial, `[null,[text]]` final | `["10",null,…,null,[null,["Can you check what is on my calendar for tomorrow?"]]]` |
| `MSG[1][5]` | **Output transcription** (Gemini), one fragment: `[text, start, end, first]`; `first` = 1 on a generation's opening fragment | `["22",[null,null,null,null,null,["Let me take a moment to ",[],[null,960625000],1]]]` |
| `MSG[1][0]` | Audio config `[3, 24000, 1, "<generation>"]` (generation id increments) | `["17",[[3,24000,1,"1"]]]` |
| `MSG[1][1]` | Audio chunk `[<base64 mp3>]` | |
| `MSG[1][2]` | Generation complete (`[null,null,[]]`) | `["71",[null,null,[]]]` |
| `MSG[1][3]` | Interrupted / barge-in (`[null,null,null,[]]`) | |
| `MSG[1][4]` | Audio stream markers (`"1-audio-stream"`, `"<uuid>-wait-for-audio"`) | |
| `MSG[3]` | Status / tool events, e.g. `[[[30,null,null,["<uuid>",null,"google_search:search"]]]]` | |
| `MSG[6]` | Conversation metadata; later repeats the user prompt and the full reply text | |

## Utterance grouping (what the bridge emits)

`{kind:'transcript', text, direction, index}`, `index` = order the wire opened the utterance
(reset when Live starts).

- **User**: `MSG[7]` replaces the open user utterance's text (opening one if none); a final
  (`[null,[text]]`) closes it.
- **Gemini**: `MSG[1][5]` appends to the open assistant utterance; a new one opens when none is
  open or the fragment has `first` = 1. `MSG[1][2]` (complete) or `MSG[1][3]` (interrupted)
  closes it. A tool-call filler and the answer that follows are separate generations, so they
  arrive as two Gemini utterances.
- Gemini starting a generation closes any still-open user utterance; a late final for it updates
  that utterance instead of opening a new one.

## Observed sequence (tool call with filler)

```
MSG[7]     [[" Search the web for today's weather in Tel Aviv."]]      partial
MSG[7]     [null,["Search the web for today's weather in Tel Aviv."]]  final
MSG[1][0]  [3,24000,1,"2"]                                              generation 2 audio
MSG[1][5]  ["Let me quickly check ",[],[null,880625000],1]               first fragment
MSG[3]     [[[30,null,null,["<uuid>",null,"google_search:search"]]]]    async search
MSG[1][5]  [" for you.",…,0]
MSG[1][2]  [null,null,[]]                                               complete
MSG[1][0]  [3,24000,1,"3"]                                              answer = new generation
MSG[1][5]  ["The current weather in ",[],[null,800625000],1]
```

## Caveats

- Text is the server's ASR / transcription, so it can differ slightly from Glic's captions
  (e.g. a clipped first word).
- The index layout is reverse-engineered; if Google changes it, `wireSeen` stays false and the
  caption scrape takes over again (with its mislabels).
