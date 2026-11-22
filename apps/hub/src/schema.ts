const TABLES = [
  "CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, card TEXT, job TEXT, type TEXT NOT NULL, actor_role TEXT NOT NULL, actor_ref TEXT, data TEXT NOT NULL, prev TEXT NOT NULL, hash TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL, state TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS vault (id INTEGER PRIMARY KEY, card TEXT NOT NULL, job TEXT, kind TEXT NOT NULL, from_party TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL, forget_at INTEGER)",
  "CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL, roles TEXT NOT NULL, skills TEXT NOT NULL, zip TEXT, on_duty INTEGER NOT NULL, last_job_at INTEGER)",
  "CREATE TABLE IF NOT EXISTS partners (id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS offers (job TEXT NOT NULL, member TEXT NOT NULL, wave INTEGER NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (job, member))",
  "CREATE TABLE IF NOT EXISTS links (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, card TEXT, job TEXT, partner TEXT, expires_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, member TEXT NOT NULL, expires_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS join_codes (hash TEXT PRIMARY KEY, member TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)",
  "CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, actor_ref TEXT, type TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, card TEXT, payload TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, last_error TEXT, forget_at INTEGER)",
  "CREATE TABLE IF NOT EXISTS playbook (version TEXT PRIMARY KEY, rows TEXT NOT NULL, loaded_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS org (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS vault_audio (id INTEGER PRIMARY KEY, card TEXT NOT NULL, part INTEGER NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, at INTEGER NOT NULL, forget_at INTEGER)",
];

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS vault_card ON vault (card)",
  "CREATE INDEX IF NOT EXISTS vault_forget_at ON vault (forget_at)",
  "CREATE INDEX IF NOT EXISTS outbox_next_at ON outbox (next_at)",
  "CREATE INDEX IF NOT EXISTS outbox_card ON outbox (card)",
  "CREATE INDEX IF NOT EXISTS vault_audio_card ON vault_audio (card, part)",
  "CREATE INDEX IF NOT EXISTS vault_audio_forget_at ON vault_audio (forget_at)",
];

export const migrate = (sql: SqlStorage): void => {
  for (const statement of [...TABLES, ...INDEXES]) sql.exec(statement);
};
