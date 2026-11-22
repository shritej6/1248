import { useId, useState } from "react";
import type { CostEntry, CostSet, Forecast, ForecastMonth, Range, ReadyForecast } from "@vision/contracts";
import { monthLabel } from "@vision/core";
import { classNames } from "../classNames.js";
import { CostEditor, type NeedLabel } from "./CostEditor.js";
import { ChartKey, ForecastChart } from "./ForecastChart.js";
import { countText, dollarsText, METHOD_NOTE } from "./words.js";
import styles from "./Resources.module.css";

const cx = classNames(styles);

const ALL = "all";
const ZERO: Range = { low: 0, likely: 0, high: 0 };

const addRange = (a: Range, b: Range): Range => ({
  low: a.low + b.low,
  likely: a.likely + b.likely,
  high: a.high + b.high,
});

const sumOf = (ranges: readonly Range[]): Range => ranges.reduce(addRange, ZERO);

function sumMonths(month: string, rows: readonly ForecastMonth[]): ForecastMonth {
  const cash = rows.map((r) => r.cashCents).filter((c): c is Range => c !== null);
  return {
    month,
    jobs: sumOf(rows.map((r) => r.jobs)),
    hours: sumOf(rows.map((r) => r.hours)),
    inKindCents: sumOf(rows.map((r) => r.inKindCents)),
    cashCents: cash.length === 0 ? null : sumOf(cash),
  };
}

function rowsFor(forecast: ReadyForecast, need: string): ForecastMonth[] {
  const chosen = forecast.needs.filter((n) => need === ALL || n.need === need);
  return forecast.months.map((month) =>
    sumMonths(
      month,
      chosen.flatMap((n) => n.months.filter((m) => m.month === month)),
    ),
  );
}

const HEADS = [
  "Month",
  "Jobs low",
  "Jobs likely",
  "Jobs high",
  "Volunteer hours, likely",
  "Value of volunteer time, likely",
  "Cash, likely",
];

const cashText = (cash: Range | null): string => (cash === null ? "Not measured" : dollarsText(cash.likely));

function TableRow({ label, row }: { label: string; row: ForecastMonth }) {
  return (
    <tr className={cx("row")}>
      <th scope="row" className={cx("cell", "rowHead")}>
        {label}
      </th>
      <td className={cx("cell", "num")}>{countText(row.jobs.low)}</td>
      <td className={cx("cell", "num", "strongNum")}>{countText(row.jobs.likely)}</td>
      <td className={cx("cell", "num")}>{countText(row.jobs.high)}</td>
      <td className={cx("cell", "num")}>{countText(row.hours.likely)}</td>
      <td className={cx("cell", "num")}>{dollarsText(row.inKindCents.likely)}</td>
      <td className={cx("cell", "num")}>{cashText(row.cashCents)}</td>
    </tr>
  );
}

function ForecastTable({ rows }: { rows: readonly ForecastMonth[] }) {
  return (
    <div className={cx("scroll")}>
      <table className={cx("table")} aria-label="Forecast by month">
        <thead>
          <tr>
            {HEADS.map((head, i) => (
              <th key={head} scope="col" className={cx("head", i === 0 ? "" : "right")}>
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TableRow key={row.month} label={monthLabel(row.month)} row={row} />
          ))}
        </tbody>
        <tfoot>
          <TableRow label="12 months" row={sumMonths("total", rows)} />
        </tfoot>
      </table>
    </div>
  );
}

function cashNote(forecast: ReadyForecast, need: string): string | null {
  const chosen = forecast.needs.filter((n) => need === ALL || n.need === need);
  const costed = chosen.filter((n) => n.cost !== null).map((n) => n.label);
  if (costed.length === 0 || costed.length === chosen.length) return null;
  return `Cash counts only the needs with a unit cost: ${costed.join(", ")}.`;
}

const historyWords = ({ from, to, syntheticMonths, recordMonths }: ReadyForecast["history"]): string =>
  `The history runs from ${monthLabel(from)} to ${monthLabel(to)}: ${String(syntheticMonths)} synthetic ` +
  `months and ${String(recordMonths)} months of the record.`;

function NeedPicker({
  forecast,
  need,
  onNeed,
}: {
  forecast: ReadyForecast;
  need: string;
  onNeed: (need: string) => void;
}) {
  const id = useId();
  return (
    <div className={cx("bar")}>
      <label className={cx("label")} htmlFor={id}>
        Need
      </label>
      <select
        id={id}
        className={cx("select")}
        value={need}
        onChange={(e) => {
          onNeed(e.target.value);
        }}
      >
        <option value={ALL}>All needs</option>
        {forecast.needs.map((n) => (
          <option key={n.need} value={n.need}>
            {n.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ForecastReady({ forecast }: { forecast: ReadyForecast }) {
  const [need, setNeed] = useState(ALL);
  const rows = rowsFor(forecast, need);
  const subject = forecast.needs.find((n) => n.need === need)?.label ?? "all needs";
  const cash = cashNote(forecast, need);
  return (
    <>
      <NeedPicker forecast={forecast} need={need} onNeed={setNeed} />
      <figure className={cx("figure")}>
        <ForecastChart months={forecast.months} series={rows.map((r) => r.jobs)} subject={subject} />
        <ChartKey />
      </figure>
      <ForecastTable rows={rows} />
      {cash === null ? null : <p className={cx("note")}>{cash}</p>}
      <p className={cx("note")}>{METHOD_NOTE}</p>
      <p className={cx("note")}>{historyWords(forecast.history)}</p>
    </>
  );
}

export type ForecastPanelProps = {
  forecast: Forecast;
  needs: readonly NeedLabel[];
  costs: readonly CostEntry[];
  busy: boolean;
  onSaveCost: (set: CostSet) => void;
};

export function ForecastPanel({ forecast, needs, costs, busy, onSaveCost }: ForecastPanelProps) {
  const titleId = useId();
  return (
    <section className={cx("block")} aria-labelledby={titleId}>
      <h3 id={titleId} className={cx("heading")}>
        Forecast of the next 12 months
      </h3>
      {forecast.status === "ready" ? (
        <ForecastReady forecast={forecast} />
      ) : (
        <p className={cx("note")}>
          {`Vision needs 12 full months of the record for a forecast. The record has ${String(forecast.recordMonths)}.`}
        </p>
      )}
      <details className={cx("details")}>
        <summary className={cx("summary")}>Unit costs</summary>
        <CostEditor needs={needs} costs={costs} busy={busy} onSave={onSaveCost} />
      </details>
    </section>
  );
}
