import type { SessionGraph } from "./audio-session.ts";
import { withBufferBytes } from "@/media/winrt/buffer-access.ts";
import { DeviceInformation } from "winui-svelte/bindings/windows/devices/enumeration/DeviceInformation";
import { AudioDeviceNodeCreationStatus } from "winui-svelte/bindings/windows/media/audio/AudioDeviceNodeCreationStatus";
import type { AudioFrameInputNode } from "winui-svelte/bindings/windows/media/audio/AudioFrameInputNode";
import type { AudioFrameOutputNode } from "winui-svelte/bindings/windows/media/audio/AudioFrameOutputNode";
import { AudioGraph } from "winui-svelte/bindings/windows/media/audio/AudioGraph";
import { AudioGraphCreationStatus } from "winui-svelte/bindings/windows/media/audio/AudioGraphCreationStatus";
import { AudioGraphSettings } from "winui-svelte/bindings/windows/media/audio/AudioGraphSettings";
import { QuantumSizeSelectionMode } from "winui-svelte/bindings/windows/media/audio/QuantumSizeSelectionMode";
import { AudioBufferAccessMode } from "winui-svelte/bindings/windows/media/AudioBufferAccessMode";
import { AudioFrame } from "winui-svelte/bindings/windows/media/AudioFrame";
import { MediaCategory } from "winui-svelte/bindings/windows/media/capture/MediaCategory";
import { AudioRenderCategory } from "winui-svelte/bindings/windows/media/render/AudioRenderCategory";

const BYTES_PER_FLOAT = Float32Array.BYTES_PER_ELEMENT;
export const MICROPHONE_ACCESS_OFF = "Microphone access is off - allow it in Settings › Privacy › Microphone";

function readFloats(tap: AudioFrameOutputNode) {
  const frame = tap.getFrame();
  try {
    const buffer = frame.lockBuffer(AudioBufferAccessMode.Read);
    return withBufferBytes({
      buffer,
      use({ memory }) {
        const byteLength = buffer.length - (buffer.length % BYTES_PER_FLOAT);
        const isEmpty = byteLength === 0;
        if (isEmpty) {
          return undefined;
        }

        const bytes = memory.readBytes(0, byteLength);
        return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + byteLength));
      }
    });
  } finally {
    frame.close();
  }
}

function writeFloats({ feed, interleaved }: {
  feed: AudioFrameInputNode;
  interleaved: Float32Array;
}) {
  const frame = new AudioFrame(interleaved.length * BYTES_PER_FLOAT);
  const bytes = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
  withBufferBytes({
    buffer: frame.lockBuffer(AudioBufferAccessMode.Write),
    use: ({ memory }) => memory.writeBytes(0, bytes)
  });
  feed.addFrame(frame);
}

function wrapNodes({ graph, tap, feed }: {
  graph: AudioGraph;
  tap: AudioFrameOutputNode;
  feed: AudioFrameInputNode;
}) {
  return {
    sampleRate: graph.encodingProperties.sampleRate,
    channels: graph.encodingProperties.channelCount,
    quantumSamples: graph.samplesPerQuantum,
    micSource: {
      read: () => readFloats(tap)
    },
    speakerSink: {
      get queuedSamples() {
        return Number(feed.queuedSampleCount);
      },
      write: interleaved => writeFloats({
        feed,
        interleaved
      }),
      discard: () => feed.discardQueuedFrames()
    },
    start: () => graph.start(),
    close() {
      graph.stop();
      graph.close();
    }
  } satisfies SessionGraph;
}

async function createGraph() {
  const settings = new AudioGraphSettings(AudioRenderCategory.Communications);
  settings.quantumSizeSelectionMode = QuantumSizeSelectionMode.LowestLatency;
  const created = await AudioGraph.createAsync(settings);
  const isGraphFailed = created.status !== AudioGraphCreationStatus.Success;
  if (isGraphFailed) {
    throw new Error(`Audio graph: ${created.status}`);
  }

  return created.graph;
}

async function microphoneNodeOf({ graph, deviceId }: {
  graph: AudioGraph;
  deviceId: string | null;
}) {
  const created = deviceId === null
    ? await graph.createDeviceInputNodeAsync(MediaCategory.Communications)
    : await graph.createDeviceInputNodeAsync(
      MediaCategory.Communications,
      graph.encodingProperties,
      await DeviceInformation.createFromIdAsync(deviceId)
    );
  const isAccessDenied = created.status === AudioDeviceNodeCreationStatus.AccessDenied;
  if (isAccessDenied) {
    throw new Error(MICROPHONE_ACCESS_OFF);
  }

  const isMicrophoneFailed = created.status !== AudioDeviceNodeCreationStatus.Success;
  if (isMicrophoneFailed) {
    throw new Error(`Microphone: ${created.status}`);
  }

  return created.deviceInputNode;
}

async function speakerNodeOf(graph: AudioGraph) {
  const created = await graph.createDeviceOutputNodeAsync();
  const isSpeakerFailed = created.status !== AudioDeviceNodeCreationStatus.Success;
  if (isSpeakerFailed) {
    throw new Error(`Speaker: ${created.status}`);
  }

  return created.deviceOutputNode;
}

// One graph, mic and speaker together, in the Communications category: that pairing is what turns on
// Windows' acoustic echo cancellation. `deviceId` is the Windows device id of the microphone, null for
// the default.
export async function createDuplexGraph({ deviceId }: { deviceId: string | null }) {
  const graph = await createGraph();
  try {
    const output = await speakerNodeOf(graph);
    const input = await microphoneNodeOf({
      graph,
      deviceId
    });
    const tap = graph.createFrameOutputNode();
    input.addOutgoingConnection(tap);
    const feed = graph.createFrameInputNode(graph.encodingProperties);
    feed.addOutgoingConnection(output);
    return wrapNodes({
      graph,
      tap,
      feed
    });
  } catch (error) {
    graph.close();
    throw error;
  }
}

const SILENT_GAIN = 0;

// No microphone: what the speaker pump writes comes straight back out of the tap. By default there is
// no device at all, so the graph runs unclocked (as fast as the CPU allows): that proves the data path,
// never the cadence. `isClockedBySilentSpeaker` adds the render device at gain 0, which clocks the graph
// like the real one does without a sound.
export async function createLoopbackGraph({ isClockedBySilentSpeaker = false }: {
  isClockedBySilentSpeaker?: boolean;
} = {}) {
  const graph = await createGraph();
  try {
    const tap = graph.createFrameOutputNode();
    const feed = graph.createFrameInputNode(graph.encodingProperties);
    feed.addOutgoingConnection(tap);

    if (isClockedBySilentSpeaker) {
      feed.addOutgoingConnection(await speakerNodeOf(graph), SILENT_GAIN);
    }

    return wrapNodes({
      graph,
      tap,
      feed
    });
  } catch (error) {
    graph.close();
    throw error;
  }
}
