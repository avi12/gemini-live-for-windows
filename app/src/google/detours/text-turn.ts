import type { createDetourRunner } from "./detour-runner.ts";
import { LiveEventKind, LiveStatus } from "@/contracts/live-engine.ts";
import type { GlicHost } from "@/google/glic/glic-host.ts";
import type { LiveEventSink } from "@/google/live-event-sink.ts";
import type { Logger } from "@/google/ports.ts";
import { delay } from "@/google/web-host/timeout.ts";
import { errorMessage } from "@/lib/error-message.ts";

// A text detour replaces the Live session, which cuts Gemini off mid-word. So it waits for Gemini
// to start answering (a moment after the request), then for its captions to stop growing (the
// voice is a beat behind the text), and never longer than the cap, in case it never stops.
const ANSWER_START_GRACE_MS = 3000;
const SPEECH_SETTLE_MS = 1800;
const MAX_SPEECH_WAIT_MS = 20_000;
const SPEECH_POLL_MS = 150;

// Returns once Gemini has stopped talking for now: it gets a short grace to start answering, then
// until its captions have been still for a moment, up to a cap. There is no "speaking" signal from
// the page, so a still caption is the best sign it has finished.
async function waitForGeminiToFinish({ speech, now }: {
  speech: { lastGeminiCaptionAt: number };
  now: () => number;
}) {
  const asked = now();
  while (now() - asked < ANSWER_START_GRACE_MS && speech.lastGeminiCaptionAt < asked) {
    await delay(SPEECH_POLL_MS);
  }

  while (now() - asked < MAX_SPEECH_WAIT_MS && now() - speech.lastGeminiCaptionAt < SPEECH_SETTLE_MS) {
    await delay(SPEECH_POLL_MS);
  }
}

// Lets Gemini finish what it is saying first, since the text turn replaces the Live session, then
// asks the prompt it builds, after the wait so it can quote Gemini's whole last line.
export function runTextDetour({ runner, host, sink, log, now, speech, request, statusText, buildPrompt }: {
  runner: ReturnType<typeof createDetourRunner>;
  host: Pick<GlicHost, "start" | "runAction">;
  sink: LiveEventSink;
  log: Logger;
  now: () => number;
  speech: { lastGeminiCaptionAt: number };
  request: string;
  statusText: string;
  buildPrompt: () => Promise<string>;
}) {
  return runner.run({
    request,
    statusText,
    async detour() {
      await waitForGeminiToFinish({
        speech,
        now
      });
      await askTextPath({
        prompt: await buildPrompt(),
        host,
        sink,
        log
      });
    }
  });
}

async function askTextPath({ prompt, host, sink, log }: {
  prompt: string;
  host: Pick<GlicHost, "start" | "runAction">;
  sink: LiveEventSink;
  log: Logger;
}) {
  try {
    const answer = await host.runAction(prompt);
    log.write(`text turn: ${answer.text.length} chars, ${answer.links.length} links back`);

    const hasText = answer.text.length > 0;
    if (hasText) {
      sink.transcript({
        text: answer.text,
        isUser: false
      });
    }

    const hasLinks = answer.links.length > 0;
    if (hasLinks) {
      sink.emit({
        kind: LiveEventKind.links,
        links: answer.links.map(link => ({
          title: link.title,
          uri: link.url
        }))
      });
    }

    await host.start();
    sink.status(LiveStatus.listening);
  } catch (error) {
    log.write(`text turn failed: ${errorMessage(error)}`);
    sink.status(LiveStatus.listening);
    host.start().catch(() => undefined);
  }
}
