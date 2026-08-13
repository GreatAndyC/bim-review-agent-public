import type { Finding, Observation, ReviewRun } from "@/src/contracts/review";
import type {
  QuickCheckCheck,
  QuickCheckEvidence,
  QuickCheckLocale,
  QuickCheckMeasurement,
  QuickCheckReport,
  QuickCheckReference,
} from "@/src/contracts/quick-check";
import { getReviewScope } from "./review-scope";
import { displayRuleId } from "../review/rule-id";

const OBSERVATION_LABELS: Record<string, readonly [string, string, string]> = {
  "Door name": ["Door name", "门名称", "門名稱"],
  "Exit classification": ["Exit classification", "出口分类", "出口分類"],
  "Exit classification candidate": ["Exit classification candidate", "出口分类候选", "出口分類候選"],
  "Exit door fire rating": ["Exit door fire rating", "出口门耐火等级", "出口門耐火等級"],
  "Verified clear opening width": ["Verified clear opening width", "已验证净开口宽度", "已驗證淨開口寬度"],
  "Reported clear width": ["Reported clear width", "报告净宽", "報告淨寬"],
  "Nominal overall width (proxy)": ["Nominal overall width (proxy)", "名义总宽（代理值）", "名義總寬（代理值）"],
  "Clear width": ["Clear width", "净开口宽度", "淨開口寬度"],
  "Occupant capacity": ["Occupant capacity", "使用人数", "使用人數"],
};

const RELIABILITY_LABELS: Record<string, readonly [string, string, string]> = {
  EXPLICIT: ["Explicit", "明确证据", "明確證據"],
  DERIVED: ["Derived", "推导值", "推導值"],
  PROXY: ["Proxy", "代理值", "代理值"],
  MISSING: ["Missing", "缺失", "缺失"],
  CONTRADICTORY: ["Contradictory", "存在矛盾", "存在矛盾"],
};

