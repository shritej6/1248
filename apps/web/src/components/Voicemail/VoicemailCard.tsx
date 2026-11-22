import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import type { DeskCard } from "@vision/contracts";
import { newCommandId } from "../../api.js";
import { fetchRecording } from "../../voiceApi.js";
import { classNames } from "../classNames.js";
import { useDeskCommand, type DeskSend } from "../deskCommand.js";
import type { CardSlotProps, DeskHub } from "../deskSlots.js";
import styles from "./Voicemail.module.css";

const cx = classNames(styles);

type Recording = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "failed" };

function useRecording(org: string, token: string | null, card: string): Recording {
  const [recording, setRecording] = useState<Recording>({ kind: "loading" });
  useEffect(() => {
    if (token === null) return;
    let live = true;
    let url: string | null = null;
    void fetchRecording(org, { kind: "session", token }, card).then((result) => {
      if (!live) return;
      if (result.ok) url = URL.createObjectURL(result.blob);
      setRecording(url === null ? { kind: "failed" } : { kind: "ready", url });
    });
    return () => {
      live = false;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [org, token, card]);
  return recording;
}

function Player({ hub, card }: { hub: DeskHub; card: string }) {
  const token = hub.auth.kind === "session" ? hub.auth.token : null;
  const recording = useRecording(hub.org, token, card);
  if (recording.kind === "loading") return <p className={cx("muted")}>Loading the recording</p>;
  if (recording.kind === "failed")
    return <p className={cx("error")}>The recording did not load. Try again later.</p>;
  return <audio className={cx("player")} controls src={recording.url} aria-label="Voicemail recording" />;
}

function GistForm({ card, send }: { card: DeskCard; send: DeskSend }) {
  const [text, setText] = useState("");
  const command = useDeskCommand(send);
  const save = () => {
    const gist = text.trim();
    if (gist.length === 0) return;
    void command.run({ id: newCommandId(), type: "voice.gist", card: card.card, text: gist });
  };
  return (
    <form
      className={cx("form")}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className={cx("field")}>
        <span className={cx("label")}>Type the gist</span>
        <textarea
          className={cx("input")}
          rows={3}
          maxLength={2000}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </label>
      <Button type="submit" className={cx("secondary")} isDisabled={command.busy || text.trim() === ""}>
        Save the gist
      </Button>
      {command.state.kind === "failed" ? (
        <p role="alert" className={cx("error")}>
          {command.state.message}
        </p>
      ) : null}
    </form>
  );
}

function TranscriptLine({ card, send }: { card: DeskCard; send: DeskSend }) {
  const status = card.ai?.voice;
  if (status === "ok")
    return <p className={cx("note")}>Transcript by speech AI. Listen before you confirm.</p>;
  if (status === "pending")
    return <p className={cx("note")}>The transcript is on the way. Listen to the voicemail.</p>;
  return (
    <>
      <p className={cx("note", "strong")}>Listen to the voicemail</p>
      {card.message === "" ? <GistForm card={card} send={send} /> : null}
    </>
  );
}

export function VoicemailCard({ card, send, hub }: CardSlotProps) {
  if (card.door !== "voice") return null;
  return (
    <section className={cx("voicemail")} aria-label="Voicemail">
      {hub === null ? null : <Player key={card.card} hub={hub} card={card.card} />}
      <TranscriptLine card={card} send={send} />
    </section>
  );
}
