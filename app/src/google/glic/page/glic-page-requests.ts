import { type GlicWebHost, SEND_TIMEOUT_MS, SUBMIT_TIMEOUT_MS } from "@/google/glic/glic-web-host.ts";
import type { Logger } from "@/google/ports.ts";
import { GlicMessage, microphonesSchema, textAnswerSchema } from "@/google/protocols/glic.ts";
import { typeText } from "@/google/web-host/cdp.ts";
import { withinMs } from "@/google/web-host/timeout.ts";
import { errorMessage } from "@/lib/error-message.ts";

const BEGIN_ACTION_TIMEOUT_MS = 10_000;

// Runs a request Live can't serve (a Google app, or a web search whose links Live could only say)
// as a text turn in the same conversation, and returns the answer with its links. The caller
// resumes Live with start().
async function runTextTurn({ webHost, prompt }: { webHost: GlicWebHost; prompt: string }) {
  const core = webHost.core;
  if (!core) {
    return {
      text: "",
      links: []
    };
  }

  const began = await withinMs({
    work: webHost.messenger.sendMessage(GlicMessage.BEGIN_ACTION),
    durationMs: BEGIN_ACTION_TIMEOUT_MS,
    label: GlicMessage.BEGIN_ACTION
  });
  const isTextBoxOpen = began === true;
  if (!isTextBoxOpen) {
    throw new Error("Gemini's text box didn't open for the action");
  }

  await typeText({
    core,
    text: prompt
  });
  const answer = await withinMs({
    work: webHost.messenger.sendMessage(GlicMessage.SUBMIT_AND_READ),
    durationMs: SUBMIT_TIMEOUT_MS,
    label: GlicMessage.SUBMIT_AND_READ
  });
  return textAnswerSchema.parse(answer);
}

// What the host asks the page and waits for the answer
export function createGlicPageRequests({ webHost, log }: { webHost: GlicWebHost; log: Logger }) {
  // The microphones the page can open; empty until the page has loaded
  async function listMicrophones() {
    if (!webHost.core) {
      return [];
    }

    try {
      const listed = await withinMs({
        work: webHost.messenger.sendMessage(GlicMessage.LIST_MICS),
        durationMs: SEND_TIMEOUT_MS,
        label: GlicMessage.LIST_MICS
      });
      const parsed = microphonesSchema.safeParse(listed);
      return parsed.success ? parsed.data : [];
    } catch (error) {
      log.write(`glic: listing microphones failed: ${errorMessage(error)}`);
      return [];
    }
  }

  return {
    listMicrophones,
    runAction: (prompt: string) =>
      runTextTurn({
        webHost,
        prompt
      })
  };
}
