"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import type { Finding, FindingStatus, Observation, ReviewRun } from "@/src/contracts/review";
import type { BatchQuickCheckReport, BatchReviewFailure } from "@/src/contracts/batch";
import type {
  AnonymousRunAccess,
  StoredAgentReviewResult,
} from "@/src/contracts/storage";
import type { QuickCheckReport } from "@/src/contracts/quick-check";
import {
  buildQuickCheckReport,
  quickCheckJson,
  quickCheckMarkdown,
} from "@/src/runtime/report/quick-check";
import { MAX_UPLOAD_BYTES } from "@/src/contracts/upload";
import {
  buildBatchQuickCheckReport,
} from "@/src/runtime/report/batch-quick-check";
import { copy, detectLocale, type CopyKey, type Locale } from "./copy";
import { BrandMark, Icon, type IconName } from "./icons";
import {
  clearHistory,
  deleteHistory,
  listHistory,
  saveHistory,
  type LocalHistoryEntry,
} from "../lib/local-history";
import { getReviewScope } from "@/src/runtime/report/review-scope";
import { displayRuleId } from "@/src/runtime/review/rule-id";
import { classifyBatchUploads } from "@/src/runtime/upload/batch";

gsap.registerPlugin(useGSAP);

const RUNNING_MIN_DURATION_MS = 450;
const RUNNING_STEP_HOLD_SECONDS = 0.41;
const RUNNING_STEP_PULSE_IN_SECONDS = 0.1;
const RUNNING_STEP_PULSE_OUT_SECONDS = 0.08;
const RUNNING_STEP_ADVANCE_MS =
  (RUNNING_STEP_HOLD_SECONDS +
    RUNNING_STEP_PULSE_IN_SECONDS * 2 +
    RUNNING_STEP_PULSE_OUT_SECONDS * 2) *
  1_000;
const RUNNING_ACTIVE_ANIMATION_DELAY_MS = 210;
const RUNNING_COMPLETE_ANIMATION_DELAY_MS = 90;
const SESSION_KEY = "bim-review-agent:last-run:v1";
const LOCALE_KEY = "bim-review-agent:locale:v1";
const LOCALE_EVENT = "bim-review-agent:locale-change";
const RULE_PROFILES_KEY = "bim-review-agent:rule-profiles:v1";
const RULE_PROFILE_METADATA_KEY = "bim-review-agent:rule-profile-metadata:v1";
const RULE_PROFILES_EVENT = "bim-review-agent:rule-profiles-change";
const CLIENT_SESSION_KEY = "bim-review-agent:anonymous-session:v1";
let volatileClientSessionId: string | null = null;

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(LOCALE_KEY);
    if (stored === "en" || stored === "zh-CN" || stored === "zh-Hant") return stored;
  } catch {
    // Fall through to the browser language when storage is unavailable.
  }
  return detectLocale(window.navigator.language);
}

function subscribeToLocale(onStoreChange: () => void) {
  window.addEventListener(LOCALE_EVENT, onStoreChange);
  return () => window.removeEventListener(LOCALE_EVENT, onStoreChange);
}

type UiStatus = "idle" | "running" | "ready" | "complete" | "error" | "deleted";
type ViewKey = "overview" | "new-review" | "runs" | "rules" | "samples";
type WizardStep = 1 | 2 | 3;
type Filter = "ALL" | FindingStatus;
type ApiError = {
  code: string;
  message: string;
  recovery: string;
  requestId?: string;
};

type BatchTask = {
  id: string;
  label: string;
  request: RequestInfo | URL;
  init: RequestInit;
  skipped?: BatchReviewFailure;
};

type BatchRunItem = {
  id: string;
  label: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  result: StoredAgentReviewResult | null;
  error: BatchReviewFailure | null;
};

type BatchRunState = {
  id: string;
  profileId: string;
  startedAt: number;
  completedAt: number | null;
  items: BatchRunItem[];
};

type UiCopyKey =
  | "overview"
  | "newReview"
  | "reviewRuns"
  | "ruleProfiles"
  | "samplesData"
  | "collapseSidebar"
  | "expandSidebar"
  | "openNavigation"
  | "closeNavigation"
  | "workspace"
  | "retainedRun"
  | "ruleCatalogLabel"
  | "localProfileLabel"
  | "bundledFixturesLabel"
  | "available"
  | "noSampleMatches"
  | "samplePurpose"
  | "batchImport"
  | "batchImportHint"
  | "selectedFiles"
  | "filesSelected"
  | "runBatchReview"
  | "batchReviewNote"
  | "batchResultsTitle"
  | "batchResultsBody"
  | "batchSummary"
  | "batchCompletedFiles"
  | "batchFailedFiles"
  | "batchSkippedFiles"
  | "batchActionable"
  | "batchFileResults"
  | "batchFailedFile"
  | "batchQueued"
  | "batchRunning"
  | "batchCompleted"
  | "batchFailed"
  | "batchSkipped"
  | "batchFileTooLargeWillSkip"
  | "batchRequestTooLarge"
  | "batchViewResult"
  | "backToBatch"
  | "batchSelectionHint"
  | "selectBatchFile"
  | "selectAllBatchFiles"
  | "clearBatchSelection"
  | "batchSelectedCount"
  | "exportBatchPdf"
  | "batchPdfNoSelection"
  | "runSelectedSamples"
  | "selectAllSamples"
  | "clearAllSamples"
  | "selectedSamples"
  | "overviewTitle"
  | "overviewBody"
  | "startReview"
  | "startReviewBody"
  | "reviewFlow"
  | "stepModel"
  | "stepRules"
  | "stepRun"
  | "reviewRulesTitle"
  | "nextStep"
  | "previousStep"
  | "reviewReady"
  | "reviewReadyBody"
  | "selectedModel"
  | "sampleShortcut"
  | "scopePreview"
  | "scopePreviewBody"
  | "scopeNext"
  | "advancedOptions"
  | "reviewNote"
  | "reviewNotePlaceholder"
  | "reviewNoteHint"
  | "modelInputTitle"
  | "modelInputBody"
  | "ruleProfile"
  | "ruleProfileHint"
  | "configure"
  | "createProfile"
  | "duplicateProfile"
  | "editProfile"
  | "editProfileDescription"
  | "deleteProfile"
  | "saveProfile"
  | "cancel"
  | "profileDetails"
  | "profileCatalog"
  | "profileSource"
  | "profileJurisdiction"
  | "profileEdition"
  | "profileStatus"
  | "draft"
  | "systemProfile"
  | "customProfile"
  | "engineReady"
  | "enginePending"
  | "chooseProfile"
  | "profileNotReady"
  | "profileCatalogNote"
  | "profileReadonly"
  | "profileDescriptionEditorNote"
  | "profileNameField"
  | "profileJurisdictionField"
  | "profileSourceField"
  | "profileSourceUrlField"
  | "profileEditionField"
  | "profileDescriptionField"
  | "profileDescriptionPlaceholder"
  | "noRules"
  | "selectRule"
  | "ruleDetail"
  | "officialSource"
  | "useProfile"
  | "selected"
  | "deleteProfileConfirm"
  | "profileActionHint"
  | "profileName"
  | "enabledRules"
  | "rulesActive"
  | "mappedRules"
  | "active"
  | "modelInputHint"
  | "dropIfc"
  | "browseFiles"
  | "dragActive"
  | "runReview"
  | "runAgain"
  | "clearFile"
  | "reviewObjective"
  | "optional"
  | "objectivePlaceholder"
  | "objectiveHint"
  | "samplesAndData"
  | "useMixedSample"
  | "sampleOutcomes"
  | "sampleHint"
  | "recentRun"
  | "noRecentRun"
  | "ready"
  | "viewAllRuns"
  | "findings"
  | "findingsBody"
  | "reportPreview"
  | "reportPreviewBody"
  | "runContext"
  | "runContextBody"
  | "reportSummary"
  | "reportSummaryBody"
  | "reportOutline"
  | "reportDetails"
  | "sourceFile"
  | "schema"
  | "rulePack"
  | "completedAt"
  | "reviewedEntities"
  | "doorCount"
  | "notApplicable"
  | "noApplicableDoorsTitle"
  | "noApplicableDoorsBody"
  | "noExecutableRulesTitle"
  | "noExecutableRulesBody"
  | "notApplicableBody"
  | "scopeStatus"
  | "inspectAnotherModel"
  | "status"
  | "detail"
  | "totalFindings"
  | "pass"
  | "fail"
  | "review"
  | "all"
  | "showing"
  | "entities"
  | "scrollForMore"
  | "scrollForPrevious"
  | "findingIndex"
  | "selectFinding"
  | "decisionSummary"
  | "actualValue"
  | "requiredValue"
  | "difference"
  | "modelEvidence"
  | "ruleEvidence"
  | "recommendedNextStep"
  | "entity"
  | "globalId"
  | "ifcClass"
  | "storey"
  | "rawValue"
  | "normalizedValue"
  | "clause"
  | "parameters"
  | "sourcePath"
  | "reliability"
  | "category"
  | "authority"
  | "limitation"
  | "agentTrace"
  | "agentTraceBody"
  | "steps"
  | "toolCalls"
  | "stopReason"
  | "newRunBody"
  | "noRuns"
  | "openFindings"
  | "historyBody"
  | "historyLocalOnly"
  | "historyServerRetention"
  | "historyLoading"
  | "historyEmpty"
  | "openHistory"
  | "deleteHistory"
  | "clearHistory"
  | "historyDeleteConfirm"
  | "historyClearConfirm"
  | "ruleProfilesTitle"
  | "ruleProfilesBody"
  | "enabled"
  | "sourceTitle"
  | "ruleLimit"
  | "samplesTitle"
  | "samplesBody"
  | "searchSamples"
  | "runSample"
  | "sampleExpected"
  | "backgroundRunTitle"
  | "backgroundRunBody"
  | "backgroundRunCompleteTitle"
  | "backgroundRunCompleteBody"
  | "viewRunProgress"
  | "viewRunResults"
  | "errorDismiss"
  | "deletedTitle"
  | "deletedBody"
  | "copyJson"
  | "printReport"
  | "deleteReview"
  | "deleteConfirm"
  | "deleting"
  | "deleteError"
  | "copyError"
  | "copyMarkdown"
  | "copiedJson"
  | "copiedMarkdown"
  | "quickCheckTitle"
  | "quickCheckBody"
  | "quickCheckSource"
  | "quickCheckSummary"
  | "quickCheckChecks"
  | "quickCheckNoAction"
  | "quickCheckReference"
  | "quickCheckEvidence"
  | "quickCheckRecommendation"
  | "quickCheckLimitation"
  | "sourceHash"
  | "actionableChecks"
  | "model"
  | "restore";

const UI_EN: Record<UiCopyKey, string> = {
  overview: "Overview",
  newReview: "New review",
  reviewRuns: "Review history",
  ruleProfiles: "Rule profiles",
  samplesData: "Samples & data",
  collapseSidebar: "Collapse sidebar",
  expandSidebar: "Expand sidebar",
  openNavigation: "Open navigation",
  closeNavigation: "Close navigation",
  workspace: "Workspace",
  retainedRun: "Retained run",
  ruleCatalogLabel: "Rule catalog",
  localProfileLabel: "Local profile",
  bundledFixturesLabel: "Bundled IFC fixtures",
  available: "Available",
  noSampleMatches: "No samples match this search.",
  samplePurpose: "Test purpose",
  batchImport: "Batch import",
  batchImportHint: "Select multiple IFC files. Each file is reviewed independently; files over 50 MiB are skipped and the remaining files continue.",
  selectedFiles: "Selected IFC files",
  filesSelected: "files selected",
  runBatchReview: "Run batch review",
  batchReviewNote: "Files are processed one at a time and saved as separate history entries.",
  batchResultsTitle: "Batch review results",
  batchResultsBody: "Select a completed file below for full evidence; this summary is for quick triage.",
  batchSummary: "Batch summary",
  batchCompletedFiles: "Completed files",
  batchFailedFiles: "Failed files",
  batchSkippedFiles: "Skipped files",
  batchActionable: "Actionable items",
  batchFileResults: "Per-file results",
  batchFailedFile: "Could not review this file",
  batchQueued: "Queued",
  batchRunning: "Running",
  batchCompleted: "Completed",
  batchFailed: "Failed",
  batchSkipped: "Skipped — over 50 MiB",
  batchFileTooLargeWillSkip: "Over 50 MiB; will be skipped in this batch",
  batchRequestTooLarge: "Upload rejected with HTTP 413; this is not a rule failure.",
  batchViewResult: "View full result",
  backToBatch: "Back to batch results",
  batchSelectionHint: "Select completed files for the PDF; click a filename to open its full review.",
  selectBatchFile: "Select this file for PDF",
  selectAllBatchFiles: "Select all completed files",
  clearBatchSelection: "Clear selection",
  batchSelectedCount: "selected",
  exportBatchPdf: "Export selected PDF",
  batchPdfNoSelection: "Select at least one completed file before exporting the PDF.",
  runSelectedSamples: "Run selected samples",
  selectAllSamples: "Select all",
  clearAllSamples: "Clear selection",
  selectedSamples: "selected",
  overviewTitle: "Start a review",
  overviewBody: "Upload one or more IFC models and inspect each finding with its evidence.",
  startReview: "Start a review",
  startReviewBody: "Upload a model or run a sample to begin.",
  reviewFlow: "Review setup",
  stepModel: "Model",
  stepRules: "Rules",
  stepRun: "Run",
  reviewRulesTitle: "Review rules",
  nextStep: "Next",
  previousStep: "Back",
  reviewReady: "Ready to run",
  reviewReadyBody: "Confirm the model and rules, then start the review.",
  selectedModel: "Model",
  sampleShortcut: "No IFC? Run a sample",
  scopePreview: "Review scope",
  scopePreviewBody: "The selected profile will be confirmed before the review runs.",
  scopeNext: "Next: confirm rules",
  advancedOptions: "Add a review note (optional)",
  reviewNote: "Review note",
  reviewNotePlaceholder: "Example: Focus on exit door width and missing door information.",
  reviewNoteHint: "This note provides context for the run. It does not change rules, thresholds, or verdicts.",
  modelInputTitle: "Model file",
  modelInputBody: "Upload one or more IFC models to begin the review.",
  ruleProfile: "Rule profile",
  ruleProfileHint: "Confirm the executable rules that will be used for this review.",
  configure: "Configure",
  createProfile: "Create profile",
  duplicateProfile: "Duplicate",
  editProfile: "Edit profile",
  editProfileDescription: "Edit configuration description",
  deleteProfile: "Delete profile",
  saveProfile: "Save profile",
  cancel: "Cancel",
  profileDetails: "Profile details",
  profileCatalog: "Profile catalog",
  profileSource: "Source",
  profileJurisdiction: "Jurisdiction",
  profileEdition: "Edition",
  profileStatus: "Status",
  draft: "DRAFT",
  systemProfile: "System profile",
  customProfile: "Custom profile",
  engineReady: "Executable",
  enginePending: "Catalog only",
  chooseProfile: "Choose a profile",
  profileNotReady: "This profile is catalog-only. Add a deterministic rule mapping before running a review.",
  profileCatalogNote: "Profiles are stored in this browser for the MVP. Canonical verdicts still come from the server rule pack.",
  profileReadonly: "Execution rules and thresholds are fixed in code. Edit the configuration description only; this does not change the executable rule mapping.",
  profileDescriptionEditorNote: "Only this local description is editable. The executable rule mapping, thresholds, and evidence logic remain fixed in code.",
  profileNameField: "Profile name",
  profileJurisdictionField: "Jurisdiction",
  profileSourceField: "Source document",
  profileSourceUrlField: "Official source URL",
  profileEditionField: "Edition / effective date",
  profileDescriptionField: "Description",
  profileDescriptionPlaceholder: "Explain scope, evidence, and limitations.",
  noRules: "No rules have been mapped to this profile yet.",
  selectRule: "Select a rule to inspect its details.",
  ruleDetail: "Rule detail",
  officialSource: "Open official source",
  useProfile: "Use for new review",
  selected: "Selected",
  deleteProfileConfirm: "Delete this custom profile? Its local configuration will be removed.",
  profileActionHint: "Hover or focus a rule to preview its details. Select it for the full source boundary.",
  profileName: "Hong Kong egress baseline",
  enabledRules: "Enabled deterministic rules",
  rulesActive: "rules active",
  mappedRules: "Mapped rules",
  active: "ACTIVE",
  modelInputHint: "IFC input",
  dropIfc: "Drop an IFC model here",
  browseFiles: "Browse files",
  dragActive: "Release to add IFC model",
  runReview: "Run review",
  runAgain: "Run again",
  clearFile: "Clear selected file",
  reviewObjective: "Review objective",
  optional: "Optional",
  objectivePlaceholder: "Example: check the enabled door information and exit width rules.",
  objectiveHint: "Up to 500 characters. This can guide the run, but never changes rule thresholds or verdicts.",
  samplesAndData: "Samples & data",
  useMixedSample: "Use mixed review sample",
  sampleOutcomes: "PASS · FAIL · REVIEW in one run",
  sampleHint: "No model yet? Run a built-in sample to see the full review path.",
  recentRun: "Recent run",
  noRecentRun: "No recent run. Upload a model or choose a bundled sample to begin.",
  ready: "Ready",
  viewAllRuns: "View all runs",
  findings: "Findings",
  findingsBody: "Evidence-backed outcomes from the deterministic review kernel.",
  reportPreview: "Review report preview",
  reportPreviewBody: "Read the conclusions and evidence before copying the Quick Check or printing the report.",
  runContext: "Run context",
  runContextBody: "The source, schema, rule pack, and completion time for this review.",
  reportSummary: "Review summary",
  reportSummaryBody: "Start with the findings that need attention, then open the supporting evidence below.",
  reportOutline: "Report outline",
  reportDetails: "Finding details",
  sourceFile: "Source file",
  schema: "IFC schema",
  rulePack: "Rule pack",
  completedAt: "Completed",
  reviewedEntities: "Reviewed entities",
  doorCount: "IfcDoor elements",
  notApplicable: "Not applicable",
  noApplicableDoorsTitle: "No applicable door occurrences",
  noApplicableDoorsBody: "The current rule pack checks IfcDoor occurrences, but this model contains none. The result cannot be evaluated; it is not a PASS result.",
  noExecutableRulesTitle: "No executable rules enabled",
  noExecutableRulesBody: "No runnable rules were enabled for this run. The result cannot be evaluated; it is not a PASS result.",
  notApplicableBody: "The numeric summary stays at zero because no findings were created. That zero is not the same as PASS.",
  scopeStatus: "Scope status",
  inspectAnotherModel: "Review another IFC",
  status: "Status",
  detail: "Detail",
  totalFindings: "Total findings",
  pass: "PASS",
  fail: "FAIL",
  review: "REVIEW",
  all: "All",
  showing: "Showing",
  entities: "entities",
  scrollForMore: "Scroll for more",
  scrollForPrevious: "Scroll up to revisit",
  findingIndex: "Finding index",
  selectFinding: "Select a finding to inspect its evidence.",
  decisionSummary: "Decision summary",
  actualValue: "Actual",
  requiredValue: "Required",
  difference: "Difference",
  modelEvidence: "Model evidence",
  ruleEvidence: "Rule evidence",
  recommendedNextStep: "Recommended next step",
  entity: "Entity",
  globalId: "GlobalId",
  ifcClass: "IFC class",
  storey: "Storey",
  rawValue: "Raw value",
  normalizedValue: "Normalized",
  clause: "Clause / table",
  parameters: "Parameters",
  sourcePath: "Source path",
  reliability: "Reliability",
  category: "Category",
  authority: "Authority",
  limitation: "Limitation",
  agentTrace: "Run details",
  agentTraceBody: "Expand to review public lifecycle events, tool calls, and the terminal reason.",
  steps: "steps",
  toolCalls: "tool calls",
  stopReason: "stop reason",
  newRunBody: "Start another local review with the same evidence-first contract.",
  noRuns: "No history on this device yet.",
  openFindings: "Open findings",
  historyBody: "Open a previous result without rerunning the IFC. History is saved on this device only.",
  historyLocalOnly: "Saved on this device",
  historyServerRetention: "Anonymous server copy: 24 hours",
  historyLoading: "Loading history…",
  historyEmpty: "No completed reviews have been saved on this device yet.",
  openHistory: "Open result",
  deleteHistory: "Remove from history",
  clearHistory: "Clear history",
  historyDeleteConfirm: "Remove this result from the history on this device? The server copy is not deleted by this action.",
  historyClearConfirm: "Clear all review history saved on this device? This cannot be undone.",
  ruleProfilesTitle: "Rule profiles",
  ruleProfilesBody: "The UI selects a profile; deterministic code owns the actual thresholds and verdicts.",
  enabled: "Enabled",
  sourceTitle: "Source and authority",
  ruleLimit: "Current MVP scope: required door information and exit clear width. This is not statutory certification.",
  samplesTitle: "Samples & data",
  samplesBody: "Each bundled IFC fixture targets a different evidence boundary. They are synthetic regression cases, not project models or compliance certificates.",
  searchSamples: "Search samples",
  runSample: "Run sample",
  sampleExpected: "Expected path",
  backgroundRunTitle: "Review running in background",
  backgroundRunBody: "You can move to another section. This review will continue here.",
  backgroundRunCompleteTitle: "Review complete",
  backgroundRunCompleteBody: "The verified result is ready to inspect.",
  viewRunProgress: "View progress",
  viewRunResults: "View results",
  errorDismiss: "Dismiss error",
  deletedTitle: "This review was deleted",
  deletedBody: "The server-retained result and this device's history entry were removed. The original IFC file was not deleted and was never durably stored.",
  copyJson: "Copy JSON",
  copyMarkdown: "Copy Markdown",
  copiedJson: "JSON copied",
  copiedMarkdown: "Markdown copied",
  printReport: "Print PDF",
  deleteReview: "Delete this review",
  deleteConfirm: "Delete this review result? This removes the server-retained result and this device's history entry. The original IFC file is not deleted. This cannot be undone.",
  deleting: "Deleting…",
  deleteError: "This review result could not be deleted. Please try again.",
  copyError: "The Quick Check content could not be copied.",
  quickCheckTitle: "Review Quick Check",
  quickCheckBody: "A concise handoff for engineering triage and agent consumption. Full evidence remains available in the web preview.",
  quickCheckSource: "Source",
  quickCheckSummary: "Summary",
  quickCheckChecks: "Actionable checks",
  quickCheckNoAction: "No FAIL or REVIEW items require action.",
  quickCheckReference: "Reference",
  quickCheckEvidence: "Evidence",
  quickCheckRecommendation: "Recommendation",
  quickCheckLimitation: "Limitation",
  sourceHash: "SHA-256",
  actionableChecks: "actionable",
  model: "Model",
  restore: "Restoring the retained run from this browser session…",
};

