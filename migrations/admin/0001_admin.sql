CREATE TABLE IF NOT EXISTS admin_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO admin_state (key, value) VALUES
  ('content', '{"kbCustom":[],"kbEdited":{},"kbDeleted":[],"kepuCustom":[],"kepuEdited":{},"kepuDeleted":[],"dialectCustom":[],"dialectDeleted":[],"apiConfig":{},"workflowConfig":{},"auditLogs":[]}'),
  ('tokens', '[]');
CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, token_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions (expires_at);
CREATE TABLE IF NOT EXISTS admin_attempts (id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, locked_until INTEGER NOT NULL, updated_at INTEGER NOT NULL, device TEXT NOT NULL);
