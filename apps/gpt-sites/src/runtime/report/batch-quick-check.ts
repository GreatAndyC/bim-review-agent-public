import type {
  BatchQuickCheckReport,
  BatchReviewFailure,
} from "@/src/contracts/batch";
import type { QuickCheckLocale, QuickCheckReport } from "@/src/contracts/quick-check";
import type { ReviewRun } from "@/src/contracts/review";
import { buildQuickCheckReport } from "./quick-check";

export type BatchReviewSuccess = {
  review: ReviewRun;
};

function markdownText(value: string): string {
  return value.replaceAll("\r", "").replaceAll("\n", " ").replaceAll("|", "\\|").trim();
}

function formatDate(value: string, locale: QuickCheckLocale): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );
  } catch {
    return value;
  }
}

function statusSummary(report: QuickCheckReport, locale: QuickCheckLocale): string {
  if (locale === "zh-CN") {
    return `${report.summary.pass} 通过 / ${report.summary.fail} 失败 / ${report.summary.review} 待复核`;
  }
  if (locale === "zh-Hant") {
    return `${report.summary.pass} 通過 / ${report.summary.fail} 失敗 / ${report.summary.review} 待覆核`;
  }
  return `${report.summary.pass} PASS / ${report.summary.fail} FAIL / ${report.summary.review} REVIEW`;
}

function batchLabels(locale: QuickCheckLocale) {
  if (locale === "zh-CN") {
    return {
      title: "批量审查快速检查",
      summary: "汇总",
      files: "文件",
      completed: "完成",
      failed: "失败",
      skipped: "已跳过",
      actionable: "需要处理",
      results: "逐文件结果",
      status: "状态",
      scope: "适用范围",
      checks: "需要处理",
      recommendation: "建议",
      reference: "参考",
      failures: "未完成文件",
      skippedFiles: "已跳过文件",
      noAction: "没有需要处理的失败或待复核项目。",
      completedAt: "完成时间",
      limitation: "限制",
      limitationText: "批量结果按文件逐个调用确定性审查引擎；每个文件的完整证据仍保留在网页审查结果中。",
    };
  }
  if (locale === "zh-Hant") {
    return {
      title: "批量審查快速檢查",
      summary: "彙總",
      files: "檔案",
      completed: "完成",
      failed: "失敗",
      skipped: "已跳過",
      actionable: "需要處理",
      results: "逐檔結果",
      status: "狀態",
      scope: "適用範圍",
      checks: "需要處理",
      recommendation: "建議",
      reference: "參考",
      failures: "未完成檔案",
      skippedFiles: "已跳過檔案",
      noAction: "沒有需要處理的失敗或待覆核項目。",
      completedAt: "完成時間",
      limitation: "限制",
      limitationText: "批量結果按檔案逐個呼叫確定性審查引擎；每個檔案的完整證據仍保留在網頁審查結果中。",
    };
  }
  return {
    title: "Batch Review Quick Check",
    summary: "Summary",
    files: "files",
    completed: "completed",
    failed: "failed",
    skipped: "skipped",
    actionable: "actionable",
    results: "Per-file results",
    status: "Status",
    scope: "Scope",
    checks: "Actionable checks",
    recommendation: "Recommendation",
    reference: "Reference",
    failures: "Files not completed",
    skippedFiles: "Files skipped",
    noAction: "No FAIL or REVIEW items require action.",
    completedAt: "Completed",
    limitation: "Limitation",
    limitationText: "Batch results call the deterministic review engine one file at a time; complete evidence remains available in each web review result.",
  };
}

export function buildBatchQuickCheckReport(
  successes: readonly BatchReviewSuccess[],
  failures: readonly BatchReviewFailure[],
  locale: QuickCheckLocale,
  generatedAt = new Date().toISOString(),
): BatchQuickCheckReport {
  const results = successes.map(({ review }) => buildQuickCheckReport(review, locale, generatedAt));
  const skippedFiles = failures.filter((failure) => failure.status === "SKIPPED").length;
  return {
    format: "bim-review-batch-quick-check/v1",
    locale,
    generated_at: generatedAt,
    summary: {
      total_files: results.length + failures.length,
      completed_files: results.length,
      failed_files: failures.length - skippedFiles,
      skipped_files: skippedFiles,
      total_findings: results.reduce((sum, report) => sum + report.summary.total_findings, 0),
      pass: results.reduce((sum, report) => sum + report.summary.pass, 0),
      fail: results.reduce((sum, report) => sum + report.summary.fail, 0),
      review: results.reduce((sum, report) => sum + report.summary.review, 0),
      actionable: results.reduce((sum, report) => sum + report.summary.actionable, 0),
    },
    results,
    failures: [...failures],
  };
}

export function batchQuickCheckJson(report: BatchQuickCheckReport): string {
  return JSON.stringify(report, null, 2);
}

export function batchQuickCheckMarkdown(report: BatchQuickCheckReport): string {
  const labels = batchLabels(report.locale);
  const lines = [
    `# ${labels.title}`,
    "",
    `- ${labels.files}: ${report.summary.total_files}`,
    `- ${labels.completed}: ${report.summary.completed_files}`,
    `- ${labels.failed}: ${report.summary.failed_files}`,
    `- ${labels.skipped}: ${report.summary.skipped_files}`,
    `- ${labels.actionable}: ${report.summary.actionable}`,
    `- ${labels.completedAt}: ${formatDate(report.generated_at, report.locale)}`,
    "",
    `## ${labels.summary}`,
    "",
    `- PASS: ${report.summary.pass}`,
    `- FAIL: ${report.summary.fail}`,
    `- REVIEW: ${report.summary.review}`,
    `- ${labels.actionable}: ${report.summary.actionable}`,
    "",
    `## ${labels.results}`,
    "",
  ];

  report.results.forEach((result, index) => {
    lines.push(`### ${index + 1}. ${markdownText(result.source.filename)}`);
    lines.push(`- ${labels.status}: ${statusSummary(result, report.locale)}`);
    lines.push(`- ${labels.scope}: ${markdownText(result.scope.label)} — ${markdownText(result.scope.detail)}`);
    if (!result.checks.length) {
      lines.push(`- ${labels.checks}: ${labels.noAction}`);
    } else {
      lines.push(`- ${labels.checks}:`);
      result.checks.forEach((check) => {
        lines.push(`  - [${check.status_label}] ${markdownText(check.title)} — ${markdownText(check.summary)}`);
        lines.push(`    - ${labels.recommendation}: ${markdownText(check.recommendation)}`);
        lines.push(`    - ${labels.reference}: ${markdownText(check.reference.source_title)}${check.reference.clause ? `; ${markdownText(check.reference.clause)}` : ""}`);
      });
    }
    lines.push("");
  });

  const failedFiles = report.failures.filter((failure) => failure.status !== "SKIPPED");
  const skippedFiles = report.failures.filter((failure) => failure.status === "SKIPPED");

  if (failedFiles.length) {
    lines.push(`## ${labels.failures}`, "");
    failedFiles.forEach((failure) => {
      lines.push(`- \`${markdownText(failure.filename)}\` — ${markdownText(failure.message)} (${failure.code})`);
    });
    lines.push("");
  }

  if (skippedFiles.length) {
    lines.push(`## ${labels.skippedFiles}`, "");
    skippedFiles.forEach((failure) => {
      lines.push(`- \`${markdownText(failure.filename)}\` — ${markdownText(failure.message)} (${failure.code})`);
    });
    lines.push("");
  }

  lines.push(`## ${labels.limitation}`, "", labels.limitationText, "");
  return `${lines.join("\n")}\n`;
}
