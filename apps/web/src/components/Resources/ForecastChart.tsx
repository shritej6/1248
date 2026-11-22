import type { Month, Range } from "@vision/contracts";
import { monthIndex, monthLabel } from "@vision/core";
import { classNames } from "../classNames.js";
import styles from "./Resources.module.css";

const cx = classNames(styles);

const WIDTH = 600;
const HEIGHT = 240;
const LEFT = 40;
const RIGHT = 8;
const TOP = 12;
const BOTTOM = 28;
const PLOT = HEIGHT - TOP - BOTTOM;
const BAR = 22;
const CAP = 5;
const INITIALS = "JFMAMJJASOND";

export type ForecastChartProps = { months: readonly Month[]; series: readonly Range[]; subject: string };

type Axis = { top: number; ticks: number[] };

function axisOf(peak: number): Axis {
  const target = Math.max(peak, 4) / 4;
  const power = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= target) ?? 10 * power;
  const top = Math.max(step, Math.ceil(peak / step) * step);
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

function chartName(months: readonly Month[], series: readonly Range[], subject: string): string {
  const first = months[0];
  const last = months.at(-1);
  if (first === undefined || last === undefined) return `Likely jobs for each month, ${subject}.`;
  const peak = series.reduce((best, r, i) => (r.likely > (series[best]?.likely ?? 0) ? i : best), 0);
  const peakMonth = months[peak] ?? first;
  const peakValue = series[peak]?.likely ?? 0;
  return (
    `Likely jobs for each month, ${monthLabel(first)} to ${monthLabel(last)}, ${subject}. ` +
    `Highest: ${monthLabel(peakMonth)}, ${String(peakValue)}.`
  );
}

function Grid({ axis, y }: { axis: Axis; y: (v: number) => number }) {
  return (
    <g>
      {axis.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={LEFT}
            x2={WIDTH - RIGHT}
            y1={y(tick)}
            y2={y(tick)}
            className={cx(tick === 0 ? "axis" : "grid")}
          />
          <text x={LEFT - 6} y={y(tick)} className={cx("tick")} textAnchor="end" dominantBaseline="middle">
            {String(tick)}
          </text>
        </g>
      ))}
    </g>
  );
}

type ColumnProps = { month: Month; range: Range; x: number; y: (v: number) => number };

function Column({ month, range, x, y }: ColumnProps) {
  return (
    <g>
      <rect
        x={x - BAR / 2}
        y={y(range.likely)}
        width={BAR}
        height={y(0) - y(range.likely)}
        className={cx("column")}
      />
      <line x1={x} x2={x} y1={y(range.low)} y2={y(range.high)} className={cx("range")} />
      <line x1={x - CAP} x2={x + CAP} y1={y(range.high)} y2={y(range.high)} className={cx("range")} />
      <line x1={x - CAP} x2={x + CAP} y1={y(range.low)} y2={y(range.low)} className={cx("range")} />
      <text x={x} y={HEIGHT - 8} className={cx("tick")} textAnchor="middle">
        {INITIALS[monthIndex(month)] ?? ""}
      </text>
    </g>
  );
}

export function ForecastChart({ months, series, subject }: ForecastChartProps) {
  const axis = axisOf(Math.max(0, ...series.map((r) => r.high)));
  const y = (v: number) => TOP + PLOT * (1 - v / axis.top);
  const slot = (WIDTH - LEFT - RIGHT) / Math.max(1, months.length);
  return (
    <svg
      className={cx("chart")}
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      role="img"
      aria-label={chartName(months, series, subject)}
    >
      <Grid axis={axis} y={y} />
      {months.map((month, i) => {
        const range = series[i];
        if (range === undefined) return null;
        return <Column key={month} month={month} range={range} x={LEFT + slot * i + slot / 2} y={y} />;
      })}
    </svg>
  );
}

export function ChartKey() {
  return (
    <ul className={cx("key")} aria-label="Chart key">
      <li className={cx("keyItem")}>
        <svg className={cx("swatch")} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <rect x="2" y="1" width="8" height="10" className={cx("column")} />
        </svg>
        Bar: likely jobs
      </li>
      <li className={cx("keyItem")}>
        <svg className={cx("swatch")} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <line x1="6" x2="6" y1="1" y2="11" className={cx("range")} />
          <line x1="3" x2="9" y1="1" y2="1" className={cx("range")} />
          <line x1="3" x2="9" y1="11" y2="11" className={cx("range")} />
        </svg>
        Line: low to high
      </li>
    </ul>
  );
}
