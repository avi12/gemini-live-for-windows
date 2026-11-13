import { errorMessage } from "@/lib/error-message.ts";
import { AudioCommandKind, audioCommandSchema, AudioEventKind } from "@/media/audio/audio-protocol.ts";
import type { AudioCommand, AudioEvent } from "@/media/audio/audio-protocol.ts";
import { createAudioSession } from "@/media/audio/session/audio-session.ts";
import type { AudioSession, SessionGraph } from "@/media/audio/session/audio-session.ts";
import type { Clock } from "@/media/clock.ts";

// The two ends of the worker's port, so the host runs against a MessageChannel in tests
export interface AudioPort {
  postMessage(event: AudioEvent, transfer?: readonly ArrayBuffer[]): void;
  on(event: "message", listener: (message: unknown) => void): void;
}

export interface OpenGraphRequest {
  deviceId: string | null;
  isLoopback: boolean;
}

function createSessionHolder({
  send,
  openGraph,
  clock
}: {
  send: (event: AudioEvent) => void;
  openGraph: (request: OpenGraphRequest) => Promise<SessionGraph>;
  clock: Clock;
}) {
  let session: AudioSession | undefined;
  let isMuted = false;

  return {
    async start(request: OpenGraphRequest) {
      const graph = await openGraph(request);
      session = createAudioSession({
        graph,
        clock,
        onMicChunk: pcm16 =>
          send({
            kind: AudioEventKind.MIC_CHUNK,
            pcm16
          }),
        onMicLevel: peak =>
          send({
            kind: AudioEventKind.MIC_LEVEL,
            peak
          }),
        onSpeakerLevel: peak =>
          send({
            kind: AudioEventKind.SPEAKER_LEVEL,
            peak
          }),
        onFailure: message =>
          send({
            kind: AudioEventKind.FAILED,
            message
          })
      });
      session.setMuted(isMuted);
      session.start();
      send({ kind: AudioEventKind.STARTED });
    },
    dispose() {
      session?.dispose();
      session = undefined;
      send({ kind: AudioEventKind.DISPOSED });
    },
    play(pcm16: Uint8Array<ArrayBuffer>) {
      session?.play(pcm16);
    },
    flush() {
      session?.flush();
    },
    mute(isNowMuted: boolean) {
      isMuted = isNowMuted;
      session?.setMuted(isMuted);
    }
  };
}

async function handleCommand({
  holder,
  command
}: {
  holder: ReturnType<typeof createSessionHolder>;
  command: AudioCommand;
}) {
  switch (command.kind) {
    case AudioCommandKind.START:
      await holder.start({
        deviceId: command.deviceId,
        isLoopback: command.isLoopback
      });
      break;
    case AudioCommandKind.PLAY:
      holder.play(command.pcm16);
      break;
    case AudioCommandKind.FLUSH:
      holder.flush();
      break;
    case AudioCommandKind.MUTE:
      holder.mute(command.isMuted);
      break;
    default:
      holder.dispose();
  }
}

// The worker's whole behaviour: commands in, events out, one session at a time. Importing it does
// nothing; audio-worker.ts is the entry that calls it.
export function serveAudio({
  port,
  openGraph,
  clock
}: {
  port: AudioPort;
  openGraph: (request: OpenGraphRequest) => Promise<SessionGraph>;
  clock: Clock;
}) {
  function send(event: AudioEvent) {
    const transfer = "pcm16" in event ? [event.pcm16.buffer] : [];
    port.postMessage(event, transfer);
  }

  const holder = createSessionHolder({
    send,
    openGraph,
    clock
  });

  async function receive(message: unknown) {
    const parsed = audioCommandSchema.safeParse(message);
    if (!parsed.success) {
      send({
        kind: AudioEventKind.FAILED,
        message: `Unreadable audio command: ${parsed.error.message}`
      });
      return;
    }

    try {
      await handleCommand({
        holder,
        command: parsed.data
      });
    } catch (error) {
      send({
        kind: AudioEventKind.FAILED,
        message: errorMessage(error)
      });
    }
  }

  port.on("message", message => {
    void receive(message);
  });
}
