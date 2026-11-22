import { useState, type ReactNode, type SyntheticEvent } from "react";
import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  RadioButton,
  RadioField,
  RadioGroup,
  Text,
  TextArea,
  TextField,
} from "react-aria-components";
import { RequestFormSchema, type Lang, type RequestForm } from "@vision/contracts";
import { submitRequest, type FailureCode } from "../api.js";
import { Call911 } from "../components/Call911/Call911.js";
import { Shell } from "../components/Shell/Shell.js";
import { classNames } from "../components/classNames.js";
import { useOrgName } from "../orgName.js";
import { matchRoute } from "../router.js";
import styles from "./AskPage.module.css";
import { ASK_ES, type AskWords } from "./spanish.js";

const cx = classNames(styles);

export type AskPageProps = { org: string };

type Draft = {
  message: string;
  firstName: string;
  contact: string;
  zip: string;
  address: string;
  safe: string | null;
  website: string;
  lang: Lang | null;
};
type AskState =
  | { kind: "filling" }
  | { kind: "sending" }
  | { kind: "failed"; message: string }
  | { kind: "sent"; tracking: string };

const EMPTY: Draft = {
  message: "",
  firstName: "",
  contact: "",
  zip: "",
  address: "",
  safe: null,
  website: "",
  lang: null,
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const ZIP = /^\d{5}$/u;

function englishFailure(code: FailureCode): string {
  switch (code) {
    case "network":
      return "Not sent. No connection. Try again.";
    case "rate_limited":
      return "Too many requests from this network. Wait one minute and try again.";
    case "too_large":
      return "Your words are too long. Make them shorter and try again.";
    default:
      return "Not sent. Check each answer and try again.";
  }
}

export const ASK_EN: AskWords = {
  lang: "en",
  title: (orgName) => (orgName === null ? "Ask for help" : `Ask ${orgName} for help`),
  needLabel: "What do you need?",
  needHint: "Use your own words.",
  needError: "Tell us what you need.",
  nameLabel: "Your first name",
  nameError: "Type your first name.",
  contactLabel: "How can we reach you?",
  contactHint: "A phone number or an email address.",
  emailError: "Check the email address.",
  phoneError: "Type a phone number with 10 numbers, or an email address.",
  zipLabel: "ZIP code",
  zipError: "Type a ZIP code with 5 numbers.",
  addressLabel: "Your address",
  addressHint: "Only the volunteer who takes the job sees this. Leave it empty if nobody needs to come.",
  safeLabel: "Is it safe for us to contact you?",
  safeHint: "If you choose No, we do not send you messages. A person decides how to help.",
  yes: "Yes",
  no: "No",
  safeError: "Choose Yes or No.",
  send: "Send request",
  sending: "Sending. Wait for the receipt.",
  failure: englishFailure,
  receiptTitle: "We have your request",
  receiptReads: (orgName) =>
    orgName === null ? "A person reads every request." : `A person at ${orgName} reads every request.`,
  receiptKeep: "Keep this link. It shows each step of your request.",
  danger: "In danger now?",
  call: "Call 911.",
};

export const askWords = (lang: Lang | null): AskWords => (lang === "es" ? ASK_ES : ASK_EN);

const contactKind = (contact: string): RequestForm["contactKind"] =>
  contact.includes("@") ? "email" : "phone";

export function contactError(value: string, words: AskWords = ASK_EN): string | null {
  const contact = value.trim();
  if (contactKind(contact) === "email") return EMAIL.test(contact) ? null : words.emailError;
  const digits = contact.replace(/\D/gu, "").length;
  return digits === 10 || digits === 11 ? null : words.phoneError;
}

const filled = (error: string) => (value: string) => (value.trim() === "" ? error : null);

export function toForm(draft: Draft): RequestForm | null {
  const parsed = RequestFormSchema.safeParse({
    firstName: draft.firstName,
    contactKind: contactKind(draft.contact.trim()),
    contact: draft.contact,
    zip: draft.zip.trim(),
    message: draft.message,
    address: draft.address,
    safeContact: draft.safe === "yes",
    website: draft.website,
    ...(draft.lang === null ? {} : { lang: draft.lang }),
  });
  return parsed.success && draft.safe !== null ? parsed.data : null;
}

export function failureWords(code: FailureCode, words: AskWords = ASK_EN): string {
  return words.failure(code);
}

function trackingPath(tracking: string): string | null {
  return matchRoute(tracking).page === "track" ? tracking : null;
}

function useRequestSend(org: string) {
  const [state, setState] = useState<AskState>({ kind: "filling" });
  const submit = async (form: RequestForm) => {
    const words = askWords(form.lang ?? null);
    setState({ kind: "sending" });
    const outcome = await submitRequest(org, form);
    if (!outcome.ok) {
      setState({ kind: "failed", message: failureWords(outcome.code, words) });
      return;
    }
    const tracking = trackingPath(outcome.tracking);
    setState(
      tracking === null
        ? { kind: "failed", message: failureWords("invalid", words) }
        : { kind: "sent", tracking },
    );
  };
  return { state, submit };
}

export function AskPage({ org }: AskPageProps) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const { state, submit } = useRequestSend(org);
  const orgName = useOrgName(org);
  const words = askWords(draft.lang);

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = toForm(draft);
    if (form !== null && state.kind !== "sending") void submit(form);
  };

  return (
    <Shell theme="paper" section={null} live={null} clock={null} orgName={orgName}>
      <div className={cx("page")} lang={words.lang}>
        <Call911 danger={words.danger} call={words.call} />
        {state.kind === "sent" ? (
          <Receipt tracking={state.tracking} orgName={orgName} words={words} />
        ) : (
          <RequestFields
            draft={draft}
            state={state}
            orgName={orgName}
            words={words}
            onChange={setDraft}
            onSubmit={onSubmit}
          />
        )}
      </div>
    </Shell>
  );
}

