import { getD1 } from "../../../db";
import { ensureRuntimeSchema } from "../../../db/runtime-schema";
import type { AgentReviewResult, AgentRun } from "../../contracts/agent";
import type { ReviewRun } from "../../contracts/review";
import type {
  AnonymousRunAccess,
  StoredAgentReviewResult,
} from "../../contracts/storage";
import type { ValidatedUpload } from "../upload/validation";

export const RUN_RETENTION_SECONDS = 24 * 60 * 60;
export const MAX_RETAINED_DERIVED_BYTES = 8 * 1024 * 1024;
const DOCUMENT_CHUNK_CODE_UNITS = 250_000;
const MAX_DOCUMENT_CHUNKS = 40;
const RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DocumentKind = "agent" | "review";

type StoredRow = {
  run_id: string;
  review_run_id: string | null;
  state: string;
  created_at: number;
  expires_at: number;
};

type DocumentRow = {
  document_kind: DocumentKind;
  chunk_index: number;
  content: string;
};

export type StoredRun = {
  agent_run: AgentRun;
  review_run: ReviewRun | null;
  created_at: string;
  expires_at: string;
};

export class RunStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly recovery: string,
  ) {
    super(message);
    this.name = "RunStoreError";
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function isoFromSeconds(value: number): string {
  return new Date(value * 1_000).toISOString();
}

function randomAccessToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function splitDocument(kind: DocumentKind, value: unknown): DocumentRow[] {
  const content = JSON.stringify(value);
  const rows: DocumentRow[] = [];
  for (let start = 0; start < content.length; ) {
    let end = Math.min(start + DOCUMENT_CHUNK_CODE_UNITS, content.length);
    if (
      end < content.length &&
      content.charCodeAt(end - 1) >= 0xd800 &&
      content.charCodeAt(end - 1) <= 0xdbff &&
      content.charCodeAt(end) >= 0xdc00 &&
      content.charCodeAt(end) <= 0xdfff
    ) {
      end -= 1;
    }
    rows.push({
      document_kind: kind,
      chunk_index: rows.length,
      content: content.slice(start, end),
    });
    start = end;
  }
  if (rows.length === 0) {
    rows.push({ document_kind: kind, chunk_index: 0, content });
  }
  if (rows.length > MAX_DOCUMENT_CHUNKS) {
    throw new RunStoreError(
      "result_too_large",
      "The derived review result exceeds the bounded anonymous-run store.",
      507,
      "Review a smaller coordination model or a model with fewer applicable elements.",
    );
  }
  return rows;
}

function documentByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

async function cleanupExpiredRuns(timestamp = nowSeconds()): Promise<number> {
  const d1 = getD1();
  const expired = "expires_at <= ? OR deleted_at IS NOT NULL";
  const results = await d1.batch([
    d1
      .prepare(
        `DELETE FROM run_documents WHERE run_id IN (
          SELECT run_id FROM review_runs WHERE ${expired}
        )`,
      )
      .bind(timestamp),
    d1.prepare(`DELETE FROM review_runs WHERE ${expired}`).bind(timestamp),
  ]);
  return Number(results[1]?.meta?.changes ?? 0);
}

function accessGrant(
  row: StoredRow,
  accessToken: string,
): AnonymousRunAccess {
  const agentPath = `/api/agent-runs/${encodeURIComponent(row.run_id)}`;
  const reviewPath = row.review_run_id
    ? `/api/reviews/${encodeURIComponent(row.review_run_id)}`
    : null;
  return {
    agent_run_id: row.run_id,
    review_run_id: row.review_run_id,
    access_token: accessToken,
    created_at: isoFromSeconds(row.created_at),
    expires_at: isoFromSeconds(row.expires_at),
    retrieval: {
      agent: agentPath,
      review: reviewPath,
      review_json: reviewPath ? `${reviewPath}.json` : null,
      quick_check_json: reviewPath ? `${reviewPath}.quick-check.json` : null,
      quick_check_markdown: reviewPath ? `${reviewPath}.quick-check.md` : null,
      delete: `/api/runs/${encodeURIComponent(row.run_id)}`,
    },
  };
}

export async function storeAgentReviewResult(
  result: AgentReviewResult,
  upload: ValidatedUpload,
): Promise<StoredAgentReviewResult> {
  const totalBytes =
    documentByteLength(result.agent_run) +
    (result.review_run ? documentByteLength(result.review_run) : 0);
  if (totalBytes > MAX_RETAINED_DERIVED_BYTES) {
    throw new RunStoreError(
      "result_too_large",
      "The derived Agent and review result is too large for bounded retention.",
      507,
      "Review a smaller coordination model or a model with fewer applicable elements.",
    );
  }

  await ensureRuntimeSchema();
  const d1 = getD1();
  const createdAt = nowSeconds();
  const row: StoredRow = {
    run_id: result.agent_run.run_id,
    review_run_id: result.review_run?.run_id ?? null,
    state: result.agent_run.state,
    created_at: createdAt,
    expires_at: createdAt + RUN_RETENTION_SECONDS,
  };
  const accessToken = randomAccessToken();
  const accessTokenHash = await tokenHash(accessToken);
  const documents = [
    ...splitDocument("agent", result.agent_run),
    ...(result.review_run ? splitDocument("review", result.review_run) : []),
  ];

  try {
    await cleanupExpiredRuns(createdAt);
    const statements = [
      d1
        .prepare(
          `INSERT INTO review_runs (
            run_id, review_run_id, access_token_hash, state,
            safe_filename, source_sha256, size_bytes, schema_name,
            rule_pack_id, rule_pack_version, review_json, agent_json,
            error_code, created_at, expires_at, last_accessed_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL)`,
        )
        .bind(
          row.run_id,
          row.review_run_id,
          accessTokenHash,
          row.state,
          upload.safeFilename,
          upload.sha256,
          upload.bytes.byteLength,
          result.review_run?.inventory.schema_name ?? null,
          result.review_run?.rule_pack_id ?? null,
          result.review_run?.rule_pack_version ?? null,
          row.created_at,
          row.expires_at,
          row.created_at,
        ),
      ...documents.map((document) =>
        d1
          .prepare(
            `INSERT INTO run_documents (
              run_id, document_kind, chunk_index, content
            ) VALUES (?, ?, ?, ?)`,
          )
          .bind(
            row.run_id,
            document.document_kind,
            document.chunk_index,
            document.content,
          ),
      ),
    ];
    await d1.batch(statements);
  } catch (error) {
    if (error instanceof RunStoreError) throw error;
    throw new RunStoreError(
      "run_store_unavailable",
      "The anonymous Agent result could not be retained safely.",
      503,
      "Try again later or run the open-source application locally.",
    );
  }

  return { ...result, access: accessGrant(row, accessToken) };
}

function parseDocuments(row: StoredRow, documents: DocumentRow[]): StoredRun {
  const grouped = new Map<DocumentKind, DocumentRow[]>();
  for (const document of documents) {
    if (
      document.document_kind !== "agent" &&
      document.document_kind !== "review"
    ) {
      throw new Error("Stored document kind is invalid.");
    }
    grouped.set(document.document_kind, [
      ...(grouped.get(document.document_kind) ?? []),
      document,
    ]);
  }
  const parse = (kind: DocumentKind): unknown | null => {
    const chunks = grouped.get(kind);
    if (!chunks) return null;
    if (chunks.length > MAX_DOCUMENT_CHUNKS) {
      throw new Error("Stored document exceeds its chunk budget.");
    }
    chunks.sort((left, right) => left.chunk_index - right.chunk_index);
    if (chunks.some((chunk, index) => chunk.chunk_index !== index)) {
      throw new Error("Stored document chunks are incomplete.");
    }
    const content = chunks.map((chunk) => chunk.content).join("");
    if (new TextEncoder().encode(content).byteLength > MAX_RETAINED_DERIVED_BYTES) {
      throw new Error("Stored document exceeds its byte budget.");
    }
    return JSON.parse(content);
  };
  const agent = parse("agent") as AgentRun | null;
  const review = parse("review") as ReviewRun | null;
  if (
    !agent ||
    agent.run_id !== row.run_id ||
    (row.review_run_id !== null && review?.run_id !== row.review_run_id) ||
    (row.review_run_id === null && review !== null)
  ) {
    throw new Error("Stored run documents do not match their metadata.");
  }
  return {
    agent_run: agent,
    review_run: review,
    created_at: isoFromSeconds(row.created_at),
    expires_at: isoFromSeconds(row.expires_at),
  };
}

async function readStoredRun(
  whereColumn: "run_id" | "review_run_id",
  identifier: string,
  accessToken: string,
): Promise<StoredRun> {
  if (!RUN_ID_PATTERN.test(identifier)) {
    throw new RunStoreError(
      "run_not_found",
      "The anonymous run does not exist, has expired, or the access token is invalid.",
      404,
      "Start a new review or use the original access token before expiry.",
    );
  }
  await ensureRuntimeSchema();
  const d1 = getD1();
  const timestamp = nowSeconds();
  await cleanupExpiredRuns(timestamp);
  const hash = await tokenHash(accessToken);
  const row = await d1
    .prepare(
      `SELECT run_id, review_run_id, state, created_at, expires_at
       FROM review_runs
       WHERE ${whereColumn} = ? AND access_token_hash = ?
         AND deleted_at IS NULL AND expires_at > ?`,
    )
    .bind(identifier, hash, timestamp)
    .first<StoredRow>();
  if (!row) {
    throw new RunStoreError(
      "run_not_found",
      "The anonymous run does not exist, has expired, or the access token is invalid.",
      404,
      "Start a new review or use the original access token before expiry.",
    );
  }

  try {
    const documents = await d1
      .prepare(
        `SELECT document_kind, chunk_index, content
         FROM run_documents
         WHERE run_id = ?
         ORDER BY document_kind, chunk_index
         LIMIT ${MAX_DOCUMENT_CHUNKS * 2 + 1}`,
      )
      .bind(row.run_id)
      .all<DocumentRow>();
    const stored = parseDocuments(row, documents.results);
    await d1
      .prepare("UPDATE review_runs SET last_accessed_at = ? WHERE run_id = ?")
      .bind(timestamp, row.run_id)
      .run();
    return stored;
  } catch (error) {
    if (error instanceof RunStoreError) throw error;
    throw new RunStoreError(
      "stored_run_corrupt",
      "The retained run failed its integrity checks.",
      500,
      "Delete this run and start a new review.",
    );
  }
}

export function readStoredRunByAgentId(
  agentRunId: string,
  accessToken: string,
): Promise<StoredRun> {
  return readStoredRun("run_id", agentRunId, accessToken);
}

export function readStoredRunByReviewId(
  reviewRunId: string,
  accessToken: string,
): Promise<StoredRun> {
  return readStoredRun("review_run_id", reviewRunId, accessToken);
}

export async function deleteStoredRun(
  agentRunId: string,
  accessToken: string,
): Promise<{ agent_run_id: string; review_run_id: string | null }> {
  if (!RUN_ID_PATTERN.test(agentRunId)) {
    throw new RunStoreError(
      "run_not_found",
      "The anonymous run does not exist, has expired, or the access token is invalid.",
      404,
      "No deletion was performed.",
    );
  }
  await ensureRuntimeSchema();
  const d1 = getD1();
  const timestamp = nowSeconds();
  await cleanupExpiredRuns(timestamp);
  const hash = await tokenHash(accessToken);
  const row = await d1
    .prepare(
      `SELECT run_id, review_run_id, state, created_at, expires_at
       FROM review_runs
       WHERE run_id = ? AND access_token_hash = ?
         AND deleted_at IS NULL AND expires_at > ?`,
    )
    .bind(agentRunId, hash, timestamp)
    .first<StoredRow>();
  if (!row) {
    throw new RunStoreError(
      "run_not_found",
      "The anonymous run does not exist, has expired, or the access token is invalid.",
      404,
      "No deletion was performed.",
    );
  }
  await d1.batch([
    d1.prepare("DELETE FROM run_documents WHERE run_id = ?").bind(row.run_id),
    d1.prepare("DELETE FROM review_runs WHERE run_id = ?").bind(row.run_id),
  ]);
  return { agent_run_id: row.run_id, review_run_id: row.review_run_id };
}
