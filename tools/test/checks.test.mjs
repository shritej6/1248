import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findDashes,
  findEmoji,
  paragraphTooLong,
  sentenceShare,
  bannedPhraseHit,
  fileProblems,
} from "../check-docs.mjs";
import { kotlinComments, scriptComments, hashComments, xmlComments } from "../check-comments.mjs";
import { examRecordProblem } from "../check-exam-record.mjs";

test("finds em and en dashes", () => {
  const em = String.fromCharCode(0x2014);
  const en = String.fromCharCode(0x2013);
  assert.deepEqual(findDashes(`a ${em} b\nc ${en} d`), [1, 2]);
});

test("exam data and results pass with escaped dashes and fail with literal ones", () => {
  const em = String.fromCharCode(0x2014);
  const escaped = ["\\u2014", "\\u2013", "\\ud83d\\ude29"].join(" ");
  const paths = [
    "exam/data/key.json",
    "exam/data/messages.json",
    "exam/results/2026-11-21-cf-test-model.json",
    "exam/results/record.json",
    "exam/voice-results/2026-11-21.json",
    "exam/link-results/2026-11-21.json",
    "exam/lang-results/2026-11-21.json",
  ];
  for (const path of paths) {
    assert.deepEqual(fileProblems(path, `"reason": "a ${escaped} b"`), []);
    assert.deepEqual(fileProblems(path, `"reason": "a ${em} b"`), [`${path}:1: em or en dash`]);
  }
});

test("exam data with a literal emoji fails", () => {
  const face = String.fromCodePoint(0x1f629);
  assert.deepEqual(fileProblems("exam/data/messages.json", `"text": "sad ${face}"`), [
    "exam/data/messages.json:1: emoji",
  ]);
});

test("our own files may not have a dash", () => {
  const em = String.fromCharCode(0x2014);
  assert.deepEqual(fileProblems("exam/src/lang-check.ts", `a ${em} b`), [
    "exam/src/lang-check.ts:1: em or en dash",
  ]);
  assert.deepEqual(fileProblems("docs/exam.md", `a ${em} b`).slice(0, 1), ["docs/exam.md:1: em or en dash"]);
});

test("finds emoji by line", () => {
  assert.deepEqual(findEmoji(`plain\nhappy ${String.fromCodePoint(0x1f600)}`), [2]);
});

test("paragraph of six sentences fails", () => {
  assert.equal(paragraphTooLong("A. B. C. D. E. F.", 5), true);
});

test("paragraph of five sentences passes", () => {
  assert.equal(paragraphTooLong("A. B. C. D. E.", 5), false);
});

test("sentence share counts sentences of 25 words or fewer", () => {
  assert.equal(sentenceShare("Short one. " + "word ".repeat(30).trim() + ".", 25), 0.5);
});

test("banned phrase is found outside the architecture document", () => {
  const phrase = ["chain", "of", "custody"].join(" ");
  assert.equal(bannedPhraseHit("README.md", `The ${phrase} holds.`), true);
  assert.equal(bannedPhraseHit("docs/architecture.md", `The ${phrase} holds.`), false);
});

test("kotlin comment found, url is not a comment", () => {
  assert.deepEqual(kotlinComments('val a = 1 // x\nval u = "http://10.0.2.2"\n/* y */'), [1, 3]);
});

test("kotlin raw string with slashes is not a comment", () => {
  assert.deepEqual(kotlinComments('val r = """a // b\n/* c */"""\nval d = 2'), []);
});

test("script comment found, template string is not a comment", () => {
  assert.deepEqual(scriptComments("const a = `x // y`;\n// z\nconst b = '/* q */';"), [2]);
});

test("hash line is a comment", () => {
  assert.deepEqual(hashComments("a: 1\n  # note\nb: '#x'"), [2]);
});

test("xml comment found", () => {
  assert.deepEqual(xmlComments("<a>\n<!-- note -->\n</a>"), [2]);
});

test("exam record: empty model passes", () => {
  assert.equal(examRecordProblem({ model: "", promptSha: null, rows: [] }), null);
});

test("exam record: model without a passing row fails", () => {
  const sha = "a".repeat(64);
  const rows = [{ model: "m", promptSha256: sha, passed: false }];
  assert.notEqual(examRecordProblem({ model: "m", promptSha: sha, rows }), null);
});

test("exam record: model with a passing row passes", () => {
  const sha = "b".repeat(64);
  const rows = [{ model: "m", promptSha256: sha, passed: true }];
  assert.equal(examRecordProblem({ model: "m", promptSha: sha, rows }), null);
});
