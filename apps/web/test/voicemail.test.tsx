import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DeskBoardSchema,
  VOICE_MAX_BYTES,
  type AiStatus,
  type Command,
  type DeskBoard,
  type DeskCard,
} from "@vision/contracts";
import { AddVoicemail } from "../src/components/Voicemail/AddVoicemail.js";
import { VoicemailCard } from "../src/components/Voicemail/VoicemailCard.js";
import { voiceSlots } from "../src/components/Voicemail/slots.js";
import type { DeskHub } from "../src/components/deskSlots.js";
import type { DeskSend } from "../src/components/deskCommand.js";
import { fixture } from "./helpers.js";

const HUB: DeskHub = { org: "comforce-demo", auth: { kind: "session", token: "desk-token-1" } };
const CARD = "c_5e2a9c41-8b7d-4f13-a6e0-3d9c1b7f2a84";

type Call = { url: string; init: RequestInit };

let calls: Call[] = [];
const stubFetch = (reply: () => Response) => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return Promise.resolve(reply());
    }),
  );
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:voicemail-1"), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const board = (): DeskBoard => DeskBoardSchema.parse(fixture("views/desk-board.json"));
const voiceCard = (voice: AiStatus | undefined, message = ""): DeskCard => {
  const card = board().triage[0];
  if (card === undefined) throw new Error("the fixture has no triage card");
  return { ...card, door: "voice", message, ai: voice === undefined ? {} : { voice } };
};
const sendOk = () => vi.fn<DeskSend>(() => Promise.resolve({ ok: true }));
const audioFile = (size: number, type = "audio/mpeg") =>
  new File([new Uint8Array(size)], "voicemail.mp3", { type });

const openDialog = (seconds: number | null) => {
  render(<AddVoicemail board={board()} send={sendOk()} hub={HUB} measure={() => Promise.resolve(seconds)} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a voicemail" }));
  return within(screen.getByRole("dialog", { name: "Add a voicemail" }));
};

const chooseAndAdd = (dialog: ReturnType<typeof openDialog>, file: File) => {
  fireEvent.change(dialog.getByLabelText("Audio file"), { target: { files: [file] } });
  fireEvent.click(dialog.getByRole("button", { name: "Add" }));
};

it("the dialog shows its fields, the help line and the two buttons", () => {
  const dialog = openDialog(30);
  expect(dialog.getByLabelText("Callback number (optional)")).toBeTruthy();
  expect(dialog.getByLabelText("ZIP code (optional)")).toBeTruthy();
  expect(dialog.getByText("WAV, MP3, OGG, WEBM or M4A. At most 2 minutes and 2 MB.")).toBeTruthy();
  expect(dialog.getByRole("button", { name: "Cancel" })).toBeTruthy();
});

it.each([
  ["a file over 2 MB", audioFile(VOICE_MAX_BYTES + 1), 30, "This file is over 2 MB."],
  ["a recording over 2 minutes", audioFile(1000), 121, "This recording is over 2 minutes."],
  [
    "a file of another type",
    audioFile(1000, "audio/flac"),
    30,
    "Vision takes WAV, MP3, OGG, WEBM or M4A files.",
  ],
  ["a file the browser cannot play", audioFile(1000), null, "Vision takes WAV, MP3, OGG, WEBM or M4A files."],
])("the dialog refuses %s before it sends", async (_name, file, seconds, words) => {
  stubFetch(() => new Response("{}", { status: 201 }));
  const dialog = openDialog(seconds);
  chooseAndAdd(dialog, file);
  expect(await dialog.findByText(words)).toBeTruthy();
  expect(calls).toEqual([]);
});

it("a good file goes to the hub as a form with the desk token, and the dialog closes", async () => {
  stubFetch(() => new Response(JSON.stringify({ card: CARD }), { status: 201 }));
  const dialog = openDialog(42.36);
  fireEvent.change(dialog.getByLabelText("Callback number (optional)"), {
    target: { value: "414-555-0177" },
  });
  fireEvent.change(dialog.getByLabelText("ZIP code (optional)"), { target: { value: "53216" } });
  chooseAndAdd(dialog, audioFile(2000, "audio/x-m4a"));
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  const [call] = calls;
  expect(call?.url).toBe("/api/v1/o/comforce-demo/voicemails");
  expect(new Headers(call?.init.headers).get("Authorization")).toBe("Bearer desk-token-1");
  const form = call?.init.body as FormData;
  expect([form.get("seconds"), form.get("callback"), form.get("zip")]).toEqual([
    "42.4",
    "414-555-0177",
    "53216",
  ]);
  expect((form.get("audio") as File).size).toBe(2000);
});

it("a refusal from the hub stays in the dialog", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ ok: false, error: { code: "too_large", message: "x" } }), {
        status: 413,
      }),
  );
  const dialog = openDialog(30);
  chooseAndAdd(dialog, audioFile(1000));
  expect(await dialog.findByText("This file is over 2 MB.")).toBeTruthy();
});

