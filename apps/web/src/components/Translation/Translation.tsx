import type { DeskCard } from "@vision/contracts";
import { classNames } from "../classNames.js";
import type { CardSlotProps } from "../deskSlots.js";
import styles from "./Translation.module.css";

const cx = classNames(styles);

export const TRANSLATION_LABEL =
  "Machine translation from Spanish. It can miss or change words, so check the original above before you decide.";
export const TRANSLATION_WARNING = "Machine translation can drop details.";
export const TRANSLATION_AI_SOURCE = "The AI urgency comes from the original words.";
export const TRANSLATION_PENDING = "The machine translation is on the way.";
export const TRANSLATION_FAILED =
  "The machine translation did not work. Read the original or ask a Spanish speaker.";

const isSpanish = (card: DeskCard): boolean => card.lang === "es";

const warningFor = (card: DeskCard): string =>
  card.sorted?.source === "ai" ? `${TRANSLATION_WARNING} ${TRANSLATION_AI_SOURCE}` : TRANSLATION_WARNING;

export function LangMark({ card }: CardSlotProps) {
  return isSpanish(card) ? (
    <span className={cx("chip")} title="Spanish">
      ES
    </span>
  ) : null;
}

function Line({ text }: { text: string }) {
  return (
    <p className={cx("line")} role="status">
      {text}
    </p>
  );
}

export function TranslationNote({ card }: CardSlotProps) {
  if (!isSpanish(card)) return null;
  const status = card.ai?.lang;
  const translation = card.translation ?? null;
  if (translation !== null)
    return (
      <section className={cx("translation")} aria-label="Machine translation">
        <p className={cx("label")}>{TRANSLATION_LABEL}</p>
        <p className={cx("text")} lang="en">
          {translation}
        </p>
        <p className={cx("warning")}>{warningFor(card)}</p>
      </section>
    );
  if (status === "pending") return <Line text={TRANSLATION_PENDING} />;
  if (status === "failed" || status === "empty" || status === "ok") return <Line text={TRANSLATION_FAILED} />;
  return null;
}
