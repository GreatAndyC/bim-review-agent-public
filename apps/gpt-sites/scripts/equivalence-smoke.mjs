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
const anonymousSession = `equivalence-${process.pid}-${Date.now()}`;

function siteFetch(input, init = {}) {
  const headers = new Headers(init.headers);
  if ((init.method ?? "GET").toUpperCase() === "POST") {
    headers.set("x-bim-review-session", anonymousSession);
  }
  return fetch(input, { ...init, headers });
}

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

for (const sample of manifest.samples) {
  const response = await siteFetch(`${baseUrl}/api/reviews/sample/${sample.id}`, {
    method: "POST",
  });
  const body = await response.json();
  assert.equal(
    response.status,
    201,
    `${sample.id} returned ${response.status}: ${JSON.stringify(body)}`,
  );
  const golden = JSON.parse(
    await readFile(new URL(sample.golden_path, contractRoot), "utf8"),
  );
  assert.deepEqual(
    deterministicPayload(body),
    golden,
    `${sample.id} drifted from the Python deterministic ReviewRun`,
  );
}

const mainlandResponse = await siteFetch(
  `${baseUrl}/api/reviews/sample/narrow_exit?profile_id=cn-fire-55037-2022`,
  { method: "POST" },
);
const mainlandRun = await mainlandResponse.json();
assert.equal(mainlandResponse.status, 201, JSON.stringify(mainlandRun));
assert.equal(mainlandRun.rule_pack_id, "cn-fire-55037-2022");
assert.equal(mainlandRun.rule_pack_version, "1.0.0");
const mainlandEgress = mainlandRun.findings.find(
  (finding) => finding.rule_id === "EGRESS-001",
);
assert.ok(mainlandEgress);
assert.equal(mainlandEgress.status, "PASS");
assert.equal(mainlandEgress.rule_evidence.clause, "7.1.4(1)");
assert.equal(mainlandEgress.rule_evidence.parameters.minimum, 800);

async function uploadReview(bytes, filename, search = "") {
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: "application/octet-stream" }),
    filename,
  );
  const response = await siteFetch(`${baseUrl}/api/reviews${search}`, {
    method: "POST",
    body: form,
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

const mixedManifest = manifest.samples.find((sample) => sample.id === "mixed_review");
assert.ok(mixedManifest);
const mixedBytes = await readFile(
  new URL(
    "../../../src/bim_review_agent/assets/samples/mixed_review.ifc",
    import.meta.url,
  ),
);
const uploadRun = await uploadReview(mixedBytes, "mixed_review.ifc");
const mixedGolden = JSON.parse(
  await readFile(new URL(mixedManifest.golden_path, contractRoot), "utf8"),
);
assert.deepEqual(deterministicPayload(uploadRun), mixedGolden);

const first = await (
  await siteFetch(`${baseUrl}/api/reviews/sample/mixed_review`, { method: "POST" })
).json();
const second = await (
  await siteFetch(`${baseUrl}/api/reviews/sample/mixed_review`, { method: "POST" })
).json();
assert.notEqual(first.run_id, second.run_id);
assert.deepEqual(deterministicPayload(first), deterministicPayload(second));

const unknown = await siteFetch(`${baseUrl}/api/reviews/sample/not-a-sample`, {
  method: "POST",
});
assert.equal(unknown.status, 404);
assert.equal((await unknown.json()).detail.code, "sample_not_found");

console.log(
  JSON.stringify(
    {
      status: "passed",
      baseUrl,
      contractVersion: manifest.contract_version,
      samples: manifest.samples.map((sample) => sample.id),
      equivalence: "full deterministic ReviewRun payload",
      mainlandProfile: "cn-fire-55037-2022 v1.0.0",
      syntheticUploadPath: true,
    },
    null,
    2,
  ),
);
