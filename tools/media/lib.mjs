export const STILLS = [
  "ask.png",
  "track.png",
  "desk-board.png",
  "desk-card.png",
  "voicemail.png",
  "same-event.png",
  "ask-spanish.png",
  "phones-offer.png",
  "phone-job.png",
  "statement.png",
  "seal.png",
  "org.png",
  "partner.png",
];

const attr = (tag, key) => {
  const match = tag.match(new RegExp(`\\s${key}="([^"]*)"`, "u"));
  return match === null ? "" : unescapeXml(match[1]);
};

export function unescapeXml(text) {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function parseNodes(xml) {
  return [...xml.matchAll(/<node [^>]*>/gu)].map((m) => {
    const tag = m[0];
    const box = attr(tag, "bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/u);
    const [x1, y1, x2, y2] = box === null ? [0, 0, 0, 0] : box.slice(1).map(Number);
    return {
      text: attr(tag, "text"),
      desc: attr(tag, "content-desc"),
      cls: attr(tag, "class"),
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
    };
  });
}

export function findNode(nodes, pattern) {
  return nodes.find((n) => pattern.test(n.text) || pattern.test(n.desc)) ?? null;
}

export function screenWords(nodes) {
  return nodes.map((n) => n.text || n.desc).filter((w) => w.length > 0);
}

export function parseCodes(text) {
  const codes = new Map();
  for (const line of text.split("\n")) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length === 3 && /^[A-Z0-9]{4,}$/u.test(parts[2])) codes.set(parts[0], parts[2]);
  }
  return codes;
}

export function codeOf(codes, name) {
  const code = codes.get(name);
  if (code === undefined) throw new Error(`The seed made no join code for ${name}.`);
  return code;
}

export function hubEnv(text, secret) {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  return lines
    .map((line) => {
      const at = line.indexOf("=");
      if (at < 0) return line;
      const key = line.slice(0, at);
      const value = line.slice(at + 1);
      return value.startsWith("change-me") ? `${key}=${secret(key)}` : line;
    })
    .join("\n")
    .concat("\n");
}

export function envValue(text, key) {
  const line = text.split("\n").find((l) => l.startsWith(`${key}=`));
  return line === undefined ? "" : line.slice(key.length + 1).trim();
}

export function segments(cuts, end) {
  return cuts
    .map((cut, i) => ({ ...cut, from: cut.at, to: i + 1 < cuts.length ? cuts[i + 1].at : end }))
    .filter((s) => s.to - s.from >= 100);
}

export function secondsOf(ms) {
  return (Math.round(ms) / 1000).toFixed(3);
}

export function sizeText(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function clockText(ms) {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  return `${minutes} min ${String(total % 60).padStart(2, "0")} s`;
}