const UI_ZH_CN: Partial<Record<UiCopyKey, string>> = {
  overview: "概览",
  newReview: "新建审查",
  reviewRuns: "历史记录",
  ruleProfiles: "规则配置",
  samplesData: "样例与数据",
  collapseSidebar: "收起侧栏",
  expandSidebar: "展开侧栏",
  openNavigation: "打开导航",
  closeNavigation: "关闭导航",
  workspace: "工作区",
  retainedRun: "已保留运行",
  ruleCatalogLabel: "规则目录",
  localProfileLabel: "本地配置",
  bundledFixturesLabel: "内置 IFC 样例",
  available: "可用",
  noSampleMatches: "没有符合搜索条件的样例。",
  samplePurpose: "测试目的",
  batchImport: "批量导入",
  batchImportHint: "可同时选择多个 IFC 文件。每个文件独立审查；超过 50 MiB 的文件会单独跳过，其余文件继续执行。",
  selectedFiles: "已选择的 IFC 文件",
  filesSelected: "个文件已选择",
  runBatchReview: "运行批量审查",
  batchReviewNote: "文件会逐个处理，并分别保存到历史记录。",
  batchResultsTitle: "批量审查结果",
  batchResultsBody: "点击下方已完成文件查看完整证据；此页摘要用于快速分流。",
  batchSummary: "批量摘要",
  batchCompletedFiles: "已完成文件",
  batchFailedFiles: "失败文件",
  batchSkippedFiles: "已跳过文件",
  batchActionable: "需要处理项",
  batchFileResults: "逐文件结果",
  batchFailedFile: "这个文件未能完成审查",
  batchQueued: "排队中",
  batchRunning: "审查中",
  batchCompleted: "已完成",
  batchFailed: "失败",
  batchSkipped: "已跳过 · 超过 50 MiB",
  batchFileTooLargeWillSkip: "超过 50 MiB；本批次将跳过",
  batchRequestTooLarge: "上传请求被 HTTP 413 拒绝；这不是规则判定失败。",
  batchViewResult: "查看完整结果",
  backToBatch: "返回批量结果",
  batchSelectionHint: "勾选已完成文件导出 PDF；点击文件名打开完整审查结果。",
  selectBatchFile: "选择此文件导出 PDF",
  selectAllBatchFiles: "全选已完成文件",
  clearBatchSelection: "清除选择",
  batchSelectedCount: "个已选择",
  exportBatchPdf: "导出所选 PDF",
  batchPdfNoSelection: "导出 PDF 前，请至少选择一个已完成文件。",
  runSelectedSamples: "运行选中样例",
  selectAllSamples: "全选",
  clearAllSamples: "清空选择",
  selectedSamples: "个已选择",
  overviewTitle: "开始一次审查",
  overviewBody: "上传一个或多个 IFC 模型，查看每条结论的证据。",
  startReview: "开始审查",
  startReviewBody: "上传模型，或直接运行一个样例。",
  reviewFlow: "审查流程",
  stepModel: "模型",
  stepRules: "规则",
  stepRun: "运行",
  reviewRulesTitle: "审查规则",
  nextStep: "下一步",
  previousStep: "上一步",
  reviewReady: "准备运行",
  reviewReadyBody: "确认模型和规则配置，然后开始审查。",
  selectedModel: "模型",
  sampleShortcut: "没有 IFC？运行样例",
  scopePreview: "审查范围",
  scopePreviewBody: "确认规则配置后，将按当前配置开始审查。",
  scopeNext: "下一步：确认规则",
  advancedOptions: "添加审查说明（可选）",
  reviewNote: "审查说明",
  reviewNotePlaceholder: "例如：重点关注出口门净宽和缺少的门信息。",
  reviewNoteHint: "这段说明只用于补充本次审查的背景，不会改变规则、阈值或判定。",
  modelInputTitle: "模型文件",
  modelInputBody: "上传一个或多个 IFC 模型即可开始审查。",
  ruleProfile: "规则配置",
  ruleProfileHint: "确认这次审查将使用的可执行规则。",
  configure: "配置",
  createProfile: "创建配置",
  duplicateProfile: "复制配置",
  editProfile: "编辑配置",
  editProfileDescription: "编辑配置说明",
  deleteProfile: "删除配置",
  saveProfile: "保存配置",
  cancel: "取消",
  profileDetails: "配置详情",
  profileCatalog: "规则配置目录",
  profileSource: "来源",
  profileJurisdiction: "适用地区",
  profileEdition: "版本",
  profileStatus: "状态",
  draft: "草案",
  systemProfile: "系统配置",
  customProfile: "自定义配置",
  engineReady: "可执行",
  enginePending: "仅目录",
  chooseProfile: "选择规则配置",
  profileNotReady: "这个配置目前仅是来源目录，尚未接入确定性规则引擎，不能用于运行审查。",
  profileCatalogNote: "MVP 阶段的配置保存在当前浏览器中；权威判定仍然来自服务端规则包。",
  profileReadonly: "执行规则和阈值由代码固定；可编辑配置说明，但不会改变实际执行规则。",
  profileDescriptionEditorNote: "这里只编辑当前浏览器中的配置说明；实际执行规则、阈值和证据逻辑仍由代码固定。",
  profileNameField: "配置名称",
  profileJurisdictionField: "适用地区",
  profileSourceField: "规范来源",
  profileSourceUrlField: "官方来源链接",
  profileEditionField: "版本 / 生效日期",
  profileDescriptionField: "说明",
  profileDescriptionPlaceholder: "说明适用范围、证据要求和限制条件。",
  noRules: "这个配置还没有映射任何规则。",
  selectRule: "选择一条规则查看详细内容。",
  ruleDetail: "规则细则",
  officialSource: "打开官方来源",
  useProfile: "用于新建审查",
  selected: "当前选择",
  deleteProfileConfirm: "删除这个自定义配置？它保存在本地的配置内容会被移除。",
  profileActionHint: "鼠标悬停或键盘聚焦规则可预览细则；点击后查看完整来源边界。",
  profileName: "香港疏散基线",
  enabledRules: "已启用确定性规则",
  rulesActive: "条规则已启用",
  mappedRules: "已映射规则",
  active: "启用",
  modelInputHint: "IFC 输入",
  dropIfc: "将 IFC 模型拖到这里",
  browseFiles: "浏览文件",
  dragActive: "松开以添加 IFC 模型",
  runReview: "运行审查",
  runAgain: "再次运行",
  clearFile: "清除所选文件",
  reviewObjective: "审查目标",
  optional: "可选",
  objectivePlaceholder: "例如：检查已启用的门信息与出口宽度规则。",
  objectiveHint: "最多 500 字。目标只能引导运行，不能改变规则阈值或判定。",
  samplesAndData: "样例与数据",
  useMixedSample: "使用混合审查样例",
  sampleOutcomes: "一次查看 PASS · FAIL · REVIEW",
  sampleHint: "还没有模型？先运行一个内置样例，看看完整审查流程。",
  recentRun: "最近运行",
  noRecentRun: "还没有最近运行。上传模型或选择内置样例开始。",
  ready: "就绪",
  viewAllRuns: "查看全部运行",
  findings: "发现",
  findingsBody: "来自确定性审查内核、由证据支撑的结果。",
  reportPreview: "审查报告预览",
  reportPreviewBody: "在复制 Quick Check 或打印报告之前，先查看本次审查的结论与证据。",
  runContext: "运行信息",
  runContextBody: "本次审查使用的源文件、Schema、规则包和完成时间。",
  reportSummary: "审查结果摘要",
  reportSummaryBody: "先查看需要关注的发现，再向下阅读每条结果的证据。",
  reportOutline: "报告目录",
  reportDetails: "发现详情",
  sourceFile: "源文件",
  schema: "IFC Schema",
  rulePack: "规则包",
  completedAt: "完成时间",
  reviewedEntities: "已检查构件",
  doorCount: "IfcDoor 门构件",
  notApplicable: "不适用",
  noApplicableDoorsTitle: "没有可审查的门构件",
  noApplicableDoorsBody: "当前规则包检查 IfcDoor 门构件，但这个模型中没有门构件实例。结果无法评价；这不等同于“通过”。",
  noExecutableRulesTitle: "没有启用可执行规则",
  noExecutableRulesBody: "本次运行没有启用可执行规则。结果无法评价；这不等同于“通过”。",
  notApplicableBody: "数字摘要保持为 0，是因为没有创建任何发现；这个 0 不等同于“通过”。",
  scopeStatus: "适用范围状态",
  inspectAnotherModel: "审查其他 IFC",
  status: "状态",
  detail: "详情",
  totalFindings: "发现总数",
  pass: "通过",
  fail: "失败",
  review: "待复核",
  all: "全部",
  showing: "正在显示",
  entities: "个构件",
  scrollForMore: "向下滚动查看更多",
  scrollForPrevious: "向上滚动查看上方内容",
  findingIndex: "发现索引",
  selectFinding: "请选择一条发现查看证据。",
  decisionSummary: "判定摘要",
  actualValue: "实际值",
  requiredValue: "要求值",
  difference: "差值",
  modelEvidence: "模型证据",
  ruleEvidence: "规则证据",
  recommendedNextStep: "建议下一步",
  entity: "构件",
  globalId: "GlobalId",
  ifcClass: "IFC 类别",
  storey: "楼层",
  rawValue: "原始值",
  normalizedValue: "归一化值",
  clause: "条文 / 表格",
  parameters: "参数",
  sourcePath: "来源路径",
  reliability: "可靠性",
  category: "类别",
  authority: "权威类型",
  limitation: "限制",
  agentTrace: "运行详情",
  agentTraceBody: "展开查看公开生命周期事件、工具调用和终止原因。",
  newRunBody: "沿用相同的证据优先契约开始下一次本地审查。",
  noRuns: "此设备还没有历史记录。",
  openFindings: "打开发现",
  historyBody: "无需重新运行 IFC，即可打开之前的结果。历史记录只保存在此设备上。",
  historyLocalOnly: "仅保存在此设备",
  historyServerRetention: "匿名服务端副本：24 小时",
  historyLoading: "正在加载历史记录…",
  historyEmpty: "此设备还没有保存完成的审查。",
  openHistory: "打开结果",
  deleteHistory: "从历史记录移除",
  clearHistory: "清空历史记录",
  historyDeleteConfirm: "从此设备的历史记录中移除这条结果？此操作不会删除服务端副本。",
  historyClearConfirm: "清空此设备上保存的全部审查历史？此操作无法撤销。",
  ruleProfilesTitle: "规则配置",
  ruleProfilesBody: "界面负责选择配置；实际阈值和判定由确定性代码拥有。",
  enabled: "已启用",
  sourceTitle: "来源与权威",
  ruleLimit: "当前 MVP 范围：必要门信息与出口净宽。不构成法定认证。",
  samplesTitle: "样例与数据",
  samplesBody: "每个内置 IFC 样例都针对不同的证据边界。它们是合成回归案例，不是项目模型，也不产生合规认证结论。",
  searchSamples: "搜索样例",
  runSample: "运行样例",
  sampleExpected: "预期路径",
  backgroundRunTitle: "审查正在后台运行",
  backgroundRunBody: "可以先去其他页面；这次审查会继续运行。",
  backgroundRunCompleteTitle: "审查已完成",
  backgroundRunCompleteBody: "经过验证的结果已准备好查看。",
  viewRunProgress: "查看运行状态",
  viewRunResults: "查看结果",
  errorDismiss: "关闭错误",
  deletedTitle: "本次审查已删除",
  deletedBody: "服务端留存的审查结果和此设备上的历史记录已移除。原始 IFC 文件没有被删除，也从未被持久化保存。",
  copyJson: "复制 JSON",
  copyMarkdown: "复制 Markdown",
  copiedJson: "已复制 JSON",
  copiedMarkdown: "已复制 Markdown",
  printReport: "打印 PDF",
  deleteReview: "删除本次审查",
  deleteConfirm: "确定删除本次审查结果吗？这会移除服务端留存的结果和此设备上的历史记录；原始 IFC 文件不会被删除。此操作无法撤销。",
  deleting: "正在删除…",
  deleteError: "无法删除本次审查结果，请重试。",
  copyError: "无法复制 Quick Check 内容。",
  quickCheckTitle: "审查快速检查",
  quickCheckBody: "用于工程人员快速分流和 Agent 读取的精简交接单；完整证据仍保留在网页预览中。",
  quickCheckSource: "来源",
  quickCheckSummary: "摘要",
  quickCheckChecks: "需要处理的检查",
  quickCheckNoAction: "没有需要处理的失败或待复核项目。",
  quickCheckReference: "参考",
  quickCheckEvidence: "证据",
  quickCheckRecommendation: "建议",
  quickCheckLimitation: "限制",
  sourceHash: "SHA-256",
  actionableChecks: "项需要处理",
  model: "模型",
  restore: "正在从当前浏览器会话恢复留存运行…",
};

const UI_ZH_HANT: Partial<Record<UiCopyKey, string>> = {
  ...UI_ZH_CN,
  overview: "概覽",
  newReview: "新增審查",
  reviewRuns: "歷史記錄",
  ruleProfiles: "規則設定",
  samplesData: "範例與資料",
  workspace: "工作區",
  retainedRun: "已保留執行",
  ruleCatalogLabel: "規則目錄",
  localProfileLabel: "本地設定",
  bundledFixturesLabel: "內建 IFC 範例",
  available: "可用",
  noSampleMatches: "沒有符合搜尋條件的範例。",
  samplePurpose: "測試目的",
  batchImport: "批量匯入",
  batchImportHint: "可同時選擇多個 IFC 檔案。每個檔案獨立審查；超過 50 MiB 的檔案會單獨跳過，其餘檔案繼續執行。",
  selectedFiles: "已選擇的 IFC 檔案",
  filesSelected: "個檔案已選擇",
  runBatchReview: "執行批量審查",
  batchReviewNote: "檔案會逐個處理，並分別保存到歷史記錄。",
  batchResultsTitle: "批量審查結果",
  batchResultsBody: "點擊下方已完成檔案查看完整證據；此頁摘要用於快速分流。",
  batchSummary: "批量摘要",
  batchCompletedFiles: "已完成檔案",
  batchFailedFiles: "失敗檔案",
  batchSkippedFiles: "已跳過檔案",
  batchActionable: "需要處理項目",
  batchFileResults: "逐檔結果",
  batchFailedFile: "這個檔案未能完成審查",
  batchQueued: "排隊中",
  batchRunning: "審查中",
  batchCompleted: "已完成",
  batchFailed: "失敗",
  batchSkipped: "已跳過 · 超過 50 MiB",
  batchFileTooLargeWillSkip: "超過 50 MiB；本批次將跳過",
  batchRequestTooLarge: "上傳請求被 HTTP 413 拒絕；這不是規則判定失敗。",
  batchViewResult: "查看完整結果",
  backToBatch: "返回批量結果",
  batchSelectionHint: "勾選已完成檔案匯出 PDF；點擊檔案名稱開啟完整審查結果。",
  selectBatchFile: "選擇此檔案匯出 PDF",
  selectAllBatchFiles: "全選已完成檔案",
  clearBatchSelection: "清除選擇",
  batchSelectedCount: "個已選擇",
  exportBatchPdf: "匯出所選 PDF",
  batchPdfNoSelection: "匯出 PDF 前，請至少選擇一個已完成檔案。",
  runSelectedSamples: "執行已選範例",
  selectAllSamples: "全選",
  clearAllSamples: "清除選擇",
  selectedSamples: "個已選擇",
  collapseSidebar: "收起側欄",
  expandSidebar: "展開側欄",
  overviewTitle: "開始一次審查",
  overviewBody: "上傳一個或多個 IFC 模型，查看每條結論的證據。",
  reviewFlow: "審查流程",
  stepModel: "模型",
  stepRules: "規則",
  stepRun: "執行",
  reviewRulesTitle: "審查規則",
  nextStep: "下一步",
  previousStep: "上一步",
  reviewReady: "準備執行",
  reviewReadyBody: "確認模型和規則設定，然後開始審查。",
  selectedModel: "模型",
  sampleShortcut: "沒有 IFC？執行範例",
  scopePreview: "審查範圍",
  scopePreviewBody: "確認規則設定後，將按目前設定開始審查。",
  scopeNext: "下一步：確認規則",
  advancedOptions: "加入審查說明（可選）",
  reviewNote: "審查說明",
  reviewNotePlaceholder: "例如：重點關注出口門淨寬和缺少的門資料。",
  reviewNoteHint: "這段說明只用於補充本次審查背景，不會改變規則、閾值或判定。",
  modelInputTitle: "模型檔案",
  modelInputBody: "上傳一個或多個 IFC 模型即可開始審查。",
  startReview: "開始審查",
  startReviewBody: "上傳模型，或直接執行範例。",
  ruleProfile: "規則設定",
  ruleProfileHint: "確認這次審查將使用的可執行規則。",
  configure: "設定",
  createProfile: "建立設定",
  duplicateProfile: "複製設定",
  editProfile: "編輯設定",
  editProfileDescription: "編輯設定說明",
  deleteProfile: "刪除設定",
  saveProfile: "儲存設定",
  cancel: "取消",
  profileDetails: "設定詳情",
  profileCatalog: "規則設定目錄",
  profileSource: "來源",
  profileJurisdiction: "適用地區",
  profileEdition: "版本",
  profileStatus: "狀態",
  draft: "草稿",
  systemProfile: "系統設定",
  customProfile: "自訂設定",
  engineReady: "可執行",
  enginePending: "僅目錄",
  chooseProfile: "選擇規則設定",
  profileNotReady: "這個設定目前僅是來源目錄，尚未接入確定性規則引擎，不能用於執行審查。",
  profileCatalogNote: "MVP 階段的設定保存在目前瀏覽器中；權威判定仍然來自伺服器規則包。",
  profileReadonly: "執行規則和閾值由程式碼固定；可編輯設定說明，但不會改變實際執行規則。",
  profileDescriptionEditorNote: "這裡只編輯目前瀏覽器中的設定說明；實際執行規則、閾值和證據邏輯仍由程式碼固定。",
  profileNameField: "設定名稱",
  profileJurisdictionField: "適用地區",
  profileSourceField: "規範來源",
  profileSourceUrlField: "官方來源連結",
  profileEditionField: "版本／生效日期",
  profileDescriptionField: "說明",
  profileDescriptionPlaceholder: "說明適用範圍、證據要求和限制條件。",
  noRules: "這個設定尚未映射任何規則。",
  selectRule: "選擇一條規則查看詳細內容。",
  ruleDetail: "規則詳情",
  officialSource: "開啟官方來源",
  useProfile: "用於新增審查",
  selected: "目前選擇",
  deleteProfileConfirm: "刪除這個自訂設定？它保存在本地的設定內容會被移除。",
  profileActionHint: "滑鼠懸停或鍵盤聚焦規則可預覽細則；點選後查看完整來源邊界。",
  profileName: "香港疏散基線",
  rulesActive: "條規則已啟用",
  mappedRules: "已映射規則",
  active: "啟用",
  authority: "權威類型",
  limitation: "限制",
  category: "類別",
  dropIfc: "將 IFC 模型拖到這裡",
  browseFiles: "瀏覽檔案",
  runReview: "執行審查",
  runAgain: "再次執行",
  clearFile: "清除所選檔案",
  reviewObjective: "審查目標",
  useMixedSample: "使用混合審查範例",
  findings: "發現",
  findingsBody: "來自確定性審查核心、由證據支撐的結果。",
  agentTrace: "執行詳情",
  agentTraceBody: "展開查看公開生命週期事件、工具呼叫和終止原因。",
  reportPreview: "審查報告預覽",
  reportPreviewBody: "在複製 Quick Check 或列印報告之前，先查看這次審查的結論與證據。",
  runContext: "執行資訊",
  runContextBody: "這次審查使用的來源檔案、Schema、規則包和完成時間。",
  reportSummary: "審查結果摘要",
  reportSummaryBody: "先查看需要關注的發現，再向下閱讀每條結果的證據。",
  reportOutline: "報告目錄",
  reportDetails: "發現詳情",
  sourceFile: "來源檔案",
  schema: "IFC Schema",
  rulePack: "規則包",
  completedAt: "完成時間",
  reviewedEntities: "已檢查構件",
  doorCount: "IfcDoor 門構件",
  notApplicable: "不適用",
  noApplicableDoorsTitle: "沒有可審查的門構件",
  noApplicableDoorsBody: "目前規則包檢查 IfcDoor 門構件，但這個模型中沒有門構件實例。結果無法評價；這不等同於「通過」。",
  noExecutableRulesTitle: "沒有啟用可執行規則",
  noExecutableRulesBody: "這次執行沒有啟用可執行規則。結果無法評價；這不等同於「通過」。",
  notApplicableBody: "數字摘要保持為 0，是因為沒有建立任何發現；這個 0 不等同於「通過」。",
  scopeStatus: "適用範圍狀態",
  inspectAnotherModel: "審查其他 IFC",
  status: "狀態",
  detail: "詳情",
  totalFindings: "發現總數",
  pass: "通過",
  fail: "失敗",
  review: "待覆核",
  entities: "個構件",
  scrollForMore: "向下滾動查看更多",
  scrollForPrevious: "向上滾動查看上方內容",
  decisionSummary: "判定摘要",
  actualValue: "實際值",
  requiredValue: "要求值",
  difference: "差值",
  modelEvidence: "模型證據",
  ruleEvidence: "規則證據",
  recommendedNextStep: "建議下一步",
  ruleProfilesTitle: "規則設定",
  ruleProfilesBody: "介面負責選擇設定；實際閾值和判定由確定性程式碼負責。",
  samplesTitle: "範例與資料",
  samplesBody: "每個內建 IFC 範例都針對不同的證據邊界。它們是合成回歸案例，不是專案模型，也不產生合規認證結論。",
  sampleOutcomes: "一次查看 PASS · FAIL · REVIEW",
  sampleHint: "還沒有模型？先執行一個內建範例，看看完整審查流程。",
  sampleExpected: "預期路徑",
  recentRun: "最近執行",
  noRecentRun: "還沒有最近執行。上傳模型或選擇內建範例開始。",
  ready: "就緒",
  viewAllRuns: "查看全部執行",
  newRunBody: "沿用相同的證據優先契約開始下一次本地審查。",
  noRuns: "此裝置還沒有歷史記錄。",
  openFindings: "開啟發現",
  historyBody: "無需重新執行 IFC，即可開啟之前的結果。歷史記錄只保存在此裝置上。",
  historyLocalOnly: "只保存在此裝置",
  historyServerRetention: "匿名伺服器副本：24 小時",
  historyLoading: "正在載入歷史記錄…",
  historyEmpty: "此裝置還沒有保存完成的審查。",
  openHistory: "開啟結果",
  deleteHistory: "從歷史記錄移除",
  clearHistory: "清空歷史記錄",
  historyDeleteConfirm: "從此裝置的歷史記錄中移除這項結果？此操作不會刪除伺服器副本。",
  historyClearConfirm: "清空此裝置上保存的全部審查歷史？此操作無法復原。",
  openNavigation: "開啟導覽",
  closeNavigation: "關閉導覽",
  enabledRules: "已啟用確定性規則",
  modelInputHint: "IFC 輸入",
  dragActive: "放開以加入 IFC 模型",
  optional: "可選",
  objectivePlaceholder: "例如：檢查已啟用的門資料與出口寬度規則。",
  objectiveHint: "最多 500 字。目標只能引導執行，不能改變規則閾值或判定。",
  samplesAndData: "範例與資料",
  all: "全部",
  showing: "顯示",
  findingIndex: "發現索引",
  selectFinding: "選擇一條發現查看其證據。",
  entity: "構件",
  globalId: "GlobalId",
  ifcClass: "IFC 類別",
  storey: "樓層",
  rawValue: "原始值",
  normalizedValue: "正規化值",
  clause: "條文 / 表格",
  parameters: "參數",
  sourcePath: "來源路徑",
  reliability: "可靠性",
  enabled: "已啟用",
  sourceTitle: "來源與權威",
  ruleLimit: "目前 MVP 範圍：必要門資料與出口淨寬。不構成法定認證。",
  errorDismiss: "關閉錯誤",
  deletedTitle: "這次審查已刪除",
  deletedBody: "伺服器留存的審查結果和此裝置上的歷史記錄已移除。原始 IFC 檔案沒有被刪除，也從未被持久化保存。",
  deleteConfirm: "確定刪除這次審查結果嗎？這會移除伺服器留存的結果和此裝置上的歷史記錄；原始 IFC 檔案不會被刪除。此操作無法復原。",
  deleting: "正在刪除…",
  deleteError: "無法刪除這次審查結果，請重試。",
  restore: "正在從目前瀏覽器工作階段恢復留存執行…",
  searchSamples: "搜尋範例",
  runSample: "執行範例",
  backgroundRunTitle: "審查正在背景執行",
  backgroundRunBody: "可以先前往其他頁面；這次審查會繼續執行。",
  backgroundRunCompleteTitle: "審查已完成",
  backgroundRunCompleteBody: "經過驗證的結果已準備好查看。",
  viewRunProgress: "查看執行狀態",
  viewRunResults: "查看結果",
  copyJson: "複製 JSON",
  copyMarkdown: "複製 Markdown",
  copiedJson: "已複製 JSON",
  copiedMarkdown: "已複製 Markdown",
  printReport: "列印 PDF",
  deleteReview: "刪除這次審查",
  copyError: "無法複製 Quick Check 內容。",
  quickCheckTitle: "審查快速檢查",
  quickCheckBody: "用於工程人員快速分流和 Agent 讀取的精簡交接單；完整證據仍保留在網頁預覽中。",
  quickCheckSource: "來源",
  quickCheckSummary: "摘要",
  quickCheckChecks: "需要處理的檢查",
  quickCheckNoAction: "沒有需要處理的失敗或待覆核項目。",
  quickCheckReference: "參考",
  quickCheckEvidence: "證據",
  quickCheckRecommendation: "建議",
  quickCheckLimitation: "限制",
  sourceHash: "SHA-256",
  actionableChecks: "項需要處理",
  model: "模型",
};