function text(locale: QuickCheckLocale, english: string, simplified?: string, traditional?: string): string {
  if (locale === "zh-CN") return simplified ?? english;
  if (locale === "zh-Hant") return traditional ?? simplified ?? english;
  return english;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
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

function formatNumber(value: number, locale: QuickCheckLocale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

function formatMeasurement(value: number, unit: string, locale: QuickCheckLocale): string {
  return `${formatNumber(value, locale)} ${unit}`.trim();
}

function observationLabel(observation: Observation, locale: QuickCheckLocale): string {
  const translated = OBSERVATION_LABELS[observation.label];
  return translated ? text(locale, ...translated) : observation.label;
}

function reliabilityLabel(reliability: Observation["reliability"], locale: QuickCheckLocale): string {
  const translated = RELIABILITY_LABELS[reliability];
  return translated ? text(locale, ...translated) : reliability;
}

function findingTitle(finding: Finding, locale: QuickCheckLocale): string {
  if (finding.rule_id === "EGRESS-001" || finding.rule_id === "HK-FS-B2-DOOR-WIDTH") {
    return text(locale, finding.rule_title, "出口门净宽", "出口門淨寬");
  }
  if (finding.rule_id === "INFO-001") {
    return text(locale, finding.rule_title, "门信息证据", "門資訊證據");
  }
  return finding.rule_title;
}

function findingCategory(finding: Finding, locale: QuickCheckLocale): string {
  if (finding.rule_id === "EGRESS-001" || finding.rule_id === "HK-FS-B2-DOOR-WIDTH") {
    return text(locale, finding.category, "疏散", "疏散");
  }
  if (finding.rule_id === "INFO-001") {
    return text(locale, finding.category, "信息质量", "資訊品質");
  }
  return finding.category;
}

function statusLabel(status: "FAIL" | "REVIEW", locale: QuickCheckLocale): string {
  return status === "FAIL"
    ? text(locale, "FAIL", "失败", "失敗")
    : text(locale, "REVIEW", "待复核", "待覆核");
}

function decisionMetric(finding: Finding): QuickCheckMeasurement | null {
  const parameters = finding.rule_evidence.parameters;
  const widthObservation = finding.model_evidence.observations.find(
    (observation) => /clear width/i.test(observation.label) && numberValue(observation.normalized_value) !== null,
  );
  const actual = numberValue(parameters.observed_clear_width_mm) ?? numberValue(widthObservation?.normalized_value);
  const required = numberValue(parameters.minimum);
  if (actual === null || required === null) return null;
  const operator = typeof parameters.operator === "string" ? parameters.operator : ">=";
  return {
    actual,
    required,
    difference: actual - required,
    operator: operator === ">=" ? "≥" : operator === "<=" ? "≤" : operator === "==" ? "=" : operator,
    unit: typeof parameters.unit === "string" ? parameters.unit : widthObservation?.unit ?? "",
  };
}

function localizedMessage(finding: Finding, locale: QuickCheckLocale, metric: QuickCheckMeasurement | null): string {
  const entityName = finding.entity.name ?? text(locale, "Unnamed entity", "未命名构件", "未命名構件");
  if (metric && (finding.rule_id === "EGRESS-001" || finding.rule_id === "HK-FS-B2-DOOR-WIDTH")) {
    const actual = formatMeasurement(metric.actual, metric.unit, locale);
    const required = formatMeasurement(metric.required, metric.unit, locale);
    if (finding.status === "FAIL") {
      return text(
        locale,
        `${entityName} clear width is ${actual}, below the required ${required}.`,
        `${entityName} 的净开口宽度为 ${actual}，低于要求值 ${required}。`,
        `${entityName} 的淨開口寬度為 ${actual}，低於要求值 ${required}。`,
      );
    }
    return text(
      locale,
      `${entityName} clear width is ${actual}, meeting the required ${required}.`,
      `${entityName} 的净开口宽度为 ${actual}，达到要求值 ${required}。`,
      `${entityName} 的淨開口寬度為 ${actual}，達到要求值 ${required}。`,
    );
  }
  if (finding.rule_id === "INFO-001") {
    const observation = finding.model_evidence.observations[0];
    const label = observation
      ? observationLabel(observation, locale)
      : text(locale, "required model information", "必要模型信息", "必要模型資訊");
    return finding.status === "FAIL"
      ? finding.message
      : text(
          locale,
          finding.status === "PASS" ? `${entityName} provides ${label}.` : `${entityName} is missing or has invalid ${label}.`,
          finding.status === "PASS" ? `${entityName} 已提供${label}。` : `${entityName} 缺少或未正确提供${label}。`,
          finding.status === "PASS" ? `${entityName} 已提供${label}。` : `${entityName} 缺少或未正確提供${label}。`,
        );
  }
  const message = finding.message.toLocaleLowerCase("en-US");
  if (message.includes("may be an exit door")) {
    return text(locale, `${entityName} may be an exit door, but applicability is unconfirmed.`, `${entityName} 可能是出口门，但目前无法确认其适用性。`, `${entityName} 可能是出口門，但目前無法確認其適用性。`);
  }
  if (message.includes("overallwidth")) {
    return text(locale, `${entityName} has only OverallWidth as a proxy; it is not verified clear width.`, `${entityName} 只有 OverallWidth 代理值，不能作为已验证的净开口宽度。`, `${entityName} 只有 OverallWidth 代理值，不能作為已驗證的淨開口寬度。`);
  }
  if (message.includes("occupant capacity")) {
    return text(locale, `${entityName} has no valid occupant capacity for this width rule.`, `${entityName} 缺少有效的使用人数，无法套用本次宽度规则。`, `${entityName} 缺少有效的使用人數，無法套用本次寬度規則。`);
  }
  return finding.message;
}

function localizedRecommendation(finding: Finding, locale: QuickCheckLocale, metric: QuickCheckMeasurement | null): string {
  if (metric && finding.status === "FAIL") {
    const gap = Math.abs(metric.difference);
    return text(
      locale,
      `Increase the clear opening by ${formatMeasurement(gap, metric.unit, locale)} to at least ${formatMeasurement(metric.required, metric.unit, locale)}, then rerun the review.`,
      `建议将净开口宽度增加 ${formatMeasurement(gap, metric.unit, locale)}，调整至至少 ${formatMeasurement(metric.required, metric.unit, locale)}，然后重新审查。`,
      `建議將淨開口寬度增加 ${formatMeasurement(gap, metric.unit, locale)}，調整至至少 ${formatMeasurement(metric.required, metric.unit, locale)}，然後重新審查。`,
    );
  }
  const recommendation = finding.recommendation.toLocaleLowerCase("en-US");
  if (recommendation.includes("pset_doorcommon.fireexit")) {
    if (locale === "en") return finding.recommendation;
    if (recommendation.includes("set pset")) {
      return text(locale, "Set Pset_DoorCommon.FireExit to TRUE or FALSE from the documented design intent; do not infer it from the element name.", "根据已记录的设计意图确认门的功能，将 Pset_DoorCommon.FireExit 填写为 TRUE 或 FALSE；不要根据构件名称推断。", "根據已記錄的設計意圖確認門的功能，將 Pset_DoorCommon.FireExit 填寫為 TRUE 或 FALSE；不要根據構件名稱推斷。");
    }
    return text(locale, "Confirm the door function, populate Pset_DoorCommon.FireExit, then rerun the review.", "确认门的功能，填写 Pset_DoorCommon.FireExit，然后重新审查。", "確認門的功能，填寫 Pset_DoorCommon.FireExit，然後重新審查。");
  }
  if (recommendation.includes("overallwidth")) {
    return text(locale, "Add a verified clear opening in Pset_BIMReview.ClearWidth; OverallWidth remains supporting evidence only.", "补充经过验证的净开口宽度到 Pset_BIMReview.ClearWidth；OverallWidth 只能作为辅助证据。", "補充經過驗證的淨開口寬度到 Pset_BIMReview.ClearWidth；OverallWidth 只能作為輔助證據。");
  }
  if (recommendation.includes("fire rating") || recommendation.includes("fire-resistance") || recommendation.includes("pset_doorcommon.firerating") || recommendation.includes("door.name")) {
    const sourcePath = finding.model_evidence.observations[0]?.source_path ?? text(locale, "the corresponding field", "对应字段", "對應欄位");
    return text(locale, `Confirm the intended value and populate ${sourcePath}; do not infer it from the element name.`, `确认目标值并填写 ${sourcePath}；不要根据构件名称推断。`, `確認目標值並填寫 ${sourcePath}；不要根據構件名稱推斷。`);
  }
  if (recommendation.includes("occupant capacity")) {
    return text(locale, "Provide verified occupant capacity and its room or storey context, then rerun the review.", "提供经过验证的使用人数及其房间或楼层对应关系，然后重新审查。", "提供經過驗證的使用人數及其房間或樓層對應關係，然後重新審查。");
  }
  return finding.recommendation;
}

function buildEvidence(finding: Finding, locale: QuickCheckLocale): QuickCheckEvidence[] {
  const observations = [
    ...(finding.model_evidence.applicability_signal ? [finding.model_evidence.applicability_signal] : []),
    ...finding.model_evidence.observations,
  ];
  return observations.map((observation) => ({
    label: observationLabel(observation, locale),
    value: `${displayValue(observation.normalized_value ?? observation.raw_value)}${observation.unit ? ` ${observation.unit}` : ""}`,
    source_path: observation.source_path,
    reliability: reliabilityLabel(observation.reliability, locale),
  }));
}

function buildReference(finding: Finding, rulePackId: string): QuickCheckReference {
  const parameters = finding.rule_evidence.parameters;
  return {
    rule_id: finding.rule_evidence.rule_id,
    display_rule_id: displayRuleId(finding.rule_evidence.rule_id, rulePackId),
    version: finding.rule_evidence.version,
    source_title: finding.rule_evidence.source_title,
    jurisdiction: finding.rule_evidence.jurisdiction,
    clause: finding.rule_evidence.clause,
    source_url: typeof parameters.source_url === "string" ? parameters.source_url : null,
    parameters,
  };
}

function buildCheck(finding: Finding, locale: QuickCheckLocale, rulePackId: string): QuickCheckCheck {
  if (finding.status === "PASS") throw new Error("PASS findings are not actionable Quick Checks.");
  const measurement = decisionMetric(finding);
  return {
    finding_id: finding.finding_id,
    status: finding.status,
    status_label: statusLabel(finding.status, locale),
    severity: finding.severity,
    rule_id: finding.rule_id,
    display_rule_id: displayRuleId(finding.rule_id, rulePackId),
    title: findingTitle(finding, locale),
    category: findingCategory(finding, locale),
    entity: {
      name: finding.entity.name ?? text(locale, "Unnamed entity", "未命名构件", "未命名構件"),
      ifc_class: finding.entity.ifc_class,
      global_id: finding.entity.global_id,
      storey: finding.entity.storey,
    },
    summary: localizedMessage(finding, locale, measurement),
    recommendation: localizedRecommendation(finding, locale, measurement),
    measurement,
    evidence: buildEvidence(finding, locale),
    reference: buildReference(finding, rulePackId),
  };
}

export function buildQuickCheckReport(review: ReviewRun, locale: QuickCheckLocale, generatedAt = new Date().toISOString()): QuickCheckReport {
  const checks = review.findings
    .filter((finding) => finding.status !== "PASS")
    .map((finding) => buildCheck(finding, locale, review.rule_pack_id));
  const scope = getReviewScope(review);
  const scopeDetail = scope.reason === "no_applicable_doors"
    ? text(
        locale,
        "No IfcDoor occurrences were found. The current rule pack could not evaluate this model; this is not a PASS result.",
        "模型中没有 IfcDoor 构件，当前规则包无法评价这个模型；这不等同于通过。",
        "模型中沒有 IfcDoor 構件，目前規則包無法評價這個模型；這不等同於通過。",
      )
    : scope.reason === "no_enabled_rules"
      ? text(
          locale,
          "No executable rules were enabled. The run could not evaluate this model; this is not a PASS result.",
          "本次没有启用可执行规则，无法评价这个模型；这不等同于通过。",
          "這次沒有啟用可執行規則，無法評價這個模型；這不等同於通過。",
        )
      : text(
          locale,
          "The selected rules were evaluated against applicable model objects.",
          "已按所选规则评价适用的模型构件。",
          "已按所選規則評價適用的模型構件。",
        );
  const limitation = review.findings[0]?.rule_evidence.limitation ?? text(locale, "This is a deterministic pre-check and evidence report, not statutory certification.", "这是确定性预审和证据报告，不构成法定认证。", "這是確定性預審和證據報告，不構成法定認證。");
  return {
    format: "bim-review-quick-check/v1",
    locale,
    generated_at: generatedAt,
    generated_from: { run_id: review.run_id, completed_at: review.completed_at },
    source: review.source,
    model: {
      schema: review.inventory.schema_name,
      length_unit: review.inventory.length_unit,
      total_entities: review.inventory.total_entities,
      reviewed_entities: review.summary.reviewed_entities,
    },
    rule_pack: { id: review.rule_pack_id, version: review.rule_pack_version },
    summary: {
      total_findings: review.summary.total_findings,
      pass: review.summary.pass_count,
      fail: review.summary.fail_count,
      review: review.summary.review_count,
      actionable: checks.length,
    },
    scope: {
      status: scope.status,
      reason: scope.reason,
      label: scope.status === "NOT_APPLICABLE"
        ? text(locale, "NOT APPLICABLE", "不适用", "不適用")
        : text(locale, "EVALUATED", "已评价", "已評價"),
      detail: scopeDetail,
    },
    checks,
    limitation,
  };
}

function markdownText(value: string): string {
  return value.replaceAll("\r", "").replaceAll("\n", " ").replaceAll("|", "\\|").trim();
}

export function quickCheckJson(report: QuickCheckReport): string {
  return JSON.stringify(report, null, 2);
}

export function quickCheckMarkdown(report: QuickCheckReport): string {
  const isChinese = report.locale !== "en";
  const labels = isChinese
    ? report.locale === "zh-Hant"
      ? { title: "審查快速檢查", source: "來源", summary: "摘要", model: "模型", scope: "適用範圍", checks: "需要處理的檢查", none: "沒有需要處理的失敗或待覆核項目。", ref: "參考", evidence: "證據", action: "建議", limitation: "限制" }
      : { title: "审查快速检查", source: "来源", summary: "摘要", model: "模型", scope: "适用范围", checks: "需要处理的检查", none: "没有需要处理的失败或待复核项目。", ref: "参考", evidence: "证据", action: "建议", limitation: "限制" }
    : { title: "Review Quick Check", source: "Source", summary: "Summary", model: "Model", scope: "Scope", checks: "Actionable checks", none: "No FAIL or REVIEW items require action.", ref: "Reference", evidence: "Evidence", action: "Recommendation", limitation: "Limitation" };
  const statusSummary = isChinese
    ? `${report.summary.pass} 通过 / ${report.summary.fail} 失败 / ${report.summary.review} 待复核`
    : `${report.summary.pass} PASS / ${report.summary.fail} FAIL / ${report.summary.review} REVIEW`;
  const lines = [
    `# ${labels.title}`,
    "",
    `- ${labels.source}: ${markdownText(report.source.filename)}`,
    `- SHA-256: \`${report.source.sha256}\``,
    `- ${labels.model}: ${report.model.schema}, ${report.model.length_unit}, ${report.model.total_entities} entities`,
    `- ${labels.summary}: ${statusSummary}`,
    `- ${labels.scope}: ${markdownText(report.scope.label)} — ${markdownText(report.scope.detail)}`,
    `- Rule pack: \`${report.rule_pack.id}@${report.rule_pack.version}\``,
    `- Completed: ${formatDate(report.generated_from.completed_at, report.locale)}`,
    "",
    `## ${labels.checks}`,
    "",
  ];
  if (!report.checks.length) {
    lines.push(labels.none, "");
  } else {
    report.checks.forEach((check, index) => {
      lines.push(`### ${index + 1}. [${check.status_label}] ${markdownText(check.title)}`);
      lines.push(`- Rule: \`${check.display_rule_id}@${check.reference.version}\``);
      lines.push(`- Entity: ${markdownText(check.entity.name)} (${check.entity.ifc_class}, ${check.entity.global_id})`);
      lines.push(`- ${labels.summary}: ${markdownText(check.summary)}`);
      if (check.measurement) {
        lines.push(`- Measurement: ${formatMeasurement(check.measurement.actual, check.measurement.unit, report.locale)} ${check.measurement.operator} ${formatMeasurement(check.measurement.required, check.measurement.unit, report.locale)}`);
      }
      lines.push(`- ${labels.action}: ${markdownText(check.recommendation)}`);
      lines.push(`- ${labels.ref}: ${markdownText(check.reference.source_title)}${check.reference.clause ? `; ${markdownText(check.reference.clause)}` : ""}`);
      if (check.evidence.length) {
        lines.push(`- ${labels.evidence}: ${check.evidence.map((item) => `${markdownText(item.label)} = ${markdownText(item.value)} [${item.source_path}; ${item.reliability}]`).join("; ")}`);
      }
      lines.push("");
    });
  }
  lines.push(`## ${labels.limitation}`, "", markdownText(report.limitation), "");
  return `${lines.join("\n")}\n`;
}
