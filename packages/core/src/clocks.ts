const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const CLOCKS = {
  deskConfirm: 15 * MINUTE,
  pageAnswer: 3 * MINUTE,
  waveWait: 5 * MINUTE,
  claim: 2 * HOUR,
  visit: 60 * MINUTE,
  consent: 24 * HOUR,
  gotIt: 24 * HOUR,
  checkbackUrgent: 24 * HOUR,
  checkbackNormal: 72 * HOUR,
  checkbackReply: 24 * HOUR,
} as const;

export const CHECKBACK_TRIES = 3;
