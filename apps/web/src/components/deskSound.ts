export type DeskSound = { playPage: () => void };

const PULSES = 5;
const PULSE_S = 0.12;
const GAP_S = 0.08;
const PAGE_HZ = 880;
const VOLUME = 0.2;

type AudioContextClass = new () => AudioContext;

function audioClass(): AudioContextClass | null {
  return typeof window.AudioContext === "function" ? window.AudioContext : null;
}

function pulse(context: AudioContext, start: number): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = PAGE_HZ;
  gain.gain.setValueAtTime(VOLUME, start);
  gain.gain.setValueAtTime(0, start + PULSE_S);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + PULSE_S);
}

export function unlockSound(): DeskSound | null {
  const Audio = audioClass();
  if (Audio === null) {
    console.warn("sound: this browser has no Web Audio, pages are silent");
    return null;
  }
  const context = new Audio();
  context.resume().catch((error: unknown) => {
    const name = error instanceof Error ? error.name : "unknown";
    console.warn(`sound: the browser kept the sound locked (${name})`);
  });
  return {
    playPage: () => {
      const start = context.currentTime;
      for (let i = 0; i < PULSES; i += 1) pulse(context, start + i * (PULSE_S + GAP_S));
    },
  };
}
