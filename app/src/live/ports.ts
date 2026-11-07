import type { Monitor, Region } from "@/contracts/monitor.ts";

// What the API-key engine needs from the outside world. MEDIA implements the two streams, CORE's
// Settings satisfies LiveConfig; the engine itself never touches a device or a file.

export interface LiveConfig {
  apiKey(): string;
  readonly model: string;
  readonly voice: string;
}

export type LogSink = (message: string) => void;

export type Unsubscribe = () => void;

// Mic and speaker share one communications graph on purpose: that is what turns on Windows'
// acoustic echo cancellation, so Gemini does not hear itself and interrupt itself.
export interface AudioDuplex {
  // While true the mic still streams, as silence, and its level reads 0
  isMuted: boolean;
  start(): Promise<void>;
  // 16 kHz mono PCM16 little-endian, one chunk per 40 ms
  onMicChunk(listener: (pcm16: Uint8Array) => void): Unsubscribe;
  // Mic peak 0..1 per capture quantum, before muting
  onMicLevel(listener: (peak: number) => void): Unsubscribe;
  // Speaker peak 0..1 per playback quantum, measured on what is actually being played
  onSpeakerLevel(listener: (peak: number) => void): Unsubscribe;
  // Queues model speech: 24 kHz mono PCM16 little-endian
  play(pcm16: Uint8Array): void;
  // Barge-in: drops everything queued and not yet heard
  flush(): void;
  dispose(): void;
}

export interface ScreenTarget {
  readonly monitor: Monitor;
  // In the monitor's physical pixels; undefined captures the whole display
  readonly region: Region | undefined;
}

export interface ScreenSource {
  // One JPEG still of the target, already cropped to its region
  capture(target: ScreenTarget): Promise<Uint8Array>;
}
