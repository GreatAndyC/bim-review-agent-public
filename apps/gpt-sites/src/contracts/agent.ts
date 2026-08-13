import type { JsonValue, ReviewRun } from "./review";

export type JsonObject = { [key: string]: JsonValue };

export type AgentRunState =
  | "CREATED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "BUDGET_EXHAUSTED"
  | "CANCELLED";

export type AgentStopReason =
  | "FINAL_OUTPUT"
  | "STEP_BUDGET_EXHAUSTED"
  | "TOOL_BUDGET_EXHAUSTED"
  | "PROVIDER_ERROR"
  | "INVALID_PROVIDER_ACTION"
  | "TOOL_NOT_ALLOWED"
  | "TOOL_NOT_FOUND"
  | "TOOL_INPUT_INVALID"
  | "TOOL_OUTPUT_INVALID"
  | "TOOL_EXECUTION_FAILED"
  | "DELEGATION_BUDGET_EXHAUSTED"
  | "DELEGATION_UNAVAILABLE"
  | "SPECIALIST_NOT_ALLOWED"
  | "SPECIALIST_NOT_FOUND"
  | "SPECIALIST_EXECUTION_FAILED"
  | "INVALID_SPECIALIST_RESULT";

export type AgentEventType =
  | "run.started"
  | "session.selected"
  | "memory.recalled"
  | "episode.recalled"
  | "provider.selected"
  | "connector.selected"
  | "tool.discovered"
  | "provider.requested"
  | "tool.requested"
  | "tool.completed"
  | "tool.failed"
  | "agent.delegated"
  | "agent.completed"
  | "agent.failed"
  | "run.completed"
  | "run.failed"
  | "run.budget_exhausted";

export type ToolEffect =
  | "PURE_READ"
  | "DETERMINISTIC_COMPUTE"
  | "LOCAL_STATE_WRITE"
  | "EXTERNAL_READ"
  | "EXTERNAL_WRITE";

export type ToolDescriptor = {
  name: string;
  version: string;
  description: string;
  effect: ToolEffect;
  input_schema: JsonObject;
  output_schema: JsonObject;
};

export type AgentDefinition = {
  agent_id: string;
  name: string;
  version: string;
  instructions: string;
  allowed_tools: readonly string[];
  allowed_specialists: readonly string[];
  max_steps: number;
  max_tool_calls: number;
  max_delegations: number;
  max_parallel_children: number;
};

export type ToolObservation = {
  call_id: string;
  tool_name: string;
  output: JsonObject;
};

export type SpecialistResult = {
  task_id: string;
  specialist_id: string;
  child_run_id: string;
  state: AgentRunState;
  stop_reason: AgentStopReason;
  message: string | null;
  data: JsonObject;
  linked_review_run_id: string | null;
};

export type ProviderRequest = {
  run_id: string;
  objective: string;
  step: number;
  agent: AgentDefinition;
  tools: readonly ToolDescriptor[];
  observations: readonly ToolObservation[];
  specialist_results: readonly SpecialistResult[];
};

export type ToolCallAction = {
  type: "tool_call";
  tool_name: string;
  arguments: JsonObject;
  purpose: string;
};

export type DelegationTask = {
  task_id: string;
  specialist_id: string;
  objective: string;
  input: JsonObject;
};

export type DelegateAction = {
  type: "delegate";
  tasks: DelegationTask[];
  purpose: string;
};

export type FinalAction = {
  type: "final";
  message: string;
  data: JsonObject;
  linked_review_run_id: string | null;
};

export type AgentAction = ToolCallAction | DelegateAction | FinalAction;

export type AgentEvent = {
  event_id: string;
  sequence: number;
  occurred_at: string;
  type: AgentEventType;
  actor: string;
  summary: string;
  data: JsonObject;
};

export type AgentFinalResponse = {
  message: string;
  data: JsonObject;
};

export type AgentRun = {
  run_id: string;
  objective: string;
  agent_id: string;
  agent_version: string;
  provider_id: string;
  model_id: string;
  connector_ids: string[];
  session_id: string | null;
  episode_id: string | null;
  state: AgentRunState;
  stop_reason: AgentStopReason;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  step_count: number;
  tool_call_count: number;
  max_steps: number;
  max_tool_calls: number;
  delegation_count: number;
  max_delegations: number;
  max_parallel_children: number;
  delegated_run_ids: string[];
  events: AgentEvent[];
  memory_read_ids: string[];
  episode_read_ids: string[];
  final_response: AgentFinalResponse | null;
  linked_review_run_id: string | null;
};

export type AgentReviewResult = {
  agent_run: AgentRun;
  review_run: ReviewRun | null;
};
