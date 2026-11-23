import { MODEL_PREFIX, SYSTEM_PROMPT } from "@/live/api/constants.ts";
import { MediaResolution, Modality } from "@/live/api/protocol.ts";
import type { LiveConfig } from "@/live/ports.ts";

// The setup message that opens every socket: which model and voice, what the model may use, and
// the handle that resumes the previous socket's conversation when there is one
export function buildSetup({ config, resumeHandle }: { config: LiveConfig; resumeHandle: string | undefined }) {
  return {
    model: `${MODEL_PREFIX}${config.model}`,
    generationConfig: {
      responseModalities: [Modality.AUDIO],
      mediaResolution: MediaResolution.MEDIUM,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: config.voice
          }
        }
      }
    },
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    tools: [
      {
        googleSearch: {}
      }
    ],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // Audio+video sessions are capped at ~2 minutes of context without this
    contextWindowCompression: {
      slidingWindow: {}
    },
    // Lets the session reconnect into the same conversation when the server sends goAway
    sessionResumption: resumeHandle === undefined ? {} : { handle: resumeHandle }
  };
}
