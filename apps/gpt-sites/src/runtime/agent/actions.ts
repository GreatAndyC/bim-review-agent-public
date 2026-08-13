import type {
  AgentAction,
  DelegateAction,
  DelegationTask,
  FinalAction,
  JsonObject,
  ToolCallAction,
} from "../../contracts/agent";

const MAX_ACTION_TEXT = 4_000;
const MAX_PURPOSE_TEXT = 500;
const MAX_ACTION_DATA_BYTES = 32 * 1024;

export class AgentActionValidationError extends Error {
  constructor(message = "The provider action does not match the declared contract.") {
    super(message);
    this.name = "AgentActionValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function boundedString(
  value: unknown,
  maximum: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.trim().length > 0) &&
    value.length <= maximum
  );
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : isRecord(value) &&
      Object.entries(value).every(
        ([key, item]) => key !== "__proto__" && isJsonValue(item, seen),
      );
  seen.delete(value);
  return valid;
}

function jsonObject(value: unknown): JsonObject | null {
  if (!isRecord(value) || !isJsonValue(value)) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_ACTION_DATA_BYTES) {
      return null;
    }
  } catch {
    return null;
  }
  return value as JsonObject;
}

function parseToolCall(value: Record<string, unknown>): ToolCallAction {
  if (
    !exactKeys(value, ["type", "tool_name", "purpose"], ["arguments"]) ||
    !boundedString(value.tool_name, 100) ||
    !boundedString(value.purpose, MAX_PURPOSE_TEXT)
  ) {
    throw new AgentActionValidationError();
  }
  const args = value.arguments === undefined ? {} : jsonObject(value.arguments);
  if (!args) throw new AgentActionValidationError();
  return {
    type: "tool_call",
    tool_name: value.tool_name,
    arguments: args,
    purpose: value.purpose,
  };
}

function parseDelegationTask(value: unknown): DelegationTask {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["task_id", "specialist_id", "objective"], ["input"]) ||
    !boundedString(value.task_id, 100) ||
    !boundedString(value.specialist_id, 100) ||
    !boundedString(value.objective, MAX_ACTION_TEXT)
  ) {
    throw new AgentActionValidationError();
  }
  const input = value.input === undefined ? {} : jsonObject(value.input);
  if (!input) throw new AgentActionValidationError();
  return {
    task_id: value.task_id,
    specialist_id: value.specialist_id,
    objective: value.objective,
    input,
  };
}

function parseDelegate(value: Record<string, unknown>): DelegateAction {
  if (
    !exactKeys(value, ["type", "tasks", "purpose"]) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length < 1 ||
    value.tasks.length > 8 ||
    !boundedString(value.purpose, MAX_PURPOSE_TEXT)
  ) {
    throw new AgentActionValidationError();
  }
  const tasks = value.tasks.map(parseDelegationTask);
  if (new Set(tasks.map((task) => task.task_id)).size !== tasks.length) {
    throw new AgentActionValidationError();
  }
  return { type: "delegate", tasks, purpose: value.purpose };
}

function parseFinal(value: Record<string, unknown>): FinalAction {
  if (
    !exactKeys(
      value,
      ["type", "message"],
      ["data", "linked_review_run_id"],
    ) ||
    !boundedString(value.message, MAX_ACTION_TEXT)
  ) {
    throw new AgentActionValidationError();
  }
  const data = value.data === undefined ? {} : jsonObject(value.data);
  const linkedReviewRunId = value.linked_review_run_id ?? null;
  if (
    !data ||
    (linkedReviewRunId !== null && !boundedString(linkedReviewRunId, 200))
  ) {
    throw new AgentActionValidationError();
  }
  return {
    type: "final",
    message: value.message,
    data,
    linked_review_run_id: linkedReviewRunId,
  };
}

export function parseAgentAction(value: unknown): AgentAction {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new AgentActionValidationError();
  }
  if (value.type === "tool_call") return parseToolCall(value);
  if (value.type === "delegate") return parseDelegate(value);
  if (value.type === "final") return parseFinal(value);
  throw new AgentActionValidationError();
}

export function requireJsonObject(value: unknown): JsonObject {
  const parsed = jsonObject(value);
  if (!parsed) throw new AgentActionValidationError("Expected a bounded JSON object.");
  return parsed;
}
