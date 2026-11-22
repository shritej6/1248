import { sha256Hex } from "@vision/core";
import { z } from "zod";

const JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DAY_MS = 86_400_000;
export const JOIN_CODE_MS = DAY_MS;
export const SESSION_MS = 30 * DAY_MS;

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

export const BootstrapSchema = z.strictObject({
  code: z.string().min(1).max(200),
  name: z.string().min(1).max(80),
  contact: z.string().min(3).max(120),
  orgName: z.string().trim().min(1).max(80).optional(),
});
export const JoinSchema = z.strictObject({ code: z.string().min(6).max(16) });

export const newToken = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

export const tokenHash = (token: string): string => sha256Hex(token);

export const newJoinCode = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => JOIN_ALPHABET.charAt(b % JOIN_ALPHABET.length)).join("");
};

export const normaliseJoinCode = (code: string): string => code.trim().toUpperCase().replace(/[\s-]/g, "");

export const sameSecret = (given: string, expected: string): boolean => {
  if (expected.length === 0) return false;
  const a = tokenHash(given);
  const b = tokenHash(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const bearerToken = (request: Request): string | null => {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(header);
  return match?.[1] ?? null;
};

export type SessionStore = {
  createSession(member: string, now: number): string;
  sessionMember(token: string, now: number): string | null;
  createJoinCode(member: string, now: number): string;
  useJoinCode(code: string, now: number): string | null;
};

const createSession = (sql: SqlStorage, member: string, now: number): string => {
  const token = newToken();
  sql.exec(
    "INSERT INTO sessions (hash, member, expires_at) VALUES (?, ?, ?)",
    tokenHash(token),
    member,
    now + SESSION_MS,
  );
  return token;
};

const sessionMember = (sql: SqlStorage, token: string, now: number): string | null => {
  const rows = sql.exec<{ member: string }>(
    "SELECT member FROM sessions WHERE hash = ? AND expires_at > ?",
    tokenHash(token),
    now,
  );
  return rows.toArray()[0]?.member ?? null;
};

const createJoinCode = (sql: SqlStorage, member: string, now: number): string => {
  const code = newJoinCode();
  sql.exec(
    "INSERT INTO join_codes (hash, member, expires_at, used_at) VALUES (?, ?, ?, NULL)",
    tokenHash(code),
    member,
    now + JOIN_CODE_MS,
  );
  return code;
};

const useJoinCode = (sql: SqlStorage, code: string, now: number): string | null => {
  const hash = tokenHash(normaliseJoinCode(code));
  const query = "SELECT member FROM join_codes WHERE hash = ? AND used_at IS NULL AND expires_at > ?";
  const row = sql.exec<{ member: string }>(query, hash, now).toArray()[0];
  if (!row) return null;
  sql.exec("UPDATE join_codes SET used_at = ? WHERE hash = ?", now, hash);
  return row.member;
};

export const sessionStore = (sql: SqlStorage): SessionStore => ({
  createSession: (member, now) => createSession(sql, member, now),
  sessionMember: (token, now) => sessionMember(sql, token, now),
  createJoinCode: (member, now) => createJoinCode(sql, member, now),
  useJoinCode: (code, now) => useJoinCode(sql, code, now),
});
