export {
  type AnalysisResult,
  type AnalyzeOptions,
  exitCodeFor,
  runAnalysis,
  TOOL_VERSION,
} from "./analyze.js";
export { buildDependencyGraph } from "./build-graph.js";
export {
  AnalysisCache,
  type CacheStats,
  disabledCacheStats,
  hashContent,
  hashList,
} from "./cache.js";
export { loadImpactConfig } from "./config-file.js";
export {
  type DiscoveryResult,
  discoverRepository,
  type PackageInfo,
  packageNameFor,
  parsePackage,
} from "./discover.js";
export { ImpactMapError, isImpactMapError } from "./errors.js";
export {
  type AiPayload,
  buildAiPayload,
  deterministicExplanation,
  type Explanation,
  requestModelCommentary,
  transmittedFields,
} from "./explain.js";
export {
  diffChanges,
  type FileChange,
  findRepositoryRoot,
  mergeBase,
  parseCatFileBatch,
  parseNameStatusZ,
  readBlob,
  resolveCommit,
  runGit,
} from "./git.js";
export { computeImpact, type ExportDiff, findingId } from "./impact.js";
export {
  isInside,
  readTextInside,
  realpathInside,
  sha256,
  toPosix,
} from "./paths.js";
export {
  type Confidence,
  type Evidence,
  evidenceFromEdge,
  type Finding,
  type FindingCategory,
  type ImpactReport,
  type ReportGraph,
  type TestRecommendation,
} from "./report.js";
export {
  candidatesFor,
  externalPackageName,
  type Resolution,
  resolveSpecifier,
} from "./resolve.js";
export { evaluateRules } from "./rules.js";
export { selectTests } from "./test-selection.js";
