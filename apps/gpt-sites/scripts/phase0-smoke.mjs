import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const baseUrl = (process.env.BIM_REVIEW_SITE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const sampleUrl = process.env.BIM_REVIEW_IFC_SAMPLE
  ? new URL(`file://${process.env.BIM_REVIEW_IFC_SAMPLE}`)
  : new URL(
      "../../../src/bim_review_agent/assets/samples/clean.ifc",
      import.meta.url,
    );

async function readJson(response, expectedStatus) {
  const body = await response.json();
  assert.equal(
    response.status,
    expectedStatus,
    `${response.url} returned ${response.status}: ${JSON.stringify(body)}`,
  );
  return body;
}

function uploadBody(bytes, filename = "clean.ifc") {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/octet-stream" }), filename);
  return form;
}

const sampleBytes = await readFile(sampleUrl);
const smokeSessionSuffix = `${process.pid}-${Date.now()}`;

const health = await readJson(await fetch(`${baseUrl}/api/health`), 200);
assert.equal(health.status, "ok");
assert.equal(health.parser.status, "available");
assert.equal(health.externalBimBackend, false);
assert.equal(health.upload.enabled, true);
assert.equal(health.admission.uploadLimitPolicy, "no_session_count_limit");
assert.deepEqual(
  {
    windowSeconds: health.admission.windowSeconds,
    sampleLimit: health.admission.sampleLimit,
    sampleLimitPolicy: health.admission.sampleLimitPolicy,
    uploadLimit: health.admission.uploadLimit,
    activeReviewsPerSession: health.admission.activeReviewsPerSession,
  },
  {
    windowSeconds: null,
    sampleLimit: null,
    sampleLimitPolicy: "no_session_count_limit",
    uploadLimit: null,
    activeReviewsPerSession: 1,
  },
);

const upload = await readJson(
  await fetch(`${baseUrl}/api/probes/upload`, {
    method: "POST",
    body: uploadBody(sampleBytes),
  }),
  200,
);
assert.equal(upload.status, "accepted");
assert.equal(upload.rawBytesRetained, false);
assert.match(upload.sha256, /^[a-f0-9]{64}$/);

const parsed = await readJson(
  await fetch(`${baseUrl}/api/probes/ifc-parse`, {
    method: "POST",
    body: uploadBody(sampleBytes),
  }),
  200,
);
assert.equal(parsed.status, "parsed");
assert.equal(parsed.inventory.schemaName, "IFC4");
// OccupantCapacity is a real IFC property entity in the current review fixture.
assert.equal(parsed.inventory.totalEntities, 25);
assert.equal(parsed.inventory.doorCount, 2);
assert.equal(parsed.rawBytesRetained, false);

const rejectedResponse = await fetch(`${baseUrl}/api/probes/upload`, {
  method: "POST",
  body: uploadBody(new TextEncoder().encode("not an IFC"), "renamed.ifc"),
});
const rejected = await readJson(rejectedResponse, 422);
assert.equal(rejected.detail.code, "invalid_step_header");
assert.match(rejected.detail.request_id, /^[0-9a-f-]{36}$/i);
assert.equal(
  rejected.detail.request_id,
  rejectedResponse.headers.get("x-request-id"),
);

const storage = await readJson(
  await fetch(`${baseUrl}/api/probes/storage`, { method: "POST" }),
  200,
);
assert.deepEqual(storage.d1, { create: true, read: true, delete: true });
assert.equal(storage.r2.required, false);

const missingSessionResponse = await fetch(
  `${baseUrl}/api/reviews/sample/clean`,
  { method: "POST" },
);
const missingSession = await readJson(missingSessionResponse, 400);
assert.equal(missingSession.detail.code, "anonymous_session_required");
assert.equal(
  missingSession.detail.request_id,
  missingSessionResponse.headers.get("x-request-id"),
);

const sampleHeaders = {
  "x-bim-review-session": `phase0-sample-${smokeSessionSuffix}`,
};
// Bundled samples no longer have a per-session count quota. Send more than
// the former eight-start limit and verify every request reaches the route.
for (let index = 0; index < 10; index += 1) {
  await readJson(
    await fetch(`${baseUrl}/api/reviews/sample/clean`, {
      method: "POST",
      headers: sampleHeaders,
    }),
    201,
  );
}

const uploadRateHeaders = {
  "x-bim-review-session": `phase0-upload-${smokeSessionSuffix}`,
};
// Real IFC uploads are not limited by an anonymous-session counter. Keep
// sending more than the former quota to prove the request path reaches file
// validation instead of returning anonymous_rate_limited.
for (let index = 0; index < 7; index += 1) {
  await readJson(
    await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: uploadRateHeaders,
      body: uploadBody(new TextEncoder().encode("not an IFC"), "invalid.ifc"),
    }),
    422,
  );
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      baseUrl,
      checks: {
        health: true,
        boundedUpload: true,
        invalidHeaderRejected: true,
        realIfcParsed: parsed.inventory,
        d1RoundTrip: storage.d1,
        anonymousSessionRequired: true,
        sampleCountLimit: false,
        realUploadCountLimit: false,
        externalBimBackend: false,
      },
    },
    null,
    2,
  ),
);
