import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const baseUrl = (process.env.BIM_REVIEW_SITE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const contractRoot = new URL("../../../contracts/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", contractRoot), "utf8"),
);
const anonymousSession = `agent-smoke-${process.pid}-${Date.now()}`;

function siteFetch(input, init = {}) {
  const headers = new Headers(init.headers);
  if ((init.method ?? "GET").toUpperCase() === "POST") {
    headers.set("x-bim-review-session", anonymousSession);
  }
  return fetch(input, { ...init, headers });
}
const AGENT_RUN_KEYS = [
  "agent_id",
  "agent_version",
  "completed_at",
  "connector_ids",
  "delegated_run_ids",
  "delegation_count",
  "duration_ms",
  "episode_id",
  "episode_read_ids",
  "events",
  "final_response",
  "linked_review_run_id",
  "max_delegations",
  "max_parallel_children",
  "max_steps",
  "max_tool_calls",
  "memory_read_ids",
  "model_id",
  "objective",
  "provider_id",
  "run_id",
  "session_id",
  "started_at",
  "state",
  "step_count",
  "stop_reason",
  "tool_call_count",
].sort();

function deterministicPayload(run) {
  return {
    source: run.source,
    rule_pack_id: run.rule_pack_id,
    rule_pack_version: run.rule_pack_version,
    inventory: run.inventory,
    trace: run.trace,
    findings: run.findings,
    summary: run.summary,
  };
}

async function json(response, expectedStatus) {
  const body = await response.json();
  assert.equal(
    response.status,
    expectedStatus,
    `${response.url} returned ${response.status}: ${JSON.stringify(body)}`,
  );
  return body;
}

const capabilities = await json(await siteFetch(`${baseUrl}/api/capabilities`), 200);
assert.equal(capabilities.profile.local_hardware_discovery, false);
assert.equal(capabilities.providers.length, 1);
assert.equal(capabilities.providers[0].id, "scripted");
assert.equal(capabilities.providers[0].external_inference, false);
assert.deepEqual(
  capabilities.tools.map((tool) => tool.name).sort(),
  [
    "critique_review_evidence",
    "inspect_ifc_model",
    "run_deterministic_review",
  ],
);

let retainedCandidate;

for (const sample of manifest.samples) {
  const result = await json(
    await siteFetch(`${baseUrl}/api/agent-runs/sample/${sample.id}`, {
      method: "POST",
    }),
    201,
  );
  const agent = result.agent_run;
  const review = result.review_run;
  assert.match(result.access.access_token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.access.agent_run_id, agent.run_id);
  assert.equal(result.access.review_run_id, review.run_id);
  assert.equal(result.access.retrieval.review_json.endsWith(".json"), true);
  assert.equal(result.access.retrieval.quick_check_json.endsWith(".quick-check.json"), true);
  assert.equal(result.access.retrieval.quick_check_markdown.endsWith(".quick-check.md"), true);
  assert.deepEqual(Object.keys(agent).sort(), AGENT_RUN_KEYS);
  assert.equal(agent.state, "COMPLETED");
  assert.equal(agent.stop_reason, "FINAL_OUTPUT");
  assert.equal(agent.provider_id, "scripted");
  assert.equal(agent.model_id, "deterministic-site-script-v1");
  assert.equal(agent.step_count, 4);
  assert.equal(agent.tool_call_count, 3);
  assert.equal(agent.linked_review_run_id, review.run_id);
  assert.deepEqual(
    agent.events.map((event) => event.sequence),
    agent.events.map((_event, index) => index + 1),
  );
  assert.deepEqual(
    agent.events
      .filter((event) => event.type === "tool.completed")
      .map((event) => event.data.tool_name),
    [
      "inspect_ifc_model",
      "run_deterministic_review",
      "critique_review_evidence",
    ],
  );
  const publicTrace = JSON.stringify(agent.events);
  assert.doesNotMatch(publicTrace, /ISO-10303-21/);
  assert.doesNotMatch(publicTrace, /filename/i);
  assert.doesNotMatch(publicTrace, /"sha256"/i);

  const golden = JSON.parse(
    await readFile(new URL(sample.golden_path, contractRoot), "utf8"),
  );
  assert.deepEqual(deterministicPayload(review), golden);
  assert.deepEqual(agent.final_response.data.summary, review.summary);
  if (sample.id === "mixed_review") retainedCandidate = result;
  else retainedCandidate ??= result;
}

assert.ok(retainedCandidate);
const retainedHeaders = {
  authorization: `Bearer ${retainedCandidate.access.access_token}`,
};
const retainedAgentResponse = await siteFetch(
  `${baseUrl}${retainedCandidate.access.retrieval.agent}`,
  { headers: retainedHeaders },
);
const retainedAgent = await json(retainedAgentResponse, 200);
assert.equal(retainedAgentResponse.headers.get("cache-control"), "private, no-store");
assert.deepEqual(retainedAgent.agent_run, retainedCandidate.agent_run);
assert.doesNotMatch(JSON.stringify(retainedAgent), /access_token/);

const retainedReviewResponse = await siteFetch(
  `${baseUrl}${retainedCandidate.access.retrieval.review_json}`,
  { headers: retainedHeaders },
);
assert.equal(retainedReviewResponse.status, 200);
assert.match(
  retainedReviewResponse.headers.get("content-disposition") ?? "",
  /^attachment; filename="review-[0-9a-f-]+\.json"$/,
);
assert.deepEqual(await retainedReviewResponse.json(), retainedCandidate.review_run);

