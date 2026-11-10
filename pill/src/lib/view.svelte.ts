import {
  EngineKind,
  GlowMode,
  pillActionSchema,
  pillViewSchema,
  previewFramesPerSecond,
  VIEW_NAME
} from "@gemini-live/protocol/view";
import type { PillAction, PillView, WindowProtocol } from "@gemini-live/protocol/view";
import { hostState } from "winui-svelte/state";
import type { HostChannel, HostState } from "winui-svelte/state";

type PillChannel = HostChannel<PillAction, WindowProtocol>;

interface Connection {
  channel: PillChannel;
  state: HostState<PillView>;
}

const EMPTY_VIEW: PillView = {
  status: "",
  statusDetail: "",
  isMuted: false,
  lines: [],
  links: [],
  displays: [],
  pillDisplay: null,
  sharedDisplay: null,
  isExtensionNeeded: false,
  isExtensionStepsShown: false,
  isKeyPromptShown: false,
  engine: EngineKind.google,
  microphones: [],
  microphoneId: null,
  isCameraShared: false,
  update: null,
  glow: {
    mode: GlowMode.rest,
    level: 0,
    isUser: false
  },
  isShown: false,
  isFocusable: false
};

let connection: Connection | undefined = $state.raw();
let isValid = $state(false);

function reportProblem(message: string) {
  process.stderr.write(`pill: ${message}\n`);
}

function readConnection() {
  const current = connection;
  if (!current) {
    throw new Error("the pill view is not connected: call connectView first");
  }

  return current;
}

function readLiveView() {
  const current = connection?.state.current;
  const isSnapshotUsable = isValid && current !== undefined;
  if (!isSnapshotUsable) {
    return EMPTY_VIEW;
  }

  return current;
}

async function validateSnapshot(state: HostState<PillView>) {
  const parsed = pillViewSchema.safeParse(await state.ready);
  if (!parsed.success) {
    reportProblem(`the host's view snapshot is invalid: ${parsed.error.message}`);
    return;
  }

  isValid = true;
}

function createView() {
  const target = { ...EMPTY_VIEW };
  for (const key of pillViewSchema.keyof().options) {
    Object.defineProperty(target, key, {
      enumerable: true,
      get: () => readLiveView()[key]
    });
  }

  return target;
}

/**
 * The host's state, read-only and reactive: each property reads the live snapshot, patched in place.
 * Before the first valid snapshot it reads as an empty, hidden pill (isShown is false), so no read
 * needs a null check and the window, which must exist from the start, stays hidden.
 */
export const view = createView();

export const pillPreview = {
  get framesPerSecond() {
    return previewFramesPerSecond(view);
  }
};

export function connectView({ channel }: { channel: PillChannel }) {
  const state = hostState<PillView>({
    channel,
    name: VIEW_NAME
  });
  connection = {
    channel,
    state
  };
  void validateSnapshot(state);
}

export async function sendAction(action: PillAction) {
  const parsed = pillActionSchema.safeParse(action);
  if (!parsed.success) {
    reportProblem(`dropped an invalid action: ${parsed.error.message}`);
    return;
  }

  try {
    await readConnection().channel.send(parsed.data);
  } catch (error) {
    reportProblem(`the host refused ${action.kind}: ${String(error)}`);
  }
}
