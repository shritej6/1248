import { useState } from "react";
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from "react-aria-components";
import { uploadVoicemail } from "../../voiceApi.js";
import { classNames } from "../classNames.js";
import { deskFailureWords } from "../deskCommand.js";
import type { BoardSlotProps, DeskHub } from "../deskSlots.js";
import {
  TOO_LARGE,
  audioSeconds,
  fileProblem,
  lengthProblem,
  sentSeconds,
  type Measure,
} from "./checkAudio.js";
import styles from "./Voicemail.module.css";

const cx = classNames(styles);
const ACCEPT = ".wav,.mp3,.ogg,.webm,.m4a,audio/wav,audio/mpeg,audio/ogg,audio/webm,audio/mp4,audio/x-m4a";

type Draft = { file: File | null; callback: string; zip: string };
type Sending = { kind: "idle" } | { kind: "sending" } | { kind: "failed"; message: string };

async function addProblem(hub: DeskHub, draft: Draft, measure: Measure): Promise<string | null> {
  if (draft.file === null) return "Choose an audio file.";
  const problem = fileProblem(draft.file);
  if (problem !== null) return problem;
  const seconds = await measure(draft.file);
  const long = lengthProblem(seconds);
  if (long !== null || seconds === null) return long;
  const upload = {
    file: draft.file,
    seconds: sentSeconds(seconds),
    callback: draft.callback,
    zip: draft.zip,
  };
  const outcome = await uploadVoicemail(hub.org, hub.auth, upload);
  if (outcome.ok) return null;
  return outcome.code === "too_large" ? TOO_LARGE : deskFailureWords(outcome);
}

type FormProps = { hub: DeskHub; measure: Measure; close: () => void };

function VoicemailForm({ hub, measure, close }: FormProps) {
  const [draft, setDraft] = useState<Draft>({ file: null, callback: "", zip: "" });
  const [sending, setSending] = useState<Sending>({ kind: "idle" });
  const add = async () => {
    setSending({ kind: "sending" });
    const message = await addProblem(hub, draft, measure);
    if (message === null) close();
    else setSending({ kind: "failed", message });
  };
  return (
    <form
      className={cx("form")}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <VoicemailFields draft={draft} onDraft={setDraft} />
      <div className={cx("actions")}>
        <Button type="submit" className={cx("primary")} isDisabled={sending.kind === "sending"}>
          Add
        </Button>
        <Button className={cx("ghost")} onPress={close}>
          Cancel
        </Button>
      </div>
      {sending.kind === "failed" ? (
        <p role="alert" className={cx("error")}>
          {sending.message}
        </p>
      ) : null}
    </form>
  );
}

type FieldsProps = { draft: Draft; onDraft: (draft: Draft) => void };
type TextProps = { label: string; value: string; max: number; zip?: boolean; onText: (text: string) => void };

function TextLine({ label, value, max, zip = false, onText }: TextProps) {
  return (
    <label className={cx("field")}>
      <span className={cx("label")}>{label}</span>
      <input
        type={zip ? "text" : "tel"}
        inputMode={zip ? "numeric" : "tel"}
        className={cx("input", zip ? "zip" : "")}
        maxLength={max}
        value={value}
        onChange={(event) => {
          onText(event.target.value);
        }}
      />
    </label>
  );
}

function VoicemailFields({ draft, onDraft }: FieldsProps) {
  return (
    <>
      <label className={cx("field")}>
        <span className={cx("label")}>Audio file</span>
        <input
          type="file"
          accept={ACCEPT}
          className={cx("input")}
          onChange={(event) => {
            onDraft({ ...draft, file: event.target.files?.[0] ?? null });
          }}
        />
      </label>
      <p className={cx("muted")}>WAV, MP3, OGG, WEBM or M4A. At most 2 minutes and 2 MB.</p>
      <TextLine
        label="Callback number (optional)"
        value={draft.callback}
        max={40}
        onText={(callback) => {
          onDraft({ ...draft, callback });
        }}
      />
      <TextLine
        label="ZIP code (optional)"
        value={draft.zip}
        max={5}
        zip
        onText={(zip) => {
          onDraft({ ...draft, zip });
        }}
      />
    </>
  );
}

export function AddVoicemail({ hub, measure = audioSeconds }: BoardSlotProps & { measure?: Measure }) {
  if (hub === null) return null;
  return (
    <DialogTrigger>
      <Button className={cx("secondary")}>Add a voicemail</Button>
      <ModalOverlay className={cx("overlay")} isDismissable>
        <Modal className={cx("modal")}>
          <Dialog className={cx("dialog")}>
            {({ close }) => (
              <>
                <Heading slot="title" className={cx("title")}>
                  Add a voicemail
                </Heading>
                <VoicemailForm hub={hub} measure={measure} close={close} />
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
