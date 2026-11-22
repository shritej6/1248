import { useEffect, useState, type ComponentType } from "react";
import { Button } from "react-aria-components";
import { DivisionSchema, type DeskCard, type Division, type Flag, type Urgency } from "@vision/contracts";
import { newCommandId } from "../../api.js";
import { ClockText } from "../ClockText/ClockText.js";
import { CARD_NEW, CARD_SORTED, ShapeMark, StateChip, type ChipState } from "../StateChip/StateChip.js";
import { classNames } from "../classNames.js";
import { useDeskCommand, type DeskSend, type SendState } from "../deskCommand.js";
import { DESK_SLOTS, type CardSlotProps, type DeskHub, type DeskSlots } from "../deskSlots.js";
import styles from "./CardPanel.module.css";

const cx = classNames(styles);

export const DESK_CONFIRM_MS = 15 * 60_000;
const PREVIEW = 60;

export type Segment = { text: string; marked: boolean };

function firstQuote(lower: string, quotes: string[], from: number): { at: number; length: number } | null {
  let best: { at: number; length: number } | null = null;
  for (const quote of quotes) {
    const at = quote === "" ? -1 : lower.indexOf(quote.toLowerCase(), from);
    if (at >= 0 && (best === null || at < best.at)) best = { at, length: quote.length };
  }
  return best;
}

export function markQuotes(message: string, quotes: string[]): Segment[] {
  const lower = message.toLowerCase();
  const segments: Segment[] = [];
  let from = 0;
  for (let hit = firstQuote(lower, quotes, 0); hit !== null; hit = firstQuote(lower, quotes, from)) {
    if (hit.at > from) segments.push({ text: message.slice(from, hit.at), marked: false });
    segments.push({ text: message.slice(hit.at, hit.at + hit.length), marked: true });
    from = hit.at + hit.length;
  }
  if (from < message.length) segments.push({ text: message.slice(from), marked: false });
  return segments;
}