type ReceiptProps = { tracking: string; orgName: string | null; words: AskWords };

function Receipt({ tracking, orgName, words }: ReceiptProps) {
  const url = `${window.location.origin}${tracking}`;
  return (
    <section className={cx("section")} aria-labelledby="receipt-title">
      <h1 id="receipt-title" className={cx("title")}>
        {words.receiptTitle}
      </h1>
      <p>{words.receiptReads(orgName)}</p>
      <p>{words.receiptKeep}</p>
      <a className={cx("tracking")} href={tracking}>
        {url}
      </a>
    </section>
  );
}

type FieldsProps = {
  draft: Draft;
  state: Exclude<AskState, { kind: "sent" }>;
  orgName: string | null;
  words: AskWords;
  onChange: (draft: Draft) => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
};

function RequestFields({ draft, state, orgName, words, onChange, onSubmit }: FieldsProps) {
  const set = (key: Exclude<keyof Draft, "lang">) => (value: string) => {
    onChange({ ...draft, [key]: value });
  };
  const setLang = (lang: Lang) => {
    onChange({ ...draft, lang });
  };
  return (
    <section className={cx("section")} aria-labelledby="ask-title">
      <LangChoice value={draft.lang} onChange={setLang} />
      <h1 id="ask-title" className={cx("title")}>
        {words.title(orgName)}
      </h1>
      <Form className={cx("form")} onSubmit={onSubmit}>
        <NeedFields draft={draft} set={set} words={words} />
        <PlaceFields draft={draft} set={set} words={words} />
        <SafeQuestion value={draft.safe} onChange={set("safe")} words={words} />
        <Trap value={draft.website} onChange={set("website")} />
        <SendArea state={state} words={words} />
      </Form>
    </section>
  );
}

function LangChoice({ value, onChange }: { value: Lang | null; onChange: (lang: Lang) => void }) {
  return (
    <RadioGroup
      className={cx("field")}
      value={value}
      onChange={(picked) => {
        onChange(picked === "es" ? "es" : "en");
      }}
      aria-label="English / Español"
    >
      <div className={cx("pair")}>
        <RadioField className={cx("option")} value="en">
          <RadioButton className={cx("choice")} lang="en">
            English
          </RadioButton>
        </RadioField>
        <RadioField className={cx("option")} value="es">
          <RadioButton className={cx("choice")} lang="es">
            Español
          </RadioButton>
        </RadioField>
      </div>
    </RadioGroup>
  );
}

