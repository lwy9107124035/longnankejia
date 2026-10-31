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
CREATE INDEX IF NOT EXISTS admin_content_live ON admin_content_items (generation, kind, key) WHERE value!='null';
CREATE INDEX IF NOT EXISTS admin_content_sequence ON admin_content_items (generation, kind);
CREATE INDEX IF NOT EXISTS admin_content_recovery ON admin_content_items (generation, kind) WHERE kind='_history' AND COALESCE(json_extract(value,'$.undone'),0)=0 AND json_type(value,'$.before') IS NOT NULL AND json_type(value,'$.before')!='null';
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
