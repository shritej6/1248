import { readText, trackedFiles } from "./check-docs.mjs";

const EXCLUDED = [/(^|\/)gradlew(\.bat)?$/u, /(^|\/)gradle\/wrapper\//u, /(^|\/)pnpm-lock\.yaml$/u];
const KOTLIN_QUOTES = ['"""', '"', "'"];
const SCRIPT_QUOTES = ['"', "'", "`"];

function skipString(text, start, quote) {
  let i = start + quote.length;
  while (i < text.length) {
    if (quote.length === 1 && text[i] === "\\") {
      i += 2;
    } else if (text.startsWith(quote, i)) {
      return i + quote.length;
    } else {
      i += 1;
    }
  }
  return i;
}

function scanComments(text, quotes) {
  const lines = new Set();
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const quote = quotes.find((q) => text.startsWith(q, i));
    let next = i + 1;
    if (quote !== undefined) {
      next = skipString(text, i, quote);
    } else if (text.startsWith("//", i)) {
      lines.add(line);
      const end = text.indexOf("\n", i);
      next = end === -1 ? text.length : end;
    } else if (text.startsWith("/*", i)) {
      lines.add(line);
      const end = text.indexOf("*/", i + 2);
      next = end === -1 ? text.length : end + 2;
    }
    for (let k = i; k < next && k < text.length; k += 1) if (text[k] === "\n") line += 1;
    i = next;
  }
  return [...lines].sort((a, b) => a - b);
}

export function kotlinComments(text) {
  return scanComments(text, KOTLIN_QUOTES);
}

export function scriptComments(text) {
  return scanComments(text, SCRIPT_QUOTES);
}

export function hashComments(text) {
  return text
    .split("\n")
    .map((l, i) => (l.trim().startsWith("#") ? i + 1 : 0))
    .filter((n) => n > 0);
}

export function xmlComments(text) {
  return text
    .split("\n")
    .map((l, i) => (l.includes("<!--") ? i + 1 : 0))
    .filter((n) => n > 0);
}

export function scannerFor(path) {
  if (EXCLUDED.some((re) => re.test(path))) return null;
  if (/\.(kt|kts)$/u.test(path)) return kotlinComments;
  if (/\.gs$/u.test(path)) return scriptComments;
  if (/\.xml$/u.test(path)) return xmlComments;
  if (/(\.ya?ml|\.toml|\.properties|(^|\/)Makefile)$/u.test(path)) return hashComments;
  return null;
}

function main() {
  const problems = [];
  for (const path of trackedFiles()) {
    const scan = scannerFor(path);
    const text = scan === null ? null : readText(path);
    if (scan !== null && text !== null) {
      for (const n of scan(text)) problems.push(`${path}:${n}: code comment`);
    }
  }
  for (const p of problems) console.error(p);
  if (problems.length > 0) process.exit(1);
  console.log("comments: no code comments found");
}

if (import.meta.main) main();
