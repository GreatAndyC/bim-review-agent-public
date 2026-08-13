import type {
  AgentAction,
  AgentDefinition,
  AgentEvent,
  AgentEventType,
  AgentRun,
  AgentRunState,
  AgentStopReason,
  DelegateAction,
  DelegationTask,
  FinalAction,
  JsonObject,
  ProviderRequest,
  SpecialistResult,
  ToolObservation,
} from "../../contracts/agent";
import { parseAgentAction, requireJsonObject } from "./actions";
import { ToolDispatchError, ToolRegistry } from "./registry";

export type ModelProvider = {
  provider_id: string;
  model_id: string;
  nextAction(request: ProviderRequest): unknown | Promise<unknown>;
};

export type AgentScheduler<Context> = {
  contains(specialistId: string): boolean;
  delegate(input: {
    parent_run_id: string;
    tasks: readonly DelegationTask[];
    parent_context: Context;
  }): unknown | Promise<unknown>;
};

export type RunAgentOptions<Context> = {
  definition: AgentDefinition;
  objective: string;
  provider: ModelProvider;
  registry: ToolRegistry<Context>;
  tool_context: Context;
  connector_ids?: readonly string[];
  scheduler?: AgentScheduler<Context>;
};

const RUN_STATES = new Set<AgentRunState>([
  "CREATED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "BUDGET_EXHAUSTED",
  "CANCELLED",
]);