const quickCheckJsonResponse = await siteFetch(
  `${baseUrl}/api/reviews/${retainedCandidate.review_run.run_id}.quick-check.json?locale=zh-CN`,
  { headers: retainedHeaders },
);
assert.equal(quickCheckJsonResponse.status, 200);
assert.match(
  quickCheckJsonResponse.headers.get("content-disposition") ?? "",
  /^attachment; filename="quick-check-[0-9a-f-]+\.json"$/,
);
const quickCheckJsonBody = await quickCheckJsonResponse.json();
assert.equal(quickCheckJsonBody.format, "bim-review-quick-check/v1");
assert.equal(quickCheckJsonBody.locale, "zh-CN");
assert.equal(quickCheckJsonBody.summary.actionable, quickCheckJsonBody.checks.length);
assert.ok(quickCheckJsonBody.checks.every((check) => check.status !== "PASS"));
assert.doesNotMatch(JSON.stringify(quickCheckJsonBody), /tool\.completed/);

const quickCheckMarkdownResponse = await siteFetch(
  `${baseUrl}/api/reviews/${retainedCandidate.review_run.run_id}.quick-check.md?locale=en`,
  { headers: retainedHeaders },
);
assert.equal(quickCheckMarkdownResponse.status, 200);
assert.match(
  quickCheckMarkdownResponse.headers.get("content-disposition") ?? "",
  /^attachment; filename="quick-check-[0-9a-f-]+\.md"$/,
);
const quickCheckMarkdownBody = await quickCheckMarkdownResponse.text();
assert.match(quickCheckMarkdownBody, /# Review Quick Check/);
assert.match(quickCheckMarkdownBody, /Recommendation/);
assert.doesNotMatch(quickCheckMarkdownBody, /tool\.completed/);

const missingToken = await json(
  await siteFetch(`${baseUrl}${retainedCandidate.access.retrieval.agent}`),
  401,
);
assert.equal(missingToken.detail.code, "run_token_required");
const wrongToken = await json(
  await siteFetch(`${baseUrl}${retainedCandidate.access.retrieval.agent}`, {
    headers: {
      authorization:
        "Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
  }),
  404,
);
assert.equal(wrongToken.detail.code, "run_not_found");

const inventoryOnly = await json(
  await siteFetch(`${baseUrl}/api/agent-runs/sample/clean`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objective: "inventory only" }),
  }),
  201,
);
assert.equal(inventoryOnly.agent_run.state, "COMPLETED");
assert.equal(inventoryOnly.agent_run.tool_call_count, 1);
assert.equal(inventoryOnly.agent_run.final_response.data.mode, "inventory_only");
assert.equal(inventoryOnly.agent_run.linked_review_run_id, null);
assert.equal(inventoryOnly.review_run, null);

const unsupported = await json(
  await siteFetch(`${baseUrl}/api/agent-runs/sample/clean`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objective: "Operate a robot arm on site" }),
  }),
  201,
);
assert.equal(unsupported.agent_run.final_response.data.mode, "unsupported_scope");
assert.equal(unsupported.review_run, null);
const deleted = await json(
  await siteFetch(`${baseUrl}${unsupported.access.retrieval.delete}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${unsupported.access.access_token}`,
    },
  }),
  200,
);
assert.equal(deleted.deleted, true);
const afterDelete = await json(
  await siteFetch(`${baseUrl}${unsupported.access.retrieval.agent}`, {
    headers: {
      authorization: `Bearer ${unsupported.access.access_token}`,
    },
  }),
  404,
);
assert.equal(afterDelete.detail.code, "run_not_found");

const tooLong = await json(
  await siteFetch(`${baseUrl}/api/agent-runs/sample/clean`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objective: "x".repeat(501) }),
  }),
  422,
);
assert.equal(tooLong.detail.code, "objective_too_long");

const mixedBytes = await readFile(
  new URL(
    "../../../src/bim_review_agent/assets/samples/mixed_review.ifc",
    import.meta.url,
  ),
);
const form = new FormData();
form.append(
  "file",
  new Blob([mixedBytes], { type: "application/octet-stream" }),
  "folder/../mixed_review.ifc",
);
form.append("objective", "Review this IFC model using the enabled rules.");
const uploaded = await json(
  await siteFetch(`${baseUrl}/api/agent-runs`, { method: "POST", body: form }),
  201,
);
assert.equal(uploaded.agent_run.state, "COMPLETED");
assert.equal(uploaded.agent_run.linked_review_run_id, uploaded.review_run.run_id);
assert.equal(uploaded.review_run.source.filename, "mixed_review.ifc");

console.log(
  JSON.stringify(
    {
      status: "passed",
      baseUrl,
      sampleTrajectories: manifest.samples.map((sample) => sample.id),
      realUploadPath: true,
      inventoryOnlyPath: true,
      unsupportedScopePath: true,
      tokenAuthorizedRetention: true,
      jsonExport: true,
      quickCheckExport: true,
      earlyHardDelete: true,
      externalInferenceCalls: 0,
    },
    null,
    2,
  ),
);
