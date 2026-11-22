import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from "react-aria-components";
import {
  DeskBoardSchema,
  type Command,
  type DeskBoard,
  type DeskCard,
  type LiveMessage,
  type PageView,
} from "@vision/contracts";
import { newCommandId, sendCommand, type Auth } from "../api.js";
import { useView, type OpenSocket, type ViewState } from "../live.js";
import { orgNameOf } from "../orgName.js";
import { readSession } from "../session.js";
import { CardPanel, CardRow, deskKeyIgnored } from "../components/CardPanel/CardPanel.js";
import { JobsBoard, type NeedChoice } from "../components/JobRow/JobRow.js";
import { Offline } from "../components/Offline/Offline.js";
import { PageAlert } from "../components/PageAlert/PageAlert.js";
import { Shell } from "../components/Shell/Shell.js";
import { ShapeMark } from "../components/StateChip/StateChip.js";
import { classNames } from "../components/classNames.js";
import { useDeskCommand, type DeskSend } from "../components/deskCommand.js";
import { DESK_SLOTS, type BoardSlotProps, type DeskHub, type DeskSlots } from "../components/deskSlots.js";
import { unlockSound, type DeskSound } from "../components/deskSound.js";
import styles from "./DeskPage.module.css";

const cx = classNames(styles);

export type { DeskSend } from "../components/deskCommand.js";

const TICK_MS = 1_000;

export function sortCards(cards: DeskCard[]): DeskCard[] {
  const rank = (card: DeskCard) => (card.sorted?.urgency === "high" ? 0 : 1);
  return [...cards].sort((a, b) => rank(a) - rank(b) || a.receivedAt - b.receivedAt);
}

function useHubNow(hubNow: number): number {
  const [tick, setTick] = useState({ from: hubNow, elapsed: 0 });
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setTick({ from: hubNow, elapsed: Date.now() - start });
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [hubNow]);
  return tick.from === hubNow ? hubNow + tick.elapsed : hubNow;
}

function useMoveKeys(
  order: DeskCard[],
  open: string | null,
  onOpen: (card: string) => void,
  paused: boolean,
) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (paused || deskKeyIgnored(event)) return;
      const key = event.key.toLowerCase();
      if (key !== "j" && key !== "k") return;
      const at = order.findIndex((card) => card.card === open);
      const next = order[key === "j" ? Math.min(at + 1, order.length - 1) : Math.max(at - 1, 0)];
      if (next !== undefined) onOpen(next.card);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  });
}

type SlotContext = { board: DeskBoard; send: DeskSend; hub: DeskHub | null; slots: DeskSlots };

function BoardSlots({ slots, props }: { slots: DeskSlots["tools"]; props: BoardSlotProps }) {
  return (
    <>
      {slots.map((Slot, index) => (
        <Slot key={index} {...props} />
      ))}
    </>
  );
}

type LaneProps = {
  title: string;
  cards: DeskCard[];
  emergency: boolean;
  note?: string;
  open: string | null;
  now: number;
  onOpen: (card: string) => void;
  slot: SlotContext;
};

