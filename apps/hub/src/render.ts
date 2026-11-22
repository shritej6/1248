import type { Effect, Lang, PartnerRecord, TemplateId, Templates } from "@vision/contracts";

export const RESIDENT_LINK_TEXT = "this page";
const TIME_SLOTS: readonly string[] = ["promiseAt", "deadline"];
const ZONE = "America/Chicago";

const chicago = (locale: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, { timeZone: ZONE, ...options });

type MomentFormat = { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat; join: string };
const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
const MOMENT: Record<Lang, MomentFormat> = {
  en: {
    date: chicago("en-US", { month: "short", day: "numeric", year: "numeric" }),
    time: chicago("en-US", TIME),
    join: " ",
  },
  es: {
    date: chicago("es-US", { month: "long", day: "numeric", year: "numeric" }),
    time: chicago("es-US", TIME),
    join: ", ",
  },
};

export const formatMoment = (ms: number, lang: Lang = "en"): string => {
  const format = MOMENT[lang];
  return `${format.date.format(ms)}${format.join}${format.time.format(ms)}`.replace(/\s/g, " ");
};

type MailWords = { subject: string; link: string; page: string };
const MAIL_WORDS: Record<Lang, MailWords> = {
  en: { subject: "About your request", link: "Your tracking page:", page: RESIDENT_LINK_TEXT },
  es: { subject: "Sobre su solicitud", link: "Su página de seguimiento:", page: "esta página" },
};

export const mailWords = (lang: Lang): MailWords => MAIL_WORDS[lang];

export const templateFor = (id: TemplateId, lang: Lang, templates: Templates): Templates[TemplateId] =>
  (lang === "en" ? undefined : templates.es?.[id]) ?? templates[id];

const textLang = (id: TemplateId, lang: Lang, templates: Templates): Lang =>
  lang !== "en" && templates.es?.[id] !== undefined ? lang : "en";

export const renderTemplate = (
  id: TemplateId,
  slots: Record<string, string>,
  templates: Templates,
  lang: Lang = "en",
): string => {
  const template = templateFor(id, lang, templates);
  const missing = template.slots.filter((name) => slots[name] === undefined);
  if (missing.length > 0) throw new Error(`Template ${id} has no value for slot ${missing.join(", ")}`);
  return template.text.replace(/\{([A-Za-z]+)\}/g, (whole, name: string) => slots[name] ?? whole);
};

const shownSlots = (slots: Record<string, string>, lang: Lang): Record<string, string> => {
  const out: Record<string, string> = { trackingLink: mailWords(lang).page, ...slots };
  for (const name of TIME_SLOTS) {
    const value = out[name];
    if (value !== undefined && /^\d+$/.test(value)) out[name] = formatMoment(Number(value), lang);
  }
  return out;
};

export type ResidentMessage = { card: string; job: string | null; text: string; lang: Lang };
export type LangOf = (card: string) => Lang;

const english: LangOf = () => "en";

export const residentMessages = (
  effects: readonly Effect[],
  templates: Templates,
  langOf: LangOf = english,
): ResidentMessage[] =>
  effects.flatMap((effect) => {
    if (effect.kind !== "message" || effect.to !== "resident") return [];
    const lang = textLang(effect.template, langOf(effect.card), templates);
    const text = renderTemplate(effect.template, shownSlots(effect.slots, lang), templates, lang);
    return [{ card: effect.card, job: effect.job, text, lang }];
  });

export const namePartners = (effects: readonly Effect[], partners: readonly PartnerRecord[]): Effect[] =>
  effects.map((e) => {
    const name = partners.find((p) => e.kind === "message" && p.id === e.partner)?.name;
    return e.kind === "message" && name !== undefined
      ? { ...e, slots: { partnerName: name, ...e.slots } }
      : e;
  });
