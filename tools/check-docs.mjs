import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DASHES = /[\u2013\u2014]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const PHRASE = new RegExp(["chain", "of", "custody"].join("\\s+"), "iu");
const PHRASE_HOME = "docs/architecture.md";
const MAX_SENTENCES = 5;
const MAX_WORDS = 25;
const MIN_SHARE = 0.8;

export function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  return [...new Set(out.split("\0").filter((p) => p.length > 0))];
}

export function readText(path) {
  try {
    const buf = readFileSync(path);
    return buf.includes(0) ? null : buf.toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function linesMatching(text, pattern) {
  return text
    .split("\n")
    .map((line, i) => (pattern.test(line) ? i + 1 : 0))
    .filter((n) => n > 0);
}

export function findDashes(text) {
  return linesMatching(text, DASHES);
}

export function findEmoji(text) {
  return linesMatching(text, EMOJI);
}

export function bannedPhraseHit(path, text) {
  return path !== PHRASE_HOME && PHRASE.test(text);
}

export function sentences(text) {
  return text
    .replace(/`[^`]*`/gu, "code")
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter((s) => /\p{L}/u.test(s));
}

export function paragraphTooLong(paragraph, max) {
  return sentences(paragraph).length > max;
}

export function sentenceShare(text, maxWords) {
  const all = sentences(text);
  if (all.length === 0) return 1;
  const short = all.filter((s) => s.split(/\s+/u).length <= maxWords);
  return short.length / all.length;
}

function isProseLine(line) {
  const t = line.trim();
  return t.length > 0 && !t.startsWith("#") && !t.startsWith("|") && !t.startsWith("<");
}

export function paragraphs(markdown) {
  const blocks = [];
  let current = [];
  let fenced = false;
  const flush = () => {
    if (current.length > 0) blocks.push(current.join(" "));
    current = [];
  };
  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("```")) {
      fenced = !fenced;
      flush();
    } else if (fenced || !isProseLine(line)) {
      flush();
    } else {
      if (/^\s*([-*+]|\d+\.)\s/u.test(line)) flush();
      current.push(line.trim().replace(/^([-*+]|\d+\.)\s+/u, ""));
    }
  }
  flush();
  return blocks;
}

function markdownProblems(path, text) {
  const problems = [];
  const blocks = paragraphs(text);
  for (const block of blocks) {
    if (paragraphTooLong(block, MAX_SENTENCES)) {
      problems.push(`${path}: paragraph has more than ${MAX_SENTENCES} sentences: "${block.slice(0, 60)}"`);
    }
  }
  const share = sentenceShare(blocks.join(" "), MAX_WORDS);
  if (share < MIN_SHARE) {
    problems.push(
      `${path}: only ${Math.round(share * 100)} percent of sentences have ${MAX_WORDS} words or fewer`,
    );
  }
  return problems;
}

export function fileProblems(path, text) {
  const problems = [];
  for (const n of findDashes(text)) problems.push(`${path}:${n}: em or en dash`);
  for (const n of findEmoji(text)) problems.push(`${path}:${n}: emoji`);
  if (bannedPhraseHit(path, text)) problems.push(`${path}: technical name is allowed only in ${PHRASE_HOME}`);
  if (path.endsWith(".md") && !path.startsWith("exam/data/")) problems.push(...markdownProblems(path, text));
  return problems;
}

function main() {
  const problems = [];
  for (const path of trackedFiles()) {
    const text = readText(path);
    if (text !== null) problems.push(...fileProblems(path, text));
  }
  for (const p of problems) console.error(p);
  if (problems.length > 0) process.exit(1);
  console.log("docs: no problems found");
}

if (import.meta.main) main();
