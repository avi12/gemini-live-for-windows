export const LIVE_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/"
  + "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export const MIC_RATE = 16000;
export const SPEAKER_RATE = 24000;
const MIC_CHUNKS_PER_SECOND = 25;
export const MIC_CHUNK_SAMPLES = MIC_RATE / MIC_CHUNKS_PER_SECOND;
export const BYTES_PER_PCM16_SAMPLE = 2;

export const AUDIO_MIME_TYPE = `audio/pcm;rate=${MIC_RATE}`;
export const FRAME_MIME_TYPE = "image/jpeg";

export const MODEL_PREFIX = "models/";
export const SESSION_CLOSE_TIMEOUT_MS = 1000;
export const DEFAULT_CLOSE_REASON = "Session ended";
export const RECONNECT_FAILED_PREFIX = "Reconnect failed: ";
export const SETUP_REJECTED_PREFIX = "Setup rejected: ";
export const INVALID_MESSAGE_REASON = "Live API sent a message this app cannot read";
export const CONNECTION_FAILED_REASON = "Could not reach the Live API";

export const CloseCode = {
  normalClosure: 1000
} as const;
export const NORMAL_CLOSE_REASON = "bye";

export const SocketState = {
  open: 1
} as const;

export const SYSTEM_PROMPT =
  "You are Gemini Live running on the user's Windows PC. You can see their screen: you "
  + "receive a still of the shared display about once a second. Speak naturally and briefly, "
  + "like a person looking over their shoulder. Refer to what is on screen when it helps. If "
  + "the screen has not been shared yet or is unclear, say so instead of guessing.";

export const FRAME_INTERVAL_MS = 1000;
export const FRAME_REFRESH_MS = 10000;
