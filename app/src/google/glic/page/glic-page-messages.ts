import { createGlicRecovery } from "./glic-recovery.ts";
import type { createEmitter } from "@/google/emitter.ts";
import type { GlicCommands } from "@/google/glic/glic-commands.ts";
import { type GlicHostEvent, GlicHostEventKind } from "@/google/glic/glic-events.ts";
import type { GlicState } from "@/google/glic/glic-state.ts";
import type { GlicWebHost } from "@/google/glic/glic-web-host.ts";
import type { GlicSession } from "@/google/glic/session/glic-session.ts";
import type { Logger } from "@/google/ports.ts";
import { Direction, GlicMessage, glicStateSchema, transcriptLineSchema } from "@/google/protocols/glic.ts";
import type { SharedView } from "@/google/shared-view.ts";
import { z } from "zod";

function onBooted({ state, commands, log }: {
  state: GlicState;
  commands: GlicCommands;
  log: Logger;
}) {
  state.isBooted = true;
  log.write("glic: host adopted");

  const hasMicrophone = state.microphoneId !== null;
  if (hasMicrophone) {
    void commands.sendMic(state.microphoneId);
  }

  const isStartable = state.isActive && !state.isUnavailable;
  if (isStartable) {
    void commands.sendStart();
  }
}

// What the page tells the host. Registered once, not per control: a rebuilt control keeps the same
// messenger, which allows one listener per message.
export function registerGlicPageMessages({ state, webHost, commands, session, events, view, log, now }: {
  state: GlicState;
  webHost: GlicWebHost;
  commands: GlicCommands;
  session: GlicSession;
  events: ReturnType<typeof createEmitter<GlicHostEvent>>;
  view: SharedView;
  log: Logger;
  now: () => number;
}) {
  const { messenger } = webHost;
  const recovery = createGlicRecovery({
    state,
    webHost,
    session,
    events,
    log,
    now
  });

  messenger.onMessage(GlicMessage.booted, () => onBooted({
    state,
    commands,
    log
  }));
  messenger.onMessage(GlicMessage.ready, () => {
    log.write("glic: live");
    state.ready.resolve();
  });
  messenger.onMessage(GlicMessage.state, message => {
    const parsed = glicStateSchema.safeParse(message.data);
    if (!parsed.success) {
      return;
    }

    events.emit({
      kind: GlicHostEventKind.state,
      isListening: parsed.data === glicStateSchema.enum.listening
    });
  });
  messenger.onMessage(GlicMessage.transcript, message => {
    const parsed = transcriptLineSchema.safeParse(message.data);
    if (!parsed.success) {
      return;
    }

    events.emit({
      kind: GlicHostEventKind.caption,
      text: parsed.data.text,
      isUser: parsed.data.direction === Direction.user,
      index: parsed.data.index
    });
  });
  messenger.onMessage(GlicMessage.error, message => {
    const parsed = z.string().nullable().safeParse(message.data);
    recovery.onPageError(parsed.success ? parsed.data : null);
  });
  messenger.onMessage(GlicMessage.capture, () => view.capture());
  messenger.onMessage(GlicMessage.read, () => view.read());
}
