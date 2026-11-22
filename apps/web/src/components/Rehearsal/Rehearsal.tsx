import { useState } from "react";
import { Button, Input, Label, NumberField } from "react-aria-components";
import type { Statement } from "@vision/contracts";
import type { RehearsalResult } from "@vision/core";
import { classNames } from "../classNames.js";
import styles from "./Rehearsal.module.css";
import { runInWorker, type RunRehearsal } from "./runInWorker.js";

const cx = classNames(styles);

type RunState =
  | { kind: "idle" }
  | { kind: "running"; seed: number }
  | { kind: "done"; result: RehearsalResult; seed: number; ms: number }
  | { kind: "failed"; detail: string };

export type RehearsalProps = { run?: RunRehearsal; now?: () => number };

const DEFAULT_SEED = 7;

function Mark({ ok }: { ok: boolean }) {
  return (
    <svg className={cx("mark")} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {ok ? <path d="M3 8.5 6.5 12 13 4.5" /> : <path d="M8 2 15 14H1Z" />}
    </svg>
  );
}

function BalanceLine({ s }: { s: Statement }) {
  const out = s.helped + s.unmet + s.unreached + s.withdrawn + s.stillOpen;
  const gap = Math.abs(s.openAtStart + s.new - out);
  return (
    <div className={cx("balance")}>
      <code>
        {`Open at start ${String(s.openAtStart)} + New ${String(s.new)} = Helped ${String(s.helped)} + Unmet ${String(s.unmet)} + Unreached ${String(s.unreached)} + Withdrawn ${String(s.withdrawn)} + Still open ${String(s.stillOpen)}`}
      </code>
      {s.balanced ? (
        <span className={cx("ok")}>
          <Mark ok />
          BALANCES
        </span>
      ) : (
        <span className={cx("crit")}>
          <Mark ok={false} />
          {`DOES NOT BALANCE by ${String(gap)}`}
        </span>
      )}
    </div>
  );
}

function WeakPoints({ weak }: { weak: RehearsalResult["weak"] }) {
  return (
    <dl className={cx("weak")}>
      <dt>Needs that reached the unmet shelf</dt>
      <dd>{weak.unmetNeeds.length > 0 ? weak.unmetNeeds.join(", ") : "None"}</dd>
      <dt>Waves that reached the desk</dt>
      <dd className="num">{weak.wavesToDesk}</dd>
      <dt>Late promises</dt>
      <dd className="num">{weak.latePromises}</dd>
    </dl>
  );
}

function Result({ result, seed, ms }: { result: RehearsalResult; seed: number; ms: number }) {
  return (
    <div className={cx("result")}>
      <p className={cx("muted")}>
        {`Rehearsal of ${String(result.requests)} requests, seed ${String(seed)}, ran in ${(ms / 1000).toFixed(1)} s. Invented people. Not the real ledger.`}
      </p>
      <section aria-label="Statement">
        <h3 className={cx("label")}>Statement</h3>
        <BalanceLine s={result.statement} />
      </section>
      <section aria-label="Weak points">
        <h3 className={cx("label")}>Weak points</h3>
        <WeakPoints weak={result.weak} />
      </section>
      <section aria-label="Source">
        <h3 className={cx("label")}>Source</h3>
        <p>{result.source}</p>
      </section>
      <section aria-label="Assumptions">
        <h3 className={cx("label")}>Assumptions</h3>
        <ul className={cx("assumptions")}>
          {result.assumptions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SeedControls({
  seed,
  onSeed,
  running,
  onRun,
}: {
  seed: number;
  onSeed: (seed: number) => void;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <div className={cx("controls")}>
      <NumberField
        className={cx("field")}
        value={seed}
        onChange={(value) => {
          if (Number.isInteger(value) && value >= 0) onSeed(value);
        }}
        minValue={0}
        step={1}
        isDisabled={running}
      >
        <Label className={cx("label")}>Seed</Label>
        <Input className={cx("input")} />
      </NumberField>
      <Button className={cx("primary")} onPress={onRun} isDisabled={running}>
        Run rehearsal
      </Button>
    </div>
  );
}

export function Rehearsal({ run = runInWorker, now = () => performance.now() }: RehearsalProps) {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const start = async () => {
    const at = now();
    setState({ kind: "running", seed });
    try {
      const result = await run(seed);
      setState({ kind: "done", result, seed, ms: now() - at });
    } catch (error) {
      setState({ kind: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
  };
  const running = state.kind === "running";
  return (
    <section className={cx("panel")} aria-labelledby="rehearsal-title">
      <h2 id="rehearsal-title" className={cx("title")}>
        Rehearsal day
      </h2>
      <SeedControls seed={seed} onSeed={setSeed} running={running} onRun={() => void start()} />
      {running && <p role="status">{`Running seed ${String(state.seed)}`}</p>}
      {state.kind === "failed" && (
        <p role="alert" className={cx("crit")}>
          {`Not run. ${state.detail}. Try again.`}
        </p>
      )}
      {state.kind === "done" && <Result result={state.result} seed={state.seed} ms={state.ms} />}
    </section>
  );
}
