import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import { ensureRuntimeSchema } from "../../db/runtime-schema";
import { publicErrorResponse } from "./http/responses";

export type AnonymousRequestKind = "sample" | "upload";

export const ANONYMOUS_WINDOW_SECONDS = 10 * 60;
/**
 * Bundled samples have no anonymous-session count limit. They remain bounded
 * by the active-review lease, parser/runtime safeguards, and the deployment
 * kill switch. Keep this explicit null policy value for health/capability
 * responses and future admission-policy changes.
 */
export const ANONYMOUS_SAMPLE_LIMIT: number | null = null;
/**
 * Real IFC uploads have no anonymous-session count limit. They remain bounded
 * by per-file size, parser/runtime resources, and the active-review lease.
 * Keep this as an explicit null policy value for health/capability responses.
 */
export const ANONYMOUS_UPLOAD_LIMIT: null = null;
export const ANONYMOUS_LEASE_SECONDS = 2 * 60;
export const ANONYMOUS_SESSION_HEADER = "x-bim-review-session";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

export class AdmissionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly recovery: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AdmissionError";
  }
}

export type AnonymousAdmission = {
  release(): Promise<void>;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function isDisabled(value: string | undefined): boolean {
  return value === "0" || value?.toLocaleLowerCase("en-US") === "false";
}

export function realUploadsEnabled(): boolean {
  return !isDisabled(env.BIM_REVIEW_UPLOADS_ENABLED);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function requestSessionId(request: Request): string {
  const value = request.headers.get(ANONYMOUS_SESSION_HEADER)?.trim() ?? "";
  if (!SESSION_ID_PATTERN.test(value)) {
    throw new AdmissionError(
      "anonymous_session_required",
      "A valid anonymous review session identifier is required.",
      400,
      "Reload the Site and retry, or send a random 16–80 character X-BIM-Review-Session header.",
    );
  }
  return value;
}

export async function beginAnonymousReview(
  request: Request,
  kind: AnonymousRequestKind,
): Promise<AnonymousAdmission> {
  if (kind === "upload" && !realUploadsEnabled()) {
    throw new AdmissionError(
      "uploads_temporarily_disabled",
      "Real IFC uploads are temporarily disabled for this Site deployment.",
      503,
      "Use a synthetic sample now or retry after the maintainer re-enables uploads.",
      300,
    );
  }

  const sessionHash = await sha256Hex(requestSessionId(request));
  await ensureRuntimeSchema();
  const d1 = getD1();
  const timestamp = nowSeconds();

  await d1.batch([
    d1
      .prepare("DELETE FROM anonymous_rate_windows WHERE updated_at < ?")
      .bind(timestamp - ANONYMOUS_WINDOW_SECONDS * 2),
    d1
      .prepare("DELETE FROM anonymous_run_leases WHERE expires_at <= ?")
      .bind(timestamp),
  ]);

  // Keep the conditional branch for an explicit future policy value, but the
  // current public demo policy does not count sample starts. Both sample and
  // upload requests retain the single active-review lease per session plus
  // the size, parser, runtime, and upload-kill-switch safeguards.
  if (kind === "sample" && ANONYMOUS_SAMPLE_LIMIT !== null) {
    const windowStartedAt =
      Math.floor(timestamp / ANONYMOUS_WINDOW_SECONDS) * ANONYMOUS_WINDOW_SECONDS;
    const rateKey = `${sessionHash}:${kind}:${windowStartedAt}`;
    const rate = await d1
      .prepare(
        `INSERT INTO anonymous_rate_windows (
          rate_key, session_hash, request_kind, window_started_at,
          request_count, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(rate_key) DO UPDATE SET
          request_count = anonymous_rate_windows.request_count + 1,
          updated_at = excluded.updated_at
        WHERE anonymous_rate_windows.request_count < ?`,
      )
      .bind(
        rateKey,
        sessionHash,
        kind,
        windowStartedAt,
        timestamp,
        ANONYMOUS_SAMPLE_LIMIT,
      )
      .run();
    if (Number(rate.meta.changes ?? 0) !== 1) {
      const retryAfter = windowStartedAt + ANONYMOUS_WINDOW_SECONDS - timestamp;
      throw new AdmissionError(
        "anonymous_rate_limited",
        "This anonymous session reached the sample review limit.",
        429,
        "Wait for the current ten-minute sample window to reset before starting another sample run.",
        Math.max(1, retryAfter),
      );
    }
  }

  const leaseId = crypto.randomUUID();
  const lease = await d1
    .prepare(
      `INSERT INTO anonymous_run_leases (
        session_hash, lease_id, expires_at, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(session_hash) DO UPDATE SET
        lease_id = excluded.lease_id,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
      WHERE anonymous_run_leases.expires_at <= ?`,
    )
    .bind(
      sessionHash,
      leaseId,
      timestamp + ANONYMOUS_LEASE_SECONDS,
      timestamp,
      timestamp,
    )
    .run();
  if (Number(lease.meta.changes ?? 0) !== 1) {
    throw new AdmissionError(
      "anonymous_review_in_progress",
      "This anonymous session already has an active IFC review.",
      429,
      "Wait for the current review to finish before starting another one.",
      ANONYMOUS_LEASE_SECONDS,
    );
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await d1
          .prepare(
            "DELETE FROM anonymous_run_leases WHERE session_hash = ? AND lease_id = ?",
          )
          .bind(sessionHash, leaseId)
          .run();
      } catch {
        // A failed release cannot invalidate a completed review. The bounded
        // lease expires automatically and the next request reconciles it.
      }
    },
  };
}

export function admissionErrorResponse(error: AdmissionError): Response {
  return publicErrorResponse(
    error.code,
    error.message,
    error.recovery,
    error.status,
    error.retryAfterSeconds
      ? { "retry-after": String(error.retryAfterSeconds) }
      : undefined,
  );
}
