import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root: appRoot,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
});

try {
  const { runAgent } = await server.ssrLoadModule(
    "/src/runtime/agent/kernel.ts",
  );
  const { ToolRegistry } = await server.ssrLoadModule(
    "/src/runtime/agent/registry.ts",
  );

  function definition(overrides = {}) {
    return {
      agent_id: "kernel-contract-test",
      name: "Kernel contract test",
      version: "1.0",
      instructions: "Use schema-valid observations and stop within budget.",
      allowed_tools: ["count_items"],
      allowed_specialists: [],
      max_steps: 4,
      max_tool_calls: 3,
      max_delegations: 0,
      max_parallel_children: 1,
      ...overrides,
    };
  }

  function countRegistry({ invalidOutput = false, canonical = false } = {}) {
    const registry = new ToolRegistry();
    registry.register({
      descriptor: {
        name: "count_items",
        version: "1.0",
        description: "Return a bounded count.",
        effect: "PURE_READ",
        input_schema: {
          type: "object",
          additionalProperties: false,
        },
        output_schema: {
          type: "object",
          additionalProperties: false,
          required: canonical ? ["count", "review_run_id"] : ["count"],
        },
      },
      validate_input(value) {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).length !== 0
        ) {
          throw new Error("invalid input");
        }
        return {};
      },
      validate_output(value) {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          !Number.isSafeInteger(value.count)
        ) {
          throw new Error("invalid output");
        }
        if (
          canonical &&
          (typeof value.review_run_id !== "string" || !value.review_run_id)
        ) {
          throw new Error("invalid canonical output");
        }
        return canonical
          ? { count: value.count, review_run_id: value.review_run_id }
          : { count: value.count };
      },
      handler(_input, context) {
        if (invalidOutput) return { wrong: "shape" };
        return canonical
          ? { count: context.count, review_run_id: "review-1" }
          : { count: context.count };
      },
      ...(canonical
        ? { canonical_review_output_key: "review_run_id" }
        : {}),
    });
    return registry;
  }

  async function execute({
    provider,
    agent = definition(),
    registry = countRegistry(),
  }) {
    return runAgent({
      definition: agent,
      objective: "Exercise the bounded kernel.",
      provider: {
        provider_id: "test-provider",
        model_id: "test-model-v1",
        nextAction: provider,
      },
      registry,
      tool_context: { count: 3 },
      connector_ids: ["test-connector"],
    });
  }

  const seenObservationCounts = [];
  const completed = await execute({
    provider(request) {
      seenObservationCounts.push(request.observations.length);
      if (request.observations.length === 0) {
        return {
          type: "tool_call",
          tool_name: "count_items",
          arguments: {},
          purpose: "Observe the typed count.",
        };
      }
      return {
        type: "final",
        message: "Used the schema-valid observation.",
        data: { count: request.observations[0].output.count },
        linked_review_run_id: null,
      };
    },
  });
  assert.deepEqual(seenObservationCounts, [0, 1]);
  assert.equal(completed.state, "COMPLETED");
  assert.equal(completed.stop_reason, "FINAL_OUTPUT");
  assert.equal(completed.step_count, 2);
  assert.equal(completed.tool_call_count, 1);
  assert.deepEqual(completed.final_response.data, { count: 3 });

  const disallowed = await execute({
    agent: definition({ allowed_tools: [] }),
    provider: () => ({
      type: "tool_call",
      tool_name: "count_items",
      arguments: {},
      purpose: "Request a blocked tool.",
    }),
  });
  assert.equal(disallowed.stop_reason, "TOOL_NOT_ALLOWED");
  assert.equal(disallowed.tool_call_count, 0);

  const invalidInput = await execute({
    provider: () => ({
      type: "tool_call",
      tool_name: "count_items",
      arguments: { unexpected: true },
      purpose: "Exercise input validation.",
    }),
  });
  assert.equal(invalidInput.stop_reason, "TOOL_INPUT_INVALID");
  assert.equal(invalidInput.events.at(-2).type, "tool.failed");

  const invalidOutput = await execute({
    registry: countRegistry({ invalidOutput: true }),
    provider: () => ({
      type: "tool_call",
      tool_name: "count_items",
      arguments: {},
      purpose: "Exercise output validation.",
    }),
  });
  assert.equal(invalidOutput.stop_reason, "TOOL_OUTPUT_INVALID");
  assert.equal(
    invalidOutput.events.some((event) => event.type === "tool.completed"),
    false,
  );

  const repeated = await execute({
    agent: definition({ max_steps: 2 }),
    provider: () => ({
      type: "tool_call",
      tool_name: "count_items",
      arguments: {},
      purpose: "Repeat until the step budget stops the run.",
    }),
  });
  assert.equal(repeated.state, "BUDGET_EXHAUSTED");
  assert.equal(repeated.stop_reason, "STEP_BUDGET_EXHAUSTED");
  assert.equal(repeated.tool_call_count, 2);

  const toolBudget = await execute({
    agent: definition({ max_tool_calls: 0 }),
    provider: () => ({
      type: "tool_call",
      tool_name: "count_items",
      arguments: {},
      purpose: "Request work beyond the zero-call budget.",
    }),
  });
  assert.equal(toolBudget.stop_reason, "TOOL_BUDGET_EXHAUSTED");
  assert.equal(toolBudget.tool_call_count, 0);

  const providerFailure = await execute({
    provider: () => {
      throw new Error("private provider detail");
    },
  });
  assert.equal(providerFailure.stop_reason, "PROVIDER_ERROR");
  assert.doesNotMatch(JSON.stringify(providerFailure), /private provider detail/);

  const malformedAction = await execute({
    provider: () => ({
      type: "final",
      message: "Looks valid but contains an undeclared property.",
      data: {},
      linked_review_run_id: null,
      hidden: true,
    }),
  });
  assert.equal(malformedAction.stop_reason, "INVALID_PROVIDER_ACTION");

  const forgedLink = await execute({
    provider: () => ({
      type: "final",
      message: "Attempt to forge a canonical link.",
      data: {},
      linked_review_run_id: "invented-review",
    }),
  });
  assert.equal(forgedLink.stop_reason, "INVALID_PROVIDER_ACTION");

  const canonical = await execute({
    registry: countRegistry({ canonical: true }),
    provider(request) {
      if (request.observations.length === 0) {
        return {
          type: "tool_call",
          tool_name: "count_items",
          arguments: {},
          purpose: "Create one canonical result.",
        };
      }
      return {
        type: "final",
        message: "Reference only the tool-created result.",
        data: {},
        linked_review_run_id:
          request.observations[0].output.review_run_id,
      };
    },
  });
  assert.equal(canonical.state, "COMPLETED");
  assert.equal(canonical.linked_review_run_id, "review-1");

  const delegation = await execute({
    provider: () => ({
      type: "delegate",
      purpose: "Attempt delegation in the single-Agent profile.",
      tasks: [
        {
          task_id: "task-1",
          specialist_id: "unknown-specialist",
          objective: "Do unconfigured work.",
          input: {},
        },
      ],
    }),
  });
  assert.equal(delegation.stop_reason, "DELEGATION_BUDGET_EXHAUSTED");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        trajectories: 11,
        checks: [
          "observation-dependent action",
          "tool allowlist",
          "input/output schemas",
          "step/tool budgets",
          "provider sanitization",
          "strict action contract",
          "canonical-link authorization",
          "delegation budget",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
