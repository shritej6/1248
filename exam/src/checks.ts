import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { chicagoDate, jsonText } from "./record.js";

export const CHECK_FOLDERS = ["voice-results", "link-results", "lang-results"] as const;
export type CheckFolder = (typeof CHECK_FOLDERS)[number];

export class CheckStopped extends Error {
  override readonly name = "CheckStopped";
}

export const ExamRowSchema = z.object({
  id: z.string(),
  door: z.string(),
  lang: z.enum(["en", "es"]),
  text: z.string(),
  true_urgency: z.enum(["high", "low"]),
  event_group: z.string().nullable(),
  run_group: z.string().nullable(),
  near_miss_partner: z.string().nullable(),
  tags: z.array(z.string()),
});

export const VOICEMAIL_TAG = "speech_to_text_errors";
export type ExamRow = z.infer<typeof ExamRowSchema>;

const dataUrl = (name: string): URL => new URL(`../data/${name}`, import.meta.url);

export const examRows = (): ExamRow[] =>
  z.array(ExamRowSchema).parse(JSON.parse(readFileSync(dataUrl("key.json"), "utf8")));

export const checkResultUrl = (folder: CheckFolder, at: Date, root = new URL("../", import.meta.url)): URL =>
  new URL(`${folder}/${chicagoDate(at)}.json`, root);

export const writeCheckResult = (folder: CheckFolder, data: unknown, at: Date, root?: URL): URL => {
  const url = checkResultUrl(folder, at, root);
  mkdirSync(new URL("./", url), { recursive: true });
  writeFileSync(url, jsonText(data));
  return url;
};

const NeuronsSchema = z.object({ neurons: z.number().nonnegative() });
const ReplySchema = z.object({
  result: z.unknown(),
  usage: NeuronsSchema.optional(),
});

export const neuronsOf = (body: unknown): number => {
  const parsed = ReplySchema.safeParse(body);
  if (!parsed.success) return 0;
  const inner = z.object({ usage: NeuronsSchema }).safeParse(parsed.data.result);
  return parsed.data.usage?.neurons ?? (inner.success ? inner.data.usage.neurons : 0);
};

export type CheckAi = {
  json(model: string, input: unknown): Promise<unknown>;
  bytes(model: string, input: unknown): Promise<Uint8Array>;
  neurons(): number;
};

const API = "https://api.cloudflare.com/client/v4/accounts";

type Call = { model: string; input: unknown };

const post = async (account: string, token: string, call: Call): Promise<Response> => {
  const response = await fetch(`${API}/${account}/ai/run/${call.model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(call.input),
  });
  if (response.ok) return response;
  await response.body?.cancel();
  throw new CheckStopped(`Workers AI answered with status ${String(response.status)} for ${call.model}.`);
};

export const cloudflareAi = (maxNeurons: number): CheckAi => {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
  if (account === "" || token === "")
    throw new CheckStopped("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the shell first.");
  let used = 0;
  const guard = (): void => {
    if (used > maxNeurons)
      throw new CheckStopped(`The check used ${String(used)} neurons, over ${String(maxNeurons)}.`);
  };
  return {
    json: async (model, input) => {
      guard();
      const body: unknown = await (await post(account, token, { model, input })).json();
      used += neuronsOf(body);
      return ReplySchema.parse(body).result;
    },
    bytes: async (model, input) => {
      guard();
      return new Uint8Array(await (await post(account, token, { model, input })).arrayBuffer());
    },
    neurons: () => used,
  };
};