type Sample = {
  id: "clean" | "missing_information" | "mixed_review" | "narrow_exit" | "proxy_width";
  title: string;
  titleZh?: string;
  titleHant?: string;
  detail: string;
  detailZh?: string;
  detailHant?: string;
  expected: string;
  expectedZh?: string;
  expectedHant?: string;
};

type ProfileStatus = "ACTIVE" | "DRAFT";

type ProfileRule = {
  id: string;
  title: string;
  titleZh?: string;
  titleHant?: string;
  category: string;
  categoryZh?: string;
  categoryHant?: string;
  authority: string;
  authorityZh?: string;
  authorityHant?: string;
  detail: string;
  detailZh?: string;
  detailHant?: string;
  enabled: boolean;
};

type RuleProfile = {
  id: string;
  version: string;
  name: string;
  nameZh?: string;
  nameHant?: string;
  jurisdiction: string;
  jurisdictionZh?: string;
  jurisdictionHant?: string;
  source: string;
  sourceZh?: string;
  sourceHant?: string;
  edition: string;
  status: ProfileStatus;
  engineSupported: boolean;
  builtin: boolean;
  description: string;
  descriptionZh?: string;
  descriptionHant?: string;
  limitation: string;
  limitationZh?: string;
  limitationHant?: string;
  sourceUrl?: string;
  rules: ProfileRule[];
};

type ProfileFormState = {
  id: string | null;
  mode: "duplicate" | "edit" | "description";
  name: string;
  jurisdiction: string;
  source: string;
  edition: string;
  description: string;
  limitation: string;
  sourceUrl?: string;
  rules: ProfileRule[];
};

type ProfileDescriptionOverride = {
  description?: string;
  limitation?: string;
};

type ProfileDescriptionOverrides = Record<string, Partial<Record<Locale, ProfileDescriptionOverride>>>;

const DEFAULT_RULE_PROFILES: RuleProfile[] = [
  {
    id: "hk-fire-safety-2011-2024",
    version: "1.0.0",
    name: "Hong Kong fire-safety pre-check",
    nameZh: "香港消防安全预审",
    nameHant: "香港消防安全預審",
    jurisdiction: "Hong Kong",
    jurisdictionZh: "中国香港",
    jurisdictionHant: "中國香港",
    source: "Code of Practice for Fire Safety in Buildings 2011",
    sourceZh: "《Code of Practice for Fire Safety in Buildings 2011》",
    sourceHant: "《Code of Practice for Fire Safety in Buildings 2011》",
    edition: "2024 Edition · Table B2",
    status: "ACTIVE",
    engineSupported: true,
    builtin: true,
    description: "Runs the evidence-readiness check and Table B2 exit-door clear-width pre-check from the Hong Kong Buildings Department source profile.",
    descriptionZh: "按香港屋宇署官方来源配置，检查门信息证据完整性，并按 Table B2 进行出口门净宽预审。",
    descriptionHant: "按香港屋宇署官方來源配置，檢查門資訊證據完整性，並按 Table B2 進行出口門淨寬預審。",
    limitation: "The source mapping is a deterministic pre-check and evidence report; it is not statutory certification and does not replace a qualified code review.",
    limitationZh: "这是确定性预审和证据报告，不构成法定认证，也不能替代合资格的规范审查。",
    limitationHant: "這是確定性預審和證據報告，不構成法定認證，也不能替代合資格的規範審查。",
    sourceUrl: "https://www.bd.gov.hk/doc/en/resources/codes-and-references/code-and-design-manuals/fs_code2011.pdf",
    rules: [
      {
        id: "INFO-001",
        title: "Door information evidence",
        titleZh: "门信息证据完整性",
        titleHant: "門資訊證據完整性",
        category: "Information quality",
        categoryZh: "信息质量",
        categoryHant: "資訊品質",
        authority: "Hong Kong source profile · evidence contract",
        authorityZh: "香港官方来源配置 · 证据契约",
        authorityHant: "香港官方來源配置 · 證據契約",
        detail: "Checks every IfcDoor for a non-empty name and explicit exit classification. Confirmed exit doors additionally require FireRating; clear width is evaluated by the separate egress rule, while occupant capacity is required only by capacity-based profiles. Missing or invalid evidence remains REVIEW.",
        detailZh: "逐一检查所有 IfcDoor 的门名称和明确出口分类；明确的出口门还需提供 FireRating。净开口宽度由独立的疏散规则检查，只有按人数分档的规范配置才要求使用人数。缺失或无效证据返回 REVIEW。",
        detailHant: "逐一檢查所有 IfcDoor 的門名稱和明確出口分類；明確的出口門還需提供 FireRating。淨開口寬度由獨立的疏散規則檢查，只有按人數分檔的規範設定才要求使用人數。缺失或無效證據返回 REVIEW。",
        enabled: true,
      },
      {
        id: "HK-FS-B2-DOOR-WIDTH",
        title: "Minimum clear width of an exit door",
        titleZh: "出口门最小净宽",
        titleHant: "出口門最小淨寬",
        category: "Means of escape",
        categoryZh: "疏散",
        categoryHant: "疏散",
        authority: "Hong Kong Code · Table B2; Note 2",
        authorityZh: "香港规范 · Table B2；注 2",
        authorityHant: "香港規範 · Table B2；註 2",
        detail: "Selects the minimum clear width from Table B2 using explicit occupant capacity. The measured width is the least clear width between the vertical door-frame members; OverallWidth remains a proxy and cannot produce PASS or FAIL.",
        detailZh: "根据明确的人员容量选择 Table B2 最小净宽。测量值应为门框垂直构件之间的最小净宽；OverallWidth 只能作为代理证据，不能直接产生 PASS 或 FAIL。",
        detailHant: "根據明確的人員容量選擇 Table B2 最小淨寬。測量值應為門框垂直構件之間的最小淨寬；OverallWidth 只能作為代理證據，不能直接產生 PASS 或 FAIL。",
        enabled: true,
      },
    ],
  },
  {
    id: "cn-fire-55037-2022",
    version: "1.0.0",
    name: "Mainland China fire baseline",
    nameZh: "中国大陆建筑防火基线",
    nameHant: "中國大陸建築防火基線",
    jurisdiction: "Chinese Mainland",
    jurisdictionZh: "中国大陆",
    jurisdictionHant: "中國大陸",
    source: "GB 55037-2022 Building Fire Protection General Code",
    sourceZh: "GB 55037-2022《建筑防火通用规范》",
    sourceHant: "GB 55037-2022《建築防火通用規範》",
    edition: "2022 · Effective 2023-06-01",
    status: "ACTIVE",
    engineSupported: true,
    builtin: true,
    description: "Runs the first evidence-backed GB 55037-2022 pre-check: explicit exit doors must provide a verified clear opening of at least 800 mm under Clause 7.1.4(1).",
    descriptionZh: "按 GB 55037-2022 第 7.1.4 条第 1 款，对明确标记为疏散出口的门检查已验证净开口宽度是否不小于 800 mm。",
    descriptionHant: "按 GB 55037-2022 第 7.1.4 條第 1 款，對明確標記為疏散出口的門檢查已驗證淨開口寬度是否不少於 800 mm。",
    limitation: "This is the first executable slice, not a complete GB 55037-2022 review. Door swing direction, building use, occupant load, floor or underground depth, exit count, total egress width, and geometry-derived applicability remain outside this rule pack and require human review.",
    limitationZh: "这是第一版可执行切片，不是完整的 GB 55037-2022 审查。门开启方向、建筑用途、人数、楼层或地下深度、出口数量、总疏散宽度及几何适用性暂未接入，相关事项仍需人工复核。",
    limitationHant: "這是第一版可執行切片，不是完整的 GB 55037-2022 審查。門開啟方向、建築用途、人數、樓層或地下深度、出口數量、總疏散寬度及幾何適用性尚未接入，相關事項仍需人工複核。",
    sourceUrl: "https://www.gov.cn/zhengce/zhengceku/2023-01/30/5739161/files/b1fb02d581bd4c2c866b488ea730c652.pdf",
    rules: [
      {
        id: "INFO-001",
        title: "Required evidence for mainland exit-door pre-check",
        titleZh: "中国大陆疏散出口门预审所需证据",
        titleHant: "中國大陸疏散出口門預審所需證據",
        category: "Information quality",
        categoryZh: "信息质量",
        categoryHant: "資訊品質",
        authority: "GB 55037-2022 · evidence contract",
        authorityZh: "GB 55037-2022 · 证据契约",
        authorityHant: "GB 55037-2022 · 證據契約",
        detail: "Checks IfcDoor.Name, explicit Pset_DoorCommon.FireExit, and verified Pset_BIMReview.ClearWidth. Missing or invalid values remain REVIEW; the engine never infers them from door names or OverallWidth.",
        detailZh: "检查 IfcDoor.Name、明确的 Pset_DoorCommon.FireExit 和已验证的 Pset_BIMReview.ClearWidth。缺失或无效值返回 REVIEW；引擎不会从门名称或 OverallWidth 推断。",
        detailHant: "檢查 IfcDoor.Name、明確的 Pset_DoorCommon.FireExit 和已驗證的 Pset_BIMReview.ClearWidth。缺失或無效值返回 REVIEW；引擎不會從門名稱或 OverallWidth 推斷。",
        enabled: true,
      },
      {
        id: "EGRESS-001",
        title: "Mainland exit-door clear width — GB 55037-2022 7.1.4(1)",
        titleZh: "中国大陆疏散出口门净宽 — GB 55037-2022 第 7.1.4 条第 1 款",
        titleHant: "中國大陸疏散出口門淨寬 — GB 55037-2022 第 7.1.4 條第 1 款",
        category: "Means of escape",
        categoryZh: "安全疏散",
        categoryHant: "安全疏散",
        authority: "GB 55037-2022 · Clause 7.1.4(1)",
        authorityZh: "GB 55037-2022 · 第 7.1.4 条第 1 款",
        authorityHant: "GB 55037-2022 · 第 7.1.4 條第 1 款",
        detail: "Compares an explicitly classified exit door's verified Pset_BIMReview.ClearWidth against a minimum of 800 mm. OverallWidth is a proxy only and cannot produce PASS or FAIL.",
        detailZh: "将明确标记为疏散出口的门的 Pset_BIMReview.ClearWidth 与 800 mm 下限比较。OverallWidth 只能作为代理证据，不能直接产生 PASS 或 FAIL。",
        detailHant: "將明確標記為疏散出口的門的 Pset_BIMReview.ClearWidth 與 800 mm 下限比較。OverallWidth 只能作為代理證據，不能直接產生 PASS 或 FAIL。",
        enabled: true,
      },
    ],
  },
];

function textForLocale(locale: Locale, english: string, simplified?: string, traditional?: string): string {
  if (locale === "zh-CN") return simplified ?? english;
  if (locale === "zh-Hant") return traditional ?? simplified ?? english;
  return english;
}

function profileName(profile: RuleProfile, locale: Locale): string {
  return textForLocale(locale, profile.name, profile.nameZh, profile.nameHant);
}

function profileJurisdiction(profile: RuleProfile, locale: Locale): string {
  return textForLocale(locale, profile.jurisdiction, profile.jurisdictionZh, profile.jurisdictionHant);
}

function profileSource(profile: RuleProfile, locale: Locale): string {
  return textForLocale(locale, profile.source, profile.sourceZh, profile.sourceHant);
}

function profileDescription(profile: RuleProfile, locale: Locale): string {
  const override = readProfileDescriptionOverrides()[profile.id]?.[locale]?.description;
  return override?.trim() || textForLocale(locale, profile.description, profile.descriptionZh, profile.descriptionHant);
}

function profileLimitation(profile: RuleProfile, locale: Locale): string {
  const override = readProfileDescriptionOverrides()[profile.id]?.[locale]?.limitation;
  return override?.trim() || textForLocale(locale, profile.limitation, profile.limitationZh, profile.limitationHant);
}

function profileStatusLabel(profile: RuleProfile, l: (key: UiCopyKey) => string): string {
  if (profile.engineSupported) return l("active");
  return profile.builtin ? l("enginePending") : l("draft");
}

function ruleTitle(rule: ProfileRule, locale: Locale): string {
  return textForLocale(locale, rule.title, rule.titleZh, rule.titleHant);
}

function ruleCategory(rule: ProfileRule, locale: Locale): string {
  return textForLocale(locale, rule.category, rule.categoryZh, rule.categoryHant);
}

function ruleAuthority(rule: ProfileRule, locale: Locale): string {
  return textForLocale(locale, rule.authority, rule.authorityZh, rule.authorityHant);
}

function ruleDetail(rule: ProfileRule, locale: Locale): string {
  return textForLocale(locale, rule.detail, rule.detailZh, rule.detailHant);
}

function isRuleProfile(value: unknown): value is RuleProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Partial<RuleProfile>;
  return (
    typeof profile.id === "string" &&
    typeof profile.version === "string" &&
    typeof profile.name === "string" &&
    typeof profile.jurisdiction === "string" &&
    typeof profile.source === "string" &&
    typeof profile.edition === "string" &&
    (profile.status === "ACTIVE" || profile.status === "DRAFT") &&
    typeof profile.engineSupported === "boolean" &&
    typeof profile.builtin === "boolean" &&
    typeof profile.description === "string" &&
    typeof profile.limitation === "string" &&
    Array.isArray(profile.rules) &&
    profile.rules.every((rule) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
      const item = rule as Partial<ProfileRule>;
      return (
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.category === "string" &&
        typeof item.authority === "string" &&
        typeof item.detail === "string" &&
        typeof item.enabled === "boolean"
      );
    })
  );
}

let ruleProfilesSnapshot: RuleProfile[] = DEFAULT_RULE_PROFILES;
let ruleProfilesInitialized = false;
let profileDescriptionOverridesSnapshot: ProfileDescriptionOverrides | null = null;

function readProfileDescriptionOverrides(): ProfileDescriptionOverrides {
  if (typeof window === "undefined") return {};
  if (profileDescriptionOverridesSnapshot) return profileDescriptionOverridesSnapshot;
  try {
    const stored = window.localStorage.getItem(RULE_PROFILE_METADATA_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      profileDescriptionOverridesSnapshot = parsed as ProfileDescriptionOverrides;
    } else {
      profileDescriptionOverridesSnapshot = {};
    }
  } catch {
    profileDescriptionOverridesSnapshot = {};
  }
  return profileDescriptionOverridesSnapshot;
}

function persistProfileDescriptionOverride(
  profileId: string,
  locale: Locale,
  description: string,
  limitation: string,
) {
  const next: ProfileDescriptionOverrides = {
    ...readProfileDescriptionOverrides(),
    [profileId]: {
      ...readProfileDescriptionOverrides()[profileId],
      [locale]: {
        description,
        limitation,
      },
    },
  };
  profileDescriptionOverridesSnapshot = next;
  try {
    window.localStorage.setItem(RULE_PROFILE_METADATA_KEY, JSON.stringify(next));
  } catch {
    // The in-memory override remains available for this page lifecycle.
  }
  window.dispatchEvent(new Event(RULE_PROFILES_EVENT));
}

function readRuleProfilesSnapshot(): RuleProfile[] {
  if (typeof window === "undefined") return DEFAULT_RULE_PROFILES;
  if (!ruleProfilesInitialized) {
    ruleProfilesInitialized = true;
    try {
      const stored = window.localStorage.getItem(RULE_PROFILES_KEY);
      const parsed: unknown = stored ? JSON.parse(stored) : null;
      if (Array.isArray(parsed)) {
        const customProfiles = parsed.filter((item): item is RuleProfile => isRuleProfile(item) && !DEFAULT_RULE_PROFILES.some((profile) => profile.id === item.id));
        ruleProfilesSnapshot = [...DEFAULT_RULE_PROFILES, ...customProfiles.map((profile) => ({ ...profile, builtin: false, engineSupported: false, status: "DRAFT" as const }))];
      }
    } catch {
      ruleProfilesSnapshot = DEFAULT_RULE_PROFILES;
    }
  }
  return ruleProfilesSnapshot;
}

function subscribeRuleProfiles(onStoreChange: () => void) {
  window.addEventListener(RULE_PROFILES_EVENT, onStoreChange);
  return () => window.removeEventListener(RULE_PROFILES_EVENT, onStoreChange);
}

function persistRuleProfiles(next: RuleProfile[]) {
  ruleProfilesSnapshot = next;
  ruleProfilesInitialized = true;
  try {
    const customProfiles = next.filter((profile) => !profile.builtin);
    window.localStorage.setItem(RULE_PROFILES_KEY, JSON.stringify(customProfiles));
  } catch {
    // The in-memory catalogue remains available for this page lifecycle.
  }
  window.dispatchEvent(new Event(RULE_PROFILES_EVENT));
}

function profileSlug(value: string): string {
  const slug = value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || `custom-profile-${Date.now()}`;
}

const SAMPLES: Sample[] = [
  {
    id: "clean",
    title: "Clean baseline",
    titleZh: "完整基线",
    titleHant: "完整基線",
    detail: "Baseline case: explicit exit classification, occupant capacity, clear-opening width, and required door information should produce PASS for applicable checks.",
    detailZh: "基线案例：出口分类、使用人数、净开口宽度和必要门信息都明确；适用检查应返回 PASS。",
    detailHant: "基線案例：出口分類、使用人數、淨開口寬度與必要門資料都明確；適用檢查應返回 PASS。",
    expected: "6 PASS",
    expectedZh: "6 项通过",
    expectedHant: "6 項通過",
  },
  {
    id: "missing_information",
    title: "Missing information",
    titleZh: "信息缺失",
    titleHant: "資訊缺失",
    detail: "Missing-evidence case: door name and fire-rating fields are absent; the review should return REVIEW instead of guessing.",
    detailZh: "证据缺失案例：门名称和耐火等级字段为空；系统应返回 REVIEW，而不是自行推断。",
    detailHant: "證據缺失案例：門名稱與耐火等級欄位為空；系統應返回 REVIEW，而不是自行推斷。",
    expected: "2 PASS · 2 REVIEW",
    expectedZh: "2 项通过 · 2 项待复核",
    expectedHant: "2 項通過 · 2 項待覆核",
  },
  {
    id: "mixed_review",
    title: "Mixed review",
    titleZh: "混合审查",
    titleHant: "混合審查",
    detail: "Primary demo case: one compact model intentionally combines PASS, FAIL, and REVIEW with explicit Table B2 evidence.",
    detailZh: "主要演示案例：在一个小模型中同时展示 PASS、FAIL 和 REVIEW，并保留明确的 Table B2 依据。",
    detailHant: "主要演示案例：在一個小模型中同時展示 PASS、FAIL 與 REVIEW，並保留明確的 Table B2 依據。",
    expected: "8 PASS · 1 FAIL · 4 REVIEW",
    expectedZh: "8 项通过 · 1 项失败 · 4 项待复核",
    expectedHant: "8 項通過 · 1 項失敗 · 4 項待覆核",
  },
  {
    id: "narrow_exit",
    title: "Narrow exit",
    titleZh: "出口过窄",
    titleHant: "出口過窄",
    detail: "Boundary case: a confirmed exit reports a width below the selected rule minimum; this tests a deterministic FAIL.",
    detailZh: "边界案例：已确认的出口门宽度低于所选规则的最低要求；用于测试确定性的 FAIL。",
    detailHant: "邊界案例：已確認的出口門寬度低於所選規則的最低要求；用於測試確定性的 FAIL。",
    expected: "3 PASS · 1 FAIL",
    expectedZh: "3 项通过 · 1 项失败",
    expectedHant: "3 項通過 · 1 項失敗",
  },
  {
    id: "proxy_width",
    title: "Proxy-only width",
    titleZh: "仅有代理宽度",
    titleHant: "僅有代理寬度",
    detail: "Evidence-boundary case: OverallWidth exists, but verified clear-opening width is unavailable; the result must remain REVIEW.",
    detailZh: "证据边界案例：只有 OverallWidth，没有经过验证的净开口宽度；结果必须保留为 REVIEW。",
    detailHant: "證據邊界案例：只有 OverallWidth，沒有經過驗證的淨開口寬度；結果必須保留為 REVIEW。",
    expected: "2 PASS · 1 REVIEW",
    expectedZh: "2 项通过 · 1 项待复核",
    expectedHant: "2 項通過 · 1 項待覆核",
  },
];

function sampleTitle(sample: Sample, locale: Locale): string {
  return textForLocale(locale, sample.title, sample.titleZh, sample.titleHant);
}

function sampleDetail(sample: Sample, locale: Locale): string {
  return textForLocale(locale, sample.detail, sample.detailZh, sample.detailHant);
}

function sampleExpected(sample: Sample, locale: Locale): string {
  return textForLocale(locale, sample.expected, sample.expectedZh, sample.expectedHant);
}

const NAV_ITEMS: ReadonlyArray<{ key: ViewKey; icon: IconName; label: UiCopyKey }> = [
  { key: "overview", icon: "grid", label: "overview" },
  { key: "new-review", icon: "plus", label: "newReview" },
  { key: "runs", icon: "list", label: "reviewRuns" },
  { key: "rules", icon: "book", label: "ruleProfiles" },
  { key: "samples", icon: "database", label: "samplesData" },
];

function uiCopy(locale: Locale, key: UiCopyKey): string {
  if (locale === "zh-CN") return UI_ZH_CN[key] ?? UI_EN[key];
  if (locale === "zh-Hant") return UI_ZH_HANT[key] ?? UI_EN[key];
  return UI_EN[key];
}

function isStoredResult(value: unknown): value is StoredAgentReviewResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const agent = item.agent_run as Record<string, unknown> | undefined;
  const access = item.access as Record<string, unknown> | undefined;
  return (
    Boolean(agent) &&
    typeof agent?.run_id === "string" &&
    Boolean(access) &&
    typeof access?.access_token === "string" &&
    typeof access?.expires_at === "string"
  );
}

function isRunAccess(value: unknown): value is AnonymousRunAccess {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const retrieval = item.retrieval as Record<string, unknown> | undefined;
  return (
    typeof item.agent_run_id === "string" &&
    (typeof item.review_run_id === "string" || item.review_run_id === null) &&
    typeof item.access_token === "string" &&
    typeof item.created_at === "string" &&
    typeof item.expires_at === "string" &&
    Boolean(retrieval) &&
    typeof retrieval?.agent === "string" &&
    typeof retrieval?.delete === "string"
  );
}

function asApiError(value: unknown, response?: Response): ApiError {
  const detail =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { detail?: unknown }).detail
      : null;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const item = detail as Record<string, unknown>;
    if (typeof item.message === "string") {
      return {
        code: typeof item.code === "string" ? item.code : "request_failed",
        message: item.message,
        recovery:
          typeof item.recovery === "string"
            ? item.recovery
            : "Return to the start surface and try again.",
        requestId:
          typeof item.request_id === "string" ? item.request_id : undefined,
      };
    }
  }
  if (response?.status === 413) {
    return {
      code: "request_too_large",
      message:
        "The upload request was rejected before review started (HTTP 413). This is an upload-size limit, not a rule failure.",
      recovery:
        "Use the updated Site runtime or choose an IFC file below the configured 50 MiB per-file limit.",
      requestId: response.headers.get("x-request-id") ?? undefined,
    };
  }
  if (response && !response.ok) {
    return {
      code: `http_${response.status}`,
      message: `The Site runtime returned HTTP ${response.status} before producing a review result.`,
      recovery: "Retry the file after the runtime is available, or use a bundled sample.",
      requestId: response.headers.get("x-request-id") ?? undefined,
    };
  }
  return {
    code: "request_failed",
    message: "The Site runtime did not return a valid result.",
    recovery: "Return to the start surface and try again.",
  };
}

