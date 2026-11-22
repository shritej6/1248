import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS, VoiceTypeSchema } from "@vision/contracts";

export const TOO_LARGE = "This file is over 2 MB.";
export const TOO_LONG = "This recording is over 2 minutes.";
export const WRONG_TYPE = "Vision takes WAV, MP3, OGG, WEBM or M4A files.";
const MEASURE_WAIT_MS = 10_000;

export type Measure = (file: File) => Promise<number | null>;

const baseType = (type: string): string => (type.split(";")[0] ?? "").trim().toLowerCase();

export function fileProblem(file: File): string | null {
  if (file.size > VOICE_MAX_BYTES) return TOO_LARGE;
  if (file.size === 0 || !VoiceTypeSchema.safeParse(baseType(file.type)).success) return WRONG_TYPE;
  return null;
}

export function lengthProblem(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return WRONG_TYPE;
  return seconds > VOICE_MAX_SECONDS ? TOO_LONG : null;
}

export const sentSeconds = (seconds: number): number => Math.max(0.1, Math.round(seconds * 10) / 10);

export const audioSeconds: Measure = (file) =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const finish = (seconds: number | null) => {
      clearTimeout(timer);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    const timer = setTimeout(() => {
      finish(null);
    }, MEASURE_WAIT_MS);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      finish(Number.isFinite(audio.duration) ? audio.duration : null);
    };
    audio.onerror = () => {
      finish(null);
    };
    audio.src = url;
  });
