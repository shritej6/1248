import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import {
  CatalogSchema,
  CommandSchema,
  CostSetSchema,
  DraftApproveSchema,
  DraftAskSchema,
  DraftIdSchema,
  EffectSchema,
  EventDraftSchema,
  RangeSchema,
  ReadinessSetSchema,
  ResourceKindSchema,
  ResourceStatusSchema,
  ResourcesViewSchema,
  SystemCommandSchema,
  writesLetter,
} from "../src/index.js";

type Row = Record<string, unknown> & { id: string };
type RawCatalog = { resources: Row[]; sponsors: Row[] };
type Source = { url: string; checked: string };

const catalogText = readFileSync(new URL("../../data/resources/catalog.json", import.meta.url), "utf8");
const catalog = (): RawCatalog => JSON.parse(catalogText) as RawCatalog;
const playbookRows = (): { need: string; quiet: boolean }[] =>
  (
    JSON.parse(readFileSync(new URL("../../data/synthetic/playbook.json", import.meta.url), "utf8")) as {
      rows: { need: string; quiet: boolean }[];
    }
  ).rows;
const withRow = (id: string, change: Record<string, unknown>): RawCatalog => {
  const c = catalog();
  return { ...c, resources: c.resources.map((r) => (r.id === id ? { ...r, ...change } : r)) };
};

const draftId = "d_5b1f0c3e-8a2d-4c6f-9e71-3a4b5c6d7e8f";
const memberId = "m_c14e291c-eaf6-4a97-9eeb-45b6b41208c3";
const uuid = "5b1f0c3e-8a2d-4c6f-9e71-3a4b5c6d7e8f";
const hash = "a".repeat(64);
const system = { card: null, job: null, actor: { role: "system", ref: null } };
const askData = { draft: draftId, kind: "funder_letter", month: "2026-11", resource: "bader_preliminary" };
const result = { draft: draftId, text: "Draft text", source: "template", flag: "ai_off", reasons: [] };

describe("catalog file", () => {
  it("parses with the catalog schema", () => {
    expect(CatalogSchema.safeParse(catalog()).success).toBe(true);
  });
  it("every row and sponsor was checked on 2026-11-22 and links to an https page", () => {
    const { resources, sponsors } = catalog();
    for (const row of [...resources, ...sponsors]) {
      const source = row["source"] as Source;
      expect(source.checked, row.id).toBe("2026-11-22");
      expect(source.url.startsWith("https://"), row.id).toBe(true);
    }
  });
  it("every fit need is a need of the synthetic playbook, and no fit need is quiet", () => {
    const active = playbookRows()
      .filter((r) => !r.quiet)
      .map((r) => r.need);
    for (const row of catalog().resources) {
      for (const need of (row["fit"] as { needs: string[] }).needs) expect(active, row.id).toContain(need);
    }
  });
  it("holds no contact detail", () => {
    expect(catalogText).not.toContain("@");
    expect(catalogText).not.toMatch(/\b\d{3}[.\-\s]\d{3}[.\-\s]\d{4}\b/);
  });
});

describe("catalog rules", () => {
  it("a duplicate id is rejected", () => {
    const c = catalog();
    const first = c.resources[0] ?? { id: "x" };
    expect(CatalogSchema.safeParse({ ...c, resources: [...c.resources, first] }).success).toBe(false);
  });
  it("deadlines out of order are rejected", () => {
    const c = withRow("bader_preliminary", { deadlines: ["2027-05-31", "2026-11-30"] });
    expect(CatalogSchema.safeParse(c).success).toBe(false);
  });
  it("a closed row with a deadline or a rolling date is rejected", () => {
    expect(
      CatalogSchema.safeParse(withRow("united_way_urgent_need", { deadlines: ["2027-01-01"] })).success,
    ).toBe(false);
    expect(CatalogSchema.safeParse(withRow("united_way_urgent_need", { rolling: true })).success).toBe(false);
  });
  it("a lowest award above the highest award is rejected", () => {
    const c = withRow("community_connections", { amount: { min: 700, max: 600 } });
    expect(CatalogSchema.safeParse(c).success).toBe(false);
  });
});

describe("resource inputs", () => {
  it("a funder letter names one resource, and an impact post names none", () => {
    const post = { draft: draftId, kind: "impact_post", month: "2026-11", resource: null };
    expect(DraftAskSchema.safeParse(post).success).toBe(true);
    expect(DraftAskSchema.safeParse(askData).success).toBe(true);
    expect(DraftAskSchema.safeParse({ ...askData, resource: null }).success).toBe(false);
    expect(DraftAskSchema.safeParse({ ...post, resource: "bader_preliminary" }).success).toBe(false);
  });
  it("a range goes from low to likely to high", () => {
    expect(RangeSchema.safeParse({ low: 4, likely: 5, high: 6 }).success).toBe(true);
    expect(RangeSchema.safeParse({ low: 5, likely: 4, high: 6 }).success).toBe(false);
  });
  it("a readiness item takes only its own states", () => {
    expect(ReadinessSetSchema.safeParse({ item: "c3", state: "yes" }).success).toBe(true);
    expect(ReadinessSetSchema.safeParse({ item: "sponsor", state: "yes" }).success).toBe(false);
  });
  it("a unit cost is a whole number of cents, or null to clear it", () => {
    const cost = (centsPerJob: number | null) =>
      CostSetSchema.safeParse({ need: "snow", centsPerJob, basis: "estimate" });
    expect(cost(2500).success).toBe(true);
    expect(cost(null).success).toBe(true);
    expect(cost(-1).success).toBe(false);
    expect(cost(12.5).success).toBe(false);
  });
  it("a draft id is d_ and a UUID v4", () => {
    expect(DraftIdSchema.safeParse(`d_${uuid}`).success).toBe(true);
    expect(DraftIdSchema.safeParse(`cmd_${uuid}`).success).toBe(false);
  });
});

