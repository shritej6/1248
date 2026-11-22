import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import type { Statement } from "@vision/contracts";
import { classNames } from "../classNames.js";
import { ShapeMark } from "../StateChip/StateChip.js";
import styles from "./StatementTable.module.css";

const cx = classNames(styles);

type FigureKey = "openAtStart" | "new" | "helped" | "unmet" | "unreached" | "withdrawn" | "stillOpen";

const FIGURES: { key: FigureKey; label: string }[] = [
  { key: "openAtStart", label: "Open at start" },
  { key: "new", label: "New" },
  { key: "helped", label: "Helped" },
  { key: "unmet", label: "Unmet" },
  { key: "unreached", label: "Unreached" },
  { key: "withdrawn", label: "Withdrawn" },
  { key: "stillOpen", label: "Still open" },
];

type Line = { key: string; label: string; value: string; method: string };

export function balanceLine(s: Statement): string {
  const [start, fresh, ...ends] = FIGURES.map((f) => `${f.label} ${String(s[f.key])}`);
  return `${start ?? ""} + ${fresh ?? ""} = ${ends.join(" + ")}`;
}

function balanceGap(s: Statement): number {
  return s.openAtStart + s.new - (s.helped + s.unmet + s.unreached + s.withdrawn + s.stillOpen);
}

const methodOf = (s: Statement, key: string): string => s.method[key] ?? "No method is recorded.";

function figureLines(s: Statement): Line[] {
  return FIGURES.map((f) => ({
    key: f.key,
    label: f.label,
    value: String(s[f.key]),
    method: methodOf(s, f.key),
  }));
}

function wrongLines(s: Statement): Line[] {
  const wrong = methodOf(s, "wrong");
  return [
    { key: "mismatches", label: "Mismatch answers", value: String(s.wrong.mismatches), method: wrong },
    {
      key: "latePromises",
      label: "Late promises",
      value: String(s.wrong.latePromises),
      method: methodOf(s, "promise"),
    },
    {
      key: "deskChanges",
      label: "Desk changes to machine labels",
      value: String(s.wrong.deskChanges),
      method: wrong,
    },
    { key: "pagesMoved", label: "Pages that moved on", value: String(s.wrong.pagesMoved), method: wrong },
    {
      key: "noVolunteer",
      label: "Jobs no volunteer took",
      value: String(s.wrong.noVolunteer),
      method: wrong,
    },
  ];
}

function recordLines(s: Statement): Line[] {
  return [
    {
      key: "promise",
      label: "Promises kept",
      value: `${String(s.promise.kept)} of ${String(s.promise.due)}`,
      method: methodOf(s, "promise"),
    },
    {
      key: "hours",
      label: "Volunteer hours",
      value: `${s.hours.toFixed(2)} h`,
      method: methodOf(s, "hours"),
    },
    {
      key: "erased",
      label: "Private rows erased",
      value: `${String(s.erased.erased)} of ${String(s.erased.due)} due`,
      method: methodOf(s, "erased"),
    },
    {
      key: "seal",
      label: "Last sealed line",
      value: `${String(s.seal.seq)}  ${s.seal.hash.slice(0, 16)}`,
      method: methodOf(s, "seal"),
    },
  ];
}

function BalanceStrip({ statement }: { statement: Statement }) {
  const gap = balanceGap(statement);
  return (
    <div className={cx("strip")}>
      <p className={cx("balance")}>{balanceLine(statement)}</p>
      {gap === 0 ? (
        <span className={cx("ok")}>
          <ShapeMark mark="hollow_check" />
          <span>BALANCES</span>
        </span>
      ) : (
        <span className={cx("crit")}>
          <ShapeMark mark="triangle" />
          <span>{`DOES NOT BALANCE by ${String(Math.abs(gap))}`}</span>
        </span>
      )}
    </div>
  );
}

type TableProps = { title: string; lines: Line[]; onHow: (line: Line) => void };

function FigureTable({ title, lines, onHow }: TableProps) {
  return (
    <table className={cx("table")} aria-label={title}>
      <thead>
        <tr>
          <th className={cx("head")}>Figure</th>
          <th className={cx("head", "right")}>Count</th>
          <th className={cx("head")}>
            <span className={cx("hidden")}>How counted</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.key} className={cx("row")}>
            <td className={cx("cell")}>{line.label}</td>
            <td className={cx("cell", "num")}>{line.value}</td>
            <td className={cx("cell")}>
              <Button
                className={cx("how")}
                aria-label={`How counted: ${line.label}`}
                onPress={() => {
                  onHow(line);
                }}
              >
                How counted
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UnmetTable({ rows }: { rows: Statement["unmetTable"] }) {
  if (rows.length === 0) return <p className={cx("empty")}>No unmet needs this month</p>;
  return (
    <table className={cx("table")} aria-label="Unmet needs">
      <thead>
        <tr>
          <th className={cx("head")}>Need</th>
          <th className={cx("head")}>ZIP code</th>
          <th className={cx("head", "right")}>Jobs</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.need}-${row.zip ?? "none"}`} className={cx("row")}>
            <td className={cx("cell")}>{row.need}</td>
            <td className={cx("cell", "code")}>{row.zip ?? "No ZIP code"}</td>
            <td className={cx("cell", "num")}>{String(row.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HowDrawer({ line, onClose }: { line: Line; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <aside className={cx("drawer")} aria-label={`How counted: ${line.label}`}>
      <div className={cx("drawerHead")}>
        <h3 className={cx("drawerTitle")}>{line.label}</h3>
        <Button className={cx("how")} onPress={onClose}>
          Close (Esc)
        </Button>
      </div>
      <div className={cx("drawerBody")}>
        <p className={cx("value")}>{line.value}</p>
        <p className={cx("quote")}>{line.method}</p>
      </div>
    </aside>
  );
}

export function StatementTable({ statement }: { statement: Statement }) {
  const [how, setHow] = useState<Line | null>(null);
  return (
    <div className={cx("layout", how === null ? "" : "withDrawer")}>
      <div className={cx("content")}>
        <BalanceStrip statement={statement} />
        <FigureTable title="Jobs this month" lines={figureLines(statement)} onHow={setHow} />
        <h3 className={cx("heading")}>What went wrong</h3>
        <FigureTable title="What went wrong" lines={wrongLines(statement)} onHow={setHow} />
        <h3 className={cx("heading")}>Record</h3>
        <FigureTable title="Record" lines={recordLines(statement)} onHow={setHow} />
        <h3 className={cx("heading")}>Unmet needs by ZIP code</h3>
        <UnmetTable rows={statement.unmetTable} />
      </div>
      {how === null ? null : (
        <HowDrawer
          line={how}
          onClose={() => {
            setHow(null);
          }}
        />
      )}
    </div>
  );
}