it("the player fetches the audio with the Authorization header and plays a blob URL", async () => {
  stubFetch(
    () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }),
  );
  render(<VoicemailCard card={voiceCard("ok", "Snow on my walk")} send={sendOk()} hub={HUB} />);
  const player = await screen.findByLabelText("Voicemail recording");
  expect(player.getAttribute("src")).toBe("blob:voicemail-1");
  const [call] = calls;
  expect(call?.url).toBe(`/api/v1/o/comforce-demo/audio/${CARD}`);
  expect(call?.url).not.toContain("desk-token-1");
  expect(new Headers(call?.init.headers).get("Authorization")).toBe("Bearer desk-token-1");
});

it("the player says so when the recording does not load", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ ok: false, error: { code: "not_found", message: "x" } }), {
        status: 404,
      }),
  );
  render(<VoicemailCard card={voiceCard("failed")} send={sendOk()} hub={HUB} />);
  expect(await screen.findByText("The recording did not load. Try again later.")).toBeTruthy();
});

const AI_LINE = "Transcript by speech AI. Listen before you confirm.";

it.each([
  ["ok", "Snow on my walk", AI_LINE, false],
  ["pending", "", "The transcript is on the way. Listen to the voicemail.", false],
  ["failed", "", "Listen to the voicemail", true],
  ["empty", "", "Listen to the voicemail", true],
  ["off", "", "Listen to the voicemail", true],
  [undefined, "", "Listen to the voicemail", true],
] as const)("with the transcript status %s the card shows the right line", (voice, message, line, form) => {
  stubFetch(() => new Response(new Uint8Array([1]), { status: 200 }));
  render(<VoicemailCard card={voiceCard(voice, message)} send={sendOk()} hub={HUB} />);
  expect(screen.getByText(line)).toBeTruthy();
  expect(screen.queryByText(AI_LINE) !== null).toBe(voice === "ok");
  expect(screen.queryByRole("button", { name: "Save the gist" }) !== null).toBe(form);
});

it("a typed gist hides the gist form", () => {
  stubFetch(() => new Response(new Uint8Array([1]), { status: 200 }));
  render(<VoicemailCard card={voiceCard("failed", "Snow on the walk")} send={sendOk()} hub={HUB} />);
  expect(screen.getByText("Listen to the voicemail")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save the gist" })).toBeNull();
});

it("the gist form sends voice.gist with the typed words", async () => {
  stubFetch(() => new Response(new Uint8Array([1]), { status: 200 }));
  const send = sendOk();
  render(<VoicemailCard card={voiceCard("failed")} send={send} hub={HUB} />);
  fireEvent.change(screen.getByLabelText("Type the gist"), {
    target: { value: "  Gas smell in the kitchen  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save the gist" }));
  await waitFor(() => {
    expect(send).toHaveBeenCalledTimes(1);
  });
  const [command] = send.mock.calls[0] ?? [];
  expect(command).toMatchObject({
    type: "voice.gist",
    card: CARD,
    text: "Gas smell in the kitchen",
  } satisfies Partial<Command>);
});

it("a card from another door shows nothing", () => {
  stubFetch(() => new Response(null, { status: 200 }));
  const card = { ...voiceCard("ok"), door: "form" as const };
  const { container } = render(<VoicemailCard card={card} send={sendOk()} hub={HUB} />);
  expect(container.textContent).toBe("");
  expect(calls).toEqual([]);
});

it("the voice slot set fills the tools and the place above the words", () => {
  expect(voiceSlots.tools).toEqual([AddVoicemail]);
  expect(voiceSlots.aboveMessage).toEqual([VoicemailCard]);
});
