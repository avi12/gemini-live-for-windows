// Mic: keep AEC, add auto-gain + voice isolation so barge-in works over desktop speakers. Each
// capture goes through a gate the pill's mute button closes (see mic_gate.ts).
import type { Microphone } from "./glic_protocol";
import { gateMicrophone, type MicGate } from "./mic_gate";

/** Aliases Chromium adds for Windows' default devices. */
enum MicAlias {
  Default = "default",
  Communications = "communications"
}

const MIC_ALIAS_IDS = new Set<string>(Object.values(MicAlias));

/** voiceIsolation is Chromium-only and not in the DOM typings. */
interface DesktopAudioConstraints extends MediaTrackConstraints {
  voiceIsolation?: boolean;
}

export interface DesktopMic {
  setMuted(muted: boolean): void;
  /** A running session holds its stream, so a new pick reopens the mic. */
  setMic(id: string | null): void;
  /** Real microphones only, without Chromium's default-device aliases. */
  listMics(): Promise<Microphone[]>;
}

/** Which device "default" currently names, or '' if unknown. */
async function defaultMicLabel(): Promise<string> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.find(d => d.kind === "audioinput" && d.deviceId === MicAlias.Default)?.label ?? "";
}

/**
 * Takes over Glic's microphone: getUserMedia gets our processing, the app's mic pick and a mute
 * gate. `reopen` restarts a running Live so it reopens the microphone.
 */
export function installDesktopMic(reopen: () => void): DesktopMic {
  const micGates = new Set<MicGate>();
  let muted = false;
  /** The microphone picked in the app's menu (null = Windows' default), applied to every capture. */
  let micId: string | null = null;

  /** Rewrites Glic's getUserMedia constraints: audio gets our processing and mic pick, video never goes through. */
  function withDesktopConstraints(constraints?: MediaStreamConstraints): MediaStreamConstraints | undefined {
    if (!constraints) {
      return constraints;
    }

    // Glic's camera-share mode asks for video, which pops a Windows camera prompt. We only share
    // the screen (frames from C#), so the camera is never opened.
    const { video, ...rest } = constraints;
    if (video && !rest.audio) {
      throw new DOMException("Camera is not shared on desktop", "NotAllowedError");
    }

    if (!rest.audio) {
      return rest;
    }

    const requested = rest.audio === true ? {} : rest.audio;
    const audio: DesktopAudioConstraints = {
      ...requested,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      voiceIsolation: true,
      // ideal, not exact: an unplugged pick falls back to the default instead of failing Live.
      ...(micId ? {
        deviceId: {
          ideal: micId
        }
      } : {})
    };
    return {
      ...rest,
      audio
    };
  }

  try {
    const media = navigator.mediaDevices;
    const getUserMedia = media.getUserMedia.bind(media);
    media.getUserMedia = async constraints => {
      const stream = await getUserMedia(withDesktopConstraints(constraints));
      if (stream.getAudioTracks().length === 0) {
        return stream;
      }

      const gate = await gateMicrophone(stream);
      gate.setOpen(!muted);
      micGates.add(gate);
      return gate.stream;
    };
  } catch {
    // Frozen mediaDevices: Glic captures with its own constraints.
  }

  // A stream opened on "default" stays on the device that was default then, so when Windows' default
  // input changes (and no mic is picked in the menu) reopen it on the new one.
  try {
    let followedDefault = "";
    defaultMicLabel().then(
      label => (followedDefault = label),
      () => {}
    );
    navigator.mediaDevices.addEventListener("devicechange", async () => {
      const label = await defaultMicLabel().catch(() => followedDefault);
      if (label === followedDefault) {
        return;
      }

      followedDefault = label;

      if (!micId) {
        reopen();
      }
    });
  } catch {
    // No device events: a new default applies at the next start.
  }

  return {
    setMuted(value) {
      muted = value;
      for (const gate of micGates) {
        if (gate.stream.getAudioTracks().some(track => track.readyState === "live")) {
          gate.setOpen(!value);
        } else {
          micGates.delete(gate);
        }
      }
    },
    setMic(id) {
      const next = id || null;
      if (next === micId) {
        return;
      }

      micId = next;
      reopen();
    },
    async listMics() {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === "audioinput" && d.deviceId && !MIC_ALIAS_IDS.has(d.deviceId))
        .map(d => ({
          id: d.deviceId,
          label: d.label || "Microphone"
        }));
    }
  };
}
