import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  batchQuickCheckJson,
  batchQuickCheckMarkdown,
  buildBatchQuickCheckReport,
} = await import("../src/runtime/report/batch-quick-check.ts");

const contractRoot = new URL("../../../contracts/", import.meta.url);

async function loadReview(filename) {
  const payload = JSON.parse(
    await readFile(new URL(`golden/${filename}.review.json`, contractRoot), "utf8"),
  );
  return {
    ...payload,
    run_id: `batch-${filename}`,
    started_at: "2026-08-13T02:00:00.000Z",
    completed_at: "2026-08-13T02:00:01.000Z",
    duration_ms: 1000,
  };
}

test("batch Quick Check aggregates many IFC results without dropping per-file evidence", async () => {
  const seed = await loadReview("mixed_review");
  const successes = Array.from({ length: 50 }, (_, index) => ({
    review: {
      ...seed,
      run_id: `batch-${index + 1}`,
      source: { ...seed.source, filename: `fixture-${String(index + 1).padStart(2, "0")}.ifc` },
    },
  }));
  const failures = [
    { filename: "broken-header.ifc", code: "invalid_step_header", message: "Invalid IFC STEP header." },
    { filename: "too-large.ifc", code: "file_too_large", message: "The file is larger than the local limit." },
  ];

  const report = buildBatchQuickCheckReport(successes, failures, "zh-CN", "2026-08-13T02:01:00.000Z");

  assert.equal(report.format, "bim-review-batch-quick-check/v1");
  assert.equal(report.summary.total_files, 52);
  assert.equal(report.summary.completed_files, 50);
  assert.equal(report.summary.failed_files, 2);
  assert.equal(report.summary.skipped_files, 0);
  assert.equal(report.results.length, 50);
  assert.equal(report.failures.length, 2);
  assert.equal(report.summary.fail, 50);
  assert.equal(report.summary.review, 200);
  assert.equal(report.summary.actionable, 250);
  assert.equal(report.results[49].source.filename, "fixture-50.ifc");

  const json = batchQuickCheckJson(report);
  const markdown = batchQuickCheckMarkdown(report);
  assert.match(json, /bim-review-batch-quick-check\/v1/);
  assert.match(json, /broken-header\.ifc/);
  assert.match(markdown, /批量审查快速检查/);
  assert.match(markdown, /fixture-50\.ifc/);
  assert.match(markdown, /invalid_step_header/);
  assert.match(markdown, /建议/);
});

test("batch Quick Check handles an empty success set as a partial batch", () => {
  const report = buildBatchQuickCheckReport(
    [],
    [{ filename: "empty.ifc", code: "empty_file", message: "The selected IFC file is empty." }],
    "en",
    "2026-08-13T02:01:00.000Z",
  );

  assert.equal(report.summary.total_files, 1);
  assert.equal(report.summary.completed_files, 0);
  assert.equal(report.summary.failed_files, 1);
  assert.equal(report.summary.skipped_files, 0);
  assert.match(batchQuickCheckMarkdown(report), /Files not completed/);
});

test("batch Quick Check keeps oversized files as skipped instead of failed", () => {
  const report = buildBatchQuickCheckReport(
    [],
    [{
      filename: "over-50-mib.ifc",
      code: "file_too_large",
      message: "Over 50 MiB; skipped in this batch.",
      status: "SKIPPED",
    }],
    "en",
    "2026-08-13T02:01:00.000Z",
  );

  assert.equal(report.summary.total_files, 1);
  assert.equal(report.summary.failed_files, 0);
  assert.equal(report.summary.skipped_files, 1);
  assert.match(batchQuickCheckMarkdown(report), /Files skipped/);
  assert.match(batchQuickCheckMarkdown(report), /over-50-mib\.ifc/);
});
