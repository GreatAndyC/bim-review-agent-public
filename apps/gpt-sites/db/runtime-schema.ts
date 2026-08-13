import { getD1 } from "./index";

const CREATE_REVIEW_RUNS = `
CREATE TABLE IF NOT EXISTS review_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  review_run_id TEXT,
  access_token_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  safe_filename TEXT,
  source_sha256 TEXT,
  size_bytes INTEGER,
  schema_name TEXT,
  rule_pack_id TEXT,
  rule_pack_version TEXT,
  review_json TEXT,
  agent_json TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_accessed_at INTEGER,
  deleted_at INTEGER
)
`;

const CREATE_RUN_DOCUMENTS = `
CREATE TABLE IF NOT EXISTS run_documents (
  run_id TEXT NOT NULL,
  document_kind TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (run_id, document_kind, chunk_index),
  FOREIGN KEY (run_id) REFERENCES review_runs(run_id) ON DELETE CASCADE
)
`;

const CREATE_EXPIRY_INDEX = `
CREATE INDEX IF NOT EXISTS idx_review_runs_expires_at
ON review_runs(expires_at)
`;

const CREATE_STATE_EXPIRY_INDEX = `
CREATE INDEX IF NOT EXISTS idx_review_runs_state_expires_at
ON review_runs(state, expires_at)
`;

const CREATE_REVIEW_ID_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_runs_review_run_id
ON review_runs(review_run_id)
`;

const CREATE_DOCUMENT_INDEX = `
CREATE INDEX IF NOT EXISTS idx_run_documents_run_kind
ON run_documents(run_id, document_kind)
`;

const CREATE_RATE_WINDOWS = `
CREATE TABLE IF NOT EXISTS anonymous_rate_windows (
  rate_key TEXT PRIMARY KEY NOT NULL,
  session_hash TEXT NOT NULL,
  request_kind TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
`;

const CREATE_RATE_UPDATED_INDEX = `
CREATE INDEX IF NOT EXISTS idx_anonymous_rate_windows_updated_at
ON anonymous_rate_windows(updated_at)
`;

const CREATE_RUN_LEASES = `
CREATE TABLE IF NOT EXISTS anonymous_run_leases (
  session_hash TEXT PRIMARY KEY NOT NULL,
  lease_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
`;

const CREATE_LEASE_EXPIRY_INDEX = `
CREATE INDEX IF NOT EXISTS idx_anonymous_run_leases_expires_at
ON anonymous_run_leases(expires_at)
`;

let initialization: Promise<void> | undefined;

export function ensureRuntimeSchema(): Promise<void> {
  if (initialization) return initialization;
  initialization = initialize().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

async function initialize(): Promise<void> {
  const d1 = getD1();
  await d1.prepare(CREATE_REVIEW_RUNS).run();
  const columns = await d1
    .prepare("PRAGMA table_info(review_runs)")
    .all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  if (!names.has("review_run_id")) {
    await d1.prepare("ALTER TABLE review_runs ADD COLUMN review_run_id TEXT").run();
  }
  if (!names.has("last_accessed_at")) {
    await d1
      .prepare("ALTER TABLE review_runs ADD COLUMN last_accessed_at INTEGER")
      .run();
  }
  await d1.batch([
    d1.prepare(CREATE_RUN_DOCUMENTS),
    d1.prepare(CREATE_EXPIRY_INDEX),
    d1.prepare(CREATE_STATE_EXPIRY_INDEX),
    d1.prepare(CREATE_REVIEW_ID_INDEX),
    d1.prepare(CREATE_DOCUMENT_INDEX),
    d1.prepare(CREATE_RATE_WINDOWS),
    d1.prepare(CREATE_RATE_UPDATED_INDEX),
    d1.prepare(CREATE_RUN_LEASES),
    d1.prepare(CREATE_LEASE_EXPIRY_INDEX),
  ]);
}
