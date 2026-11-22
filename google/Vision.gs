const INBOX_LABEL = "vision-in";
const POLL_MINUTES = 5;
const MAX_TRIES = 3;
const FIRST_WAIT_MS = 1000;
const LEDGER_HEADERS = ["seq", "at", "card", "job", "type", "actorRole", "actorRef", "data", "prev", "hash"];
const PLAYBOOK_HEADERS = [
  "need",
  "label",
  "service",
  "defaultForService",
  "code",
  "level",
  "owner",
  "skill",
  "promiseHours",
  "quiet",
  "crew",
  "bring",
  "ladder",
];

function setting(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error("The script property " + name + " is not set.");
  return value;
}

function answer(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function refused(message) {
  console.warn("vision: refused, " + message);
  return answer({ ok: false, error: message });
}

function tab(name, headers) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  if (headers && sheet.getLastRow() === 0) sheet.appendRow(headers);
  return sheet;
}

function sendMail(body) {
  if (typeof body.to !== "string" || typeof body.subject !== "string" || typeof body.body !== "string")
    return refused("a mail needs to, subject and body");
  GmailApp.sendEmail(body.to, body.subject, body.body);
  return answer({ ok: true });
}

function appendLedger(body) {
  if (!Array.isArray(body.lines)) return refused("ledger lines are missing");
  const sheet = tab("Ledger", LEDGER_HEADERS);
  const known = sheet.getLastRow() > 1 ? Number(sheet.getRange(sheet.getLastRow(), 1).getValue()) : 0;
  const rows = body.lines
    .filter((line) => line.seq > known)
    .map((line) => [
      line.seq,
      new Date(line.at).toISOString(),
      line.card || "",
      line.job || "",
      line.type,
      line.actor.role,
      line.actor.ref || "",
      JSON.stringify(line.data),
      line.prev,
      line.hash,
    ]);
  if (rows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LEDGER_HEADERS.length).setValues(rows);
  return answer({ ok: true, added: rows.length });
}

function flatten(prefix, value, out) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    Object.keys(value).forEach((key) => flatten(prefix ? prefix + "." + key : key, value[key], out));
  } else {
    out.push([prefix, Array.isArray(value) ? JSON.stringify(value) : value]);
  }
  return out;
}

function writeStatement(body) {
  const s = body.statement;
  if (!s || typeof s.month !== "string") return refused("the statement is missing");
  const sheet = tab("Statement " + s.month, null);
  sheet.clear();
  const rows = [["field", "value"]].concat(flatten("", s, []));
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  return answer({ ok: true });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (error) {
    return refused("the body is not JSON (" + error.name + ")");
  }
  if (body.secret !== setting("SCRIPT_SECRET")) return refused("the secret is not right");
  if (body.kind === "mail") return sendMail(body);
  if (body.kind === "ledger") return appendLedger(body);
  if (body.kind === "statement") return writeStatement(body);
  return refused("unknown kind " + body.kind);
}

function cell(value) {
  return typeof value === "string" ? value.trim() : value;
}

function rung(text) {
  const parts = text.trim().split(/\s+/);
  if (parts[0] === "partner") return { path: "partner", partner: parts[1], replyMinutes: Number(parts[2]) };
  return { path: parts[0] };
}

function playbookRow(values) {
  const row = {};
  PLAYBOOK_HEADERS.forEach((name, i) => {
    row[name] = cell(values[i]);
  });
  row.defaultForService = row.defaultForService === true || row.defaultForService === "TRUE";
  row.quiet = row.quiet === true || row.quiet === "TRUE";
  row.level = Number(row.level);
  row.promiseHours = Number(row.promiseHours);
  row.crew = Number(row.crew);
  row.bring = row.bring === "" ? null : row.bring;
  row.ladder = String(row.ladder).split(">").map(rung);
  return row;
}

function doGet(e) {
  const params = e.parameter || {};
  if (params.secret !== setting("SCRIPT_SECRET")) return refused("the secret is not right");
  if (params.kind !== "playbook") return refused("unknown kind " + params.kind);
  const values = tab("Playbook", PLAYBOOK_HEADERS).getDataRange().getValues().slice(1);
  const rows = values.filter((v) => String(v[0]).trim() !== "").map(playbookRow);
  const version = "sheet-" + Utilities.formatDate(new Date(), "America/Chicago", "yyyy-MM-dd-HHmm");
  return answer({ ok: true, playbook: { version: version, rows: rows } });
}

function sender(from) {
  const match = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(from);
  return match ? { name: match[1].trim(), address: match[2].trim() } : { name: "", address: from.trim() };
}

function postToDoor(message) {
  const from = sender(message.getFrom());
  const payload = {
    messageId: message.getId(),
    fromName: from.name.slice(0, 200),
    fromAddress: from.address.slice(0, 120),
    subject: message.getSubject().slice(0, 500),
    text: message.getPlainBody().slice(0, 10000),
  };
  const options = {
    method: "post",
    contentType: "application/json",
    headers: { "X-Door-Secret": setting("DOOR_SECRET") },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  for (let tries = 1; tries <= MAX_TRIES; tries += 1) {
    const code = UrlFetchApp.fetch(setting("HUB_URL") + "/doors/email", options).getResponseCode();
    if (code === 200 || code === 201) return true;
    if (code < 500 && code !== 429) {
      console.warn("vision: the mail door refused message " + payload.messageId + " with status " + code);
      return false;
    }
    if (tries < MAX_TRIES) Utilities.sleep(FIRST_WAIT_MS * Math.pow(4, tries - 1));
  }
  console.warn("vision: the hub did not take message " + payload.messageId + " after " + MAX_TRIES + " tries");
  return false;
}

function pollInbox() {
  const threads = GmailApp.search("label:" + INBOX_LABEL + " is:unread");
  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      if (message.isUnread() && postToDoor(message)) message.markRead();
    });
  });
}

function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "pollInbox")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("pollInbox").timeBased().everyMinutes(POLL_MINUTES).create();
}
