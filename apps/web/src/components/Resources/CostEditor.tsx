import { useState } from "react";
import { Button, Input, Label, NumberField } from "react-aria-components";
import { CENTS_PER_JOB_MAX, type CostBasis, type CostEntry, type CostSet } from "@vision/contracts";
import { classNames } from "../classNames.js";
import { ShapeMark, StateChip } from "../StateChip/StateChip.js";
import { centsText, COST_CHIPS } from "./words.js";
import styles from "./Resources.module.css";

const cx = classNames(styles);

export type NeedLabel = { need: string; label: string };

const BASES: readonly CostBasis[] = ["estimate", "receipts"];
const BASIS_WORDS: Record<CostBasis, string> = { estimate: "Estimate", receipts: "From receipts" };
const MONEY = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

type BasisProps = { label: string; basis: CostBasis; busy: boolean; onPick: (basis: CostBasis) => void };

function BasisButtons({ label, basis, busy, onPick }: BasisProps) {
  return (
    <div className={cx("choices")} role="group" aria-label={`Basis for ${label}`}>
      {BASES.map((option) => {
        const chosen = option === basis;
        return (
          <Button
            key={option}
            aria-label={`${BASIS_WORDS[option]} for ${label}`}
            aria-pressed={chosen}
            className={cx("choice", chosen ? "chosen" : "")}
            isDisabled={busy}
            onPress={() => {
              onPick(option);
            }}
          >
            {chosen ? <ShapeMark mark="filled_square" /> : null}
            {BASIS_WORDS[option]}
          </Button>
        );
      })}
    </div>
  );
}

function SavedCost({ entry }: { entry: CostEntry | null }) {
  if (entry === null) return <span className={cx("muted")}>Unit cost not yet measured</span>;
  return (
    <span className={cx("saved")}>
      <StateChip state={COST_CHIPS[entry.basis]} />
      <span className={cx("num")}>{`${centsText(entry.centsPerJob)} a job`}</span>
    </span>
  );
}

type InputProps = { label: string; dollars: number; busy: boolean; onDollars: (dollars: number) => void };

function CostInput({ label, dollars, busy, onDollars }: InputProps) {
  return (
    <NumberField
      value={dollars}
      onChange={onDollars}
      minValue={0}
      maxValue={CENTS_PER_JOB_MAX / 100}
      step={0.01}
      formatOptions={MONEY}
      isDisabled={busy}
    >
      <Label className={cx("hidden")}>{`Dollars for each job, ${label}`}</Label>
      <Input className={cx("money")} />
    </NumberField>
  );
}

type RowProps = { need: NeedLabel; entry: CostEntry | null; busy: boolean; onSave: (set: CostSet) => void };

function CostRow({ need, entry, busy, onSave }: RowProps) {
  const [dollars, setDollars] = useState(entry === null ? Number.NaN : entry.centsPerJob / 100);
  const [basis, setBasis] = useState<CostBasis>(entry?.basis ?? "estimate");
  const save = (centsPerJob: number | null) => {
    onSave({ need: need.need, centsPerJob, basis });
  };
  return (
    <tr className={cx("row")}>
      <th scope="row" className={cx("cell", "rowHead")}>
        {need.label}
      </th>
      <td className={cx("cell")}>
        <CostInput label={need.label} dollars={dollars} busy={busy} onDollars={setDollars} />
      </td>
      <td className={cx("cell")}>
        <BasisButtons label={need.label} basis={basis} busy={busy} onPick={setBasis} />
      </td>
      <td className={cx("cell")}>
        <SavedCost entry={entry} />
      </td>
      <td className={cx("cell")}>
        <CostActions
          label={need.label}
          canSave={Number.isFinite(dollars)}
          canClear={entry !== null}
          busy={busy}
          onSave={() => {
            save(Math.round(dollars * 100));
          }}
          onClear={() => {
            save(null);
          }}
        />
      </td>
    </tr>
  );
}

type ActionsProps = {
  label: string;
  canSave: boolean;
  canClear: boolean;
  busy: boolean;
  onSave: () => void;
  onClear: () => void;
};

function CostActions({ label, canSave, canClear, busy, onSave, onClear }: ActionsProps) {
  return (
    <div className={cx("actions")}>
      <Button
        className={cx("secondary")}
        aria-label={`Save the unit cost for ${label}`}
        isDisabled={busy || !canSave}
        onPress={onSave}
      >
        Save
      </Button>
      <Button
        className={cx("ghost")}
        aria-label={`Clear the unit cost for ${label}`}
        isDisabled={busy || !canClear}
        onPress={onClear}
      >
        Clear
      </Button>
    </div>
  );
}

export type CostEditorProps = {
  needs: readonly NeedLabel[];
  costs: readonly CostEntry[];
  busy: boolean;
  onSave: (set: CostSet) => void;
};

const COST_HEADS = ["Need", "Dollars for each job", "Basis", "Saved", "Actions"];

export function CostEditor({ needs, costs, busy, onSave }: CostEditorProps) {
  const byNeed = new Map(costs.map((c) => [c.need, c]));
  return (
    <div className={cx("scroll")}>
      <table className={cx("table")} aria-label="Unit costs">
        <thead>
          <tr>
            {COST_HEADS.map((head) => (
              <th key={head} scope="col" className={cx("head")}>
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {needs.map((need) => {
            const entry = byNeed.get(need.need) ?? null;
            const key = `${need.need}-${entry === null ? "none" : String(entry.updatedAt)}`;
            return <CostRow key={key} need={need} entry={entry} busy={busy} onSave={onSave} />;
          })}
        </tbody>
      </table>
    </div>
  );
}
