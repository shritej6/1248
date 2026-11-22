import type { SystemCommand } from "@vision/contracts";
import {
  VectorSchema,
  bestMatches,
  embedInput,
  linkCandidates,
  linkScore,
  vectorsOf,
  type LinkMatch,
  type Vector,
} from "@vision/core";
import { AiJobError, type AiJob, type AiTools } from "./types.js";

const VECTOR_KIND = "link_vector";
const IDS_PER_QUERY = 90;

const messageOf = (sql: SqlStorage, card: string): string =>
  sql
    .exec<{ body: string }>("SELECT body FROM vault WHERE card = ? AND kind = 'message_in' ORDER BY id", card)
    .toArray()
    .map((row) => row.body)
    .join("\n")
    .trim();

const storeVector = (sql: SqlStorage, card: string, vector: Vector, at: number): void => {
  sql.exec("DELETE FROM vault WHERE card = ? AND kind = ?", card, VECTOR_KIND);
  sql.exec(
    "INSERT INTO vault (card, job, kind, from_party, body, at, forget_at) VALUES (?, NULL, ?, 'system', ?, ?, NULL)",
    card,
    VECTOR_KIND,
    JSON.stringify(vector),
    at,
  );
};

const batchesOf = (cards: readonly string[]): string[][] =>
  Array.from({ length: Math.ceil(cards.length / IDS_PER_QUERY) }, (_, i) =>
    cards.slice(i * IDS_PER_QUERY, (i + 1) * IDS_PER_QUERY),
  );

const vectorRows = (sql: SqlStorage, cards: readonly string[]) =>
  sql
    .exec<{ card: string; body: string }>(
      `SELECT card, body FROM vault WHERE kind = ? AND card IN (${cards.map(() => "?").join(", ")}) ORDER BY id`,
      VECTOR_KIND,
      ...cards,
    )
    .toArray();

const storedVectors = (sql: SqlStorage, cards: readonly string[]): { card: string; vector: Vector }[] =>
  batchesOf(cards)
    .flatMap((batch) => vectorRows(sql, batch))
    .flatMap((row) => {
      const parsed = VectorSchema.safeParse(JSON.parse(row.body));
      return parsed.success ? [{ card: row.card, vector: parsed.data }] : [];
    });

const embed = async (tools: AiTools, text: string): Promise<Vector> => {
  const vector = vectorsOf(await tools.run(tools.model, embedInput([text])), 1)?.[0];
  if (vector === undefined) throw new AiJobError("The link model gave no vector.");
  return vector;
};

const matchesFor = (tools: AiTools, card: string, vector: Vector): LinkMatch[] =>
  bestMatches(
    storedVectors(tools.sql, linkCandidates(tools.state, card)).map((row) => ({
      other: row.card,
      score: linkScore(vector, row.vector),
    })),
  );

const run = async (card: string, tools: AiTools): Promise<SystemCommand> => {
  const text = messageOf(tools.sql, card);
  if (text === "") return { type: "link.result", card, outcome: "empty", matches: [] };
  const vector = await embed(tools, text);
  storeVector(tools.sql, card, vector, tools.now);
  return { type: "link.result", card, outcome: "ok", matches: matchesFor(tools, card, vector) };
};

export const linkJob: AiJob = {
  key: "link",
  model: (env) => env.LINK_MODEL,
  run,
  fallback: (card, outcome) => ({ type: "link.result", card, outcome, matches: [] }),
};
