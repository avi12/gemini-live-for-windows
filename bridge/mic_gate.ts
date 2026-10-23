// A mute that Live can't mistake for a broken mic. A disabled track sends pure digital silence,
// which Glic answers with "Your audio couldn't be heard"; this routes the microphone through a gain
// gate instead and mixes in a faint comfort noise, so a muted mic still sounds like a quiet room.
// Ported from interview-prep's mic mixer (apps/gemini-live/src/lib/mic-mixer.ts).

const COMFORT_NOISE_LEVEL = 0.001;
const GATE_RAMP_SECONDS = 0.01;
// A hidden page may not be allowed to run audio; past this, keep the raw microphone instead.
const RESUME_TIMEOUT_MS = 1000;

export interface MicGate {
  stream: MediaStream;
  setOpen(open: boolean): void;
}

/** One second of faint white noise, looped. */
const comfortNoise = (context: AudioContext): AudioBufferSourceNode => {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (Math.random() * 2 - 1) * COMFORT_NOISE_LEVEL;
  }
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  noise.start();
  return noise;
};

/**
 * Routes the microphone through a gate; null when audio can't run here, so the
 * caller keeps the microphone as it is. Stopping the gated track stops the microphone too.
 */
export const gateMicrophone = async (microphone: MediaStream): Promise<MicGate | null> => {
  const context = new AudioContext();
  const running = await Promise.race([
    context.resume().then(() => context.state === 'running'),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), RESUME_TIMEOUT_MS)),
  ]).catch(() => false);
  if (!running) {
    void context.close();
    return null;
  }

  const destination = context.createMediaStreamDestination();
  const gate = context.createGain();
  context.createMediaStreamSource(microphone).connect(gate).connect(destination);
  comfortNoise(context).connect(destination);

  const [gated] = destination.stream.getAudioTracks();
  if (gated) {
    const stopGated = gated.stop.bind(gated);
    gated.stop = () => {
      stopGated();
      for (const track of microphone.getTracks()) {
        track.stop();
      }
      void context.close();
    };
  }

  return {
    stream: destination.stream,
    setOpen(open) {
      gate.gain.setTargetAtTime(open ? 1 : 0, context.currentTime, GATE_RAMP_SECONDS);
    },
  };
};
