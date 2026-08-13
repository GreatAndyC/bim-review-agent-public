import assert from "node:assert/strict";
import test from "node:test";

const { buildQuickCheckReport, quickCheckJson, quickCheckMarkdown } = await import(
  "../src/runtime/report/quick-check.ts"
);
const { loadRulePack } = await import("../src/runtime/review/rule-pack.ts");
const { displayRuleId } = await import("../src/runtime/review/rule-id.ts");

test("Rule IDs are qualified by rule pack in human-facing output", () => {
  assert.equal(displayRuleId("INFO-001", "hk-fire-safety-2011-2024"), "HK-FS-INFO-001");
  assert.equal(displayRuleId("INFO-001", "cn-fire-55037-2022"), "CN-FS-INFO-001");
  assert.equal(displayRuleId("EGRESS-001", "cn-fire-55037-2022"), "CN-FS-EGRESS-001");
  assert.equal(displayRuleId("HK-FS-B2-DOOR-WIDTH", "hk-fire-safety-2011-2024"), "HK-FS-B2-DOOR-WIDTH");
});

test("Mainland China profile is backed by the GB 55037-2022 executable pack", () => {
  const pack = loadRulePack("cn-fire-55037-2022");

  assert.equal(pack.id, "cn-fire-55037-2022");
  assert.equal(pack.version, "1.0.0");
  assert.equal(pack.authority.type, "AUTHORITATIVE_STANDARD");
  assert.equal(pack.authority.clause, "7.1.4(1)");
  assert.equal(pack.egress.threshold?.value, 800);
  assert.equal(pack.egress.threshold?.unit, "mm");
});

function finding(status, findingId, name, width, message, recommendation) {
  return {
    finding_id: findingId,
    rule_id: "EGRESS-001",
    rule_title: "Exit door clear width",
    category: "Egress",
    status,
    severity: status === "FAIL" ? "ERROR" : "INFO",
    entity: {
      ifc_class: "IfcDoor",
      global_id: `${findingId}-global-id`,
      name,
      object_type: null,
      tag: null,
      storey: "Level 01",
    },
    applicability: "Confirmed exit door.",
    message,
    recommendation,
    model_evidence: {
      applicability_signal: null,
      observations: [
        {
          label: "Reported clear width",
          raw_value: width,
          normalized_value: width,
          unit: "mm",
          source_path: "Pset_BIMReview.ClearWidth",
          reliability: "EXPLICIT",
          note: null,
        },
      ],
    },
    rule_evidence: {
      rule_id: "EGRESS-001",
      title: "Exit door clear width",
      version: "1.0.0",
      authority: "DEMO_PROJECT_RULE",
      source_title: "BIM Review Agent demo rule",
      jurisdiction: "Demo project",
      clause: "Table B2",
      parameters: {
        operator: ">=",
        minimum: 900,
        unit: "mm",
        observed_clear_width_mm: width,
        source_url: "https://example.com/rule",
      },
      limitation: "Deterministic pre-check only.",
    },
    explanation: null,
  };
}

function review(findings) {
  return {
    run_id: "review-quick-check-test",
    started_at: "2026-08-12T06:00:00.000Z",
    completed_at: "2026-08-12T06:00:01.000Z",
    duration_ms: 1000,
    source: {
      filename: "real-model.ifc",
      size_bytes: 1234,
      sha256: "a".repeat(64),
    },
    rule_pack_id: "demo-rule-pack",
    rule_pack_version: "1.0.0",
    inventory: {
      schema_name: "IFC4",
      length_unit: "mm",
      length_unit_known: true,
      length_to_metre_scale: 0.001,
      total_entities: 42,
      entity_counts: { IfcDoor: 2 },
    },
    trace: [],
    findings,
    summary: {
      total_findings: findings.length,
      pass_count: findings.filter((item) => item.status === "PASS").length,
      fail_count: findings.filter((item) => item.status === "FAIL").length,
      review_count: findings.filter((item) => item.status === "REVIEW").length,
      reviewed_entities: findings.length,
    },
  };
}

test("Quick Check keeps only actionable findings and preserves precise evidence", () => {
  const report = buildQuickCheckReport(
    review([
      finding("FAIL", "fail-001", "Service Exit D-11", 820, "Width is below the minimum.", "Coordinate a wider clear opening."),
      finding("PASS", "pass-001", "Lobby Exit D-10", 950, "Width meets the minimum.", "Retain the source measurement."),
    ]),
    "zh-CN",
    "2026-08-12T06:00:02.000Z",
  );

  assert.equal(report.format, "bim-review-quick-check/v1");
  assert.equal(report.summary.pass, 1);
  assert.equal(report.summary.fail, 1);
  assert.equal(report.summary.actionable, 1);
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0].measurement.actual, 820);
  assert.equal(report.checks[0].measurement.required, 900);
  assert.equal(report.checks[0].display_rule_id, "EGRESS-001");
  assert.equal(report.checks[0].reference.display_rule_id, "EGRESS-001");
  assert.match(report.checks[0].summary, /净开口宽度/);
  assert.match(report.checks[0].recommendation, /增加 80 mm/);
  assert.equal(report.checks[0].reference.clause, "Table B2");
  assert.equal(report.checks[0].evidence[0].source_path, "Pset_BIMReview.ClearWidth");

  const json = quickCheckJson(report);
  const markdown = quickCheckMarkdown(report);
  assert.match(json, /bim-review-quick-check\/v1/);
  assert.match(markdown, /Pset_BIMReview\.ClearWidth/);
  assert.match(markdown, /建议将净开口宽度增加 80 mm/);
  assert.doesNotMatch(markdown, /run\.started|tool\.completed/);
});

test("Quick Check gives a concise empty action section for a clean review", () => {
  const report = buildQuickCheckReport(
    review([finding("PASS", "pass-001", "Lobby Exit D-10", 950, "Width meets the minimum.", "Retain the source measurement.")]),
    "en",
    "2026-08-12T06:00:02.000Z",
  );
  assert.equal(report.checks.length, 0);
  assert.match(quickCheckMarkdown(report), /No FAIL or REVIEW items require action/);
});

test("Quick Check marks a zero-applicable-door run instead of implying PASS", () => {
  const zeroScopeReview = review([]);
  zeroScopeReview.inventory.entity_counts = {};
  zeroScopeReview.trace = [
    {
      order: 2,
      key: "plan",
      label: "Plan review",
      status: "COMPLETED",
      detail: "One enabled rule.",
      data: { enabled_rules: ["INFO-001"] },
    },
  ];

  const report = buildQuickCheckReport(zeroScopeReview, "zh-CN", "2026-08-12T06:00:02.000Z");

  assert.equal(report.scope.status, "NOT_APPLICABLE");
  assert.equal(report.scope.reason, "no_applicable_doors");
  assert.match(report.scope.detail, /没有 IfcDoor/);
  assert.match(quickCheckMarkdown(report), /不适用/);
  assert.match(quickCheckMarkdown(report), /不等同于通过/);
});
