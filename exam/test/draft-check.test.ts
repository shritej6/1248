import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CatalogSchema, DraftFactsSchema } from "@vision/contracts";
import { DRAFT_PROMPT_SHA256, DRAFT_TRIES, guardDraft, templateDraft, type DrafterTools } from "@vision/core";
import { afterEach, expect, it } from "vitest";
import { CheckStopped, type CheckAi } from "../src/checks.js";
import {
  DRAFT_DEFAULT_MODEL,
  DRAFT_MAX_NEURONS,
  DRAFT_MIN_AI_SHARE,
  runDraftCheck,
  saveDraftCheck,
} from "../src/draft-check.js";
import { DRAFT_CHECK_FACTS } from "../src/draft-facts.js";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Call = { model: string; input: unknown };
type Input = { messages: { role: string; content: string }[] };
type Sent = { kind: string; facts: { label: string; text: string }[] };

const fakeAi = (reply: (call: Call) => unknown): CheckAi & { calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    json: (model, input) => {
      calls.push({ model, input });
      return Promise.resolve().then(() => reply({ model, input }));
    },
    bytes: () => Promise.reject(new Error("no audio in the draft check")),
    neurons: () => calls.length * 4,
  };
};

const noWait: DrafterTools = { wait: () => Promise.resolve(), log: () => undefined };
const AT = new Date(Date.UTC(2026, 10, 22, 18));
const sentFacts = (call: Call): Sent =>
  JSON.parse((call.input as Input).messages[1]?.content ?? "{}") as Sent;
const factLines = (call: Call): string =>
  sentFacts(call)
    .facts.map((f) => `${f.label}: ${f.text}.`)
    .join("\n");
const catalogNames = (): Map<string, string> => {
  const raw = readFileSync(new URL("../../data/resources/catalog.json", import.meta.url), "utf8");
  return new Map(CatalogSchema.parse(JSON.parse(raw)).resources.map((r) => [r.id, r.name]));
};

it("the check has 3 impact posts and 3 funder letters of synthetic facts that the schema accepts", () => {
  const names = catalogNames();
  expect(DRAFT_CHECK_FACTS.map((s) => s.facts.month)).toEqual([
    "2026-09",
    "2026-10",
    "2026-11",
    "2026-10",
    "2026-11",
    "2026-09",
  ]);
  expect(DRAFT_CHECK_FACTS.map((s) => s.facts.resource)).toEqual([
    null,
    null,
    null,
    "bader_preliminary",
    "safe_sound_good_neighbor",
    "we_energies_foundation",
  ]);
  expect(new Set(DRAFT_CHECK_FACTS.map((s) => s.id)).size).toBe(6);
  for (const { id, facts } of DRAFT_CHECK_FACTS) {
    expect(DraftFactsSchema.safeParse(facts).success, id).toBe(true);
    const funder = facts.facts.find((f) => f.key === "funder")?.text ?? null;
    expect(funder, id).toBe(facts.resource === null ? null : (names.get(facts.resource) ?? "unknown"));
    expect(JSON.stringify(facts), id).not.toMatch(/\b\d{5}\b|@/);
  }
});

it("the fixed template of every fact set passes the draft guard", () => {
  for (const { id, facts } of DRAFT_CHECK_FACTS)
    expect(guardDraft(templateDraft(facts), facts), id).toEqual({ ok: true });
});

it("replies that pass the guard give AI text for every row, so the check passes", async () => {
  const ai = fakeAi((call) => ({ response: { text: factLines(call) } }));
  const result = await runDraftCheck(ai, DRAFT_DEFAULT_MODEL, AT, noWait);
  expect(ai.calls).toHaveLength(6);
  expect(ai.calls.every((call) => call.model === DRAFT_DEFAULT_MODEL)).toBe(true);
  expect(result.rows.map((r) => [r.id, r.source, r.flag, r.calls])).toEqual(
    DRAFT_CHECK_FACTS.map((s) => [s.id, "ai", null, 1]),
  );
  for (const [i, row] of result.rows.entries()) {
    expect(row.kind).toBe(DRAFT_CHECK_FACTS[i]?.facts.kind);
    expect(row.text.endsWith(DRAFT_CHECK_FACTS[i]?.facts.footer ?? "missing")).toBe(true);
  }
  expect(result).toMatchObject({ date: "2026-11-22", aiShare: 1, calls: 6, neurons: 24, passed: true });
  expect(result.promptSha256).toBe(DRAFT_PROMPT_SHA256);
  expect(DRAFT_MIN_AI_SHARE).toBe(0.5);
});

it("replies with an invented number give the template with guard_rejected after 3 calls each", async () => {
  const ai = fakeAi(() => ({
    response: { text: "We helped 999999 neighbours this month, and every volunteer gave time." },
  }));
  const result = await runDraftCheck(ai, DRAFT_DEFAULT_MODEL, AT, noWait);
  for (const row of result.rows) {
    expect(row).toMatchObject({
      source: "template",
      flag: "guard_rejected",
      reasons: ["number"],
      calls: DRAFT_TRIES,
    });
    expect(row.text).not.toContain("999999");
  }
  expect(result.calls).toBe(6 * DRAFT_TRIES);
  expect(result).toMatchObject({ aiShare: 0, passed: false });
});

it("a check over the neuron limit does not pass even when every row is AI text", async () => {
  const ai = fakeAi((call) => ({ response: { text: factLines(call) } }));
  const costly: CheckAi = { ...ai, neurons: () => DRAFT_MAX_NEURONS + 1 };
  const result = await runDraftCheck(costly, DRAFT_DEFAULT_MODEL, AT, noWait);
  expect(result).toMatchObject({ aiShare: 1, passed: false });
});

it("a stop from the neuron limit or the API ends the check instead of saving templates", async () => {
  const ai = fakeAi(() => {
    throw new CheckStopped("The check used 501 neurons, over 500.");
  });
  await expect(runDraftCheck(ai, DRAFT_DEFAULT_MODEL, AT, noWait)).rejects.toBeInstanceOf(CheckStopped);
  expect(ai.calls.length).toBeLessThanOrEqual(DRAFT_TRIES);
});

it("the result goes in exam/draft-results under the Chicago date", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vision-draft-"));
  made.push(dir);
  const at = new Date(Date.UTC(2026, 10, 22, 3, 0));
  const ai = fakeAi((call) => ({ response: { text: factLines(call) } }));
  const result = await runDraftCheck(ai, DRAFT_DEFAULT_MODEL, at, noWait);
  const url = saveDraftCheck(result, at, pathToFileURL(`${dir}/`));
  expect(url.pathname.endsWith("/draft-results/2026-11-21.json")).toBe(true);
  expect(JSON.parse(readFileSync(url, "utf8"))).toEqual(JSON.parse(JSON.stringify(result)));
});
