CREATE TABLE IF NOT EXISTS admin_media_uploads (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 262144000),
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('creating', 'uploading', 'completed', 'aborting', 'aborted')),
  r2_upload_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  lock_token TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0,
  receipt TEXT,
  UNIQUE (owner_session_id, client_id)
);
CREATE INDEX IF NOT EXISTS admin_media_uploads_owner ON admin_media_uploads (owner_session_id, expires_at);
CREATE TABLE IF NOT EXISTS admin_media_upload_parts (
  upload_id TEXT NOT NULL REFERENCES admin_media_uploads(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL CHECK (part_number >= 1 AND part_number <= 32),
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 8388608),
  sha256 TEXT NOT NULL,
  etag TEXT,
  PRIMARY KEY (upload_id, part_number)
);
