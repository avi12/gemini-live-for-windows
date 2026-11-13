import type { PillContext } from "@/pill/context.ts";

const NO_MICROPHONE = "Default (Windows)";

// Like Win+H's flyout lists them: every microphone Gemini's page can open
export async function refreshMicrophones(context: PillContext) {
  context.state.microphones = await context.deps.microphones.list();
  context.changed();
}

export async function setMicrophone({ context, id }: { context: PillContext; id: string | null }) {
  const { state, deps } = context;
  const found = state.microphones.find(microphone => microphone.id === id);
  const isUnknown = id !== null && found === undefined;
  if (isUnknown) {
    throw new Error(`There is no microphone '${id}'`);
  }

  await deps.settings.setMicrophoneId(id);
  deps.microphones.select(id);
  deps.log(`microphone -> ${found?.name ?? NO_MICROPHONE}`);
}
