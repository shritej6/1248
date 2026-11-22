import type { FailureCode } from "../api.js";

export type AskWords = {
  lang: "en" | "es";
  title: (orgName: string | null) => string;
  needLabel: string;
  needHint: string;
  needError: string;
  nameLabel: string;
  nameError: string;
  contactLabel: string;
  contactHint: string;
  emailError: string;
  phoneError: string;
  zipLabel: string;
  zipError: string;
  addressLabel: string;
  addressHint: string;
  safeLabel: string;
  safeHint: string;
  yes: string;
  no: string;
  safeError: string;
  send: string;
  sending: string;
  failure: (code: FailureCode) => string;
  receiptTitle: string;
  receiptReads: (orgName: string | null) => string;
  receiptKeep: string;
  danger: string;
  call: string;
};

export type TrackWords = {
  lang: "en" | "es";
  title: string;
  noCode: string;
  stepsLabel: string;
  step: (word: string) => string;
  day: (at: number, now: number) => string;
  deletedOn: (date: string) => string;
  date: (at: number) => string;
  messagesTitle: string;
  consentTitle: string;
  consentText: (partnerName: string, needLabel: string) => string;
  shareYes: string;
  shareNo: string;
  checkbackTitle: string;
  checkbackText: (needLabel: string) => string;
  helpedYes: string;
  helpedPartly: string;
  helpedNo: string;
  sent: string;
  sending: string;
  answerFailure: (code: FailureCode) => string;
  danger: string;
  call: string;
};

const ZONE = "America/Chicago";
const TIME = new Intl.DateTimeFormat("es-US", { hour: "numeric", minute: "2-digit", timeZone: ZONE });
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeZone: ZONE });
const WEEKDAY = new Intl.DateTimeFormat("es-US", { weekday: "short", timeZone: ZONE });
const MONTH_DAY = new Intl.DateTimeFormat("es-US", { month: "short", day: "numeric", timeZone: ZONE });
const LONG_DATE = new Intl.DateTimeFormat("es-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: ZONE,
});
const WEEK_MS = 6 * 24 * 60 * 60 * 1000;
const spaced = (text: string): string => text.replace(/\s/gu, " ");

export function spanishDayTime(at: number, now: number): string {
  const time = spaced(TIME.format(at));
  if (DAY_KEY.format(at) === DAY_KEY.format(now)) return `Hoy ${time}`;
  if (Math.abs(now - at) <= WEEK_MS) return `${WEEKDAY.format(at)} ${time}`;
  return `${MONTH_DAY.format(at)} ${time}`;
}

export function spanishLongDate(at: number): string {
  return spaced(LONG_DATE.format(at));
}

const STEPS: Readonly<Record<string, string>> = {
  Received: "Recibida",
  Sorted: "Revisada",
  Confirmed: "Confirmada",
  "A volunteer has it": "Una persona voluntaria la tiene",
  "On the way": "En camino",
  "Volunteer on the way": "La persona voluntaria va en camino",
  Arrived: "Llegó",
  Done: "Terminada",
};
const HAS_IT = " has it";

export function spanishStep(word: string): string {
  const known = STEPS[word];
  if (known !== undefined) return known;
  return word.endsWith(HAS_IT) ? `${word.slice(0, -HAS_IT.length)} la tiene` : word;
}

const NO_CONNECTION = "No se envió. No hay conexión. Intente de nuevo.";

function askFailure(code: FailureCode): string {
  switch (code) {
    case "network":
      return NO_CONNECTION;
    case "rate_limited":
      return "Hay demasiadas solicitudes desde esta red. Espere un minuto e intente de nuevo.";
    case "too_large":
      return "Su mensaje es demasiado largo. Hágalo más corto e intente de nuevo.";
    default:
      return "No se envió. Revise cada respuesta e intente de nuevo.";
  }
}

function answerFailure(code: FailureCode): string {
  if (code === "network") return NO_CONNECTION;
  if (code === "wrong_state" || code === "not_found") return "Esta pregunta está cerrada.";
  return "No se envió. Intente de nuevo en unos minutos.";
}

export const ASK_ES: AskWords = {
  lang: "es",
  title: (orgName) => (orgName === null ? "Pida ayuda" : `Pida ayuda a ${orgName}`),
  needLabel: "¿Qué necesita?",
  needHint: "Use sus propias palabras.",
  needError: "Díganos qué necesita.",
  nameLabel: "Su nombre",
  nameError: "Escriba su nombre.",
  contactLabel: "¿Cómo podemos comunicarnos con usted?",
  contactHint: "Un número de teléfono o un correo electrónico.",
  emailError: "Revise el correo electrónico.",
  phoneError: "Escriba un número de teléfono de 10 dígitos o un correo electrónico.",
  zipLabel: "Código postal (ZIP)",
  zipError: "Escriba un código postal de 5 números.",
  addressLabel: "Su dirección",
  addressHint:
    "Solo la persona voluntaria que acepta el trabajo ve su dirección. Déjela vacía si nadie tiene que ir a su casa.",
  safeLabel: "¿Es seguro que le enviemos mensajes?",
  safeHint: "Si elige No, no le enviamos mensajes. Una persona decide cómo ayudarle.",
  yes: "Sí",
  no: "No",
  safeError: "Elija Sí o No.",
  send: "Enviar solicitud",
  sending: "Enviando. Espere el recibo.",
  failure: askFailure,
  receiptTitle: "Tenemos su solicitud",
  receiptReads: (orgName) =>
    orgName === null ? "Una persona lee cada solicitud." : `Una persona de ${orgName} lee cada solicitud.`,
  receiptKeep: "Guarde este enlace. Muestra cada paso de su solicitud.",
  danger: "¿Está en peligro ahora?",
  call: "Llame al 911.",
};

export const TRACK_ES: TrackWords = {
  lang: "es",
  title: "Su solicitud",
  noCode: "Su código llega después de que una persona lea su solicitud.",
  stepsLabel: "Pasos de su solicitud",
  step: spanishStep,
  day: spanishDayTime,
  deletedOn: (date) => `Este registro se borra el ${date}.`,
  date: spanishLongDate,
  messagesTitle: "Mensajes para usted",
  consentTitle: "¿Podemos compartir sus datos?",
  consentText: (partnerName, needLabel) =>
    `${partnerName} puede ayudar con ${needLabel}. ¿Podemos darles su nombre, su código postal y lo que necesita?`,
  shareYes: "Sí, compartir",
  shareNo: "No, no compartir",
  checkbackTitle: "¿Le ayudaron?",
  checkbackText: (needLabel) => `Su solicitud: ${needLabel}.`,
  helpedYes: "Sí",
  helpedPartly: "En parte",
  helpedNo: "No",
  sent: "Enviado. Gracias.",
  sending: "Enviando",
  answerFailure,
  danger: "¿Está en peligro ahora?",
  call: "Llame al 911.",
};
