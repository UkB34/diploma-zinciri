CREATE TABLE IF NOT EXISTS transcripts (
 id TEXT PRIMARY KEY NOT NULL,
 uploader TEXT NOT NULL,
 filename TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 size INTEGER NOT NULL,
 data BLOB NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS transcripts_uploader ON transcripts(uploader);