function anonymousClientSession(): string {
  if (volatileClientSessionId) return volatileClientSessionId;
  try {
    const stored = window.localStorage.getItem(CLIENT_SESSION_KEY);
    if (stored && /^[A-Za-z0-9_-]{16,80}$/.test(stored)) {
      volatileClientSessionId = stored;
      return stored;
    }
  } catch {
    // Hardened browser contexts may disable storage. Keep the session in memory.
  }
  const created = crypto.randomUUID();
  volatileClientSessionId = created;
  try {
    window.localStorage.setItem(CLIENT_SESSION_KEY, created);
  } catch {
    // The in-memory value remains valid for this page lifecycle.
  }
  return created;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function formatDate(value: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusIcon(status: FindingStatus) {
  if (status === "PASS") return <Icon name="check" />;
  if (status === "FAIL") return <Icon name="x" />;
  return <Icon name="info" />;
}

function statusLabel(status: FindingStatus, l: (key: UiCopyKey) => string): string {
  return l(status === "PASS" ? "pass" : status === "FAIL" ? "fail" : "review");
}

function findingTitle(finding: Finding, locale: Locale): string {
  if (finding.rule_id === "EGRESS-001" || finding.rule_id === "HK-FS-B2-DOOR-WIDTH") {
    return textForLocale(locale, finding.rule_title, "出口门净宽", "出口門淨寬");
  }
  if (finding.rule_id === "INFO-001") {
    return textForLocale(locale, finding.rule_title, "门信息证据", "門資訊證據");
  }
  return finding.rule_title;
}

function findingCategory(finding: Finding, locale: Locale): string {
  if (finding.rule_id === "EGRESS-001" || finding.rule_id === "HK-FS-B2-DOOR-WIDTH") {
    return textForLocale(locale, finding.category, "疏散", "疏散");
  }
  if (finding.rule_id === "INFO-001") {
    return textForLocale(locale, finding.category, "门信息", "門資訊");
  }
  return finding.category;
}

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

function observationLabel(observation: Observation, locale: Locale): string {
  const translated = OBSERVATION_LABELS[observation.label];
  return translated ? textForLocale(locale, ...translated) : observation.label;
}

const RELIABILITY_LABELS: Record<string, readonly [string, string, string]> = {
  EXPLICIT: ["Explicit", "明确证据", "明確證據"],
  DERIVED: ["Derived", "推导值", "推導值"],
  PROXY: ["Proxy", "代理值", "代理值"],
  MISSING: ["Missing", "缺失", "缺失"],
  CONTRADICTORY: ["Contradictory", "存在矛盾", "存在矛盾"],
};

function reliabilityLabel(reliability: Observation["reliability"], locale: Locale): string {
  const translated = RELIABILITY_LABELS[reliability];
  return translated ? textForLocale(locale, ...translated) : reliability;
}

const AUTHORITY_LABELS: Record<string, readonly [string, string, string]> = {
  DEMO_PROJECT_RULE: ["Demo project rule", "演示项目规则", "示範專案規則"],
  PROJECT_REQUIREMENT: ["Project requirement", "项目要求", "專案要求"],
  AUTHORITATIVE_STANDARD: ["Authoritative standard", "权威标准", "權威標準"],
};

function authorityLabel(authority: Finding["rule_evidence"]["authority"], locale: Locale): string {
  const translated = AUTHORITY_LABELS[authority];
  return translated ? textForLocale(locale, ...translated) : authority;
}

const PARAMETER_LABELS: Record<string, readonly [string, string, string]> = {
  requirement_key: ["Requirement key", "规则键", "規則鍵"],
  operator: ["Comparison", "比较符号", "比較符號"],
  minimum: ["Minimum clear opening width", "最低净开口宽度", "最低淨開口寬度"],
  unit: ["Unit", "单位", "單位"],
  selection_field: ["Selection field", "选择字段", "選擇欄位"],
  required_field: ["Required field", "必要字段", "必要欄位"],
  applicability: ["Applicability", "适用范围", "適用範圍"],
  missing_outcome: ["Missing outcome", "缺失结果", "缺失結果"],
  clause_or_table: ["Reference", "参考条文 / 表格", "參考條文 / 表格"],
  missing_evidence_outcome: ["Missing-evidence outcome", "证据缺失结果", "證據缺失結果"],
  proxy_policy: ["Proxy-value policy", "代理值策略", "代理值策略"],
  contradiction_tolerance_mm: ["Conflict tolerance", "冲突容差", "衝突容差"],
  observed_clear_width_mm: ["Observed clear opening width", "观测净开口宽度", "觀測淨開口寬度"],
  source_policy: ["Evidence policy", "证据策略", "證據策略"],
  occupant_capacity: ["Occupant capacity", "使用人数", "使用人數"],
  selected_range: ["Selected range", "适用人数区间", "適用人數區間"],
  outcome_reason: ["Outcome reason", "结果原因", "結果原因"],
  source_url: ["Source URL", "来源 URL", "來源 URL"],
  source_landing_page: ["Source landing page", "来源入口页", "來源入口頁"],
  source_edition: ["Source edition", "来源版本", "來源版本"],
  source_retrieved_on: ["Source retrieved on", "来源检索日期", "來源檢索日期"],
  measurement_definition: ["Measurement definition", "测量定义", "測量定義"],
};

function parameterLabel(key: string, locale: Locale): string {
  const translated = PARAMETER_LABELS[key];
  return translated ? textForLocale(locale, ...translated) : key;
}

function formatRuleParameterValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => displayValue(item)).join(", ");
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${displayValue(item)}`)
      .join(" · ");
  }
  return displayValue(value);
}

function isRuleParameterUrl(key: string, value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^https?:\/\//i.test(value) &&
    (key === "source_url" || key === "source_landing_page" || key.endsWith("_url"))
  );
}

function isTechnicalRuleParameter(key: string): boolean {
  return [
    "requirement_key",
    "required_field",
    "operator",
    "unit",
    "source_edition",
    "source_retrieved_on",
  ].includes(key);
}

function RuleParameterList({
  parameters,
  locale,
}: {
  parameters: Record<string, unknown>;
  locale: Locale;
}) {
  const entries = Object.entries(parameters);
  if (!entries.length) return <span className="rule-parameters-empty">—</span>;

  return (
    <ul className="rule-parameter-list">
      {entries.map(([key, value]) => {
        const renderedValue = formatRuleParameterValue(value);
        const valueClassName = `rule-parameter-value${isTechnicalRuleParameter(key) ? " mono" : ""}`;
        return (
          <li className="rule-parameter-item" key={key}>
            <span className="rule-parameter-key">{parameterLabel(key, locale)}</span>
            {isRuleParameterUrl(key, value) ? (
              <a className={`${valueClassName} rule-parameter-link`} href={value} target="_blank" rel="noreferrer">
                {renderedValue}
              </a>
            ) : (
              <span className={valueClassName}>{renderedValue}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function localizedFindingMessage(finding: Finding, locale: Locale): string {
  if (locale === "en") return finding.message;
  const entityName = finding.entity.name ?? (locale === "zh-Hant" ? "未命名構件" : "未命名构件");
  const metric = decisionMetric(finding);
  if (metric && (finding.rule_id === "EGRESS-001" || finding.rule_id === "HK-FS-B2-DOOR-WIDTH")) {
    if (locale === "zh-Hant") {
      return finding.status === "PASS"
        ? `${entityName} 的淨開口寬度為 ${formatMetric(metric.actual, metric.unit, locale)}，達到 ${formatMetric(metric.required, metric.unit, locale)} 的規則要求。`
        : `${entityName} 的淨開口寬度為 ${formatMetric(metric.actual, metric.unit, locale)}，低於 ${formatMetric(metric.required, metric.unit, locale)} 的規則要求。`;
    }
    return finding.status === "PASS"
      ? `${entityName} 的净开口宽度为 ${formatMetric(metric.actual, metric.unit, locale)}，达到 ${formatMetric(metric.required, metric.unit, locale)} 的规则要求。`
      : `${entityName} 的净开口宽度为 ${formatMetric(metric.actual, metric.unit, locale)}，低于 ${formatMetric(metric.required, metric.unit, locale)} 的规则要求。`;
  }

  if (finding.rule_id === "INFO-001") {
    const firstObservation = finding.model_evidence.observations[0];
    const label = firstObservation ? observationLabel(firstObservation, locale) : (locale === "zh-Hant" ? "門資訊證據" : "门信息证据");
    if (locale === "zh-Hant") return finding.status === "PASS" ? `${entityName} 已提供${label}。` : `${entityName} 缺少或未正確提供${label}。`;
    return finding.status === "PASS" ? `${entityName} 已提供${label}。` : `${entityName} 缺少或未正确提供${label}。`;
  }

  const message = finding.message.toLocaleLowerCase("en-US");
  if (message.includes("may be an exit door")) {
    return locale === "zh-Hant"
      ? `${entityName} 可能是出口門，但目前無法確認其適用性。`
      : `${entityName} 可能是出口门，但目前无法确认其适用性。`;
  }
  if (message.includes("overallwidth")) {
    return locale === "zh-Hant"
      ? `${entityName} 只有 OverallWidth 代理值，不能作為已驗證的淨開口寬度。`
      : `${entityName} 只有 OverallWidth 代理值，不能作为已验证的净开口宽度。`;
  }
  if (message.includes("occupant capacity")) {
    return locale === "zh-Hant"
      ? `${entityName} 缺少有效的使用人數，無法套用本次審查的寬度規則。`
      : `${entityName} 缺少有效的使用人数，无法套用本次审查的宽度规则。`;
  }
  return finding.message;
}

function localizedRecommendation(finding: Finding, locale: Locale): string {
  if (locale === "en") return finding.recommendation;
  const metric = decisionMetric(finding);
  if (metric && finding.status === "FAIL") {
    const gap = Math.abs(metric.difference);
    return locale === "zh-Hant"
      ? `建議將淨開口寬度增加 ${formatMetric(gap, metric.unit, locale)}，調整至至少 ${formatMetric(metric.required, metric.unit, locale)}，然後重新審查。`
      : `建议将净开口宽度增加 ${formatMetric(gap, metric.unit, locale)}，调整至至少 ${formatMetric(metric.required, metric.unit, locale)}，然后重新审查。`;
  }
  if (metric && finding.status === "PASS") {
    return locale === "zh-Hant"
      ? "目前寬度符合本次規則比較；請保留原始測量證據。"
      : "当前宽度符合本次规则比较；请保留原始测量证据。";
  }

  const recommendation = finding.recommendation.toLocaleLowerCase("en-US");
  if (recommendation.includes("pset_doorcommon.fireexit")) {
    if (recommendation.includes("set pset")) {
      return locale === "zh-Hant"
        ? "根據已記錄的設計意圖確認門的功能，將 Pset_DoorCommon.FireExit 填寫為 TRUE 或 FALSE；不要根據構件名稱推斷。"
        : "根据已记录的设计意图确认门的功能，将 Pset_DoorCommon.FireExit 填写为 TRUE 或 FALSE；不要根据构件名称推断。";
    }
    return locale === "zh-Hant"
      ? "確認門的功能，填寫 Pset_DoorCommon.FireExit，然後再依賴寬度結果。"
      : "确认门的功能，填写 Pset_DoorCommon.FireExit，然后再依赖宽度结果。";
  }
  if (recommendation.includes("fire rating") || recommendation.includes("fire-resistance") || recommendation.includes("pset_doorcommon.firerating")) {
    return locale === "zh-Hant"
      ? "確認適用的耐火等級，填寫 Pset_DoorCommon.FireRating；不要根據構件名稱推斷。"
      : "确认适用的耐火等级，填写 Pset_DoorCommon.FireRating；不要根据构件名称推断。";
  }
  if (recommendation.includes("overallwidth")) {
    return locale === "zh-Hant"
      ? "補充已驗證的淨開口寬度到 Pset_BIMReview.ClearWidth；OverallWidth 只能作為輔助證據。"
      : "补充经过验证的净开口宽度到 Pset_BIMReview.ClearWidth；OverallWidth 只能作为辅助证据。";
  }
  if (recommendation.includes("clear-opening width") || recommendation.includes("clear opening width")) {
    return locale === "zh-Hant"
      ? "在模型中補充已驗證的淨開口寬度，然後重新審查。"
      : "在模型中补充经过验证的净开口宽度，然后重新审查。";
  }
  if (recommendation.includes("door.name")) {
    return locale === "zh-Hant"
      ? `確認目標值並填寫 ${finding.model_evidence.observations[0]?.source_path ?? "對應欄位"}；不要根據構件名稱推斷。`
      : `确认目标值并填写 ${finding.model_evidence.observations[0]?.source_path ?? "对应字段"}；不要根据构件名称推断。`;
  }
  if (recommendation.includes("occupant capacity")) {
    return locale === "zh-Hant"
      ? "提供已驗證的使用人數及其房間／樓層對應關係，然後重新審查。"
      : "提供经过验证的使用人数及其房间 / 楼层对应关系，然后重新审查。";
  }
  if (recommendation.includes("no action")) {
    return locale === "zh-Hant" ? "目前不需要採取額外措施。" : "目前不需要采取额外措施。";
  }
  if (recommendation.includes("escalate")) {
    return locale === "zh-Hant" ? "請交由具備相應資格的規範審查人員進一步確認。" : "请交由具备相应资格的规范审查人员进一步确认。";
  }
  return finding.recommendation;
}

function localizedFindingBoundary(boundary: string, locale: Locale): string {
  if (locale === "en" || !boundary.toLocaleLowerCase("en-US").startsWith("this explanation restates deterministic evidence")) {
    return boundary;
  }
  return locale === "zh-Hant"
    ? "這段說明只是重述確定性證據，不會改變結論、證明合規，也不能取代專業審查。"
    : "这段说明只是复述确定性证据，不会改变结论、证明合规，也不能替代专业审查。";
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type DecisionMetric = {
  actual: number;
  required: number;
  difference: number;
  unit: string;
  operator: string;
};

function decisionMetric(finding: Finding): DecisionMetric | null {
  const parameters = finding.rule_evidence.parameters;
  const widthObservation = finding.model_evidence.observations.find(
    (observation) =>
      /clear width/i.test(observation.label) &&
      numericValue(observation.normalized_value) !== null,
  );
  const actual =
    numericValue(parameters.observed_clear_width_mm) ??
    numericValue(widthObservation?.normalized_value);
  const required = numericValue(parameters.minimum);
  if (actual === null || required === null) return null;

  return {
    actual,
    required,
    difference: actual - required,
    unit:
      typeof parameters.unit === "string"
        ? parameters.unit
        : widthObservation?.unit ?? "",
    operator: displayOperator(typeof parameters.operator === "string" ? parameters.operator : "≥"),
  };
}

function displayOperator(operator: string): string {
  if (operator === ">=") return "≥";
  if (operator === "<=") return "≤";
  if (operator === "==") return "=";
  return operator;
}

function findingAnchor(findingId: string): string {
  return `report-finding-${findingId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function formatMetric(value: number, unit: string, locale: Locale, signed = false): string {
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    signDisplay: signed ? "always" : "auto",
  }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

type ScrollAffordance = {
  canScrollUp: boolean;
  canScrollDown: boolean;
};

function useScrollAffordance(
  ref: RefObject<HTMLElement | null>,
  refreshKey?: string | number,
): ScrollAffordance {
  const [state, setState] = useState<ScrollAffordance>({
    canScrollUp: false,
    canScrollDown: false,
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const canScrollUp = element.scrollTop > 4;
      const canScrollDown = element.scrollTop + element.clientHeight < element.scrollHeight - 4;
      setState((previous) =>
        previous.canScrollUp === canScrollUp && previous.canScrollDown === canScrollDown
          ? previous
          : { canScrollUp, canScrollDown },
      );
    };

    update();
    element.addEventListener("scroll", update, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resizeObserver?.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      resizeObserver?.disconnect();
    };
  }, [ref, refreshKey]);

  return state;
}

function waitForMinimumRunningState(startedAt: number): Promise<void> {
  const remaining = RUNNING_MIN_DURATION_MS - (Date.now() - startedAt);
  if (remaining <= 0) return Promise.resolve();
  return new Promise((resolve) => window.setTimeout(resolve, remaining));
}

function initialRunningStep(startedAt: number, complete: boolean, stepCount: number): number {
  const animationDelay = complete
    ? RUNNING_COMPLETE_ANIMATION_DELAY_MS
    : RUNNING_ACTIVE_ANIMATION_DELAY_MS;
  const elapsed = Math.max(0, Date.now() - startedAt - animationDelay);
  return Math.min(stepCount, Math.floor(elapsed / RUNNING_STEP_ADVANCE_MS));
}

export function ReviewApp() {
  const locale = useSyncExternalStore(subscribeToLocale, readStoredLocale, () => "en" as Locale);
  const profiles = useSyncExternalStore(
    subscribeRuleProfiles,
    readRuleProfilesSnapshot,
    () => DEFAULT_RULE_PROFILES,
  );
  const [status, setStatus] = useState<UiStatus>("idle");
  const [result, setResult] = useState<StoredAgentReviewResult | null>(null);
  const [history, setHistory] = useState<LocalHistoryEntry[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [view, setView] = useState<ViewKey>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [batchRun, setBatchRun] = useState<BatchRunState | null>(null);
  const [selectedBatchItemId, setSelectedBatchItemId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [runningLabel, setRunningLabel] = useState("IFC");
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState(DEFAULT_RULE_PROFILES[0].id);
  const fileInput = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const activeRequestController = useRef<AbortController | null>(null);
  const reviewGeneration = useRef(0);
  const t = (key: CopyKey) => copy(locale, key);
  const l = (key: UiCopyKey) => uiCopy(locale, key);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? DEFAULT_RULE_PROFILES[0];

  async function saveResultToHistory(nextResult: StoredAgentReviewResult) {
    try {
      await saveHistory(nextResult);
      setHistory(await listHistory());
      setHistoryReady(true);
    } catch {
      // A browser storage failure must not block a completed review or its exports.
    }
  }

  useEffect(() => {
    document.documentElement.setAttribute("lang", locale);
  }, [locale]);

  useEffect(() => {
    let active = true;
    void listHistory()
      .then((entries) => {
        if (!active) return;
        setHistory(entries);
        setHistoryReady(true);
      })
      .catch(() => {
        if (active) setHistoryReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#view=")) {
        const next = hash.slice("#view=".length) as ViewKey;
        if (NAV_ITEMS.some((item) => item.key === next)) setView(next);
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  useEffect(() => {
    const serialized = window.sessionStorage.getItem(SESSION_KEY);
    if (!serialized) return;
    let saved: AnonymousRunAccess;
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (!isRunAccess(parsed)) throw new Error("Invalid saved access envelope.");
      saved = parsed;
    } catch {
      window.sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    if (new Date(saved.expires_at).getTime() <= Date.now()) {
      window.sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    let active = true;
    void (async () => {
      const headers = { authorization: `Bearer ${saved.access_token}` };
      try {
        const agentResponse = await fetch(saved.retrieval.agent, { headers });
        if (!agentResponse.ok) throw new Error("Retained AgentRun unavailable.");
        const agentBody = (await agentResponse.json()) as {
          agent_run: StoredAgentReviewResult["agent_run"];
        };
        let reviewRun: StoredAgentReviewResult["review_run"] = null;
        if (saved.retrieval.review) {
          const reviewResponse = await fetch(saved.retrieval.review, { headers });
          if (!reviewResponse.ok) throw new Error("Retained ReviewRun unavailable.");
          reviewRun = await reviewResponse.json();
        }
        if (!active) return;
        const restored = { agent_run: agentBody.agent_run, review_run: reviewRun, access: saved };
        setResult(restored);
        void saveResultToHistory(restored);
        setStatus("complete");
      } catch {
        window.sessionStorage.removeItem(SESSION_KEY);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useGSAP(
    () => {
      const root = shellRef.current;
      if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const select = gsap.utils.selector(root);
      const items = select(".motion-item:not(.running-live-card)");
      if (!items.length) return;
      const timeline = gsap.timeline({ defaults: { duration: 0.22, ease: "power2.out" } });
      timeline.from(items, { autoAlpha: 0, y: 8, stagger: 0.025, clearProps: "all" });
      return () => timeline.kill();
    },
    {
      scope: shellRef,
      dependencies: [view, status, result?.review_run?.run_id],
      revertOnUpdate: true,
    },
  );

  function selectLocale(nextLocale: Locale) {
    try {
      window.localStorage.setItem(LOCALE_KEY, nextLocale);
    } catch {
      // The current page still updates through the event even if storage is unavailable.
    }
    window.dispatchEvent(new Event(LOCALE_EVENT));
  }

  function navigate(nextView: ViewKey) {
    if (nextView === "new-review") {
      startNewReview();
      return;
    }
    setView(nextView);
    setMobileNavOpen(false);
    window.history.replaceState(null, "", `${window.location.pathname}#view=${nextView}`);
  }

  function saveRuleProfile(profile: RuleProfile) {
    const next = profiles.some((item) => item.id === profile.id)
      ? profiles.map((item) => (item.id === profile.id ? profile : item))
      : [...profiles, profile];
    persistRuleProfiles(next);
    setSelectedProfileId(profile.id);
  }

  function saveRuleProfileDescription(profileId: string, nextLocale: Locale, description: string, limitation: string) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile?.builtin) return;
    persistProfileDescriptionOverride(profileId, nextLocale, description, limitation);
    setSelectedProfileId(profileId);
  }

  function deleteRuleProfile(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile || profile.builtin) return;
    persistRuleProfiles(profiles.filter((item) => item.id !== profileId));
    if (selectedProfileId === profileId) setSelectedProfileId(DEFAULT_RULE_PROFILES[0].id);
  }

  function validateFiles(candidates: File[]): boolean {
    const invalid = candidates.find(
      (candidate) =>
        !candidate.name.toLocaleLowerCase("en-US").endsWith(".ifc") ||
        candidate.size === 0,
    );
    if (!candidates.length || invalid) {
      setError({
        code: "invalid_file",
        message: invalid ? `${invalid.name}: ${t("invalidFile")}` : t("invalidFile"),
        recovery: t("fileHint"),
      });
      return false;
    }
    setError(null);
    setFiles(candidates);
    return true;
  }

  async function requestStoredResult(
    request: RequestInfo | URL,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<StoredAgentReviewResult> {
    const headers = new Headers(init.headers);
    headers.set("x-bim-review-session", anonymousClientSession());
    const response = await fetch(request, { ...init, headers, signal: signal ?? init.signal });
    const body = await responseJson(response);
    if (!response.ok) throw asApiError(body, response);
    if (!isStoredResult(body)) throw asApiError(body, response);
    return body;
  }

  async function execute(request: RequestInfo | URL, init: RequestInit, label: string) {
    activeRequestController.current?.abort();
    const controller = new AbortController();
    activeRequestController.current = controller;
    const generation = reviewGeneration.current + 1;
    reviewGeneration.current = generation;
    const startedAt = Date.now();
    setRunStartedAt(startedAt);
    setStatus("running");
    setRunningLabel(label);
    setError(null);
    setBatchRun(null);
    setSelectedBatchItemId(null);
    setView("overview");
    setMobileNavOpen(false);
    window.history.replaceState(null, "", `${window.location.pathname}#view=overview`);
    try {
      const body = await requestStoredResult(request, init, controller.signal);
      await waitForMinimumRunningState(startedAt);
      if (reviewGeneration.current !== generation) return;
      setResult(body);
      setStatus("ready");
      void saveResultToHistory(body);
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(body.access));
    } catch (caught) {
      if (reviewGeneration.current !== generation) return;
      const nextError =
        caught &&
        typeof caught === "object" &&
        "code" in caught &&
        "message" in caught &&
        "recovery" in caught
          ? (caught as ApiError)
          : asApiError(null);
      await waitForMinimumRunningState(startedAt);
      setError(nextError);
      setStatus("error");
      setRunStartedAt(null);
    } finally {
      if (activeRequestController.current === controller) {
        activeRequestController.current = null;
      }
    }
  }

  async function executeBatch(tasks: BatchTask[], label: string) {
    activeRequestController.current?.abort();
    const controller = new AbortController();
    activeRequestController.current = controller;
    const generation = reviewGeneration.current + 1;
    reviewGeneration.current = generation;
    const startedAt = Date.now();
    const batch: BatchRunState = {
      id: crypto.randomUUID(),
      profileId: selectedProfile.id,
      startedAt,
      completedAt: null,
      items: tasks.map((task) => ({
        id: task.id,
        label: task.label,
        status: task.skipped ? "SKIPPED" : "QUEUED",
        result: null,
        error: task.skipped ?? null,
      })),
    };
    setBatchRun(batch);
    setSelectedBatchItemId(null);
    setResult(null);
    setRunStartedAt(startedAt);
    setStatus("running");
    setRunningLabel(label);
    setError(null);
    setView("overview");
    setMobileNavOpen(false);
    window.history.replaceState(null, "", `${window.location.pathname}#view=overview`);

    let latestResult: StoredAgentReviewResult | null = null;
    for (const task of tasks) {
      if (reviewGeneration.current !== generation) return;
      if (task.skipped) continue;
      setBatchRun((current) => current ? {
        ...current,
        items: current.items.map((item) => item.id === task.id ? { ...item, status: "RUNNING", error: null } : item),
      } : current);
      try {
        const nextResult = await requestStoredResult(task.request, task.init, controller.signal);
        if (reviewGeneration.current !== generation) return;
        latestResult = nextResult;
        setBatchRun((current) => current ? {
          ...current,
          items: current.items.map((item) => item.id === task.id ? { ...item, status: "COMPLETED", result: nextResult } : item),
        } : current);
        void saveResultToHistory(nextResult);
      } catch (caught) {
        if (reviewGeneration.current !== generation) return;
        const nextError =
          caught &&
          typeof caught === "object" &&
          "code" in caught &&
          "message" in caught
            ? (caught as ApiError)
            : asApiError(null);
        setBatchRun((current) => current ? {
          ...current,
          items: current.items.map((item) => item.id === task.id ? {
            ...item,
            status: "FAILED",
            error: { filename: task.label, code: nextError.code, message: nextError.message },
          } : item),
        } : current);
      }
    }

    await waitForMinimumRunningState(startedAt);
    if (reviewGeneration.current !== generation) return;
    setResult(latestResult);
    setBatchRun((current) => current ? { ...current, completedAt: Date.now() } : current);
    setStatus("ready");
    setRunStartedAt(startedAt);
    if (activeRequestController.current === controller) {
      activeRequestController.current = null;
    }
  }

  function openRunView() {
    setView("overview");
    setMobileNavOpen(false);
    window.history.replaceState(null, "", `${window.location.pathname}#view=overview`);
  }

  function openResults() {
    if (!result?.review_run && !batchRun) return;
    setStatus("complete");
    openRunView();
    window.requestAnimationFrame(() => {
      document.getElementById("review-workspace")?.focus();
    });
  }

  function openBatchResult(itemId: string) {
    const item = batchRun?.items.find((candidate) => candidate.id === itemId);
    if (!item?.result?.review_run) return;
    setSelectedBatchItemId(itemId);
    setResult(item.result);
    setError(null);
    setStatus("complete");
    openRunView();
    window.requestAnimationFrame(() => {
      document.getElementById("review-workspace")?.focus();
    });
  }

  function returnToBatchResults() {
    setSelectedBatchItemId(null);
    setResult(null);
    setError(null);
    setStatus("complete");
    openRunView();
  }

  function runSample(sampleId: Sample["id"]) {
    if (!selectedProfile.engineSupported) {
      setError({
        code: "profile_not_ready",
        message: l("profileNotReady"),
        recovery: l("profileCatalogNote"),
      });
      navigate("rules");
      return;
    }
    void execute(
      `/api/agent-runs/sample/${encodeURIComponent(sampleId)}?profile_id=${encodeURIComponent(selectedProfile.id)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      sampleTitle(SAMPLES.find((sample) => sample.id === sampleId) ?? SAMPLES[0], locale),
    );
  }

  function runUpload() {
    if (!selectedProfile.engineSupported) {
      setError({
        code: "profile_not_ready",
        message: l("profileNotReady"),
        recovery: l("profileCatalogNote"),
      });
      navigate("rules");
      return;
    }
    if (!files.length) {
      setError({ code: "invalid_file", message: t("invalidFile"), recovery: t("fileHint") });
      return;
    }
    const endpoint = `/api/agent-runs?profile_id=${encodeURIComponent(selectedProfile.id)}`;
    if (files.length === 1) {
      if (files[0].size > MAX_UPLOAD_BYTES) {
        setError({
          code: "file_too_large",
          message: t("invalidFile"),
          recovery: t("fileHint"),
        });
        return;
      }
      const form = new FormData();
      form.append("file", files[0], files[0].name);
      void execute(endpoint, { method: "POST", body: form }, files[0].name);
      return;
    }
    void executeBatch(
      classifyBatchUploads(files, l("batchFileTooLargeWillSkip")).map(({ file: candidate, skipped }) => {
        const id = crypto.randomUUID();
        if (skipped) {
          return {
            id,
            label: candidate.name,
            request: endpoint,
            init: { method: "POST" },
            skipped,
          };
        }
        const form = new FormData();
        form.append("file", candidate, candidate.name);
        return { id, label: candidate.name, request: endpoint, init: { method: "POST", body: form } };
      }),
      `${files.length} ${l("batchImport")}`,
    );
  }

  function runSelectedSamples(sampleIds: Sample["id"][]) {
    if (!selectedProfile.engineSupported) {
      setError({
        code: "profile_not_ready",
        message: l("profileNotReady"),
        recovery: l("profileCatalogNote"),
      });
      navigate("rules");
      return;
    }
    const tasks = sampleIds.map((sampleId) => ({
      id: sampleId,
      label: sampleTitle(SAMPLES.find((sample) => sample.id === sampleId) ?? SAMPLES[0], locale),
      request: `/api/agent-runs/sample/${encodeURIComponent(sampleId)}?profile_id=${encodeURIComponent(selectedProfile.id)}`,
      init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
    }));
    if (tasks.length === 1) {
      void execute(tasks[0].request, tasks[0].init, tasks[0].label);
      return;
    }
    void executeBatch(tasks, `${tasks.length} ${l("samplesData")}`);
  }

  function startNewReview() {
    reviewGeneration.current += 1;
    activeRequestController.current?.abort();
    activeRequestController.current = null;
    setRunStartedAt(null);
    setStatus("idle");
    setResult(null);
    setBatchRun(null);
    setSelectedBatchItemId(null);
    setError(null);
    setFiles([]);
    setDragActive(false);
    setRunningLabel("IFC");
    window.sessionStorage.removeItem(SESSION_KEY);
    setMobileNavOpen(false);
    setView("new-review");
    window.history.replaceState(null, "", `${window.location.pathname}#view=new-review`);
    if (fileInput.current) fileInput.current.value = "";
  }

  function reset() {
    startNewReview();
  }

  function openHistoryEntry(entry: LocalHistoryEntry) {
    setBatchRun(null);
    setSelectedBatchItemId(null);
    setResult(entry.result);
    setError(null);
    setStatus("complete");
    navigate("overview");
    if (entry.result.access.expires_at && new Date(entry.result.access.expires_at).getTime() > Date.now()) {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(entry.result.access));
    }
    window.requestAnimationFrame(() => {
      document.getElementById("review-workspace")?.focus();
    });
  }

  async function removeHistoryEntry(id: string) {
    try {
      await deleteHistory(id);
      setHistory((entries) => entries.filter((entry) => entry.id !== id));
    } catch {
      // Keep the in-memory list intact when IndexedDB rejects the mutation.
    }
  }

  async function removeAllHistory() {
    try {
      await clearHistory();
      setHistory([]);
    } catch {
      // Keep the in-memory list intact when IndexedDB rejects the mutation.
    }
  }

  function markDeleted() {
    const deletedRunId = result?.agent_run.run_id;
    if (deletedRunId) {
      void deleteHistory(deletedRunId).catch(() => undefined);
      setHistory((entries) => entries.filter((entry) => entry.id !== deletedRunId));
    }
    setResult(null);
    setBatchRun(null);
    setSelectedBatchItemId(null);
    setError(null);
    setFiles([]);
    setRunStartedAt(null);
    setStatus("deleted");
    setView("new-review");
    window.sessionStorage.removeItem(SESSION_KEY);
    window.history.replaceState(null, "", `${window.location.pathname}#view=new-review`);
  }

  const runVisibleInWorkspace =
    (status === "running" || status === "ready") && view === "overview";
  const backgroundRunVisible =
    (status === "running" || status === "ready") && !runVisibleInWorkspace;

  const hasBatchResults = Boolean(batchRun?.completedAt);
  const selectedBatchItem = batchRun?.items.find((item) => item.id === selectedBatchItemId) ?? null;
  const selectedBatchResult = selectedBatchItem?.result?.review_run ? selectedBatchItem.result : null;
  const isBatchResultsList = Boolean(batchRun && view === "overview" && !selectedBatchResult);
  const hasReviewResults = Boolean(result?.review_run || hasBatchResults);
  const activeNav = status === "complete" && view === "overview" && hasReviewResults
    ? "overview"
    : view === "overview" && (status === "running" || status === "ready")
      ? "overview"
    : view === "overview"
      ? "new-review"
      : view;

  return (
    <div
      ref={shellRef}
      className={`product-shell${sidebarCollapsed ? " is-sidebar-collapsed" : ""}${mobileNavOpen ? " is-mobile-nav-open" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div
        className="mobile-nav-scrim"
        aria-hidden="true"
        onClick={() => setMobileNavOpen(false)}
      />
      <aside className="app-sidebar" aria-label="Application navigation">
        <div className="sidebar-brand-row">
          <a className="sidebar-brand" href="#view=overview" onClick={() => navigate("overview")}>
            <BrandMark />
            <span className="sidebar-brand-copy">
              <strong>BIM Review Agent</strong>
              <small>Evidence-first IFC review</small>
            </span>
          </a>
          <button
            className="sidebar-toggle sidebar-toggle-top"
            type="button"
            aria-label={sidebarCollapsed ? l("expandSidebar") : l("collapseSidebar")}
            title={sidebarCollapsed ? l("expandSidebar") : l("collapseSidebar")}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            <Icon name="panel" />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          <div className="sidebar-section-label">{l("workspace")}</div>
          {NAV_ITEMS.map((item) => (
            <a
              className={`sidebar-nav-item${activeNav === item.key ? " is-active" : ""}`}
              key={item.key}
              href={`#view=${item.key}`}
              aria-current={activeNav === item.key ? "page" : undefined}
              title={sidebarCollapsed ? l(item.label) : undefined}
              onClick={(event) => {
                event.preventDefault();
                if (item.key === "new-review") {
                  startNewReview();
                } else {
                  navigate(item.key);
                }
              }}
            >
              <Icon name={item.icon} />
              <span>{l(item.label)}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-schema-note">
            <strong>IFC 4.0.2.1</strong>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="topbar-leading">
            <button
              className="mobile-menu-button"
              type="button"
              aria-label={mobileNavOpen ? l("closeNavigation") : l("openNavigation")}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((value) => !value)}
            >
              <Icon name={mobileNavOpen ? "x" : "menu"} />
            </button>
            <div className="breadcrumb" aria-label="Current workspace">
              <span>BIM Review Agent</span>
              <Icon name="chevron" />
              <strong>{isBatchResultsList ? l("batchResultsTitle") : status === "complete" && result?.review_run && view === "overview" ? l("findings") : l(activeNav === "overview" ? "overview" : activeNav === "new-review" ? "newReview" : activeNav === "runs" ? "reviewRuns" : activeNav === "rules" ? "ruleProfiles" : "samplesData")}</strong>
            </div>
          </div>
          <div className="topbar-tools">
            <span className="schema-pill">
              <Icon name="file" /> IFC 4.0.2.1
            </span>
            <div className="locale-switch" aria-label="Interface language">
              {(["en", "zh-CN", "zh-Hant"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={locale === item}
                  onClick={() => selectLocale(item)}
                >
                  {item === "en" ? "EN" : item === "zh-CN" ? "简" : "繁"}
                </button>
              ))}
            </div>
            {status === "complete" && result?.review_run && view === "overview" && !isBatchResultsList && (
              <button className="button button-primary button-compact topbar-new-review" type="button" onClick={reset}>
                <Icon name="plus" /> {l("newReview")}
              </button>
            )}
          </div>
        </header>

        <main id="main-content" className="workspace-main">
          {backgroundRunVisible && runStartedAt !== null && (
            <BackgroundRunStatus
              label={runningLabel}
              complete={status === "ready"}
              l={l}
              onOpen={status === "ready" && (result?.review_run || batchRun?.completedAt) ? openResults : openRunView}
            />
          )}
          <div className="workspace-content">
            {error && <ErrorPanel error={error} t={t} l={l} onDismiss={() => setError(null)} />}
            {runVisibleInWorkspace && runStartedAt !== null ? (
              <RunningView
                label={runningLabel}
                t={t}
                complete={status === "ready"}
                startedAt={runStartedAt}
                hasResults={Boolean(result?.review_run || batchRun)}
                onViewResults={openResults}
              />
            ) : status === "deleted" ? (
              <DeletedView t={l} onReset={reset} />
            ) : selectedBatchResult && view === "overview" ? (
              <FindingsView
                result={selectedBatchResult}
                locale={locale}
                t={t}
                l={l}
                onNewReview={reset}
                onDeleted={markDeleted}
                onBackToBatch={returnToBatchResults}
              />
            ) : batchRun && view === "overview" ? (
              <BatchResultsView
                batch={batchRun}
                locale={locale}
                l={l}
                onOpenResult={openBatchResult}
              />
            ) : result?.review_run && view === "overview" ? (
              <FindingsView
                result={result}
                locale={locale}
                t={t}
                l={l}
                onNewReview={reset}
                onDeleted={markDeleted}
              />
            ) : view === "runs" ? (
              <RunsView
                history={history}
                historyReady={historyReady}
                locale={locale}
                l={l}
                onOpenHistory={openHistoryEntry}
                onDeleteHistory={(id) => void removeHistoryEntry(id)}
                onClearHistory={() => void removeAllHistory()}
              />
            ) : view === "rules" ? (
              <RulesView
                profiles={profiles}
                locale={locale}
                selectedProfileId={selectedProfile.id}
                l={l}
                onSelectProfile={setSelectedProfileId}
                onUseProfile={(profileId) => {
                  const profile = profiles.find((item) => item.id === profileId);
                  if (profile?.engineSupported) {
                    setSelectedProfileId(profileId);
                    navigate("new-review");
                  }
                }}
                onSaveProfile={saveRuleProfile}
                onSaveProfileDescription={saveRuleProfileDescription}
                onDeleteProfile={deleteRuleProfile}
              />
            ) : view === "samples" ? (
              <SamplesView locale={locale} l={l} busy={status === "running"} onRunSample={runSample} onRunSamples={runSelectedSamples} />
            ) : (
              <NewReviewView
                locale={locale}
                files={files}
                fileInput={fileInput}
                dragActive={dragActive}
                status={status}
                l={l}
                onFiles={validateFiles}
                onClearFile={() => {
                  setFiles([]);
                  if (fileInput.current) fileInput.current.value = "";
                }}
                onDragActive={setDragActive}
                onRunUpload={runUpload}
                onRunSample={runSample}
                profiles={profiles}
                selectedProfileId={selectedProfile.id}
                onProfileChange={setSelectedProfileId}
              />
            )}
          </div>
        </main>
      </div>
      <div className="sr-only" aria-live="polite">
        {status === "running"
          ? `${t("processingTitle")} ${runningLabel}`
          : status === "ready"
            ? t("processingReady")
            : ""}
      </div>
    </div>
  );
}

function BackgroundRunStatus({
  label,
  complete,
  l,
  onOpen,
}: {
  label: string;
  complete: boolean;
  l: (key: UiCopyKey) => string;
  onOpen: () => void;
}) {
  return (
    <aside className={`background-run-status${complete ? " is-complete" : ""}`} aria-live="polite">
      <span className="background-run-status-icon" aria-hidden="true">
        <Icon name={complete ? "check" : "activity"} />
      </span>
      <span className="background-run-status-copy">
        <strong>{l(complete ? "backgroundRunCompleteTitle" : "backgroundRunTitle")}</strong>
        <small>{label} · {l(complete ? "backgroundRunCompleteBody" : "backgroundRunBody")}</small>
      </span>
      <button className="button button-secondary button-compact" type="button" onClick={onOpen}>
        <Icon name={complete ? "list" : "activity"} />
        {l(complete ? "viewRunResults" : "viewRunProgress")}
        <Icon name="chevron" />
      </button>
    </aside>
  );
}

function ErrorPanel({
  error,
  t,
  l,
  onDismiss,
}: {
  error: ApiError;
  t: (key: CopyKey) => string;
  l: (key: UiCopyKey) => string;
  onDismiss: () => void;
}) {
  return (
    <div className="error-panel motion-item" role="alert">
      <span className="error-icon"><Icon name="x" /></span>
      <div>
        <strong>{t("errorTitle")}</strong>
        <p>{error.message}</p>
        <small>{error.code} · {error.recovery}{error.requestId ? ` · ${t("requestLabel")} ${error.requestId}` : ""}</small>
      </div>
      <button className="icon-button" type="button" aria-label={l("errorDismiss")} onClick={onDismiss}>
        <Icon name="x" />
      </button>
    </div>
  );
}

function NewReviewView({
  locale,
  files,
  fileInput,
  dragActive,
  status,
  l,
  onFiles,
  onClearFile,
  onDragActive,
  onRunUpload,
  onRunSample,
  profiles,
  selectedProfileId,
  onProfileChange,
}: {
  locale: Locale;
  files: File[];
  fileInput: RefObject<HTMLInputElement | null>;
  dragActive: boolean;
  status: UiStatus;
  l: (key: UiCopyKey) => string;
  onFiles: (files: File[]) => boolean;
  onClearFile: () => void;
  onDragActive: (active: boolean) => void;
  onRunUpload: () => void;
  onRunSample: (sampleId: Sample["id"]) => void;
  profiles: RuleProfile[];
  selectedProfileId: string;
  onProfileChange: (profileId: string) => void;
}) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const wizardRef = useRef<HTMLDivElement>(null);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? DEFAULT_RULE_PROFILES[0];
  const steps: Array<{ id: WizardStep; label: string; icon: IconName }> = [
    { id: 1, label: l("stepModel"), icon: "file" },
    { id: 2, label: l("stepRules"), icon: "settings" },
    { id: 3, label: l("stepRun"), icon: "play" },
  ];

  useGSAP(
    () => {
      const stage = wizardRef.current?.querySelector<HTMLElement>(".wizard-stage");
      if (!stage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.fromTo(
        stage,
        { autoAlpha: 0, y: 8 },
        { autoAlpha: 1, y: 0, duration: 0.22, ease: "power2.out", clearProps: "all" },
      );
    },
    { scope: wizardRef, dependencies: [wizardStep], revertOnUpdate: true },
  );

  function goNext() {
    if (wizardStep === 1 && files.length) {
      setWizardStep(2);
      return;
    }
    if (wizardStep === 2 && selectedProfile.engineSupported) setWizardStep(3);
  }

  function goBack() {
    if (wizardStep > 1) setWizardStep((step) => (step - 1) as WizardStep);
  }

  function goToStep(step: WizardStep) {
    if (step < wizardStep) setWizardStep(step);
  }

  function renderProfilePicker() {
    return (
      <div className="wizard-profile-layout">
        <div className="wizard-profile-selection">
          <span className="wizard-profile-label">{l("ruleProfile")}</span>
          <div className="profile-picker">
            <button
              className="profile-select"
              type="button"
              aria-label={l("chooseProfile")}
              aria-expanded={profileMenuOpen}
              onClick={() => setProfileMenuOpen((value) => !value)}
            >
              <span>
                <span className={`profile-status-dot${selectedProfile.engineSupported ? "" : " is-draft"}`} />
                {profileName(selectedProfile, locale)}
              </span>
              <Icon name="chevronDown" />
            </button>
            {profileMenuOpen && (
              <div className="profile-menu" role="listbox" aria-label={l("chooseProfile")}>
                {profiles.map((profile) => (
                  <button
                    className={`profile-option${profile.id === selectedProfile.id ? " is-selected" : ""}`}
                    type="button"
                    role="option"
                    aria-selected={profile.id === selectedProfile.id}
                    disabled={!profile.engineSupported}
                    title={!profile.engineSupported ? l("profileNotReady") : undefined}
                    key={profile.id}
                    onClick={() => {
                      if (!profile.engineSupported) return;
                      onProfileChange(profile.id);
                      setProfileMenuOpen(false);
                    }}
                  >
                    <span className="profile-option-copy">
                      <strong>{profileName(profile, locale)}</strong>
                      <small>{profileJurisdiction(profile, locale)} · {profile.engineSupported ? l("engineReady") : l("enginePending")}</small>
                    </span>
                    <span className={`profile-status-badge${profile.engineSupported ? " is-ready" : " is-draft"}`}>
                      {profile.engineSupported ? l("engineReady") : l("enginePending")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {!selectedProfile.engineSupported && (
            <div className="profile-not-ready"><Icon name="info" /><span>{l("profileNotReady")}</span></div>
          )}
        </div>

        <div className="wizard-profile-rules">
          <div className="rule-list-heading">
            <strong>{selectedProfile.rules.length} {l("rulesActive")}</strong>
            <span>{profileJurisdiction(selectedProfile, locale)}</span>
          </div>
          <div className="rule-list rule-summary-list">
            {selectedProfile.rules.length > 0 ? selectedProfile.rules.map((rule) => (
              <div className="rule-row" key={rule.id}>
                <span className={`rule-row-icon${rule.id.includes("EGRESS") || rule.id.includes("WIDTH") ? " teal" : " info"}`}><Icon name={rule.id.includes("EGRESS") || rule.id.includes("WIDTH") ? "shield" : "info"} /></span>
                <span>
                  <strong>{ruleTitle(rule, locale)}</strong>
                  <small>{ruleCategory(rule, locale)}</small>
                  <small className="rule-row-description">{ruleDetail(rule, locale)}</small>
                </span>
                <span className="rule-summary-check" aria-label={rule.enabled && selectedProfile.engineSupported ? l("active") : l("draft")}>
                  {rule.enabled && selectedProfile.engineSupported ? <Icon name="check" /> : <Icon name="info" />}
                </span>
              </div>
            )) : (
              <div className="empty-rule-row">{l("noRules")}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={wizardRef} className="page-scroll wizard-view" aria-labelledby="setup-title">
      <div className="page-heading motion-item">
        <div>
          <h1 id="setup-title">{l("overviewTitle")}</h1>
          <p>{l("overviewBody")}</p>
        </div>
      </div>

      <nav className="wizard-steps" aria-label={l("reviewFlow")}>
        {steps.map((item, index) => (
          <span className="wizard-step-group" key={item.id}>
            <button
              className={`wizard-step${wizardStep === item.id ? " is-current" : ""}${wizardStep > item.id ? " is-complete" : ""}`}
              type="button"
              disabled={item.id > wizardStep}
              aria-current={wizardStep === item.id ? "step" : undefined}
              onClick={() => goToStep(item.id)}
            >
              <span className="wizard-step-marker" aria-hidden="true">
                {wizardStep > item.id ? <Icon name="check" /> : <Icon name={item.icon} />}
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.id}/3</small>
              </span>
            </button>
            {index < steps.length - 1 && <span className={`wizard-step-connector${wizardStep > item.id ? " is-complete" : ""}`} aria-hidden="true" />}
          </span>
        ))}
      </nav>

      <section className="wizard-panel panel motion-item">
        <div className="wizard-stage">
          {wizardStep === 1 && (
            <section className="wizard-stage-section" data-tour="ifc-input" aria-labelledby="upload-title">
              <div className="wizard-panel-header">
                <div>
                  <h2 id="upload-title">{l("modelInputTitle")}</h2>
                  <p>{l("modelInputBody")}</p>
                </div>
                <span className="panel-icon"><Icon name="upload" /></span>
              </div>

              <div className="wizard-model-layout">
                <div className="wizard-drop-zone">
                  <div
                    className={`drop-zone${dragActive ? " is-dragging" : ""}${files.length ? " has-file" : ""}`}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      onDragActive(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      if (event.currentTarget === event.target) onDragActive(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      onDragActive(false);
                      const candidates = Array.from(event.dataTransfer.files);
                      if (candidates.length) onFiles(candidates);
                    }}
                  >
                    <input
                      ref={fileInput}
                      id="ifc-file"
                      type="file"
                      multiple
                      accept=".ifc,application/octet-stream"
                      onChange={(event) => {
                        const candidates = Array.from(event.target.files ?? []);
                        if (candidates.length) onFiles(candidates);
                      }}
                    />
                    {files.length ? (
                      <div className="selected-files">
                        <div className="selected-files-header">
                          <span className="file-icon"><Icon name="file" /></span>
                          <span className="selected-file-copy">
                            <strong>{files.length} {l("filesSelected")}</strong>
                            <small>{files.reduce((total, candidate) => total + candidate.size, 0) / 1024 / 1024 < 10 ? `${(files.reduce((total, candidate) => total + candidate.size, 0) / 1024 / 1024).toFixed(2)} MiB` : `${(files.reduce((total, candidate) => total + candidate.size, 0) / 1024 / 1024).toFixed(1)} MiB`} · IFC STEP</small>
                          </span>
                          <button className="icon-button" type="button" aria-label={l("clearFile")} onClick={onClearFile}>
                            <Icon name="x" />
                          </button>
                        </div>
                        <ul className="selected-files-list" aria-label={l("selectedFiles")}>
                          {files.map((candidate) => (
                            <li key={`${candidate.name}-${candidate.lastModified}-${candidate.size}`}>
                              <Icon name="file" />
                              <span title={candidate.name}>{candidate.name}</span>
                              <small>{(candidate.size / 1024 / 1024).toFixed(2)} MiB{candidate.size > MAX_UPLOAD_BYTES && files.length > 1 ? ` · ${l("batchFileTooLargeWillSkip")}` : ""}</small>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <label className="drop-target" htmlFor="ifc-file">
                        <span className="drop-file-icon"><Icon name="file" /></span>
                        <strong>{dragActive ? l("dragActive") : l("dropIfc")}</strong>
                        <span>{l("browseFiles")}</span>
                        <small>.ifc STEP · multiple files · max 50 MiB each</small>
                      </label>
                    )}
                  </div>
                  {files.length > 1 && <p className="batch-import-note"><strong>{l("batchImport")}</strong> · {l("batchImportHint")}</p>}
                </div>

                <aside className="wizard-scope-preview" aria-labelledby="scope-preview-title">
                  <div className="wizard-scope-heading">
                    <span className="wizard-scope-icon"><Icon name="shield" /></span>
                    <div>
                      <h3 id="scope-preview-title">{l("scopePreview")}</h3>
                      <p>{l("scopePreviewBody")}</p>
                    </div>
                  </div>
                  <div className="wizard-scope-profile">
                    <span className={`profile-status-dot${selectedProfile.engineSupported ? "" : " is-draft"}`} />
                    <span>
                      <strong>{profileName(selectedProfile, locale)}</strong>
                      <small>{profileJurisdiction(selectedProfile, locale)}</small>
                    </span>
                  </div>
                  <ul className="wizard-scope-rules">
                    {selectedProfile.rules.length > 0 ? selectedProfile.rules.map((rule) => (
                      <li key={rule.id}>
                        <span className={`wizard-scope-rule-icon${rule.id.includes("EGRESS") ? " teal" : " info"}`}><Icon name={rule.id.includes("EGRESS") ? "shield" : "info"} /></span>
                        <span>
                          <strong>{ruleTitle(rule, locale)}</strong>
                          <small>{ruleCategory(rule, locale)}</small>
                        </span>
                      </li>
                    )) : <li className="wizard-scope-empty">{l("noRules")}</li>}
                  </ul>
                  <div className="wizard-scope-next"><Icon name="arrow" /> {l("scopeNext")}</div>
                </aside>
              </div>

              <div className="wizard-actions">
                <div className="wizard-actions-left">
                  <button className="text-link-button wizard-shortcut" data-tour="sample-run" type="button" disabled={status === "running" || !selectedProfile.engineSupported} title={!selectedProfile.engineSupported ? l("profileNotReady") : undefined} onClick={() => onRunSample("mixed_review")}>
                    <Icon name="database" /> {l("sampleShortcut")}
                  </button>
                </div>
                <div className="wizard-actions-right">
                  <button className="button button-primary wizard-action-button wizard-next-button" type="button" disabled={status === "running" || !files.length} onClick={goNext}>
                    {l("nextStep")} <Icon name="chevron" />
                  </button>
                </div>
              </div>
            </section>
          )}

          {wizardStep === 2 && (
            <section className="wizard-stage-section" data-tour="rule-profile" aria-labelledby="profile-title">
              <div className="wizard-panel-header">
                <div>
                  <h2 id="profile-title">{l("reviewRulesTitle")}</h2>
                  <p>{l("ruleProfileHint")}</p>
                </div>
              </div>
              {renderProfilePicker()}
              <div className="wizard-actions">
                <div className="wizard-actions-left">
                  <button className="button button-secondary wizard-action-button wizard-back-button" type="button" onClick={goBack}><Icon name="chevron" className="wizard-back-icon" /> {l("previousStep")}</button>
                </div>
                <div className="wizard-actions-right">
                  <button className="button button-primary wizard-action-button wizard-next-button" type="button" disabled={status === "running" || !selectedProfile.engineSupported} title={!selectedProfile.engineSupported ? l("profileNotReady") : undefined} onClick={goNext}>
                    {l("nextStep")} <Icon name="chevron" />
                  </button>
                </div>
              </div>
            </section>
          )}

          {wizardStep === 3 && (
            <section className="wizard-stage-section" data-tour="run-review" aria-labelledby="run-title">
              <div className="wizard-panel-header">
                <div>
                  <h2 id="run-title">{l("reviewReady")}</h2>
                  <p>{l("reviewReadyBody")}</p>
                </div>
                <span className="panel-icon"><Icon name="play" /></span>
              </div>

              <div className="wizard-summary" aria-label={l("reviewReady")}>
                <div>
                  <span>{l("selectedModel")}</span>
                  <strong title={files.length === 1 ? files[0].name : undefined}>{files.length === 1 ? files[0].name : files.length ? `${files.length} ${l("filesSelected")}` : "—"}</strong>
                </div>
                <div>
                  <span>{l("ruleProfile")}</span>
                  <strong>{profileName(selectedProfile, locale)}</strong>
                </div>
                <div>
                  <span>{l("rulesActive")}</span>
                  <strong>{selectedProfile.rules.length}</strong>
                </div>
              </div>
              {files.length > 1 && <p className="batch-import-note wizard-batch-note">{l("batchReviewNote")}</p>}

              <div className="wizard-actions">
                <div className="wizard-actions-left">
                  <button className="button button-secondary wizard-action-button wizard-back-button" type="button" onClick={goBack}><Icon name="chevron" className="wizard-back-icon" /> {l("previousStep")}</button>
                </div>
                <div className="wizard-actions-right">
                  <button className="button button-primary wizard-action-button wizard-run-button" type="button" disabled={status === "running" || !files.length || !selectedProfile.engineSupported} title={!selectedProfile.engineSupported ? l("profileNotReady") : undefined} onClick={onRunUpload}>
                    <Icon name="play" /> {files.length > 1 ? l("runBatchReview") : l("runReview")}
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function RunningView({
  label,
  t,
  complete,
  startedAt,
  hasResults,
  onViewResults,
}: {
  label: string;
  t: (key: CopyKey) => string;
  complete: boolean;
  startedAt: number;
  hasResults: boolean;
  onViewResults: () => void;
}) {
  const traceRef = useRef<HTMLElement>(null);
  const steps = useMemo(() => [
    ["01", t("processingUpload")],
    ["02", t("processingInspect")],
    ["03", t("processingReview")],
    ["04", t("processingEvidence")],
  ], [t]);
  const stepLimit = complete ? steps.length : Math.max(steps.length - 1, 0);
  const initialStep = initialRunningStep(startedAt, complete, stepLimit);
  const activeStepRef = useRef(initialStep);
  const [activeStep, setActiveStep] = useState(initialStep);

  useGSAP(
    (context, contextSafe) => {
      const root = traceRef.current;
      if (!root) return;
      const select = gsap.utils.selector(root);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const updateStep = (index: number) => {
        activeStepRef.current = index;
        setActiveStep(index);
      };

      const startIndex = Math.min(Math.max(activeStepRef.current, 0), stepLimit);
      const stepHoldDuration = RUNNING_STEP_HOLD_SECONDS;
      const safeUpdateStep = contextSafe ? contextSafe(updateStep) : updateStep;

      if (reducedMotion) {
        const reducedSequence = gsap.timeline({ delay: 0.12 });
        for (let index = startIndex; index < stepLimit; index += 1) {
          if (index === startIndex) reducedSequence.call(() => safeUpdateStep(index), [], 0);
          const marker = select(`.running-step-${index} .running-step-marker`);
          reducedSequence.to(marker, { scale: 1, duration: stepHoldDuration, ease: "none" });
          const nextStep = index + 1;
          if (nextStep <= stepLimit) reducedSequence.call(() => safeUpdateStep(nextStep));
        }
        return () => reducedSequence.kill();
      }

      const intro = gsap.timeline({ defaults: { ease: "power2.out" } });
      intro
        .from(select(".running-live-card"), { autoAlpha: 0, y: 10, duration: 0.09 })
        .from(select(".running-step"), { autoAlpha: 0, x: -8, duration: 0.07, stagger: 0.023 }, "-=0.04");

      const sequence = gsap.timeline({
        delay: (complete ? RUNNING_COMPLETE_ANIMATION_DELAY_MS : RUNNING_ACTIVE_ANIMATION_DELAY_MS) / 1000,
      });
      for (let index = startIndex; index < stepLimit; index += 1) {
        if (index === startIndex) sequence.call(() => safeUpdateStep(index), [], 0);
        const marker = select(`.running-step-${index} .running-step-marker`);
        sequence
          .to(marker, {
            scale: 1.08,
            duration: RUNNING_STEP_PULSE_IN_SECONDS,
            ease: "power2.out",
          })
          .to(marker, {
            scale: 1,
            duration: RUNNING_STEP_PULSE_OUT_SECONDS,
            ease: "power2.inOut",
          })
          .to(marker, { scale: 1, duration: stepHoldDuration, ease: "none" });

        const nextStep = index + 1;
        if (nextStep <= stepLimit) {
          sequence.call(() => safeUpdateStep(nextStep));
          sequence
            .to(marker, {
              scale: 1.08,
              duration: RUNNING_STEP_PULSE_IN_SECONDS,
              ease: "power2.out",
            })
            .to(marker, {
              scale: 1,
              duration: RUNNING_STEP_PULSE_OUT_SECONDS,
              ease: "power2.inOut",
            });
        }
      }

      return () => {
        intro.kill();
        sequence.kill();
      };
    },
    { scope: traceRef, dependencies: [steps.length, complete, startedAt, stepLimit], revertOnUpdate: true },
  );

  const traceComplete = complete && activeStep >= steps.length;

  return (
    <section ref={traceRef} className="running-view page-scroll" aria-live="polite" aria-busy={!traceComplete}>
      <div className="running-card running-live-card panel">
        <div className={`running-icon${traceComplete ? " is-complete" : ""}`}>
          {!traceComplete && <span className="loading-spinner" />}
          <Icon name={traceComplete ? "check" : "activity"} />
        </div>
        <span className="section-kicker">{t("processingEyebrow")}</span>
        <h1>{t("processingTitle")}</h1>
        <p>{t("processingBody")}</p>
        <div className="running-file"><Icon name="file" /><strong>{label}</strong><span>{traceComplete ? t("processingComplete") : t("processingWait")}</span></div>
        <div className="running-trace">
          <div className="running-trace-heading">
            <span className="running-trace-heading-icon"><Icon name="activity" /></span>
            <span className="running-trace-heading-copy"><strong>{t("agentTrace")}</strong><small>{traceComplete ? t("processingReady") : t("processingWait")}</small></span>
            {traceComplete && hasResults && (
              <button className="button button-primary button-compact running-results-button" type="button" onClick={onViewResults}>
                <Icon name="list" /> {t("viewResults")} <Icon name="chevron" />
              </button>
            )}
          </div>
          <ol className="running-steps" aria-label={t("agentTrace")}>
            {steps.map(([number, labelText], index) => {
              const state = index < activeStep ? "is-complete" : index === activeStep ? "is-active" : "is-pending";
              const stateLabel = index < activeStep ? t("processingComplete") : index === activeStep ? t("processingActive") : t("processingQueued");
              return (
                <li key={number} className={`running-step running-step-${index} ${state}`} aria-current={index === activeStep ? "step" : undefined}>
                  <span className="running-step-marker" aria-hidden="true">{index < activeStep ? <Icon name="check" /> : number}</span>
                  <span className="running-step-copy"><strong>{labelText}</strong><small>{stateLabel}</small></span>
                  <i className="running-step-signal" aria-hidden="true" />
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

function DeletedView({ t, onReset }: { t: (key: UiCopyKey) => string; onReset: () => void }) {
  return (
    <section className="empty-view page-scroll" aria-live="polite">
      <div className="empty-card panel motion-item">
        <span className="empty-icon success"><Icon name="check" /></span>
        <h1>{t("deletedTitle")}</h1>
        <p>{t("deletedBody")}</p>
        <button className="button button-primary" type="button" onClick={onReset}><Icon name="plus" /> {t("newReview")}</button>
      </div>
    </section>
  );
}

function ReviewApplicabilityNotice({
  review,
  locale,
  l,
  onNewReview,
}: {
  review: ReviewRun;
  locale: Locale;
  l: (key: UiCopyKey) => string;
  onNewReview: () => void;
}) {
  const scope = getReviewScope(review);
  const inventoryStage = review.trace.find((stage) => stage.key === "inventory");
  const noApplicableDoors = scope.reason === "no_applicable_doors";

  if (scope.status !== "NOT_APPLICABLE") return null;

  const title = noApplicableDoors ? l("noApplicableDoorsTitle") : l("noExecutableRulesTitle");
  const body = noApplicableDoors ? l("noApplicableDoorsBody") : l("noExecutableRulesBody");
  const doorLabel = textForLocale(locale, "IfcDoor occurrences", "IfcDoor 构件数量", "IfcDoor 構件數量");
  const totalLabel = textForLocale(locale, "Total IFC entities", "IFC 实体总数", "IFC 實體總數");
  const ruleLabel = textForLocale(locale, "Enabled rules", "已启用规则", "已啟用規則");

  return (
    <aside className="applicability-notice is-empty-result motion-item" role="status">
      <span className="applicability-notice-icon"><Icon name="info" /></span>
      <div className="applicability-notice-copy">
        <div className="applicability-notice-status"><span>{l("scopeStatus")}</span><strong>{l("notApplicable")}</strong></div>
        <h2>{title}</h2>
        <p>{body}</p>
        <p className="applicability-notice-explanation">{l("notApplicableBody")}</p>
        <div className="applicability-notice-facts" aria-label={title}>
          <span><strong>{doorLabel}</strong>{scope.door_count}</span>
          <span><strong>{totalLabel}</strong>{review.inventory.total_entities}</span>
          {inventoryStage && <span><strong>{ruleLabel}</strong>{scope.enabled_rule_count ?? "—"}</span>}
        </div>
        <button className="button button-primary button-compact" type="button" onClick={onNewReview}>
          <Icon name="plus" /> {l("inspectAnotherModel")}
        </button>
      </div>
    </aside>
  );
}

function batchItemStatusLabel(item: BatchRunItem, l: (key: UiCopyKey) => string): string {
  if (item.status === "QUEUED") return l("batchQueued");
  if (item.status === "RUNNING") return l("batchRunning");
  if (item.status === "COMPLETED") return l("batchCompleted");
  if (item.status === "SKIPPED") return l("batchSkipped");
  return l("batchFailed");
}

function BatchResultsView({
  batch,
  locale,
  l,
  onOpenResult,
}: {
  batch: BatchRunState;
  locale: Locale;
  l: (key: UiCopyKey) => string;
  onOpenResult: (itemId: string) => void;
}) {
  const completedItems = useMemo(
    () => batch.items.filter((item) => item.result?.review_run),
    [batch.items],
  );
  const completedIds = useMemo(
    () => completedItems.map((item) => item.id),
    [completedItems],
  );
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>(completedIds);
  const [pdfError, setPdfError] = useState("");
  const allSuccesses = useMemo(
    () => batch.items.flatMap((item) => item.result?.review_run ? [{ review: item.result.review_run }] : []),
    [batch.items],
  );
  const allFailures = useMemo(
    () => batch.items.flatMap((item) => item.error ? [item.error] : []),
    [batch.items],
  );
  const selectedItems = useMemo(
    () => completedItems.filter((item) => selectedBatchIds.includes(item.id)),
    [completedItems, selectedBatchIds],
  );
  const selectedSuccesses = useMemo(
    () => selectedItems.flatMap((item) => item.result?.review_run ? [{ review: item.result.review_run }] : []),
    [selectedItems],
  );
  const report = useMemo<BatchQuickCheckReport>(
    () => buildBatchQuickCheckReport(allSuccesses, allFailures, locale),
    [allFailures, allSuccesses, locale],
  );
  const selectedReport = useMemo<BatchQuickCheckReport>(
    () => buildBatchQuickCheckReport(selectedSuccesses, [], locale),
    [locale, selectedSuccesses],
  );
  const allCompletedSelected = completedIds.length > 0 && completedIds.every((id) => selectedBatchIds.includes(id));

  function toggleBatchSelection(itemId: string) {
    setSelectedBatchIds((current) => current.includes(itemId)
      ? current.filter((id) => id !== itemId)
      : [...current, itemId]);
    setPdfError("");
  }

  function toggleAllBatchSelection() {
    setSelectedBatchIds(allCompletedSelected ? [] : completedIds);
    setPdfError("");
  }

  function exportSelectedPdf() {
    if (!selectedItems.length) {
      setPdfError(l("batchPdfNoSelection"));
      return;
    }
    setPdfError("");
    window.print();
  }

  const completedCount = report.summary.completed_files;
  const failedCount = report.summary.failed_files;
  const skippedCount = report.summary.skipped_files;

  return (
    <div className="findings-view page-scroll is-report-preview batch-results-view" id="review-workspace" tabIndex={-1} aria-labelledby="batch-results-title">
      <div className="findings-heading motion-item">
        <div className="findings-heading-copy">
          <div className="run-meta-line"><Icon name="database" /><strong>{batch.items.length} {l("batchImport")}</strong><span>{l("batchSummary")}</span><span>{batch.profileId}</span></div>
          <h1 id="batch-results-title">{l("batchResultsTitle")}</h1>
          <p>{l("batchResultsBody")}</p>
        </div>
        <div className="findings-heading-controls">
          <div className="findings-actions batch-findings-actions">
            <span className="batch-selection-count">{selectedItems.length} {l("batchSelectedCount")}</span>
            <button className="button button-primary button-compact batch-export-pdf" type="button" disabled={!selectedItems.length} onClick={exportSelectedPdf}><Icon name="print" /> {l("exportBatchPdf")}</button>
          </div>
        </div>
      </div>

      {pdfError && <p className="action-error" role="alert">{pdfError}</p>}

      <section className="batch-summary-panel panel motion-item" aria-labelledby="batch-summary-title">
        <div className="batch-summary-heading">
          <div><h2 id="batch-summary-title">{l("batchSummary")}</h2><p>{batch.items.length} {l("filesSelected")}</p></div>
          <span className="batch-summary-total">{report.summary.total_findings}</span>
        </div>
        <div className="batch-kpi-grid">
          <div><span>{l("batchCompletedFiles")}</span><strong className="is-pass">{completedCount}</strong></div>
          <div><span>{l("batchFailedFiles")}</span><strong className="is-fail">{failedCount}</strong></div>
          <div><span>{l("batchSkippedFiles")}</span><strong className="is-review">{skippedCount}</strong></div>
          <div><span>{l("totalFindings")}</span><strong>{report.summary.total_findings}</strong></div>
          <div><span>{l("batchActionable")}</span><strong className="is-review">{report.summary.actionable}</strong></div>
        </div>
      </section>

      <section className="batch-file-results panel motion-item" aria-labelledby="batch-file-results-title">
        <div className="batch-file-results-heading">
          <div><h2 id="batch-file-results-title">{l("batchFileResults")}</h2><p>{l("batchSelectionHint")}</p></div>
          <label className="batch-select-all">
            <input type="checkbox" checked={allCompletedSelected} disabled={!completedItems.length} onChange={toggleAllBatchSelection} aria-label={l(allCompletedSelected ? "clearBatchSelection" : "selectAllBatchFiles")} />
            <span>{l(allCompletedSelected ? "clearBatchSelection" : "selectAllBatchFiles")}</span>
          </label>
        </div>
        <div className="batch-file-results-list">
          {batch.items.map((item, index) => {
            const review = item.result?.review_run;
            return (
              <article className={`batch-file-result-item is-${item.status.toLowerCase()}`} key={item.id}>
                <label className="batch-file-result-select">
                  <input type="checkbox" checked={Boolean(review && selectedBatchIds.includes(item.id))} disabled={!review} onChange={() => toggleBatchSelection(item.id)} aria-label={`${l("selectBatchFile")}: ${item.label}`} />
                </label>
                <span className="batch-file-result-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="batch-file-result-icon"><Icon name={item.status === "COMPLETED" ? "check" : item.status === "FAILED" ? "x" : item.status === "RUNNING" ? "activity" : "file"} /></span>
                {review ? (
                  <button
                    className="batch-file-result-copy batch-file-result-open"
                    type="button"
                    onClick={() => onOpenResult(item.id)}
                    aria-label={`${l("batchViewResult")}: ${item.label}`}
                  >
                    <strong title={item.label}>{item.label}</strong>
                    <small>{batchItemStatusLabel(item, l)} · {review.summary.total_findings} {l("findings").toLocaleLowerCase(locale)} · {l("batchViewResult")}</small>
                  </button>
                ) : (
                  <span className="batch-file-result-copy"><strong title={item.label}>{item.label}</strong><small>{batchItemStatusLabel(item, l)}{item.error ? ` · ${item.error.code === "request_too_large" ? l("batchRequestTooLarge") : item.error.message}` : ""}</small></span>
                )}
                {review && (
                  <span
                    className="batch-file-result-counts"
                    aria-label={`${l("fail")} ${review.summary.fail_count} · ${l("review")} ${review.summary.review_count} · ${l("pass")} ${review.summary.pass_count}`}
                  >
                    <span className="batch-file-result-count"><small>{l("fail")}</small><b className="is-fail">{review.summary.fail_count}</b></span>
                    <span className="batch-file-result-count"><small>{l("review")}</small><b className="is-review">{review.summary.review_count}</b></span>
                    <span className="batch-file-result-count"><small>{l("pass")}</small><b className="is-pass">{review.summary.pass_count}</b></span>
                  </span>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <BatchQuickCheckPrintReport report={selectedReport} locale={locale} l={l} />
    </div>
  );
}

function FindingsView({
  result,
  locale,
  t,
  l,
  onNewReview,
  onDeleted,
  onBackToBatch,
}: {
  result: StoredAgentReviewResult;
  locale: Locale;
  t: (key: CopyKey) => string;
  l: (key: UiCopyKey) => string;
  onNewReview: () => void;
  onDeleted: () => void;
  onBackToBatch?: () => void;
}) {
  const review = result.review_run;
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(review?.findings[0]?.finding_id ?? null);
  const [actionError, setActionError] = useState("");
  const [copiedFormat, setCopiedFormat] = useState<"json" | "markdown" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);
  const reportOutlineListRef = useRef<HTMLDivElement | null>(null);
  const quickCheck = review ? buildQuickCheckReport(review, locale) : null;
  const isNotApplicable = review ? getReviewScope(review).status === "NOT_APPLICABLE" : false;

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
    };
  }, []);

  const filtered = useMemo(
    () => review?.findings.filter((finding) => filter === "ALL" || finding.status === filter) ?? [],
    [filter, review],
  );
  const selected = filtered.find((finding) => finding.finding_id === selectedId) ?? filtered[0] ?? null;
  const outlineScroll = useScrollAffordance(reportOutlineListRef, `${filter}:${filtered.length}`);

  useEffect(() => {
    if (reportOutlineListRef.current) reportOutlineListRef.current.scrollTop = 0;
  }, [filter]);

  function focusFinding(findingId: string) {
    setSelectedId(findingId);
    window.requestAnimationFrame(() => {
      document.getElementById(findingAnchor(findingId))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function writeClipboard(body: string) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(body);
        return;
      } catch {
        // Fall back to the legacy copy path when permission or browser support is limited.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = body;
    textarea.setAttribute("readonly", "true");
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      if (!document.execCommand("copy")) throw new Error("Clipboard copy failed.");
    } finally {
      textarea.remove();
    }
  }

  async function copyExport(body: string, format: "json" | "markdown") {
    setActionError("");
    try {
      await writeClipboard(body);
      setCopiedFormat(format);
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedFormat(null);
        copyResetTimerRef.current = null;
      }, 1800);
    } catch {
      setCopiedFormat(null);
      setActionError(l("copyError"));
    }
  }

  async function copyJson() {
    if (!quickCheck || !review) return;
    await copyExport(quickCheckJson(quickCheck), "json");
  }

  async function copyMarkdown() {
    if (!quickCheck || !review) return;
    await copyExport(quickCheckMarkdown(quickCheck), "markdown");
  }

  async function deleteRun() {
    if (!window.confirm(l("deleteConfirm"))) return;
    setDeleting(true);
    setActionError("");
    try {
      const response = await fetch(result.access.retrieval.delete, {
        method: "DELETE",
        headers: { authorization: `Bearer ${result.access.access_token}` },
      });
      if (!response.ok) throw new Error("Delete failed.");
      onDeleted();
    } catch {
      setDeleting(false);
      setActionError(l("deleteError"));
    }
  }

  if (!review) {
    return (
      <section className="empty-view page-scroll" id="review-workspace" tabIndex={-1}>
        <div className="empty-card panel motion-item">
          <span className="empty-icon info"><Icon name="info" /></span>
          <span className="section-kicker">AGENT OUTCOME</span>
          <h1>{result.agent_run.final_response?.message ?? "No canonical ReviewRun was produced."}</h1>
          <p>{t("boundary")}</p>
          <button className="button button-primary" type="button" onClick={onNewReview}><Icon name="plus" /> {l("newReview")}</button>
        </div>
      </section>
    );
  }

  const filters: ReadonlyArray<[Filter, UiCopyKey, number]> = [
    ["ALL", "all", review.summary.total_findings],
    ["FAIL", "fail", review.summary.fail_count],
    ["REVIEW", "review", review.summary.review_count],
    ["PASS", "pass", review.summary.pass_count],
  ];

  return (
    <div className="findings-view page-scroll is-report-preview" id="review-workspace" tabIndex={-1} aria-labelledby="findings-title">
      <div className="findings-heading motion-item">
        <div className="findings-heading-copy">
          <div className="run-meta-line"><Icon name="file" /><strong>{review.source.filename}</strong><span>{review.inventory.schema_name}</span><span>{review.rule_pack_id} · v{review.rule_pack_version}</span></div>
          <h1 id="findings-title">{l("reportPreview")}</h1>
          <p>{l("reportPreviewBody")}</p>
        </div>
        <div className="findings-heading-controls">
          <div className="findings-actions">
            {onBackToBatch && <button className="button button-secondary button-compact findings-batch-back" type="button" onClick={onBackToBatch}><Icon name="chevron" className="icon-chevron-back" /> {l("backToBatch")}</button>}
            <button className="button button-secondary button-compact findings-new-review" type="button" onClick={onNewReview}><Icon name="plus" /> {l("newReview")}</button>
            <button className="button button-primary button-compact findings-copy findings-copy-json" type="button" onClick={() => void copyJson()}><Icon name={copiedFormat === "json" ? "check" : "copy"} /> {l(copiedFormat === "json" ? "copiedJson" : "copyJson")}</button>
            <button className="button button-secondary button-compact findings-copy findings-copy-markdown" type="button" onClick={() => void copyMarkdown()}><Icon name={copiedFormat === "markdown" ? "check" : "copy"} /> {l(copiedFormat === "markdown" ? "copiedMarkdown" : "copyMarkdown")}</button>
            <button className="button button-secondary button-compact findings-print print-action" type="button" onClick={() => window.print()}><Icon name="print" /> {l("printReport")}</button>
            <button className="button button-danger button-compact findings-delete" type="button" disabled={deleting} onClick={() => void deleteRun()}><Icon name="trash" /> {deleting ? l("deleting") : l("deleteReview")}</button>
          </div>
        </div>
      </div>

      {actionError && <p className="action-error" role="alert">{actionError}</p>}

      <>
          <section className="report-context motion-item" aria-labelledby="report-context-title">
            <div className="report-context-copy">
              <h2 id="report-context-title">{l("runContext")}</h2>
              <p>{l("runContextBody")}</p>
            </div>
            <dl className="report-run-facts">
              <div className="report-fact-wide"><dt>{l("sourceFile")}</dt><dd title={review.source.filename}>{review.source.filename}</dd></div>
              <div><dt>{l("schema")}</dt><dd>{review.inventory.schema_name}</dd></div>
              <div className="report-fact-wide"><dt>{l("rulePack")}</dt><dd>{review.rule_pack_id} · v{review.rule_pack_version}</dd></div>
              <div><dt>{l("doorCount")}</dt><dd>{review.inventory.entity_counts.IfcDoor ?? 0}</dd></div>
              <div><dt>{l("reviewedEntities")}</dt><dd>{review.summary.reviewed_entities}</dd></div>
              <div><dt>{l("completedAt")}</dt><dd>{formatDate(review.completed_at, locale)}</dd></div>
            </dl>
          </section>

          <ReviewApplicabilityNotice review={review} locale={locale} l={l} onNewReview={onNewReview} />

          {!isNotApplicable && <>
            <div className="report-kpi-strip motion-item" aria-label={l("reportSummary")}>
              <SummaryMetric label={l("totalFindings")} value={review.summary.total_findings} kind="total" />
              <SummaryMetric label={l("fail")} value={review.summary.fail_count} kind="fail" />
              <SummaryMetric label={l("review")} value={review.summary.review_count} kind="review" />
              <SummaryMetric label={l("pass")} value={review.summary.pass_count} kind="pass" />
            </div>

            <ReportSummaryTable
              findings={filtered}
              rulePackId={review.rule_pack_id}
              selectedId={selected?.finding_id ?? null}
              locale={locale}
              t={t}
              l={l}
              onSelect={focusFinding}
            />

            <div className="report-body">
            <aside className="report-outline panel motion-item" aria-labelledby="report-outline-title">
              <div className="report-outline-header">
                <div>
                  <h2 id="report-outline-title">{l("reportOutline")}</h2>
                  <p>{filtered.length} / {review.summary.total_findings}</p>
                </div>
                <span className="finding-count">{filtered.length}</span>
              </div>
              <div className="filter-row report-filter-row" role="group" aria-label={l("status")}>
                {filters.map(([value, labelKey, count]) => (
                  <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setSelectedId(null); }}>
                    {l(labelKey)} <span>{count}</span>
                  </button>
                ))}
              </div>
              <div ref={reportOutlineListRef} className="report-outline-list" role="region" aria-label={l("reportDetails")}>
                {filtered.length ? filtered.map((finding, index) => (
                  <button
                    className={`report-outline-item status-${finding.status.toLocaleLowerCase("en-US")}${selected?.finding_id === finding.finding_id ? " is-selected" : ""}`}
                    key={finding.finding_id}
                    type="button"
                    aria-current={selected?.finding_id === finding.finding_id ? "true" : undefined}
                    onClick={() => focusFinding(finding.finding_id)}
                  >
                    <span className="report-outline-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="report-outline-copy"><strong>{findingTitle(finding, locale)}</strong><small>{finding.entity.name ?? finding.entity.global_id}</small></span>
                    <span className="report-outline-status" aria-label={statusLabel(finding.status, l)}>{statusIcon(finding.status)}</span>
                  </button>
                )) : <p className="empty-list">{t("noFindings")}</p>}
              </div>
              <div className="report-outline-footer">
                <span>{review.summary.reviewed_entities} {l("entities")}</span>
                {outlineScroll.canScrollDown && <span className="report-outline-scroll-hint"><Icon name="chevronDown" /> {l("scrollForMore")}</span>}
                {!outlineScroll.canScrollDown && outlineScroll.canScrollUp && <span className="report-outline-scroll-hint"><Icon name="chevronDown" /> {l("scrollForPrevious")}</span>}
              </div>
            </aside>

            <section className="report-document" aria-labelledby="report-details-title">
              <div className="report-document-header">
                <div><h2 id="report-details-title">{l("reportDetails")}</h2><p>{l("reportPreviewBody")}</p></div>
                <span>{filtered.length} {l("findings").toLocaleLowerCase(locale)}</span>
              </div>
              <div className="report-finding-list">
                {filtered.length ? filtered.map((finding, index) => (
                  <FindingReportDetail key={finding.finding_id} finding={finding} index={index} rulePackId={review.rule_pack_id} locale={locale} t={t} l={l} />
                )) : <div className="empty-report panel"><span className="empty-icon info"><Icon name="info" /></span><p>{t("noFindings")}</p></div>}
              </div>
            </section>
            </div>
          </>}
      </>

      {quickCheck && <QuickCheckPrintReport report={quickCheck} locale={locale} l={l} />}
      <AgentTrace result={result} locale={locale} l={l} />
    </div>
  );
}

function ReportSummaryTable({
  findings,
  rulePackId,
  selectedId,
  locale,
  t,
  l,
  onSelect,
}: {
  findings: Finding[];
  rulePackId: string;
  selectedId: string | null;
  locale: Locale;
  t: (key: CopyKey) => string;
  l: (key: UiCopyKey) => string;
  onSelect: (findingId: string) => void;
}) {
  return (
    <section className="report-summary panel motion-item" aria-labelledby="report-summary-title">
      <div className="report-section-heading">
        <div><h2 id="report-summary-title">{l("reportSummary")}</h2><p>{l("reportSummaryBody")}</p></div>
        <span className="report-section-count">{findings.length}</span>
      </div>
      <div className="report-summary-table-wrap">
        {findings.length ? (
          <table className="report-summary-table">
            <caption className="sr-only">{l("reportSummary")}</caption>
            <thead>
              <tr>
                <th scope="col">{l("status")}</th>
                <th scope="col">{l("detail")}</th>
                <th scope="col">{l("actualValue")}</th>
                <th scope="col">{l("requiredValue")}</th>
                <th scope="col">{l("difference")}</th>
                <th scope="col">{l("entity")}</th>
                <th scope="col">{l("storey")}</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((finding) => {
                const metric = decisionMetric(finding);
                const isSelected = finding.finding_id === selectedId;
                return (
                  <tr
                    className={isSelected ? "is-selected" : undefined}
                    key={finding.finding_id}
                    tabIndex={0}
                    onClick={() => onSelect(finding.finding_id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(finding.finding_id);
                      }
                    }}
                  >
                    <td data-label={l("status")}><span className={`report-status-mark status-${finding.status.toLocaleLowerCase("en-US")}`}>{statusIcon(finding.status)}<span>{statusLabel(finding.status, l)}</span></span></td>
                    <td data-label={l("detail")}><strong>{findingTitle(finding, locale)}</strong><small>{displayRuleId(finding.rule_id, rulePackId)} · {findingCategory(finding, locale)}</small></td>
                    <td data-label={l("actualValue")} className="report-value">{metric ? formatMetric(metric.actual, metric.unit, locale) : "—"}</td>
                    <td data-label={l("requiredValue")} className="report-value">{metric ? `${metric.operator} ${formatMetric(metric.required, metric.unit, locale)}` : "—"}</td>
                    <td data-label={l("difference")} className={`report-value report-difference status-${finding.status.toLocaleLowerCase("en-US")}`}>{metric ? formatMetric(metric.difference, metric.unit, locale, true) : "—"}</td>
                    <td data-label={l("entity")}><strong>{finding.entity.name ?? finding.entity.global_id}</strong><small>{finding.entity.ifc_class}</small></td>
                    <td data-label={l("storey")}>{finding.entity.storey ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="empty-list">{t("noFindings")}</p>}
      </div>
    </section>
  );
}

function SummaryMetric({ label, value, kind }: { label: string; value: number; kind: "total" | "pass" | "fail" | "review" }) {
  return <div className={`summary-metric summary-${kind}`}><span>{label}</span><strong>{value}</strong></div>;
}

function FindingReportDetail({
  finding,
  index,
  rulePackId,
  locale,
  t,
  l,
}: {
  finding: Finding;
  index: number;
  rulePackId: string;
  locale: Locale;
  t: (key: CopyKey) => string;
  l: (key: UiCopyKey) => string;
}) {
  return (
    <article
      id={findingAnchor(finding.finding_id)}
      className={`report-finding report-status-${finding.status.toLocaleLowerCase("en-US")}`}
      aria-labelledby={`${findingAnchor(finding.finding_id)}-title`}
    >
      <header className="report-finding-header">
        <span className="report-finding-number">{String(index + 1).padStart(2, "0")}</span>
        <div className="report-finding-heading">
          <div className="inspector-badges">
            <span className={`status-badge status-${finding.status.toLocaleLowerCase("en-US")}`}>{statusIcon(finding.status)} {statusLabel(finding.status, l)}</span>
            <span className="data-badge">{findingCategory(finding, locale)}</span>
            <span className="data-badge">{displayRuleId(finding.rule_id, rulePackId)}</span>
            <span className="data-badge">{finding.severity}</span>
          </div>
          <h3 id={`${findingAnchor(finding.finding_id)}-title`}>{findingTitle(finding, locale)}</h3>
        </div>
        <span className="inspector-finding-id">{finding.finding_id}</span>
      </header>

      <DecisionSummary finding={finding} locale={locale} l={l} />
      <EntityFacts finding={finding} l={l} />
      <FindingEvidenceSections finding={finding} rulePackId={rulePackId} locale={locale} t={t} l={l} variant="report" />
    </article>
  );
}

function EntityFacts({ finding, l }: { finding: Finding; l: (key: UiCopyKey) => string }) {
  return (
    <dl className="entity-definition-grid">
      <div><dt>{l("entity")}</dt><dd>{finding.entity.name ?? "—"}</dd></div>
      <div><dt>{l("globalId")}</dt><dd className="mono">{finding.entity.global_id}</dd></div>
      <div><dt>{l("ifcClass")}</dt><dd>{finding.entity.ifc_class}</dd></div>
      <div><dt>{l("storey")}</dt><dd>{finding.entity.storey ?? "—"}</dd></div>
    </dl>
  );
}

function FindingEvidenceSections({
  finding,
  rulePackId,
  locale,
  t,
  l,
  variant,
}: {
  finding: Finding;
  rulePackId: string;
  locale: Locale;
  t: (key: CopyKey) => string;
  l: (key: UiCopyKey) => string;
  variant: "report" | "inspector";
}) {
  const observations = [
    ...(finding.model_evidence.applicability_signal ? [finding.model_evidence.applicability_signal] : []),
    ...finding.model_evidence.observations,
  ];
  const evidenceClassName = variant === "report" ? "report-evidence-grid" : "evidence-stack";

  return (
    <>
      <div className={evidenceClassName}>
        <section className="evidence-section" aria-labelledby={`${findingAnchor(finding.finding_id)}-model-evidence-title`}>
          <div className="evidence-heading"><h3 id={`${findingAnchor(finding.finding_id)}-model-evidence-title`}>{l("modelEvidence")}</h3></div>
          {observations.length ? observations.map((observation, index) => <ObservationRow key={`${observation.source_path}-${index}`} observation={observation} locale={locale} l={l} />) : <p className="muted-copy">{t("noObservation")}</p>}
        </section>
        <section className="evidence-section" aria-labelledby={`${findingAnchor(finding.finding_id)}-rule-evidence-title`}>
          <div className="evidence-heading"><h3 id={`${findingAnchor(finding.finding_id)}-rule-evidence-title`}>{l("ruleEvidence")}</h3></div>
          <dl className="rule-definition-grid">
            <div><dt>{t("ruleVersion")}</dt><dd>{displayRuleId(finding.rule_evidence.rule_id, rulePackId)} · {finding.rule_evidence.version}</dd></div>
            <div><dt>{l("authority")}</dt><dd>{authorityLabel(finding.rule_evidence.authority, locale)}</dd></div>
            <div><dt>{t("source")}</dt><dd>{finding.rule_evidence.source_title}</dd></div>
            {finding.rule_evidence.clause && <div><dt>{l("clause")}</dt><dd>{finding.rule_evidence.clause}</dd></div>}
            <div className="wide rule-parameters"><dt>{l("parameters")}</dt><dd><RuleParameterList parameters={finding.rule_evidence.parameters} locale={locale} /></dd></div>
          </dl>
        </section>
      </div>

      <section className={`recommendation-block${variant === "report" ? " report-recommendation" : ""}`}>
        <div className="evidence-heading"><h3>{l("recommendedNextStep")}</h3></div>
        <p>{localizedRecommendation(finding, locale)}</p>
        {finding.explanation && <p className="limitation-copy">{localizedFindingBoundary(finding.explanation.boundary, locale)}</p>}
      </section>
    </>
  );
}

function QuickCheckPrintReport({
  report,
  locale,
  l,
}: {
  report: QuickCheckReport;
  locale: Locale;
  l: (key: UiCopyKey) => string;
}) {
  return (
    <section className="quick-check-print-report" aria-labelledby="quick-check-print-title">
      <header className="quick-check-print-header">
        <div>
          <span className="panel-overline">BIM REVIEW AGENT · QUICK CHECK V1</span>
          <h1 id="quick-check-print-title">{l("quickCheckTitle")}</h1>
          <p>{l("quickCheckBody")}</p>
        </div>
        <span className="quick-check-print-run-id">{report.generated_from.run_id}</span>
      </header>

      <dl className="quick-check-print-meta">
        <div><dt>{l("quickCheckSource")}</dt><dd>{report.source.filename}</dd></div>
        <div><dt>{l("sourceHash")}</dt><dd className="mono">{report.source.sha256}</dd></div>
        <div><dt>{l("model")}</dt><dd>{report.model.schema} · {report.model.length_unit} · {report.model.total_entities} entities</dd></div>
        <div><dt>{l("rulePack")}</dt><dd>{report.rule_pack.id} · v{report.rule_pack.version}</dd></div>
        <div><dt>{l("completedAt")}</dt><dd>{formatDate(report.generated_from.completed_at, locale)}</dd></div>
      </dl>
      <div className={report.scope.status === "NOT_APPLICABLE" ? "quick-check-print-scope scope-not-applicable" : "quick-check-print-scope scope-evaluated"}>
        <strong>{report.scope.label}</strong>
        <p>{report.scope.detail}</p>
      </div>

      <section className="quick-check-print-summary" aria-labelledby="quick-check-print-summary-title">
        <h2 id="quick-check-print-summary-title">{l("quickCheckSummary")}</h2>
        <div className="quick-check-print-summary-grid">
          <div><span>{l("totalFindings")}</span><strong>{report.summary.total_findings}</strong></div>
          <div><span>{l("pass")}</span><strong className="is-pass">{report.summary.pass}</strong></div>
          <div><span>{l("fail")}</span><strong className="is-fail">{report.summary.fail}</strong></div>
          <div><span>{l("review")}</span><strong className="is-review">{report.summary.review}</strong></div>
          <div><span>{l("actionableChecks")}</span><strong>{report.summary.actionable}</strong></div>
        </div>
      </section>

      <section className="quick-check-print-checks" aria-labelledby="quick-check-print-checks-title">
        <div className="quick-check-print-section-heading">
          <h2 id="quick-check-print-checks-title">{l("quickCheckChecks")}</h2>
          <span>{report.checks.length}</span>
        </div>
        {report.checks.length ? report.checks.map((check, index) => <QuickCheckPrintCheck key={check.finding_id} check={check} index={index} locale={locale} l={l} />) : <p className="quick-check-print-empty">{l("quickCheckNoAction")}</p>}
      </section>

      <footer className="quick-check-print-footer">
        <h2>{l("quickCheckLimitation")}</h2>
        <p>{report.limitation}</p>
      </footer>
    </section>
  );
}

function QuickCheckPrintCheck({
  check,
  index,
  locale,
  l,
}: {
  check: QuickCheckReport["checks"][number];
  index: number;
  locale: Locale;
  l: (key: UiCopyKey) => string;
}) {
  return (
    <article className={`quick-check-print-check status-${check.status.toLocaleLowerCase("en-US")}`}>
      <header>
        <span className="quick-check-print-number">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <div className="quick-check-print-check-line"><strong>{check.status_label}</strong><span>{check.display_rule_id}</span><span>{check.category}</span></div>
          <h3>{check.title}</h3>
          <p className="quick-check-print-entity">{check.entity.name} · {check.entity.ifc_class} · {check.entity.global_id}</p>
        </div>
      </header>
      <p className="quick-check-print-summary-copy">{check.summary}</p>
      {check.measurement && <p className="quick-check-print-measurement"><strong>{l("actualValue")}:</strong> {formatMetric(check.measurement.actual, check.measurement.unit, locale)} <strong>{check.measurement.operator}</strong> <strong>{l("requiredValue")}:</strong> {formatMetric(check.measurement.required, check.measurement.unit, locale)}</p>}
      <div className="quick-check-print-detail-grid">
        <div><h4>{l("quickCheckRecommendation")}</h4><p>{check.recommendation}</p></div>
        <div><h4>{l("quickCheckReference")}</h4><p>{check.reference.source_title}{check.reference.clause ? ` · ${check.reference.clause}` : ""}</p><small>{check.reference.display_rule_id} · v{check.reference.version}</small></div>
        {check.evidence.length > 0 && <div className="quick-check-print-evidence"><h4>{l("quickCheckEvidence")}</h4><ul>{check.evidence.map((evidence) => <li key={`${evidence.source_path}-${evidence.label}`}><strong>{evidence.label}:</strong> {evidence.value} <span>({evidence.source_path}; {evidence.reliability})</span></li>)}</ul></div>}
      </div>
    </article>
  );
}

function BatchQuickCheckPrintReport({
  report,
  locale,
  l,
}: {
  report: BatchQuickCheckReport;
  locale: Locale;
  l: (key: UiCopyKey) => string;
}) {
  const limitation = textForLocale(
    locale,
    "This PDF includes only the selected completed IFC files. Open the web result for complete evidence and lifecycle details.",
    "此 PDF 仅包含所选的已完成 IFC 文件；完整证据和执行详情请在网页结果中查看。",
    "此 PDF 僅包含所選的已完成 IFC 檔案；完整證據和執行詳情請在網頁結果中查看。",
  );

  return (
    <section className="batch-quick-check-print-report" aria-labelledby="batch-quick-check-print-title">
      <header className="quick-check-print-header batch-quick-check-print-header">
        <div>
          <span className="panel-overline">BIM REVIEW AGENT · BATCH QUICK CHECK V1</span>
          <h1 id="batch-quick-check-print-title">{l("batchResultsTitle")}</h1>
          <p>{l("batchSelectionHint")}</p>
        </div>
        <span className="quick-check-print-run-id">{formatDate(report.generated_at, locale)}</span>
      </header>

      <dl className="quick-check-print-meta batch-quick-check-print-meta">
        <div><dt>{l("batchCompletedFiles")}</dt><dd>{report.summary.completed_files}</dd></div>
        <div><dt>{l("totalFindings")}</dt><dd>{report.summary.total_findings}</dd></div>
        <div><dt>{l("pass")}</dt><dd>{report.summary.pass}</dd></div>
        <div><dt>{l("fail")}</dt><dd>{report.summary.fail}</dd></div>
        <div><dt>{l("review")}</dt><dd>{report.summary.review}</dd></div>
      </dl>

      <section className="quick-check-print-checks batch-quick-check-print-files" aria-labelledby="batch-quick-check-print-files-title">
        <div className="quick-check-print-section-heading">
          <h2 id="batch-quick-check-print-files-title">{l("batchFileResults")}</h2>
          <span>{report.results.length}</span>
        </div>
        {report.results.map((result, fileIndex) => (
          <section className="batch-quick-check-print-file" key={result.generated_from.run_id}>
            <header className="batch-quick-check-print-file-header">
              <div className="batch-quick-check-print-file-title">
                <span className="quick-check-print-number">{String(fileIndex + 1).padStart(2, "0")}</span>
                <div>
                  <h2>{result.source.filename}</h2>
                  <p>{result.scope.label} · {result.rule_pack.id} · v{result.rule_pack.version}</p>
                </div>
              </div>
              <span className="batch-quick-check-print-file-status">{result.summary.pass} / {result.summary.fail} / {result.summary.review}</span>
            </header>
            <p className="batch-quick-check-print-file-meta">{l("sourceHash")}: {result.source.sha256} · {l("model")}: {result.model.schema} · {result.model.length_unit} · {result.model.total_entities}</p>
            <div className={result.scope.status === "NOT_APPLICABLE" ? "quick-check-print-scope scope-not-applicable" : "quick-check-print-scope scope-evaluated"}>
              <strong>{result.scope.label}</strong>
              <p>{result.scope.detail}</p>
            </div>
            {result.checks.length ? result.checks.map((check, checkIndex) => <QuickCheckPrintCheck key={check.finding_id} check={check} index={checkIndex} locale={locale} l={l} />) : <p className="quick-check-print-empty">{l("quickCheckNoAction")}</p>}
          </section>
        ))}
      </section>

      <footer className="quick-check-print-footer">
        <h2>{l("quickCheckLimitation")}</h2>
        <p>{limitation}</p>
      </footer>
    </section>
  );
}

function DecisionSummary({ finding, locale, l }: { finding: Finding; locale: Locale; l: (key: UiCopyKey) => string }) {
  const metric = decisionMetric(finding);
  return (
    <section className={`decision-summary decision-${finding.status.toLocaleLowerCase("en-US")}`} aria-label={l("decisionSummary")}>
      <div className="decision-summary-header">
        <strong>{l("decisionSummary")}</strong>
        <span>{statusLabel(finding.status, l)}</span>
      </div>
      <p className="decision-summary-message">{localizedFindingMessage(finding, locale)}</p>
      {metric && (
        <div className="decision-metric-grid">
          <div className="decision-metric">
            <span>{l("actualValue")}</span>
            <strong>{formatMetric(metric.actual, metric.unit, locale)}</strong>
          </div>
          <div className="decision-metric">
            <span>{l("requiredValue")}</span>
            <strong>{metric.operator} {formatMetric(metric.required, metric.unit, locale)}</strong>
          </div>
          <div className="decision-metric decision-metric-difference">
            <span>{l("difference")}</span>
            <strong>{formatMetric(metric.difference, metric.unit, locale, true)}</strong>
          </div>
        </div>
      )}
    </section>
  );
}

function ObservationRow({ observation, locale, l }: { observation: Observation; locale: Locale; l: (key: UiCopyKey) => string }) {
  return (
    <div className="observation-row">
      <div className="observation-title"><strong>{observationLabel(observation, locale)}</strong><span className="reliability-label">{reliabilityLabel(observation.reliability, locale)}</span></div>
      <dl className="observation-definition-grid">
        <div><dt>{l("rawValue")}</dt><dd>{displayValue(observation.raw_value)}</dd></div>
        <div><dt>{l("normalizedValue")}</dt><dd>{displayValue(observation.normalized_value)} {observation.unit ?? ""}</dd></div>
        <div className="wide"><dt>{l("sourcePath")}</dt><dd className="mono">{observation.source_path}</dd></div>
      </dl>
      {observation.note && <p className="observation-note">{observation.note}</p>}
    </div>
  );
}

function AgentTrace({ result, locale, l }: { result: StoredAgentReviewResult; locale: Locale; l: (key: UiCopyKey) => string }) {
  const run = result.agent_run;
  return (
    <details className="agent-trace report-trace panel motion-item">
      <summary><span className="trace-icon"><Icon name="activity" /></span><span><strong>{l("agentTrace")}</strong><small>{l("agentTraceBody")}</small></span><span className="trace-metrics">{run.step_count} {l("steps")} · {run.tool_call_count} {l("toolCalls")}</span><Icon name="chevron" /></summary>
      <div className="trace-body">
        <div className="trace-contract"><span>{run.provider_id}</span><span>{run.model_id}</span><span>{l("stopReason")}: {run.stop_reason}</span><span>{run.agent_id}@{run.agent_version}</span></div>
        <ol className="event-list">
          {run.events.map((event) => (
            <li key={event.event_id}><span className="event-sequence">{String(event.sequence).padStart(2, "0")}</span><span className="event-line" aria-hidden="true" /><div><div className="event-meta"><strong>{event.type}</strong><span>{event.actor}</span><time>{formatDate(event.occurred_at, locale)}</time></div><p>{event.summary}</p></div></li>
          ))}
        </ol>
      </div>
    </details>
  );
}

function RunsView({
  history,
  historyReady,
  locale,
  l,
  onOpenHistory,
  onDeleteHistory,
  onClearHistory,
}: {
  history: LocalHistoryEntry[];
  historyReady: boolean;
  locale: Locale;
  l: (key: UiCopyKey) => string;
  onOpenHistory: (entry: LocalHistoryEntry) => void;
  onDeleteHistory: (id: string) => void;
  onClearHistory: () => void;
}) {
  const completedHistory = history.filter((entry) => entry.result.review_run);

  return (
    <div className="page-scroll resource-view" aria-labelledby="runs-title">
      <div className="page-heading motion-item history-page-heading">
        <div>
          <h1 id="runs-title">{l("reviewRuns")}</h1>
          <p>{l("historyBody")}</p>
        </div>
        {completedHistory.length > 0 && <button className="button button-secondary button-compact" type="button" onClick={() => { if (window.confirm(l("historyClearConfirm"))) onClearHistory(); }}><Icon name="trash" /> {l("clearHistory")}</button>}
      </div>
      <p className="history-storage-note"><Icon name="info" /> {l("historyLocalOnly")} · {l("historyServerRetention")}</p>
      {!historyReady ? (
        <div className="empty-card panel motion-item"><span className="empty-icon info"><Icon name="clock" /></span><h2>{l("historyLoading")}</h2></div>
      ) : completedHistory.length ? (
        <div className="history-list">
          {completedHistory.map((entry) => {
            const review = entry.result.review_run;
            if (!review) return null;
            const status = review.summary.fail_count > 0 ? "fail" : review.summary.review_count > 0 ? "review" : "pass";
            return (
              <section className="history-card panel motion-item" key={entry.id}>
                <div className="history-card-header">
                  <div>
                    <span className="panel-overline">{l("historyLocalOnly")}</span>
                    <h2>{review.source.filename}</h2>
                  </div>
                  <span className={`status-label history-status-${status}`}>{status === "fail" ? l("fail") : status === "review" ? l("review") : l("pass")}</span>
                </div>
                <dl className="history-card-grid">
                  <div><dt>{l("completedAt")}</dt><dd>{formatDate(review.completed_at, locale)}</dd></div>
                  <div><dt>{l("schema")}</dt><dd>{review.inventory.schema_name}</dd></div>
                  <div><dt>{l("rulePack")}</dt><dd>{review.rule_pack_id} · v{review.rule_pack_version}</dd></div>
                  <div><dt>{l("totalFindings")}</dt><dd>{review.summary.total_findings}</dd></div>
                  <div><dt>{l("actionableChecks")}</dt><dd>{review.summary.fail_count + review.summary.review_count}</dd></div>
                </dl>
                <div className="history-card-footer">
                  <span className="action-hint">{l("showing")} {review.summary.fail_count} {l("fail")} · {review.summary.review_count} {l("review")}</span>
                  <div className="history-card-actions">
                    <button className="button button-primary button-compact" type="button" onClick={() => onOpenHistory(entry)}><Icon name="list" /> {l("openHistory")}</button>
                    <button className="button button-ghost button-compact" type="button" onClick={() => { if (window.confirm(l("historyDeleteConfirm"))) onDeleteHistory(entry.id); }}><Icon name="trash" /> {l("deleteHistory")}</button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="empty-card panel motion-item"><span className="empty-icon info"><Icon name="clock" /></span><h2>{l("historyEmpty")}</h2><p>{l("historyBody")}</p></div>
      )}
    </div>
  );
}

function RulesView({
  profiles,
  locale,
  selectedProfileId,
  l,
  onSelectProfile,
  onUseProfile,
  onSaveProfile,
  onSaveProfileDescription,
  onDeleteProfile,
}: {
  profiles: RuleProfile[];
  locale: Locale;
  selectedProfileId: string;
  l: (key: UiCopyKey) => string;
  onSelectProfile: (profileId: string) => void;
  onUseProfile: (profileId: string) => void;
  onSaveProfile: (profile: RuleProfile) => void;
  onSaveProfileDescription: (profileId: string, locale: Locale, description: string, limitation: string) => void;
  onDeleteProfile: (profileId: string) => void;
}) {
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [editor, setEditor] = useState<ProfileFormState | null>(null);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? DEFAULT_RULE_PROFILES[0];
  const selectedRule = selectedProfile.rules.find((rule) => rule.id === selectedRuleId) ?? selectedProfile.rules[0];

  function selectProfile(profileId: string) {
    onSelectProfile(profileId);
    setSelectedRuleId(null);
    setEditor(null);
  }

  function startDuplicate() {
    setEditor({
      id: null,
      mode: "duplicate",
      name: `${profileName(selectedProfile, locale)} copy`,
      jurisdiction: profileJurisdiction(selectedProfile, locale),
      source: profileSource(selectedProfile, locale),
      edition: selectedProfile.edition,
      description: profileDescription(selectedProfile, locale),
      limitation: profileLimitation(selectedProfile, locale),
      sourceUrl: selectedProfile.sourceUrl,
      rules: selectedProfile.rules,
    });
  }

  function startEdit() {
    if (selectedProfile.builtin) return;
    setEditor({
      id: selectedProfile.id,
      mode: "edit",
      name: selectedProfile.name,
      jurisdiction: selectedProfile.jurisdiction,
      source: selectedProfile.source,
      edition: selectedProfile.edition,
      description: selectedProfile.description,
      limitation: selectedProfile.limitation,
      sourceUrl: selectedProfile.sourceUrl,
      rules: selectedProfile.rules,
    });
  }

  function startEditDescription() {
    if (!selectedProfile.builtin) return;
    setEditor({
      id: selectedProfile.id,
      mode: "description",
      name: selectedProfile.name,
      jurisdiction: selectedProfile.jurisdiction,
      source: selectedProfile.source,
      edition: selectedProfile.edition,
      description: profileDescription(selectedProfile, locale),
      limitation: profileLimitation(selectedProfile, locale),
      sourceUrl: selectedProfile.sourceUrl,
      rules: selectedProfile.rules,
    });
  }

  function commitEditor() {
    if (!editor) return;
    if (editor.mode === "description") {
      onSaveProfileDescription(selectedProfile.id, locale, editor.description.trim(), editor.limitation.trim());
      setEditor(null);
      return;
    }
    const name = editor.name.trim();
    const jurisdiction = editor.jurisdiction.trim();
    const source = editor.source.trim();
    if (!name || !jurisdiction || !source) return;
    const existing = editor.id ? profiles.find((profile) => profile.id === editor.id) : undefined;
    const profile: RuleProfile = existing
      ? {
          ...existing,
          name,
          jurisdiction,
          source,
          edition: editor.edition.trim(),
          description: editor.description.trim(),
          limitation: editor.limitation.trim(),
          sourceUrl: editor.sourceUrl?.trim() || undefined,
          rules: editor.rules,
        }
      : {
          id: `${profileSlug(name)}-${Date.now()}`,
          version: "0.1.0-draft",
          name,
          jurisdiction,
          source,
          edition: editor.edition.trim() || "Draft",
          status: "DRAFT",
          engineSupported: false,
          builtin: false,
          description: editor.description.trim() || "Custom rule profile catalogue entry.",
          limitation: editor.limitation.trim() || "Catalog-only until deterministic rule mappings are implemented and tested.",
          sourceUrl: editor.sourceUrl?.trim() || undefined,
          rules: editor.rules,
        };
    onSaveProfile(profile);
    setEditor(null);
    setSelectedRuleId(profile.rules[0]?.id ?? null);
  }

  function confirmDelete() {
    if (selectedProfile.builtin) return;
    if (window.confirm(l("deleteProfileConfirm"))) {
      onDeleteProfile(selectedProfile.id);
      setEditor(null);
      setSelectedRuleId(null);
    }
  }

  return (
    <div className="page-scroll resource-view" aria-labelledby="rules-title">
      <div className="page-heading motion-item">
        <div>
          <h1 id="rules-title">{l("ruleProfilesTitle")}</h1>
          <p>{l("ruleProfilesBody")}</p>
        </div>
      </div>

      <div className="rules-layout">
        <section className="profile-catalog panel motion-item" aria-labelledby="profile-catalog-title">
          <div className="profile-catalog-header">
            <div>
              <span className="panel-overline">{l("ruleCatalogLabel")}</span>
              <h2 id="profile-catalog-title">{l("profileCatalog")}</h2>
            </div>
          </div>
          <div className="profile-catalog-list">
            {profiles.map((profile) => (
              <button
                className={`profile-catalog-row${profile.id === selectedProfile.id ? " is-selected" : ""}`}
                type="button"
                key={profile.id}
                onClick={() => selectProfile(profile.id)}
              >
                <span className={`profile-catalog-icon${profile.engineSupported ? " is-ready" : " is-draft"}`}><Icon name={profile.engineSupported ? "check" : "book"} /></span>
                <span className="profile-catalog-copy">
                  <strong>{profileName(profile, locale)}</strong>
                  <small>{profileJurisdiction(profile, locale)} · {profile.engineSupported ? l("engineReady") : l("enginePending")}</small>
                </span>
                <span className={`status-label ${profile.engineSupported ? "status-active" : "status-review"}`}>{profileStatusLabel(profile, l)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="profile-detail panel motion-item" aria-labelledby="profile-detail-title">
          <div className="profile-detail-header">
            <div>
              <span className="panel-overline">{selectedProfile.id} · v{selectedProfile.version}</span>
              <h2 id="profile-detail-title">{profileName(selectedProfile, locale)}</h2>
              <p>{profileDescription(selectedProfile, locale)}</p>
            </div>
            <div className="profile-detail-badges">
              <span className={`status-label ${selectedProfile.engineSupported ? "status-active" : "status-review"}`}>{selectedProfile.engineSupported ? l("engineReady") : l("enginePending")}</span>
              <span className="status-label status-neutral">{selectedProfile.builtin ? l("systemProfile") : l("customProfile")}</span>
            </div>
          </div>

          <div className="profile-detail-actions">
            {selectedProfile.engineSupported && (
              <button className="button button-primary button-compact profile-use-button" type="button" onClick={() => onUseProfile(selectedProfile.id)}>
                <Icon name="play" /> {l("useProfile")}
              </button>
            )}
            <button
              className="button button-secondary button-compact profile-duplicate-button"
              type="button"
              onClick={selectedProfile.builtin ? startEditDescription : startDuplicate}
            >
              <Icon name={selectedProfile.builtin ? "edit" : "copy"} /> {l(selectedProfile.builtin ? "editProfileDescription" : "duplicateProfile")}
            </button>
            {!selectedProfile.builtin && (
              <>
                <button className="button button-secondary button-compact profile-edit-button" type="button" onClick={startEdit}>
                  <Icon name="edit" /> {l("editProfile")}
                </button>
                <button className="button button-danger button-compact profile-delete-button" type="button" onClick={confirmDelete}>
                  <Icon name="trash" /> {l("deleteProfile")}
                </button>
              </>
            )}
          </div>

          <dl className="profile-meta-grid">
            <div><dt>{l("profileJurisdiction")}</dt><dd>{profileJurisdiction(selectedProfile, locale)}</dd></div>
            <div><dt>{l("profileSource")}</dt><dd>{profileSource(selectedProfile, locale)}</dd></div>
            <div><dt>{l("profileEdition")}</dt><dd>{selectedProfile.edition}</dd></div>
            <div><dt>{l("profileStatus")}</dt><dd>{profileStatusLabel(selectedProfile, l)}</dd></div>
          </dl>

          <div className="profile-boundary-grid">
            <div><span className="profile-boundary-label">{l("profileDetails")}</span><p>{profileDescription(selectedProfile, locale)}</p></div>
            <div><span className="profile-boundary-label">{l("limitation")}</span><p>{profileLimitation(selectedProfile, locale)}</p></div>
          </div>
          {selectedProfile.sourceUrl && (
            <a className="source-link" href={selectedProfile.sourceUrl} target="_blank" rel="noreferrer">
              <Icon name="external" /> {l("officialSource")}
            </a>
          )}
          {selectedProfile.builtin && <p className="profile-readonly-note"><Icon name="lock" /> {l("profileReadonly")}</p>}

          <div className="rule-detail-section">
            <div className="section-label-row"><span>{l("ruleDetail")}</span><small>{selectedProfile.rules.length} {l("mappedRules")}</small></div>
            <div className="rule-detail-layout">
              <div className="rule-detail-list">
                {selectedProfile.rules.length > 0 ? selectedProfile.rules.map((rule) => (
                  <button
                    className={`rule-detail-row${selectedRule?.id === rule.id ? " is-selected" : ""}`}
                    type="button"
                    key={rule.id}
                    onClick={() => setSelectedRuleId(rule.id)}
                  >
                    <span className="rule-detail-row-copy"><strong>{displayRuleId(rule.id, selectedProfile.id)}</strong><span>{ruleTitle(rule, locale)}</span></span>
                    <span className={`status-label ${rule.enabled && selectedProfile.engineSupported ? "status-active" : "status-review"}`}>{rule.enabled && selectedProfile.engineSupported ? l("active") : profileStatusLabel(selectedProfile, l)}</span>
                  </button>
                )) : <div className="empty-rule-row">{l("noRules")}</div>}
              </div>
              <aside className="rule-detail-inspector" aria-live="polite">
                {selectedRule ? (
                  <>
                    <span className="panel-overline">{displayRuleId(selectedRule.id, selectedProfile.id)}</span>
                    <h3>{ruleTitle(selectedRule, locale)}</h3>
                    <p>{ruleDetail(selectedRule, locale)}</p>
                    <dl>
                      <div><dt>{l("category")}</dt><dd>{ruleCategory(selectedRule, locale)}</dd></div>
                      <div><dt>{l("authority")}</dt><dd>{ruleAuthority(selectedRule, locale)}</dd></div>
                    </dl>
                  </>
                ) : <p>{l("selectRule")}</p>}
              </aside>
            </div>
          </div>
        </section>
      </div>

      {editor && (
        <section className="profile-editor panel motion-item" aria-labelledby="profile-editor-title">
          <div className="profile-editor-header">
            <div>
              <span className="panel-overline">{l("localProfileLabel")}</span>
              <h2 id="profile-editor-title">
                {editor.mode === "description" ? l("editProfileDescription") : editor.id ? l("editProfile") : l("createProfile")}
              </h2>
            </div>
            <button className="icon-button" type="button" aria-label={l("cancel")} onClick={() => setEditor(null)}><Icon name="x" /></button>
          </div>
          <form className="profile-form" onSubmit={(event) => { event.preventDefault(); commitEditor(); }}>
            {editor.mode === "description" ? (
              <>
                <p className="profile-editor-note"><Icon name="info" /> {l("profileDescriptionEditorNote")}</p>
                <div className="profile-form-grid profile-description-editor-grid">
                  <label className="profile-form-wide"><span>{l("profileDescriptionField")}</span><textarea rows={4} placeholder={l("profileDescriptionPlaceholder")} value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label>
                  <label className="profile-form-wide"><span>{l("limitation")}</span><textarea rows={4} placeholder={l("profileDescriptionPlaceholder")} value={editor.limitation} onChange={(event) => setEditor({ ...editor, limitation: event.target.value })} /></label>
                </div>
              </>
            ) : (
              <div className="profile-form-grid">
                <label><span>{l("profileNameField")}</span><input required value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
                <label><span>{l("profileJurisdictionField")}</span><input required value={editor.jurisdiction} onChange={(event) => setEditor({ ...editor, jurisdiction: event.target.value })} /></label>
                <label><span>{l("profileSourceField")}</span><input required value={editor.source} onChange={(event) => setEditor({ ...editor, source: event.target.value })} /></label>
                <label><span>{l("profileSourceUrlField")}</span><input type="url" value={editor.sourceUrl ?? ""} onChange={(event) => setEditor({ ...editor, sourceUrl: event.target.value })} /></label>
                <label><span>{l("profileEditionField")}</span><input value={editor.edition} onChange={(event) => setEditor({ ...editor, edition: event.target.value })} /></label>
                <label className="profile-form-wide"><span>{l("profileDescriptionField")}</span><textarea rows={3} placeholder={l("profileDescriptionPlaceholder")} value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label>
                <label className="profile-form-wide"><span>{l("limitation")}</span><textarea rows={3} placeholder={l("profileDescriptionPlaceholder")} value={editor.limitation} onChange={(event) => setEditor({ ...editor, limitation: event.target.value })} /></label>
              </div>
            )}
            <div className="profile-form-actions">
              <span>{l("profileCatalogNote")}</span>
              <div><button className="button button-secondary button-compact profile-cancel-button" type="button" onClick={() => setEditor(null)}>{l("cancel")}</button><button className="button button-primary button-compact profile-save-button" type="submit"><Icon name="check" /> {l("saveProfile")}</button></div>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

function SamplesView({ locale, l, busy, onRunSample, onRunSamples }: { locale: Locale; l: (key: UiCopyKey) => string; busy: boolean; onRunSample: (sampleId: Sample["id"]) => void; onRunSamples: (sampleIds: Sample["id"][]) => void }) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Sample["id"][]>([]);
  const filtered = SAMPLES.filter((sample) => `${sampleTitle(sample, locale)} ${sampleDetail(sample, locale)} ${sampleExpected(sample, locale)}`.toLowerCase().includes(query.toLowerCase()));
  const filteredIds = filtered.map((sample) => sample.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((sampleId) => selectedIds.includes(sampleId));

  function toggleSample(sampleId: Sample["id"]) {
    setSelectedIds((current) => current.includes(sampleId) ? current.filter((id) => id !== sampleId) : [...current, sampleId]);
  }

  function toggleAllFiltered() {
    setSelectedIds((current) => allFilteredSelected
      ? current.filter((id) => !filteredIds.includes(id))
      : [...current, ...filteredIds.filter((id) => !current.includes(id))]);
  }

  return (
    <div className="page-scroll resource-view" aria-labelledby="samples-title">
      <div className="page-heading motion-item"><div><h1 id="samples-title">{l("samplesTitle")}</h1><p>{l("samplesBody")}</p></div><label className="search-field"><Icon name="search" /><span className="sr-only">{l("searchSamples")}</span><input value={query} placeholder={l("searchSamples")} onChange={(event) => setQuery(event.target.value)} /></label></div>
      <section className="sample-catalog panel motion-item">
        <div className="sample-catalog-header">
          <div><span className="panel-overline">{l("bundledFixturesLabel")}</span><span className="sample-selection-count">{selectedIds.length} {l("selectedSamples")}</span></div>
          <div className="sample-catalog-actions"><button className="text-button" type="button" onClick={toggleAllFiltered}>{allFilteredSelected ? l("clearAllSamples") : l("selectAllSamples")}</button><button className="button button-primary button-compact" type="button" disabled={busy || selectedIds.length === 0} onClick={() => onRunSamples(selectedIds)}><Icon name="play" /> {l("runSelectedSamples")}</button></div>
        </div>
        <div className="sample-catalog-count">{filtered.length}/{SAMPLES.length}</div>
        {filtered.map((sample, index) => <article className="sample-catalog-row" key={sample.id}><label className="sample-select"><input type="checkbox" checked={selectedIds.includes(sample.id)} onChange={() => toggleSample(sample.id)} aria-label={`${sampleTitle(sample, locale)} ${l("selected")}`} /><span className="sample-number">{String(index + 1).padStart(2, "0")}</span></label><span className="sample-catalog-copy"><strong>{sampleTitle(sample, locale)}</strong><small><span>{l("samplePurpose")}{locale === "en" ? ": " : "："}</span>{sampleDetail(sample, locale)}</small></span><span className="sample-expected"><small>{l("sampleExpected")}</small><strong>{sampleExpected(sample, locale)}</strong></span><button className="button button-secondary button-compact sample-run-button" type="button" disabled={busy} onClick={() => onRunSample(sample.id)}><Icon name="play" /> {l("runSample")}</button></article>)}{filtered.length === 0 && <p className="empty-list">{l("noSampleMatches")} {query && <span className="mono">“{query}”</span>}</p>}
      </section>
    </div>
  );
}
