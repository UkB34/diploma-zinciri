CREATE TABLE IF NOT EXISTS chain_batches (
 id TEXT PRIMARY KEY NOT NULL,
 run_id TEXT NOT NULL,
 run_size INTEGER NOT NULL,
 method TEXT NOT NULL,
 action TEXT NOT NULL,
 size INTEGER NOT NULL,
 data_hash TEXT NOT NULL,
 payload TEXT NOT NULL,
 root TEXT,
 status TEXT NOT NULL,
 tx_hash TEXT UNIQUE,
 from_address TEXT,
 block_number INTEGER,
 block_time INTEGER,
 gas_used TEXT,
 gas_price TEXT,
 error TEXT,
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 submitted_at INTEGER,
 confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS chain_batches_run ON chain_batches(run_id);
CREATE TABLE IF NOT EXISTS chain_records (
 method TEXT NOT NULL,
 code TEXT NOT NULL,
 vc_hash TEXT NOT NULL,
 batch_id TEXT NOT NULL,
 proof TEXT,
 revoked_batch TEXT,
 PRIMARY KEY (method, code)
);
CREATE INDEX IF NOT EXISTS chain_records_hash ON chain_records(vc_hash);