const STOP_REASONS = new Set<AgentStopReason>([
  "FINAL_OUTPUT",
  "STEP_BUDGET_EXHAUSTED",
  "TOOL_BUDGET_EXHAUSTED",
  "PROVIDER_ERROR",
  "INVALID_PROVIDER_ACTION",
  "TOOL_NOT_ALLOWED",
  "TOOL_NOT_FOUND",
  "TOOL_INPUT_INVALID",
  "TOOL_OUTPUT_INVALID",
  "TOOL_EXECUTION_FAILED",
  "DELEGATION_BUDGET_EXHAUSTED",
  "DELEGATION_UNAVAILABLE",
  "SPECIALIST_NOT_ALLOWED",
  "SPECIALIST_NOT_FOUND",
  "SPECIALIST_EXECUTION_FAILED",
  "INVALID_SPECIALIST_RESULT",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

function validText(value: unknown, maximum = 4_000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function validateSpecialistResult(value: unknown): SpecialistResult {
  const item = record(value);
  if (
    !item ||
    !exactKeys(
      item,
      [
        "task_id",
        "specialist_id",
        "child_run_id",
        "state",
        "stop_reason",
      ],
      ["message", "data", "linked_review_run_id"],
    ) ||
    !validText(item.task_id, 100) ||
    !validText(item.specialist_id, 100) ||
    !validText(item.child_run_id, 200) ||
    typeof item.state !== "string" ||
    !RUN_STATES.has(item.state as AgentRunState) ||
    typeof item.stop_reason !== "string" ||
    !STOP_REASONS.has(item.stop_reason as AgentStopReason)
  ) {
    throw new Error("Invalid specialist result.");
  }
  const message = item.message ?? null;
  const linkedReviewRunId = item.linked_review_run_id ?? null;
  if (
    (message !== null && typeof message !== "string") ||
    (linkedReviewRunId !== null && !validText(linkedReviewRunId, 200))
  ) {
    throw new Error("Invalid specialist result.");
  }
  return {
    task_id: item.task_id,
    specialist_id: item.specialist_id,
    child_run_id: item.child_run_id,
    state: item.state as AgentRunState,
    stop_reason: item.stop_reason as AgentStopReason,
    message,
    data: item.data === undefined ? {} : requireJsonObject(item.data),
    linked_review_run_id: linkedReviewRunId,
  };
}

function validateSpecialistResults(value: unknown): SpecialistResult[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new Error("Invalid specialist result set.");
  }
  return value.map(validateSpecialistResult);
}

function assertDefinition(definition: AgentDefinition): void {
  if (
    !validText(definition.agent_id, 100) ||
    !validText(definition.version, 100) ||
    !Number.isSafeInteger(definition.max_steps) ||
    definition.max_steps < 1 ||
    definition.max_steps > 100 ||
    !Number.isSafeInteger(definition.max_tool_calls) ||
    definition.max_tool_calls < 0 ||
    definition.max_tool_calls > 100 ||
    !Number.isSafeInteger(definition.max_delegations) ||
    definition.max_delegations < 0 ||
    definition.max_delegations > 20 ||
    !Number.isSafeInteger(definition.max_parallel_children) ||
    definition.max_parallel_children < 1 ||
    definition.max_parallel_children > 8
  ) {
    throw new Error("Agent definition violates the runtime budget contract.");
  }
}

export async function runAgent<Context>({
  definition,
  objective,
  provider,
  registry,
  tool_context: toolContext,
  connector_ids: connectorIds = [],
  scheduler,
}: RunAgentOptions<Context>): Promise<AgentRun> {
  assertDefinition(definition);
  const runId = crypto.randomUUID();
  const startedAt = new Date();
  const startedClock = performance.now();
  const events: AgentEvent[] = [];
  const observations: ToolObservation[] = [];
  const specialistResults: SpecialistResult[] = [];
  const canonicalReviewRunIds = new Set<string>();
  let toolCallCount = 0;
  let delegationCount = 0;
  const catalogue = registry.catalogue(definition.allowed_tools);

  const addEvent = (
    type: AgentEventType,
    actor: string,
    summary: string,
    data: JsonObject = {},
  ) => {
    events.push({
      event_id: crypto.randomUUID(),
      sequence: events.length + 1,
      occurred_at: new Date().toISOString(),
      type,
      actor,
      summary,
      data,
    });
  };

  const finish = (
    state: AgentRunState,
    stopReason: AgentStopReason,
    stepCount: number,
    finalAction: FinalAction | null = null,
  ): AgentRun => {
    const completedAt = new Date();
    return {
      run_id: runId,
      objective,
      agent_id: definition.agent_id,
      agent_version: definition.version,
      provider_id: provider.provider_id,
      model_id: provider.model_id,
      connector_ids: [...connectorIds],
      session_id: null,
      episode_id: null,
      state,
      stop_reason: stopReason,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: Math.max(0, Math.round(performance.now() - startedClock)),
      step_count: stepCount,
      tool_call_count: toolCallCount,
      max_steps: definition.max_steps,
      max_tool_calls: definition.max_tool_calls,
      delegation_count: delegationCount,
      max_delegations: definition.max_delegations,
      max_parallel_children: definition.max_parallel_children,
      delegated_run_ids: specialistResults.map((result) => result.child_run_id),
      events,
      memory_read_ids: [],
      episode_read_ids: [],
      final_response: finalAction
        ? { message: finalAction.message, data: finalAction.data }
        : null,
      linked_review_run_id: finalAction?.linked_review_run_id ?? null,
    };
  };

  const fail = (
    reason: AgentStopReason,
    message: string,
    stepCount: number,
  ): AgentRun => {
    addEvent("run.failed", "agent-kernel", message, { reason });
    return finish("FAILED", reason, stepCount);
  };

  const budgetExhausted = (
    reason: AgentStopReason,
    message: string,
    stepCount: number,
  ): AgentRun => {
    addEvent("run.budget_exhausted", "agent-kernel", message, { reason });
    return finish("BUDGET_EXHAUSTED", reason, stepCount);
  };

  addEvent(
    "run.started",
    definition.agent_id,
    "Agent run started with explicit step, tool-call, and delegation budgets.",
    {
      max_steps: definition.max_steps,
      max_tool_calls: definition.max_tool_calls,
      max_delegations: definition.max_delegations,
    },
  );
  addEvent(
    "provider.selected",
    "agent-kernel",
    `Selected provider ${provider.provider_id} and model ${provider.model_id}.`,
    { provider_id: provider.provider_id, model_id: provider.model_id },
  );
  if (connectorIds.length > 0) {
    addEvent(
      "connector.selected",
      "agent-kernel",
      `Selected ${connectorIds.length} policy-approved connector source.`,
      { connector_ids: [...connectorIds] },
    );
  }
  addEvent(
    "tool.discovered",
    "agent-kernel",
    `Exposed ${catalogue.length} healthy, policy-approved tools to the Agent.`,
    { tools: catalogue.map((tool) => tool.name) },
  );

  for (let stepCount = 1; stepCount <= definition.max_steps; stepCount += 1) {
    addEvent(
      "provider.requested",
      definition.agent_id,
      `Requested one structured action for step ${stepCount}.`,
      { step: stepCount, observation_count: observations.length },
    );
    const request: ProviderRequest = {
      run_id: runId,
      objective,
      step: stepCount,
      agent: definition,
      tools: catalogue,
      observations,
      specialist_results: specialistResults,
    };

    let rawAction: unknown;
    try {
      rawAction = await provider.nextAction(request);
    } catch {
      return fail(
        "PROVIDER_ERROR",
        "The selected model provider could not return an action.",
        stepCount,
      );
    }
    let action: AgentAction;
    try {
      action = parseAgentAction(rawAction);
    } catch {
      return fail(
        "INVALID_PROVIDER_ACTION",
        "The model provider returned an action outside the declared contract.",
        stepCount,
      );
    }

    if (action.type === "final") {
      const linkedId = action.linked_review_run_id;
      const linkIsValid =
        (canonicalReviewRunIds.size === 0 && linkedId === null) ||
        (canonicalReviewRunIds.size === 1 &&
          linkedId !== null &&
          canonicalReviewRunIds.has(linkedId));
      if (!linkIsValid) {
        return fail(
          "INVALID_PROVIDER_ACTION",
          "The provider final response did not reference exactly the canonical ReviewRun created by an approved tool.",
          stepCount,
        );
      }
      addEvent(
        "run.completed",
        definition.agent_id,
        "Agent returned a contract-valid final response.",
        { reason: "FINAL_OUTPUT" },
      );
      return finish("COMPLETED", "FINAL_OUTPUT", stepCount, action);
    }

    if (action.type === "delegate") {
      const delegated = await handleDelegation({
        action,
        definition,
        scheduler,
        toolContext,
        runId,
        specialistResults,
        addEvent,
      });
      if (delegated.kind === "budget") {
        return budgetExhausted(
          "DELEGATION_BUDGET_EXHAUSTED",
          delegated.message,
          stepCount,
        );
      }
      if (delegated.kind === "failure") {
        return fail(delegated.reason, delegated.message, stepCount);
      }
      delegationCount += delegated.count;
      continue;
    }

    if (toolCallCount >= definition.max_tool_calls) {
      return budgetExhausted(
        "TOOL_BUDGET_EXHAUSTED",
        "Agent stopped before exceeding its tool-call budget.",
        stepCount,
      );
    }
    if (!definition.allowed_tools.includes(action.tool_name)) {
      return fail(
        "TOOL_NOT_ALLOWED",
        `Agent policy does not allow tool ${action.tool_name}.`,
        stepCount,
      );
    }
    if (!registry.contains(action.tool_name)) {
      return fail(
        "TOOL_NOT_FOUND",
        `Requested tool is not registered: ${action.tool_name}`,
        stepCount,
      );
    }
    if (
      canonicalReviewRunIds.size > 0 &&
      registry.isCanonicalReviewTool(action.tool_name)
    ) {
      return fail(
        "INVALID_PROVIDER_ACTION",
        "Agent policy permits at most one canonical deterministic review per run.",
        stepCount,
      );
    }

    const callId = crypto.randomUUID();
    toolCallCount += 1;
    addEvent("tool.requested", definition.agent_id, action.purpose, {
      call_id: callId,
      tool_name: action.tool_name,
    });
    try {
      const execution = await registry.execute(
        action.tool_name,
        action.arguments,
        toolContext,
      );
      if (execution.canonical_review_run_id) {
        canonicalReviewRunIds.add(execution.canonical_review_run_id);
      }
      observations.push({
        call_id: callId,
        tool_name: action.tool_name,
        output: execution.output,
      });
      addEvent(
        "tool.completed",
        action.tool_name,
        `Tool ${action.tool_name} returned a schema-valid observation.`,
        {
          call_id: callId,
          tool_name: action.tool_name,
          observation: execution.public_output,
        },
      );
    } catch (error) {
      const dispatchError =
        error instanceof ToolDispatchError
          ? error
          : new ToolDispatchError(
              "TOOL_EXECUTION_FAILED",
              `Tool ${action.tool_name} failed during execution.`,
            );
      addEvent("tool.failed", action.tool_name, dispatchError.message, {
        call_id: callId,
        tool_name: action.tool_name,
        reason: dispatchError.reason,
      });
      return fail(dispatchError.reason, dispatchError.message, stepCount);
    }
  }

  return budgetExhausted(
    "STEP_BUDGET_EXHAUSTED",
    "Agent stopped after reaching its step budget.",
    definition.max_steps,
  );
}

type DelegationOutcome =
  | { kind: "success"; count: number }
  | { kind: "budget"; message: string }
  | { kind: "failure"; reason: AgentStopReason; message: string };

async function handleDelegation<Context>({
  action,
  definition,
  scheduler,
  toolContext,
  runId,
  specialistResults,
  addEvent,
}: {
  action: DelegateAction;
  definition: AgentDefinition;
  scheduler: AgentScheduler<Context> | undefined;
  toolContext: Context;
  runId: string;
  specialistResults: SpecialistResult[];
  addEvent: (
    type: AgentEventType,
    actor: string,
    summary: string,
    data?: JsonObject,
  ) => void;
}): Promise<DelegationOutcome> {
  if (action.tasks.length > definition.max_parallel_children) {
    return {
      kind: "budget",
      message: "Delegation request exceeds the Agent's parallel-child limit.",
    };
  }
  if (specialistResults.length + action.tasks.length > definition.max_delegations) {
    return {
      kind: "budget",
      message: "Delegation request exceeds the Agent's total specialist budget.",
    };
  }
  if (!scheduler) {
    return {
      kind: "failure",
      reason: "DELEGATION_UNAVAILABLE",
      message: "This Agent run has no configured specialist scheduler.",
    };
  }
  for (const task of action.tasks) {
    if (!definition.allowed_specialists.includes(task.specialist_id)) {
      return {
        kind: "failure",
        reason: "SPECIALIST_NOT_ALLOWED",
        message: `Agent policy does not allow specialist ${task.specialist_id}.`,
      };
    }
    if (!scheduler.contains(task.specialist_id)) {
      return {
        kind: "failure",
        reason: "SPECIALIST_NOT_FOUND",
        message: `Requested specialist is not registered: ${task.specialist_id}`,
      };
    }
  }

  addEvent("agent.delegated", definition.agent_id, action.purpose, {
    tasks: action.tasks.map((task) => ({
      task_id: task.task_id,
      specialist_id: task.specialist_id,
    })),
    parallel_limit: definition.max_parallel_children,
  });

  let results: SpecialistResult[];
  try {
    results = validateSpecialistResults(
      await scheduler.delegate({
        parent_run_id: runId,
        tasks: action.tasks,
        parent_context: toolContext,
      }),
    );
  } catch {
    return {
      kind: "failure",
      reason: "SPECIALIST_EXECUTION_FAILED",
      message: "The specialist scheduler could not complete the delegated tasks.",
    };
  }

  const expected = new Map(
    action.tasks.map((task) => [task.task_id, task.specialist_id]),
  );
  if (
    results.length !== action.tasks.length ||
    results.some(
      (result) => expected.get(result.task_id) !== result.specialist_id,
    ) ||
    new Set(results.map((result) => result.task_id)).size !== results.length
  ) {
    return {
      kind: "failure",
      reason: "INVALID_SPECIALIST_RESULT",
      message: "The specialist scheduler returned an incomplete or mismatched result set.",
    };
  }

  for (const result of results) {
    specialistResults.push(result);
    const completed = result.state === "COMPLETED";
    addEvent(
      completed ? "agent.completed" : "agent.failed",
      result.specialist_id,
      completed
        ? `Specialist ${result.specialist_id} completed its bounded task.`
        : `Specialist ${result.specialist_id} ended without success.`,
      {
        task_id: result.task_id,
        specialist_id: result.specialist_id,
        child_run_id: result.child_run_id,
        state: result.state,
        stop_reason: result.stop_reason,
        linked_review_run_id: result.linked_review_run_id,
      },
    );
  }
  return { kind: "success", count: results.length };
}
