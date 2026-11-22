import { useState } from "react";
import { Button } from "react-aria-components";
import type { MemberRecord, PartnerRecord } from "@vision/contracts";
import type { JoinCodeOutcome } from "../../api.js";
import { dayTime } from "../clockTime.js";
import { classNames } from "../classNames.js";
import { deskFailureWords } from "../deskCommand.js";
import { ShapeMark } from "../StateChip/StateChip.js";
import styles from "./PeopleTable.module.css";

const cx = classNames(styles);

export type MakeJoinCode = (member: string) => Promise<JoinCodeOutcome>;

type CodeState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "shown"; code: string }
  | { kind: "failed"; message: string };

function JoinCode({ member, name, makeCode }: { member: string; name: string; makeCode: MakeJoinCode }) {
  const [state, setState] = useState<CodeState>({ kind: "idle" });
  const make = async () => {
    setState({ kind: "sending" });
    const outcome = await makeCode(member);
    if (outcome.ok) setState({ kind: "shown", code: outcome.joinCode });
    else setState({ kind: "failed", message: deskFailureWords(outcome) ?? "Not sent." });
  };
  if (state.kind === "shown") {
    return (
      <span className={cx("shown")}>
        <code className={cx("joinCode")}>{state.code}</code>
        <span className={cx("hint")}>Shown once. Give it to {name}.</span>
      </span>
    );
  }
  return (
    <span className={cx("shown")}>
      <Button
        className={cx("secondary")}
        isDisabled={state.kind === "sending"}
        aria-label={`Make a join code for ${name}`}
        onPress={() => void make()}
      >
        Make join code
      </Button>
      {state.kind === "failed" ? (
        <span role="alert" className={cx("error")}>
          {state.message}
        </span>
      ) : null}
    </span>
  );
}

export type MembersTableProps = { members: MemberRecord[]; now: number; makeCode: MakeJoinCode };

export function MembersTable({ members, now, makeCode }: MembersTableProps) {
  if (members.length === 0) return <p className={cx("empty")}>No members yet</p>;
  return (
    <table className={cx("table")} aria-label="Members">
      <thead>
        <tr>
          {["Name", "Roles", "Skills", "Home ZIP", "Tonight", "Last job", "Join code"].map((head) => (
            <th key={head} className={cx("head")}>
              {head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {members.map((member) => (
          <tr key={member.id} className={cx("row")}>
            <td className={cx("cell", "strong")}>{member.name}</td>
            <td className={cx("cell")}>{member.roles.join(", ")}</td>
            <td className={cx("cell")}>{member.skills.length === 0 ? "None" : member.skills.join(", ")}</td>
            <td className={cx("cell", "code")}>{member.zip ?? "None"}</td>
            <td className={cx("cell")}>
              <span className={cx("state")}>
                <ShapeMark mark={member.on ? "filled_circle" : "hollow_circle"} />
                <span>{member.on ? "ON" : "OFF"}</span>
              </span>
            </td>
            <td className={cx("cell")}>
              {member.lastJobAt === null ? "None" : dayTime(member.lastJobAt, now)}
            </td>
            <td className={cx("cell")}>
              <JoinCode member={member.id} name={member.name} makeCode={makeCode} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PartnersTable({ partners }: { partners: PartnerRecord[] }) {
  if (partners.length === 0) return <p className={cx("empty")}>No partners yet</p>;
  return (
    <table className={cx("table")} aria-label="Partners">
      <thead>
        <tr>
          <th className={cx("head")}>Name</th>
          <th className={cx("head")}>Partner id</th>
        </tr>
      </thead>
      <tbody>
        {partners.map((partner) => (
          <tr key={partner.id} className={cx("row")}>
            <td className={cx("cell", "strong")}>{partner.name}</td>
            <td className={cx("cell", "code")}>{partner.id}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
