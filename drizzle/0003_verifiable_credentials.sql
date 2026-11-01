CREATE TABLE IF NOT EXISTS credentials (
 id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL,
 username TEXT,
 role TEXT,
 subject TEXT NOT NULL,
 status_index INTEGER NOT NULL UNIQUE,
 jwt TEXT NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS credentials_holder ON credentials(username, kind, revoked);
CREATE TABLE IF NOT EXISTS wallet_challenges (
 nonce_hash TEXT PRIMARY KEY NOT NULL,
 username TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
