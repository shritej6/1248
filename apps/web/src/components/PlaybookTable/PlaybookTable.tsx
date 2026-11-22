import { useState, type ChangeEvent } from "react";
import { Button } from "react-aria-components";
import { PlaybookSchema, type Level, type OrgView, type Playbook, type PlaybookRow } from "@vision/contracts";
import { newCommandId } from "../../api.js";
import { classNames } from "../classNames.js";
import { ShapeMark } from "../StateChip/StateChip.js";
import { useDeskCommand, type DeskSend } from "../deskCommand.js";
import styles from "./PlaybookTable.module.css";

const cx = classNames(styles);

type NeedLevel = OrgView["levels"]["needs"][number];
type Levels = OrgView["levels"];

const PATH_WORDS = { volunteers: "Volunteers", partner: "Partner", unmet: "Unmet shelf" } as const;

const ladderWords = (row: PlaybookRow): string =>
  row.ladder.map((rung) => PATH_WORDS[rung.path]).join(", then ");

type LevelProps = { need: string; current: NeedLevel | undefined; send: DeskSend };

function LevelPicker({ need, current, send }: LevelProps) {
  const command = useDeskCommand(send);
  const choices: Level[] = current?.canEarn === true ? [1, 2, 3] : [2, 3];
  return (
    <div className={cx("levels")}>
      {choices.map((level) => {
        const chosen = current?.level === level;
        return (
          <Button
            key={level}
            aria-label={`Set ${need} to level ${String(level)}${chosen ? ", current" : ""}`}
            aria-pressed={chosen}
            className={cx("choice", chosen ? "chosen" : "")}
            isDisabled={command.busy}
            onPress={() => {
              if (!chosen) void command.run({ id: newCommandId(), type: "need.set_level", need, level });
            }}
          >
            {chosen ? <ShapeMark mark="filled_square" /> : null}
            {String(level)}
          </Button>
        );
      })}
      {command.state.kind === "failed" ? (
        <span role="alert" className={cx("error")}>
          {command.state.message}
        </span>
      ) : null}
    </div>
  );
}

type RowsProps = { playbook: Playbook; levels: Levels; send: DeskSend };

function PlaybookRows({ playbook, levels, send }: RowsProps) {
  const byNeed = new Map(levels.needs.map((item) => [item.need, item]));
  return (
    <table className={cx("table")} aria-label="Playbook">
      <thead>
        <tr>
          {["Code", "Need", "Service", "Promise", "Crew", "Path", "Quiet", "Clean cards", "Level"].map(
            (head) => (
              <th key={head} className={cx("head")}>
                {head}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {playbook.rows.map((row) => {
          const level = byNeed.get(row.need);
          return (
            <tr key={row.need} className={cx("row")}>
              <td className={cx("cell", "code")}>{row.code}</td>
              <td className={cx("cell")}>{row.label}</td>
              <td className={cx("cell")}>{row.service}</td>
              <td className={cx("cell", "num")}>{`${String(row.promiseHours)} h`}</td>
              <td className={cx("cell", "num")}>{String(row.crew)}</td>
              <td className={cx("cell")}>{ladderWords(row)}</td>
              <td className={cx("cell")}>{row.quiet ? "Quiet" : "No"}</td>
              <td className={cx("cell", "num")}>{level === undefined ? "0" : String(level.clean)}</td>
              <td className={cx("cell")}>
                <LevelPicker need={row.need} current={level} send={send} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MasterSwitch({ master, send }: { master: boolean; send: DeskSend }) {
  const command = useDeskCommand(send);
  return (
    <div className={cx("master")}>
      <span className={cx("label")}>Master switch</span>
      <span>{master ? "ON. Every need runs at level 2." : "OFF. Each need runs at its own level."}</span>
      <Button
        className={cx("secondary")}
        isDisabled={command.busy}
        onPress={() => void command.run({ id: newCommandId(), type: "levels.master", on: !master })}
      >
        {master ? "Use own levels" : "Return all to level 2"}
      </Button>
      {command.state.kind === "failed" ? (
        <span role="alert" className={cx("error")}>
          {command.state.message}
        </span>
      ) : null}
    </div>
  );
}

async function readPlaybook(file: File): Promise<Playbook | null> {
  try {
    const parsed = PlaybookSchema.safeParse(JSON.parse(await file.text()));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.warn(`playbook: the file ${file.name} is not JSON (${name})`);
    return null;
  }
}

function PlaybookLoad({ send }: { send: DeskSend }) {
  const command = useDeskCommand(send);
  const [problem, setProblem] = useState<string | null>(null);
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    const playbook = await readPlaybook(file);
    setProblem(playbook === null ? "This file is not a valid playbook. Nothing was loaded." : null);
    if (playbook !== null) await command.run({ id: newCommandId(), type: "playbook.load", playbook });
  };
  const message = problem ?? (command.state.kind === "failed" ? command.state.message : null);
  return (
    <div className={cx("load")}>
      <label className={cx("label")} htmlFor="playbook-file">
        Load a new playbook
      </label>
      <input
        id="playbook-file"
        className={cx("file")}
        type="file"
        accept="application/json,.json"
        onChange={(e) => void onFile(e)}
      />
      <span className={cx("hint")}>A new version applies to new cards only.</span>
      {message === null ? null : (
        <span role="alert" className={cx("error")}>
          {message}
        </span>
      )}
    </div>
  );
}

export type PlaybookTableProps = { playbook: Playbook | null; levels: Levels; send: DeskSend };

export function PlaybookTable({ playbook, levels, send }: PlaybookTableProps) {
  return (
    <div className={cx("playbook")}>
      <p className={cx("version")}>
        {playbook === null
          ? "No playbook is loaded."
          : `Version ${playbook.version}, ${String(playbook.rows.length)} needs`}
      </p>
      <MasterSwitch master={levels.master} send={send} />
      <PlaybookLoad send={send} />
      {playbook === null ? null : <PlaybookRows playbook={playbook} levels={levels} send={send} />}
    </div>
  );
}
