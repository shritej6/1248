import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { EventDraft, LedgerEvent } from "@vision/contracts";
import { canonicalJson, sha256Hex, sealEvent, verifySeal, GENESIS_HASH } from "../src/index.js";

const draft = (n: number): EventDraft => ({
  card: `c_${String(n)}`,
  job: null,
  type: "card.received",
  actor: { role: "system", ref: null },
  data: { door: "form", zip: "53216", safeContact: true },
});

const chain = (count: number): LedgerEvent[] => {
  const out: LedgerEvent[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= count; i++) {
    const e = sealEvent(draft(i), i, 1_000 * i, prev);
    out.push(e);
    prev = e.hash;
  }
  return out;
};

const withZip = (e: LedgerEvent, zip: string): LedgerEvent =>
  e.type === "card.received" ? { ...e, data: { ...e.data, zip } } : e;

describe("canonical json and hash", () => {
  it("sha256 of abc is the standard value", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("key order does not change canonical json", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }),
    );
  });

  it("canonical json keeps array order", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it("canonical json has no spaces and sorted keys", () => {
    expect(canonicalJson({ b: null, a: "x", c: { z: true, y: 1.5 } })).toBe(
      '{"a":"x","b":null,"c":{"y":1.5,"z":true}}',
    );
  });
});

describe("seal", () => {
  it("the first line links to the genesis hash", () => {
    expect(chain(1)[0]?.prev).toBe(GENESIS_HASH);
    expect(GENESIS_HASH).toBe("0".repeat(64));
  });

  it("an empty ledger verifies at the genesis hash", () => {
    expect(verifySeal([])).toEqual({ ok: true, seq: 0, hash: GENESIS_HASH });
  });

  it("a clean chain verifies", () => {
    expect(verifySeal(chain(5))).toEqual({ ok: true, seq: 5, hash: chain(5)[4]?.hash });
  });

  it("any changed line fails at that line", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9 }), (i) => {
        const lines = chain(10).map((e, k) => (k === i ? withZip(e, "53206") : e));
        expect(verifySeal(lines)).toEqual({ ok: false, badSeq: i + 1 });
      }),
    );
  });

  it("a removed line fails at the line after the gap", () => {
    const lines = chain(5).filter((e) => e.seq !== 3);
    expect(verifySeal(lines)).toEqual({ ok: false, badSeq: 4 });
  });

  it("a first line that does not start at seq 1 fails", () => {
    const lines = chain(3).slice(1);
    expect(verifySeal(lines)).toEqual({ ok: false, badSeq: 2 });
  });
});
