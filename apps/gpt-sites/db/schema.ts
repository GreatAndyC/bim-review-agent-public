import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const reviewRuns = sqliteTable(
  "review_runs",
  {
    runId: text("run_id").primaryKey(),
    reviewRunId: text("review_run_id"),
    accessTokenHash: text("access_token_hash").notNull(),
    state: text("state").notNull(),
    safeFilename: text("safe_filename"),
    sourceSha256: text("source_sha256"),
    sizeBytes: integer("size_bytes"),
    schemaName: text("schema_name"),
    rulePackId: text("rule_pack_id"),
    rulePackVersion: text("rule_pack_version"),
    reviewJson: text("review_json"),
    agentJson: text("agent_json"),
    errorCode: text("error_code"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastAccessedAt: integer("last_accessed_at"),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("idx_review_runs_expires_at").on(table.expiresAt),
    index("idx_review_runs_state_expires_at").on(table.state, table.expiresAt),
    uniqueIndex("idx_review_runs_review_run_id").on(table.reviewRunId),
  ],
);

export const runDocuments = sqliteTable(
  "run_documents",
  {
    runId: text("run_id")
      .notNull()
      .references(() => reviewRuns.runId, { onDelete: "cascade" }),
    documentKind: text("document_kind").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.documentKind, table.chunkIndex],
    }),
    index("idx_run_documents_run_kind").on(
      table.runId,
      table.documentKind,
    ),
  ],
);

export const anonymousRateWindows = sqliteTable(
  "anonymous_rate_windows",
  {
    rateKey: text("rate_key").primaryKey(),
    sessionHash: text("session_hash").notNull(),
    requestKind: text("request_kind").notNull(),
    windowStartedAt: integer("window_started_at").notNull(),
    requestCount: integer("request_count").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_anonymous_rate_windows_updated_at").on(table.updatedAt),
  ],
);

export const anonymousRunLeases = sqliteTable(
  "anonymous_run_leases",
  {
    sessionHash: text("session_hash").primaryKey(),
    leaseId: text("lease_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_anonymous_run_leases_expires_at").on(table.expiresAt),
  ],
);
