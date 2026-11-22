import { useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { Command, DeskJob, DeskVolunteer, JobFlag, JobStatus, Outcome } from "@vision/contracts";
import { newCommandId } from "../../api.js";
import { CLOCK_LIMITS, ClockText, countdown } from "../ClockText/ClockText.js";
import { MemberPicker } from "../MemberPicker/MemberPicker.js";
import { OutcomePicker } from "../OutcomePicker/OutcomePicker.js";
import { JOB_STATES, ShapeMark, StateChip } from "../StateChip/StateChip.js";
import { classNames } from "../classNames.js";
import { useDeskCommand, type DeskSend } from "../deskCommand.js";
import styles from "./JobRow.module.css";
import { PartnerAnswerLine } from "./PartnerAnswerLine.js";
import { PartnerLink } from "./PartnerLink.js";

const cx = classNames(styles);

type TapAction = "accept" | "on_my_way" | "there" | "done";
type Picking =
  | { kind: "offer_to" }
  | { kind: "tap_for"; action: TapAction }
  | { kind: "tap_done"; member: string }
  | { kind: "add_need" }
  | { kind: "withdraw" }
  | null;

export type NeedChoice = { need: string; label: string };

const TAP_NEXT: Partial<Record<JobStatus, TapAction>> = {
  offered: "accept",
  accepted: "on_my_way",
  on_my_way: "there",
  there: "done",
};

const TAP_WORDS: Record<TapAction, string> = {
  accept: "Tap accept for",
  on_my_way: "Tap on my way for",
  there: "Tap there for",
  done: "Tap done for",
};

const FLAG_WORDS: Record<JobFlag, string> = {
  visit_check: "Check on the visit",
  consent_call: "Call for consent",
  checkback_call: "Call the resident back",
};

const RETURN_WORDS: Record<string, string> = {
  no_volunteer: "no volunteer took it",
  claim_expired: "the volunteer did not start in time",
  not_done: "the volunteer could not do it",
  hand_off: "the volunteer handed it back",
  partly: "the person said part of the need is left",
  mismatch: "the person said they were not helped",
};

const PARTNER_STEPS: JobStatus[] = ["consent_asked", "partner_asked", "partner_yes"];
const WAITING = new Set<JobStatus>([...PARTNER_STEPS, "got_it"]);
const NEXT_PATH = new Set<JobStatus>(["planned", "mismatch", "partly", ...PARTNER_STEPS]);
const SEND_AGAIN = new Set<JobStatus>(["partly", "unmet"]);

const WITHDRAW_CHOICES: NeedChoice[] = [
  { need: "cancelled", label: "Cancelled by the person" },
  { need: "duplicate", label: "Duplicate request" },
];

export type JobFilter = "all" | "mine" | "late" | "waiting";

export function isLate(job: DeskJob, now: number): boolean {
  if (job.promiseLate) return true;
  if (job.clock === null) return false;
  return countdown(job.clock.dueAt, now, CLOCK_LIMITS[job.clock.label] ?? null).tone !== "normal";
}

export function jobMatches(job: DeskJob, filter: JobFilter, now: number): boolean {
  if (filter === "mine") return job.holder.kind === "desk";
  if (filter === "late") return isLate(job, now);
  if (filter === "waiting") return WAITING.has(job.status);
  return true;
}

function holderName(job: DeskJob): string {
  if (job.holder.kind === "none" || job.holder.kind === "desk") return job.holder.name ?? "Desk";
  return job.holder.name ?? job.holder.kind;
}

function ReturnLine({ job }: { job: DeskJob }) {
  if (job.mismatch) {
    return (
      <span className={cx("crit")}>
        <ShapeMark mark="triangle" />
        <span>Mismatch: the person said they were not helped</span>
      </span>
    );
  }
  if (job.returnReason === null) return null;
  const words = RETURN_WORDS[job.returnReason] ?? job.returnReason;
  return <span className={cx("note")}>{`Back to desk: ${words}`}</span>;
}

function HolderCell({ job }: { job: DeskJob }) {
  return (
    <td className={cx("cell")}>
      <span className={cx("holder")}>
        <span className={cx("label")}>Held by</span>
        <span className={cx("strong")}>{holderName(job)}</span>
      </span>
      <ReturnLine job={job} />
      <PartnerAnswerLine job={job} />
      {job.flags.map((flag) => (
        <span key={flag} className={cx("flag")}>
          <span className={cx("flagMark")}>?</span> {FLAG_WORDS[flag]}
        </span>
      ))}
      {job.promiseLate ? <span className={cx("late")}>Promise time passed</span> : null}
    </td>
  );
}

function memberOf(job: DeskJob, volunteers: DeskVolunteer[]): string | null {
  if (job.holder.kind !== "volunteer") return null;
  return volunteers.find((volunteer) => volunteer.name === job.holder.name)?.member ?? null;
}

type Tone = "primary" | "secondary" | "danger";
type JobButton = { label: string; tone: Tone; press: () => void };
type ButtonsInput = {
  job: DeskJob;
  canAdd: boolean;
  run: (command: Command) => void;
  onPick: (picking: Picking) => void;
};

const jobCommand = (job: DeskJob) => ({ id: newCommandId(), job: job.job });
const picker = (onPick: (picking: Picking) => void) => (picking: NonNullable<Picking>) => () => {
  onPick(picking);
};

function offerAgainButton(job: DeskJob, press: () => void): JobButton | null {
  if (job.status === "mismatch") return { label: "Send to new volunteer", tone: "danger", press };
  if (SEND_AGAIN.has(job.status) || (job.status === "planned" && job.returnReason !== null))
    return { label: "Offer again", tone: "primary", press };
  return null;
}

function mainButtons({ job, run, onPick }: ButtonsInput): (JobButton | null)[] {
  const tap = TAP_NEXT[job.status];
  const send = (type: "job.approve" | "job.offer_again" | "job.next_rung") => () => {
    run({ ...jobCommand(job), type });
  };
  const pick = picker(onPick);
  const fresh = job.status === "planned" && job.returnReason === null;
  return [
    fresh ? { label: "Approve plan", tone: "primary", press: send("job.approve") } : null,
    offerAgainButton(job, send("job.offer_again")),
    job.status === "offered"
      ? { label: "Send offer", tone: "secondary", press: send("job.offer_again") }
      : null,
    job.status === "planned" || job.status === "offered"
      ? { label: "Offer to one", tone: "secondary", press: pick({ kind: "offer_to" }) }
      : null,
    tap === undefined
      ? null
      : { label: TAP_WORDS[tap], tone: "secondary", press: pick({ kind: "tap_for", action: tap }) },
    NEXT_PATH.has(job.status)
      ? { label: "Next path", tone: "secondary", press: send("job.next_rung") }
      : null,
  ];
}

function callButtons({ job, run }: ButtonsInput): JobButton[] {
  const consent = (answer: "yes" | "no") => () => {
    run({ ...jobCommand(job), type: "consent.answer", answer });
  };
  const checkback = (answer: 1 | 2 | 3) => () => {
    run({ ...jobCommand(job), type: "checkback.answer", answer });
  };
  const safe = () => {
    run({ ...jobCommand(job), type: "job.clear_flag", flag: "visit_check" });
  };
  const byFlag: Record<JobFlag, JobButton[]> = {
    consent_call: [
      { label: "Said yes", tone: "secondary", press: consent("yes") },
      { label: "Said no", tone: "secondary", press: consent("no") },
    ],
    checkback_call: [
      { label: "Helped", tone: "secondary", press: checkback(1) },
      { label: "Partly", tone: "secondary", press: checkback(2) },
      { label: "Not helped", tone: "secondary", press: checkback(3) },
    ],
    visit_check: [{ label: "Volunteer is safe", tone: "secondary", press: safe }],
  };
  return job.flags.flatMap((flag) => byFlag[flag]);
}

function cardButtons({ canAdd, onPick }: ButtonsInput): (JobButton | null)[] {
  const pick = picker(onPick);
  return [
    canAdd ? { label: "Add a need", tone: "secondary", press: pick({ kind: "add_need" }) } : null,
    { label: "Withdraw", tone: "secondary", press: pick({ kind: "withdraw" }) },
  ];
}

function ActionButtons({ busy, ...input }: ButtonsInput & { busy: boolean }) {
  const buttons = [...mainButtons(input), ...callButtons(input), ...cardButtons(input)];
  return (
    <span className={cx("actions")}>
      {buttons
        .filter((button) => button !== null)
        .map((button) => (
          <Button key={button.label} className={cx(button.tone)} isDisabled={busy} onPress={button.press}>
            {button.label}
          </Button>
        ))}
    </span>
  );
}

type ChoiceDialogProps = {
  title: string;
  note: string;
  choices: NeedChoice[];
  onPick: (value: string) => void;
  onClose: () => void;
};

function ChoiceDialog({ title, note, choices, onPick, onClose }: ChoiceDialogProps) {
  return (
    <ModalOverlay
      className={cx("overlay")}
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal className={cx("modal")}>
        <Dialog className={cx("dialog")}>
          <Heading slot="title" className={cx("title")}>
            {title}
          </Heading>
          <p className={cx("muted")}>{note}</p>
          <span className={cx("choices")}>
            {choices.map((choice) => (
              <Button
                key={choice.need}
                className={cx("choice")}
                onPress={() => {
                  onPick(choice.need);
                }}
              >
                {choice.label}
              </Button>
            ))}
          </span>
          <Button className={cx("cancel")} onPress={onClose}>
            Cancel
          </Button>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

type ActionsProps = {
  job: DeskJob;
  send: DeskSend;
  volunteers: DeskVolunteer[];
  addable: NeedChoice[];
};

type ValuePicking = Exclude<NonNullable<Picking>, { kind: "tap_done" }>;

function pickCommand(job: DeskJob, picking: ValuePicking, value: string): Command {
  switch (picking.kind) {
    case "offer_to":
      return { ...jobCommand(job), type: "job.offer_to", member: value };
    case "tap_for":
      return { ...jobCommand(job), type: "job.tap_for", member: value, action: picking.action };
    case "add_need":
      return { id: newCommandId(), type: "card.add_job", card: job.card, need: value };
    case "withdraw":
      return {
        ...jobCommand(job),
        type: "job.withdraw",
        reason: value === "duplicate" ? "duplicate" : "cancelled",
      };
  }
}

type PickerProps = {
  job: DeskJob;
  picking: NonNullable<Picking>;
  volunteers: DeskVolunteer[];
  addable: NeedChoice[];
  onPick: (value: string) => void;
  onDone: (outcome: Outcome) => void;
  onClose: () => void;
};

function Picker({ job, picking, volunteers, addable, onPick, onDone, onClose }: PickerProps) {
  if (picking.kind === "tap_done") {
    return <OutcomePicker note={`Tap done for ${job.routeCode}`} onSend={onDone} onClose={onClose} />;
  }
  if (picking.kind === "add_need") {
    const note = "Vision plans a second job on the same request.";
    const title = `Add a need to ${job.routeCode}`;
    return <ChoiceDialog title={title} note={note} choices={addable} onPick={onPick} onClose={onClose} />;
  }
  if (picking.kind === "withdraw") {
    const note = "This closes the job. The statement counts it as withdrawn.";
    const title = `Withdraw ${job.routeCode}`;
    return (
      <ChoiceDialog title={title} note={note} choices={WITHDRAW_CHOICES} onPick={onPick} onClose={onClose} />
    );
  }
  const title =
    picking.kind === "offer_to"
      ? `Offer ${job.routeCode} to one volunteer`
      : `${TAP_WORDS[picking.action]} ${job.routeCode}`;
  const preselect = picking.kind === "tap_for" ? memberOf(job, volunteers) : null;
  return <MemberPicker {...{ title, volunteers, preselect, onPick, onClose }} />;
}

function usePicking(job: DeskJob, run: (command: Command) => void) {
  const [picking, setPicking] = useState<Picking>(null);
  const pick = (value: string) => {
    if (picking === null || picking.kind === "tap_done") return;
    if (picking.kind === "tap_for" && picking.action === "done") {
      setPicking({ kind: "tap_done", member: value });
      return;
    }
    setPicking(null);
    run(pickCommand(job, picking, value));
  };
  const done = (outcome: Outcome) => {
    if (picking?.kind !== "tap_done") return;
    setPicking(null);
    run({ ...jobCommand(job), type: "job.tap_for", member: picking.member, action: "done", outcome });
  };
  return { picking, setPicking, pick, done };
}

function Actions({ job, send, volunteers, addable }: ActionsProps) {
  const command = useDeskCommand(send);
  const run = (body: Command) => void command.run(body);
  const { picking, setPicking, pick, done } = usePicking(job, run);
  return (
    <td className={cx("cell")}>
      <ActionButtons
        job={job}
        canAdd={addable.length > 0}
        busy={command.busy}
        run={run}
        onPick={setPicking}
      />
      {job.partnerLink === null ? null : <PartnerLink link={job.partnerLink} />}
      {command.busy ? <span className={cx("note")}>Waiting for hub receipt</span> : null}
      {command.state.kind === "failed" ? (
        <span role="alert" className={cx("error")}>
          {command.state.message}
        </span>
      ) : null}
      {picking === null ? null : (
        <Picker
          job={job}
          picking={picking}
          volunteers={volunteers}
          addable={addable}
          onPick={pick}
          onDone={done}
          onClose={() => {
            setPicking(null);
          }}
        />
      )}
    </td>
  );
}

export type JobRowProps = {
  job: DeskJob;
  now: number;
  stale: number | null;
  volunteers: DeskVolunteer[];
  send: DeskSend;
  addable: NeedChoice[];
};

export function JobRow({ job, now, stale, volunteers, send, addable }: JobRowProps) {
  return (
    <tr className={cx("row", job.mismatch ? "mismatch" : "")}>
      <td className={cx("cell")}>
        <code className={cx("code")}>{job.routeCode}</code>
      </td>
      <td className={cx("cell")}>{job.needLabel}</td>
      <td className={cx("cell")}>
        <StateChip state={JOB_STATES[job.status]} />
      </td>
      <HolderCell job={job} />
      <td className={cx("cell", "clockCell")}>
        {job.clock === null ? (
          <span className={cx("muted")}>No clock</span>
        ) : (
          <ClockText label={job.clock.label} dueAt={job.clock.dueAt} now={now} syncedAt={stale} />
        )}
      </td>
      <Actions job={job} send={send} volunteers={volunteers} addable={addable} />
    </tr>
  );
}

const FILTERS: { filter: JobFilter; label: string }[] = [
  { filter: "all", label: "All" },
  { filter: "mine", label: "Mine" },
  { filter: "late", label: "Late" },
  { filter: "waiting", label: "Waiting" },
];

function FilterTabs({ filter, onFilter }: { filter: JobFilter; onFilter: (filter: JobFilter) => void }) {
  return (
    <div className={cx("tabs")} role="group" aria-label="Show jobs">
      {FILTERS.map((item) => (
        <button
          key={item.filter}
          type="button"
          className={cx("tab", filter === item.filter ? "tabOn" : "")}
          aria-pressed={filter === item.filter}
          onClick={() => {
            onFilter(item.filter);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export type JobsBoardProps = Omit<JobRowProps, "job" | "addable"> & {
  jobs: DeskJob[];
  needOptions: NeedChoice[];
};

function addableNeeds(job: DeskJob, jobs: DeskJob[], needOptions: NeedChoice[]): NeedChoice[] {
  const open = new Set(jobs.filter((other) => other.card === job.card).map((other) => other.needLabel));
  return needOptions.filter((option) => !open.has(option.label));
}

export function JobsBoard({ jobs, now, stale, volunteers, send, needOptions }: JobsBoardProps) {
  const [filter, setFilter] = useState<JobFilter>("all");
  const shown = jobs.filter((job) => jobMatches(job, filter, now));
  return (
    <section className={cx("board")} aria-label="Jobs board">
      <FilterTabs filter={filter} onFilter={setFilter} />
      {shown.length === 0 ? (
        <p className={cx("empty")}>{filter === "all" ? "No jobs" : "No jobs in this list"}</p>
      ) : (
        <table className={cx("table")}>
          <thead>
            <tr>
              {["Code", "Need", "State", "Holder", "Clock", "Next step"].map((head) => (
                <th key={head} scope="col" className={cx("head")}>
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((job) => (
              <JobRow
                key={job.job}
                job={job}
                now={now}
                stale={stale}
                volunteers={volunteers}
                send={send}
                addable={addableNeeds(job, jobs, needOptions)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
