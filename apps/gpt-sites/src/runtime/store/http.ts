import { publicErrorResponse } from "../http/responses";
import { RunStoreError } from "./runs";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function runAccessToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const headerToken = request.headers.get("x-run-token");
  const bearer = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1] ?? null;
  if (bearer && headerToken && bearer !== headerToken) {
    throw new RunStoreError(
      "ambiguous_run_token",
      "The request supplied conflicting anonymous-run credentials.",
      400,
      "Send one Bearer token or one X-Run-Token header.",
    );
  }
  const token = bearer ?? headerToken;
  if (!token || !TOKEN_PATTERN.test(token)) {
    throw new RunStoreError(
      "run_token_required",
      "A valid anonymous-run access token is required.",
      401,
      "Use the access token returned once when the Agent run was created.",
    );
  }
  return token;
}

export function runStoreErrorResponse(error: unknown): Response {
  const storeError =
    error instanceof RunStoreError
      ? error
      : new RunStoreError(
          "run_store_unavailable",
          "The anonymous run store is unavailable.",
          503,
          "Try again later or run the open-source application locally.",
        );
  return publicErrorResponse(
    storeError.code,
    storeError.message,
    storeError.recovery,
    storeError.status,
  );
}

export function privateJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