function Lane({ title, cards, emergency, note, open, now, onOpen, slot }: LaneProps) {
  const { board, send, hub, slots } = slot;
  return (
    <section className={cx("lane", emergency ? "emergencyLane" : "triageLane")} aria-label={`${title} lane`}>
      <h2 className={cx(emergency ? "laneHeadCrit" : "laneHead")}>
        {emergency ? <ShapeMark mark="triangle" /> : null}
        <span>{title}</span>
        <span className={cx("count")}>{cards.length}</span>
      </h2>
      {note === undefined ? null : <p className={cx("laneNote")}>{note}</p>}
      {title === "Triage" ? <BoardSlots slots={slots.triage} props={{ board, send, hub }} /> : null}
      {cards.length === 0 ? (
        <p className={cx("empty")}>{emergency ? "No emergencies" : "No cards to read"}</p>
      ) : (
        <ul className={cx("rows")}>
          {cards.map((card) => (
            <CardRow
              key={card.card}
              card={card}
              emergency={emergency}
              selected={card.card === open}
              now={now}
              onOpen={() => {
                onOpen(card.card);
              }}
              send={send}
              hub={hub}
              slots={slots}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

const KEYS: [string, string][] = [
  ["J / K", "move"],
  ["Enter", "open"],
  ["H / L", "urgency"],
  ["C", "confirm"],
  ["Esc", "close"],
];

function KeyStrip() {
  return (
    <p className={cx("keys")}>
      {KEYS.map(([key, word]) => (
        <span key={key} className={cx("key")}>
          <kbd>{key}</kbd> {word}
        </span>
      ))}
    </p>
  );
}

type SoundProps = { sound: DeskSound | null; onSound: (sound: DeskSound | null) => void };

function SoundControl({ sound, onSound }: SoundProps) {
  const [missing, setMissing] = useState(false);
  if (missing) return <span className={cx("muted")}>No sound in this browser</span>;
  if (sound === null) {
    return (
      <Button
        className={cx("secondary")}
        onPress={() => {
          const unlocked = unlockSound();
          setMissing(unlocked === null);
          onSound(unlocked);
        }}
      >
        Sound off
      </Button>
    );
  }
  return (
    <Button className={cx("ghost")} onPress={sound.playPage}>
      Sound on. Test sound
    </Button>
  );
}

type ShiftProps = SoundProps & { send: DeskSend };

function ShiftDialog({ sound, onSound, send }: ShiftProps) {
  const command = useDeskCommand(send);
  const take = async (close: () => void) => {
    onSound(sound ?? unlockSound());
    if (await command.run({ id: newCommandId(), type: "shift.take" })) close();
  };
  return (
    <ModalOverlay className={cx("overlay")} isDismissable>
      <Modal className={cx("modal")}>
        <Dialog className={cx("dialog")}>
          {({ close }) => (
            <>
              <Heading slot="title" className={cx("title")}>
                Take the shift
              </Heading>
              <p>You hold every new card and every page until the next person takes the shift.</p>
              <p className={cx("muted")}>Confirm also turns the page sound on.</p>
              <div className={cx("actions")}>
                <Button className={cx("primary")} isDisabled={command.busy} onPress={() => void take(close)}>
                  Confirm
                </Button>
                <Button className={cx("ghost")} onPress={close}>
                  Cancel
                </Button>
              </div>
              {command.state.kind === "failed" ? (
                <p role="alert" className={cx("error")}>
                  {command.state.message}
                </p>
              ) : null}
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

type ToolsProps = ShiftProps & { slot: SlotContext };

function DeskTools({ slot, sound, onSound, send }: ToolsProps) {
  const { onShift, quietCount } = slot.board;
  return (
    <div className={cx("tools")}>
      <span className={cx("label")}>Shift</span>
      <span className={cx("strong")}>{onShift === null ? "No one on shift" : onShift.name}</span>
      <DialogTrigger>
        <Button className={cx("secondary")}>Take shift</Button>
        <ShiftDialog sound={sound} onSound={onSound} send={send} />
      </DialogTrigger>
      <SoundControl sound={sound} onSound={onSound} />
      <BoardSlots slots={slot.slots.tools} props={{ board: slot.board, send, hub: slot.hub }} />
      <span className={cx("spacer")} />
      {quietCount > 0 ? <span className={cx("muted")}>{`${String(quietCount)} quiet cards`}</span> : null}
    </div>
  );
}

export type DeskViewProps = {
  board: DeskBoard;
  send: DeskSend;
  stale?: number | null;
  hub?: DeskHub | null;
  slots?: DeskSlots;
};

function useOpenPage(board: DeskBoard) {
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const waiting = board.pages.filter((page) => !answered.has(page.page));
  const onAnswered = useCallback((page: string) => {
    setAnswered((previous) => new Set([...previous, page]));
  }, []);
  return { page: waiting[0] ?? null, more: Math.max(waiting.length - 1, 0), onAnswered };
}

function needChoices(board: DeskBoard): NeedChoice[] {
  if (board.needOptions !== undefined) return board.needOptions;
  const seen = new Map<string, NeedChoice>();
  for (const option of [...board.emergency, ...board.triage].flatMap((card) => card.needOptions))
    seen.set(option.need, option);
  return [...seen.values()];
}

const QUIET_NOTE = "Only the lead sees these. Vision sends nothing to the person.";

type Lanes = { emergency: DeskCard[]; triage: DeskCard[]; quiet: DeskCard[] };

function deskLanes(board: DeskBoard): Lanes {
  return {
    emergency: sortCards(board.emergency),
    triage: sortCards(board.triage.filter((card) => !card.quiet)),
    quiet: sortCards(board.triage.filter((card) => card.quiet)),
  };
}

type GridProps = {
  board: DeskBoard;
  lanes: Lanes;
  card: DeskCard | null;
  now: number;
  view: { send: DeskSend; stale: number | null };
  onOpen: (card: string | null) => void;
  slot: SlotContext;
};

function LaneColumn({
  lanes,
  open,
  now,
  onOpen,
  slot,
}: Pick<GridProps, "lanes" | "now" | "onOpen" | "slot"> & { open: string | null }) {
  const lane = { open, now, onOpen, slot };
  return (
    <div className={cx("lanes")}>
      <Lane title="Emergency" cards={lanes.emergency} emergency {...lane} />
      <Lane title="Triage" cards={lanes.triage} emergency={false} {...lane} />
      {lanes.quiet.length === 0 ? null : (
        <Lane title="Quiet" cards={lanes.quiet} emergency={false} note={QUIET_NOTE} {...lane} />
      )}
    </div>
  );
}

function DeskGrid({ board, lanes, card, now, view, onOpen, slot }: GridProps) {
  return (
    <div className={cx("grid", card === null ? "" : "withDrawer")}>
      <LaneColumn lanes={lanes} open={card?.card ?? null} now={now} onOpen={onOpen} slot={slot} />
      <JobsBoard
        jobs={board.jobs}
        now={now}
        stale={view.stale}
        volunteers={board.volunteers}
        send={view.send}
        needOptions={needChoices(board)}
      />
      {card === null ? null : (
        <div className={cx("drawer")}>
          <CardPanel
            key={card.card}
            card={card}
            emergency={lanes.emergency.some((item) => item.card === card.card)}
            now={now}
            deskName={board.onShift?.name ?? null}
            send={view.send}
            onClose={() => {
              onOpen(null);
            }}
            hub={slot.hub}
            slots={slot.slots}
          />
        </div>
      )}
    </div>
  );
}

export function DeskView({ board, send, stale = null, hub = null, slots = DESK_SLOTS }: DeskViewProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [sound, setSound] = useState<DeskSound | null>(null);
  const now = useHubNow(board.clock.now);
  const lanes = deskLanes(board);
  const order = [...lanes.emergency, ...lanes.triage, ...lanes.quiet];
  const card = order.find((item) => item.card === open) ?? null;
  const paging = useOpenPage(board);
  useMoveKeys(order, open, setOpen, paging.page !== null);
  const paged = paging.page === null ? null : (order.find((item) => item.card === paging.page?.card) ?? null);
  const slot = { board, send, hub, slots };
  return (
    <div className={cx("desk")}>
      {paging.page === null ? null : (
        <PageAlert {...paging} page={paging.page} card={paged} now={now} sound={sound} send={send} />
      )}
      <div className={cx("body")} inert={paging.page !== null}>
        <DeskTools slot={slot} sound={sound} onSound={setSound} send={send} />
        <p className={cx("narrow")}>This desk needs a screen at least 1280 px wide.</p>
        <DeskGrid
          board={board}
          lanes={lanes}
          card={card}
          now={now}
          view={{ send, stale }}
          onOpen={setOpen}
          slot={slot}
        />
        <KeyStrip />
      </div>
    </div>
  );
}

type LivePages = { board: DeskBoard | null; pages: PageView[] };

export function withLivePages(board: DeskBoard, extra: LivePages): DeskBoard {
  if (extra.board !== board) return board;
  const known = new Set(board.pages.map((page) => page.page));
  return { ...board, pages: [...board.pages, ...extra.pages.filter((page) => !known.has(page.page))] };
}

function useDeskSend(org: string, auth: Auth, refresh: () => void): DeskSend {
  return useCallback<DeskSend>(
    async (command: Command) => {
      const outcome = await sendCommand(org, auth, command);
      if (outcome.ok) refresh();
      return outcome;
    },
    [org, auth, refresh],
  );
}

type DeskLoadedProps = { org: string; token: string; openSocket: OpenSocket | undefined };

function DeskLoaded({ org, token, openSocket }: DeskLoadedProps) {
  const auth = useMemo<Auth>(() => ({ kind: "session", token }), [token]);
  const [extra, setExtra] = useState<LivePages>({ board: null, pages: [] });
  const shown = useRef<DeskBoard | null>(null);
  const onMessage = (message: LiveMessage) => {
    if (message.t !== "page") return;
    const current = shown.current;
    setExtra((previous) => ({
      board: current,
      pages: previous.board === current ? [...previous.pages, message.page] : [message.page],
    }));
  };
  const { view, live, refresh } = useView(org, auth, "desk", DeskBoardSchema, {
    onMessage,
    ...(openSocket === undefined ? {} : { openSocket }),
  });
  const board = view.state === "ready" ? view.view : null;
  useEffect(() => {
    shown.current = board;
  });
  const send = useDeskSend(org, auth, refresh);
  const head = { live, clock: board?.clock ?? null, orgName: orgNameOf(board, org) };
  return (
    <Shell theme="graphite" section="Desk" {...head}>
      {board === null ? (
        <DeskWaiting org={org} view={view} refresh={refresh} />
      ) : (
        <DeskView
          board={withLivePages(board, extra)}
          send={send}
          stale={live.status === "live" ? null : live.since}
          hub={{ org, auth }}
        />
      )}
    </Shell>
  );
}

type WaitingProps = { org: string; view: ViewState<DeskBoard>; refresh: () => void };

function DeskWaiting({ org, view, refresh }: WaitingProps) {
  if (view.state === "loading") {
    return (
      <p className={cx("notice")} role="status">
        Loading
      </p>
    );
  }
  if (view.state === "failed" && view.code === "network")
    return <Offline theme="graphite" onRetry={refresh} />;
  return <JoinFirst org={org} />;
}

function JoinFirst({ org }: { org: string }) {
  return (
    <section className={cx("notice")}>
      <h1 className={cx("title")}>Join the desk first</h1>
      <p>This browser has no desk session, or the session ended.</p>
      <a className={cx("link")} href={`/${org}/join`}>
        Type a join code
      </a>
    </section>
  );
}

export type DeskPageProps = { org: string; openSocket?: OpenSocket };

export function DeskPage({ org, openSocket }: DeskPageProps) {
  const [token] = useState(() => readSession(org));
  if (token === null) {
    return (
      <Shell theme="graphite" section="Desk" live={null} clock={null} orgName={null}>
        <JoinFirst org={org} />
      </Shell>
    );
  }
  return <DeskLoaded org={org} token={token} openSocket={openSocket} />;
}