export function MarkedMessage({ message, quotes }: { message: string; quotes: string[] }) {
  return (
    <>
      {markQuotes(message, quotes).map((segment, index) =>
        segment.marked ? (
          <mark key={index} className={cx("mark")}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

const FLAG_WORDS: Record<Flag, string> = {
  word_list_hit: "Word list hit",
  passes_disagree: "The two AI passes disagree",
  quote_not_found: "The AI quote is not in the message",
  ai_down: "AI did not answer",
  sorter_off: "Sorter is off. Read it yourself.",
  spot_check: "Spot check",
  voice_transcript: "Voicemail. A person must confirm it.",
};

const DOOR_WORDS: Record<DeskCard["door"], string> = { form: "Form", email: "Email", voice: "Voicemail" };

type SlotList = readonly ComponentType<CardSlotProps>[];

function Slots({ slots, props }: { slots: SlotList; props: CardSlotProps }) {
  return (
    <>
      {slots.map((Slot, index) => (
        <Slot key={index} {...props} />
      ))}
    </>
  );
}

const zipWords = (card: DeskCard) => (card.zip === null ? "no ZIP" : `ZIP ${card.zip}`);

const CARD_EMERGENCY: ChipState = { label: "EMERGENCY", mark: "triangle", tone: "crit" };

const rowState = (card: DeskCard, emergency: boolean) =>
  emergency ? CARD_EMERGENCY : card.sorted === null ? CARD_NEW : CARD_SORTED;

export type CardRowProps = {
  card: DeskCard;
  emergency: boolean;
  selected: boolean;
  now: number;
  onOpen: () => void;
  send: DeskSend;
  hub?: DeskHub | null;
  slots?: DeskSlots;
};

export function CardRow({ card, emergency, selected, now, onOpen, ...more }: CardRowProps) {
  const { send, hub = null, slots = DESK_SLOTS } = more;
  const preview = card.message.length > PREVIEW ? `${card.message.slice(0, PREVIEW)}...` : card.message;
  return (
    <li className={cx("row", emergency ? "rowEmergency" : "", selected ? "selected" : "")}>
      <Button className={cx("rowButton")} onPress={onOpen} aria-current={selected}>
        <span className={cx("rowLine")}>
          <StateChip state={rowState(card, emergency)} />
          <code>{card.zip ?? "-----"}</code>
          <span className={cx("need")}>{card.sorted?.service ?? "Not sorted"}</span>
          {card.flags.length > 0 ? <span className={cx("flagMark")}>?</span> : null}
          {card.quiet ? <span className={cx("tag")}>QUIET</span> : null}
          <Slots slots={slots.rowMarks} props={{ card, send, hub }} />
        </span>
        <span className={cx("rowLine")}>
          <span className={cx("preview")}>{preview}</span>
          <ClockText
            label={null}
            dueAt={card.receivedAt + DESK_CONFIRM_MS}
            now={now}
            limitMs={DESK_CONFIRM_MS}
          />
        </span>
      </Button>
    </li>
  );
}

function AiLabels({ card }: { card: DeskCard }) {
  const sorted = card.sorted;
  const words = card.quotes.map((quote) => `"${quote}"`).join(", ");
  return (
    <section className={cx("section")} aria-label="Sorter labels">
      {sorted === null || sorted.source === "none" ? (
        <p className={cx("muted")}>Not sorted by the AI. Read the words and choose.</p>
      ) : (
        <>
          <p>{`AI: ${sorted.urgency ?? "no urgency"}. Words: ${words === "" ? "none" : words}`}</p>
          <p className={cx("muted")}>
            {`AI service: ${sorted.service ?? "none"}. AI team: ${sorted.division ?? "none"}.`}
          </p>
        </>
      )}
      {card.flags.map((flag) => (
        <p key={flag} className={cx("flag")}>
          <span className={cx("flagMark")}>?</span> {FLAG_WORDS[flag]}
        </p>
      ))}
    </section>
  );
}

type NeedProps = { card: DeskCard; need: string | null; onPick: (need: string) => void };

function NeedChoice({ card, need, onPick }: NeedProps) {
  const [open, setOpen] = useState(need === null);
  const label = card.needOptions.find((option) => option.need === need)?.label ?? null;
  if (card.needOptions.length === 0) {
    return <p className={cx("muted")}>No need in the playbook fits. Call the lead.</p>;
  }
  return (
    <fieldset className={cx("section", "fieldset")}>
      <legend className={cx("fieldLabel")}>Need</legend>
      {open ? (
        <NeedOptions card={card} need={need} onPick={onPick} />
      ) : (
        <span className={cx("needLine")}>
          <span className={cx("strong")}>{label}</span>
          <Button
            className={cx("secondary", "small")}
            onPress={() => {
              setOpen(true);
            }}
          >
            Change
          </Button>
        </span>
      )}
    </fieldset>
  );
}

function NeedOptions({ card, need, onPick }: NeedProps) {
  return (
    <span className={cx("options")}>
      {card.needOptions.map((option) => (
        <label key={option.need} className={cx("option")}>
          <input
            type="radio"
            name={`need-${card.card}`}
            checked={need === option.need}
            onChange={() => {
              onPick(option.need);
            }}
          />
          {option.label}
        </label>
      ))}
    </span>
  );
}

type UrgencyProps = { urgency: Urgency | null; onPick: (urgency: Urgency) => void };

function UrgencyPair({ urgency, onPick }: UrgencyProps) {
  return (
    <div className={cx("section")} role="group" aria-label="Urgency">
      <span className={cx("fieldLabel")}>Urgency</span>
      <span className={cx("pair")}>
        <button
          type="button"
          className={cx("choice", urgency === "high" ? "high" : "")}
          aria-pressed={urgency === "high"}
          onClick={() => {
            onPick("high");
          }}
        >
          {urgency === "high" ? <ShapeMark mark="triangle" /> : null}
          High
        </button>
        <button
          type="button"
          className={cx("choice", urgency === "low" ? "low" : "")}
          aria-pressed={urgency === "low"}
          onClick={() => {
            onPick("low");
          }}
        >
          Low
        </button>
      </span>
    </div>
  );
}

function listedDivision(card: DeskCard): Division | null {
  const parsed = DivisionSchema.safeParse(card.sorted?.division);
  return parsed.success ? parsed.data : null;
}

function confirmReason(need: string | null, urgency: Urgency | null, busy: boolean): string | null {
  if (busy) return "Waiting for hub receipt";
  if (urgency === null) return "Pick urgency first";
  if (need === null) return "Pick a need first";
  return null;
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName));

export function deskKeyIgnored(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return true;
  if (document.querySelector('[role="alertdialog"]') !== null) return true;
  return event.target instanceof Element && event.target.closest('[role="dialog"]') !== null;
}

function useCardKeys(onUrgency: (urgency: Urgency) => void, onConfirm: () => void, onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (deskKeyIgnored(event)) return;
      const key = event.key.toLowerCase();
      if (key === "h") onUrgency("high");
      if (key === "l") onUrgency("low");
      if (key === "c") onConfirm();
      if (key === "escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  });
}

export type CardPanelProps = {
  card: DeskCard;
  emergency: boolean;
  now: number;
  deskName: string | null;
  send: DeskSend;
  onClose: () => void;
  hub?: DeskHub | null;
  slots?: DeskSlots;
};

export function CardPanel(props: CardPanelProps) {
  const { card, emergency, send, onClose, hub = null, slots = DESK_SLOTS } = props;
  const slotProps = { card, send, hub };
  const [need, setNeed] = useState<string | null>(card.suggestedNeed);
  const [urgency, setUrgency] = useState<Urgency | null>(null);
  const command = useDeskCommand(send, onClose);
  const reason = confirmReason(need, urgency, command.busy);
  const confirm = () => {
    if (reason !== null || need === null || urgency === null) return;
    const division = listedDivision(card);
    void command.run({ id: newCommandId(), type: "card.confirm", card: card.card, need, urgency, division });
  };
  const raise = () => void command.run({ id: newCommandId(), type: "card.raise", card: card.card });
  useCardKeys(setUrgency, confirm, onClose);
  return (
    <section className={cx("panel")} aria-label={`Request from ${zipWords(card)}`}>
      <PanelHeader {...props} />
      <Slots slots={slots.aboveMessage} props={slotProps} />
      <section className={cx("quote")} aria-label="Words of the resident">
        <MarkedMessage message={card.message} quotes={card.quotes} />
      </section>
      <Slots slots={slots.belowMessage} props={slotProps} />
      <AiLabels card={card} />
      <Slots slots={slots.afterLabels} props={slotProps} />
      <NeedChoice card={card} need={need} onPick={setNeed} />
      <UrgencyPair urgency={urgency} onPick={setUrgency} />
      <div className={cx("actions")}>
        <Button className={cx("primary")} isDisabled={reason !== null} onPress={confirm}>
          Confirm
        </Button>
        {emergency ? null : (
          <Button className={cx("secondary")} isDisabled={command.busy} onPress={raise}>
            Raise to emergency
          </Button>
        )}
      </div>
      <PanelNotes reason={reason} state={command.state} />
    </section>
  );
}

function PanelNotes({ reason, state }: { reason: string | null; state: SendState }) {
  return (
    <>
      {reason === null ? null : <p className={cx("muted")}>{reason}</p>}
      {state.kind === "failed" ? (
        <p role="alert" className={cx("error")}>
          {state.message}
        </p>
      ) : null}
    </>
  );
}

function PanelHeader({ card, emergency, now, deskName, onClose }: CardPanelProps) {
  return (
    <>
      <header className={cx("header")}>
        <h2 className={cx("title")}>
          Request <code>{card.zip ?? "no ZIP"}</code>
        </h2>
        <StateChip state={card.sorted === null ? CARD_NEW : CARD_SORTED} emergency={emergency} />
        <span className={cx("door")}>{DOOR_WORDS[card.door]}</span>
        <Button className={cx("ghost")} onPress={onClose}>
          Close
        </Button>
      </header>
      <p className={cx("holder")}>
        <span className={cx("fieldLabel")}>Held by</span>
        <span className={cx("strong")}>{deskName === null ? "Desk" : `${deskName} (desk)`}</span>
        <ClockText label="Desk confirm" dueAt={card.receivedAt + DESK_CONFIRM_MS} now={now} />
      </p>
      {card.quiet ? (
        <p className={cx("quietNote")}>
          Quiet card. Vision sends nothing to the person. Contact only by the lead.
        </p>
      ) : null}
    </>
  );
}
