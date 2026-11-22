import { useState, type SyntheticEvent } from "react";
import { Button, FieldError, Form, Input, Label, Text, TextField } from "react-aria-components";
import { JoinCodeSchema, type Role } from "@vision/contracts";
import { joinOrg, type FailureCode } from "../api.js";
import { Shell } from "../components/Shell/Shell.js";
import { useOrgName } from "../orgName.js";
import { saveSession } from "../session.js";
import { classNames } from "../components/classNames.js";
import styles from "./JoinPage.module.css";

const cx = classNames(styles);

export type JoinPageProps = { org: string; navigate?: (path: string) => void };

type JoinState = { kind: "typing" } | { kind: "sending" } | { kind: "failed"; message: string };

const FORMAT_ERROR = "Type the 8 characters of the code.";
const VOLUNTEER_ONLY =
  "This code is for a volunteer. The website is for the desk and organisers. Ask the organiser for a new code and type it in the volunteer app.";

export function failureWords(code: FailureCode): string {
  switch (code) {
    case "network":
      return "Not sent. No connection. Try again.";
    case "unauthorized":
    case "not_found":
      return "This code does not work. A code works one time and lasts 24 hours. Ask the organiser for a new code.";
    case "rate_limited":
      return "Too many tries. Wait one minute and try again.";
    default:
      return `Not joined. The hub refused the code (${code}). Ask the organiser.`;
  }
}

export function homeFor(org: string, roles: Role[]): string | null {
  if (roles.includes("desk")) return `/${org}/desk`;
  if (roles.includes("organiser") || roles.includes("lead")) return `/${org}/org`;
  return null;
}

const normalise = (value: string) => value.toUpperCase().replace(/[\s-]/gu, "");

const goTo = (path: string) => {
  window.location.assign(path);
};

export function JoinPage({ org, navigate = goTo }: JoinPageProps) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<JoinState>({ kind: "typing" });
  const orgName = useOrgName(org);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await joinOrg(org, normalise(code));
    if (!outcome.ok) {
      setState({ kind: "failed", message: failureWords(outcome.code) });
      return;
    }
    const home = homeFor(org, outcome.member.roles);
    if (home === null) {
      setState({ kind: "failed", message: VOLUNTEER_ONLY });
      return;
    }
    saveSession(org, outcome.session);
    navigate(home);
  };

  return (
    <Shell theme="graphite" section="Join" live={null} clock={null} orgName={orgName}>
      <JoinForm
        orgName={orgName}
        code={code}
        state={state}
        onChange={setCode}
        onSubmit={(event) => {
          setState({ kind: "sending" });
          void submit(event);
        }}
      />
    </Shell>
  );
}

type JoinFormProps = {
  orgName: string | null;
  code: string;
  state: JoinState;
  onChange: (code: string) => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
};

function JoinForm({ orgName, code, state, onChange, onSubmit }: JoinFormProps) {
  const sending = state.kind === "sending";
  return (
    <section className={cx("panel")} aria-labelledby="join-title">
      <h1 id="join-title" className={cx("title")}>
        {orgName === null ? "Join" : `Join ${orgName}`}
      </h1>
      <p className={cx("hint")}>Type the join code from the organiser. A code works one time.</p>
      <Form className={cx("form")} onSubmit={onSubmit}>
        <TextField
          className={cx("field")}
          value={code}
          onChange={onChange}
          isRequired
          validate={(value) => (JoinCodeSchema.safeParse(normalise(value)).success ? null : FORMAT_ERROR)}
        >
          <Label className={cx("label")}>Join code</Label>
          <Input className={cx("input")} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          <FieldError className={cx("error")} />
        </TextField>
        <Button className={cx("primary")} type="submit" isDisabled={sending}>
          Join
        </Button>
        {sending ? <Text className={cx("hint")}>Waiting for hub receipt</Text> : null}
        {state.kind === "failed" ? (
          <p className={cx("error")} role="alert">
            {state.message}
          </p>
        ) : null}
      </Form>
    </section>
  );
}