describe("draft ledger lines", () => {
  it("the three draft lines parse with no card, no job and the system actor", () => {
    const lines = [
      { type: "draft.asked", data: { ...askData, by: memberId } },
      { type: "draft.done", data: { draft: draftId, source: "ai", flag: null, textHash: hash } },
      { type: "draft.approved", data: { draft: draftId, textHash: hash, by: memberId } },
    ];
    for (const line of lines)
      expect(EventDraftSchema.safeParse({ ...system, ...line }).success, line.type).toBe(true);
  });
  it("a draft line never holds the draft text", () => {
    const data = { draft: draftId, source: "ai", flag: null, textHash: hash, text: "Draft text" };
    expect(EventDraftSchema.safeParse({ ...system, type: "draft.done", data }).success).toBe(false);
  });
  it("the two draft effects parse", () => {
    const text = { ...result, kind: "draft.text", textHash: hash };
    expect(EffectSchema.safeParse({ kind: "draft", draft: draftId }).success).toBe(true);
    expect(EffectSchema.safeParse(text).success).toBe(true);
    expect(EffectSchema.safeParse({ ...text, reasons: ["invented"] }).success).toBe(false);
  });
});

describe("draft system commands", () => {
  it("draft.ask, draft.result and draft.approve parse as system commands", () => {
    const commands = [
      { type: "draft.ask", ...askData, by: memberId },
      { type: "draft.result", ...result },
      { type: "draft.approve", draft: draftId, textHash: hash, by: memberId },
    ];
    for (const c of commands) expect(SystemCommandSchema.safeParse(c).success, c.type).toBe(true);
  });
  it("a browser command can never be a draft command", () => {
    const ask = { id: `cmd_${uuid}`, type: "draft.ask", ...askData, by: memberId };
    expect(CommandSchema.safeParse(ask).success).toBe(false);
  });
});

describe("view fixture", () => {
  it("the demo view copies its rows from the catalog, and each why need is a need of the view", () => {
    const text = readFileSync(new URL("../fixtures/views/resources-demo.json", import.meta.url), "utf8");
    const view = ResourcesViewSchema.parse(JSON.parse(text));
    const rows = CatalogSchema.parse(catalog());
    for (const r of view.resources) expect(r).toEqual(rows.resources.find((x) => x.id === r.id));
    expect(view.sponsors).toEqual(rows.sponsors);
    expect(view.matches.map((m) => m.resource)).toEqual(view.resources.map((r) => r.id));
    const needs = view.needs.map((n) => n.need);
    for (const why of view.matches.flatMap((m) => m.why))
      for (const n of why.needs ?? []) expect(needs).toContain(n);
  });
});

const REQUEST_SCHEMAS = [
  ["draft-ask-", DraftAskSchema],
  ["draft-approve", DraftApproveSchema],
  ["costs-", CostSetSchema],
  ["readiness-", ReadinessSetSchema],
] as const;

describe("request fixtures", () => {
  it("every request fixture parses with the schema for its prefix", () => {
    const dir = new URL("../fixtures/resources/", import.meta.url);
    const files = readdirSync(dir);
    expect(files).toHaveLength(6);
    for (const f of files) {
      const schema = REQUEST_SCHEMAS.find(([prefix]) => f.startsWith(prefix))?.[1];
      const value = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as unknown;
      expect(schema?.safeParse(value).success, f).toBe(true);
    }
  });
});

describe("letter rows", () => {
  it("only a grant or a company row that is not closed takes a letter", () => {
    const taking = ResourceKindSchema.options.flatMap((kind) =>
      ResourceStatusSchema.options
        .filter((status) => writesLetter({ kind, status }))
        .map((status) => `${kind} ${status}`),
    );
    expect(taking).toEqual([
      "grant open",
      "grant between_cycles",
      "grant unknown",
      "company open",
      "company between_cycles",
      "company unknown",
    ]);
  });

  it("the catalog has letter rows, and no people, goods or closed row takes a letter", () => {
    const rows = CatalogSchema.parse(catalog()).resources;
    expect(rows.filter(writesLetter).length).toBeGreaterThan(0);
    for (const id of ["united_way_urgent_need", "every_org_sponsor", "givebutter_sponsor", "taproot_plus"]) {
      const row = rows.find((r) => r.id === id);
      expect(row, id).toBeDefined();
      expect(row !== undefined && writesLetter(row), id).toBe(false);
    }
  });
});