type SetField = (key: Exclude<keyof Draft, "lang">) => (value: string) => void;
type FieldGroupProps = { draft: Draft; set: SetField; words: AskWords };

function Field(props: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  validate: (value: string) => string | null;
  maxLength: number;
  children: ReactNode;
}) {
  return (
    <TextField
      className={cx("field")}
      value={props.value}
      onChange={props.onChange}
      validate={props.validate}
      maxLength={props.maxLength}
    >
      <Label className={cx("label")}>{props.label}</Label>
      {props.hint === undefined ? null : (
        <Text slot="description" className={cx("hint")}>
          {props.hint}
        </Text>
      )}
      {props.children}
      <FieldError className={cx("error")} />
    </TextField>
  );
}

function NeedFields({ draft, set, words }: FieldGroupProps) {
  return (
    <>
      <Field
        label={words.needLabel}
        hint={words.needHint}
        value={draft.message}
        onChange={set("message")}
        validate={filled(words.needError)}
        maxLength={2000}
      >
        <TextArea className={cx("textarea")} rows={4} />
      </Field>
      <Field
        label={words.nameLabel}
        value={draft.firstName}
        onChange={set("firstName")}
        validate={filled(words.nameError)}
        maxLength={40}
      >
        <Input className={cx("input")} autoComplete="given-name" />
      </Field>
      <Field
        label={words.contactLabel}
        hint={words.contactHint}
        value={draft.contact}
        onChange={set("contact")}
        validate={(value) => contactError(value, words)}
        maxLength={120}
      >
        <Input className={cx("input")} autoComplete="on" />
      </Field>
    </>
  );
}

function PlaceFields({ draft, set, words }: FieldGroupProps) {
  return (
    <>
      <Field
        label={words.zipLabel}
        value={draft.zip}
        onChange={set("zip")}
        validate={(value) => (ZIP.test(value.trim()) ? null : words.zipError)}
        maxLength={5}
      >
        <Input className={cx("input", "zip")} inputMode="numeric" autoComplete="postal-code" />
      </Field>
      <Field
        label={words.addressLabel}
        hint={words.addressHint}
        value={draft.address}
        onChange={set("address")}
        validate={() => null}
        maxLength={200}
      >
        <Input className={cx("input")} autoComplete="street-address" />
      </Field>
    </>
  );
}

type SafeProps = { value: string | null; onChange: (value: string) => void; words: AskWords };

function SafeQuestion({ value, onChange, words }: SafeProps) {
  return (
    <RadioGroup className={cx("field")} value={value} onChange={onChange} isRequired>
      <Label className={cx("label")}>{words.safeLabel}</Label>
      <Text slot="description" className={cx("hint")}>
        {words.safeHint}
      </Text>
      <div className={cx("pair")}>
        <RadioField className={cx("option")} value="yes">
          <RadioButton className={cx("choice")}>{words.yes}</RadioButton>
        </RadioField>
        <RadioField className={cx("option")} value="no">
          <RadioButton className={cx("choice")}>{words.no}</RadioButton>
        </RadioField>
      </div>
      <FieldError className={cx("error")}>{words.safeError}</FieldError>
    </RadioGroup>
  );
}

function Trap({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className={cx("trap")} aria-hidden="true">
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function SendArea({ state, words }: { state: FieldsProps["state"]; words: AskWords }) {
  const sending = state.kind === "sending";
  return (
    <div className={cx("send")}>
      <Button className={cx("primary")} type="submit" isDisabled={sending}>
        {words.send}
      </Button>
      {sending ? <Text className={cx("hint")}>{words.sending}</Text> : null}
      {state.kind === "failed" ? (
        <p className={cx("error")} role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
