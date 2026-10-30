CREATE TABLE IF NOT EXISTS admin_content_items (
  generation TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT '',
  target_key TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL,
  digest TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (generation, key)
);
CREATE INDEX IF NOT EXISTS admin_content_kind ON admin_content_items (generation, kind, key);
CREATE INDEX IF NOT EXISTS admin_content_changes ON admin_content_items (generation, revision, key);
CREATE INDEX IF NOT EXISTS admin_content_owner ON admin_content_items (generation, owner, kind);
CREATE INDEX IF NOT EXISTS admin_content_media ON admin_content_items (generation, kind, media_type, key);
CREATE INDEX IF NOT EXISTS admin_content_history_target ON admin_content_items (generation, kind, target_key);
CREATE TABLE IF NOT EXISTS admin_content_receipts (
  generation TEXT NOT NULL,
  id TEXT NOT NULL,
  owner TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (generation, id)
);
