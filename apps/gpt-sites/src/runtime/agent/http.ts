import {
  AdmissionError,
  admissionErrorResponse,
} from "../admission";
import { publicErrorResponse } from "../http/responses";
import { reviewErrorResponse } from "../review/http";
import { runStoreErrorResponse } from "../store/http";
import { RunStoreError } from "../store/runs";
import { uploadRequestFromMultipart } from "../upload/validation";
import { DEFAULT_AGENT_OBJECTIVE } from "./provider";

export const MAX_OBJECTIVE_CHARS = 500;

export class AgentRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly recovery: string,
  ) {
    super(message);
    this.name = "AgentRequestError";
  }
}

function normalizeObjective(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_AGENT_OBJECTIVE;
  }
  if (typeof value !== "string") {
    throw new AgentRequestError(
      "invalid_objective",
      "The Agent objective must be plain text.",
      400,
      "Remove file or structured values from the objective field.",
    );
  }
  const normalized = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code > 31;
    })
    .join("")
    .trim();
  if (!normalized) return DEFAULT_AGENT_OBJECTIVE;
  if (normalized.length > MAX_OBJECTIVE_CHARS) {
    throw new AgentRequestError(
      "objective_too_long",
      `The Agent objective exceeds the ${MAX_OBJECTIVE_CHARS}-character limit.`,
      422,
      "Shorten the objective to the supported IFC review scope.",
    );
  }
  return normalized;
}

export async function agentUploadRequest(request: Request) {
  const parsed = await uploadRequestFromMultipart(request);
  const unexpected = Array.from(parsed.formData.keys()).filter(
    (key) => key !== "file" && key !== "objective",
  );
  if (unexpected.length > 0) {
    throw new AgentRequestError(
      "unexpected_form_field",
      "The Agent request contains an unsupported form field.",
      400,
      "Submit one file field and, optionally, one objective field.",
    );
  }
  const objectives = parsed.formData.getAll("objective");
  if (objectives.length > 1) {
    throw new AgentRequestError(
      "duplicate_objective",
      "The Agent request contains more than one objective.",
      400,
      "Submit at most one objective field.",
    );
  }
  return {
    upload: parsed.upload,
    objective: normalizeObjective(objectives[0]),
  };
}

export async function sampleAgentObjective(request: Request): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 2_048) {
    throw new AgentRequestError(
      "request_too_large",
      "The sample Agent request body is too large.",
      413,
      "Send only a bounded objective string.",
    );
  }
  const body = await request.text();
  if (!body.trim()) return DEFAULT_AGENT_OBJECTIVE;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLocaleLowerCase("en-US").includes("application/json")) {
    throw new AgentRequestError(
      "invalid_request_type",
      "Sample Agent requests must use an optional JSON body.",
      415,
      "Send application/json with an optional objective string.",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new AgentRequestError(
      "invalid_json",
      "The sample Agent request body is not valid JSON.",
      400,
      "Send an object such as {\"objective\": \"Review the IFC model\"}.",
    );
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AgentRequestError(
      "invalid_request",
      "The sample Agent request body must be a JSON object.",
      400,
      "Send an object with an optional objective field.",
    );
  }
  const item = raw as Record<string, unknown>;
  if (Object.keys(item).some((key) => key !== "objective")) {
    throw new AgentRequestError(
      "unexpected_json_field",
      "The sample Agent request contains an unsupported field.",
      400,
      "Send only the optional objective field.",
    );
  }
  return normalizeObjective(item.objective);
}

export function agentErrorResponse(error: unknown): Response {
  if (error instanceof AdmissionError) return admissionErrorResponse(error);
  if (error instanceof AgentRequestError) {
    return publicErrorResponse(
      error.code,
      error.message,
      error.recovery,
      error.status,
    );
  }
  if (error instanceof RunStoreError) return runStoreErrorResponse(error);
  return reviewErrorResponse(error);
}
