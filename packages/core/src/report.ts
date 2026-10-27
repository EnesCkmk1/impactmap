import {
  type DependencyEdge,
  GRAPH_DIRECTION_MEANING,
  type GraphDiagnostic,
} from "@impactmap/graph";
import type { CacheStats } from "./cache.js";
import type { FileChange } from "./git.js";

export type FindingCategory =
  | "direct"
  | "transitive"
  | "interface"
  | "architectural";
export type FindingSeverity = "info" | "warning" | "error";
export type Confidence = "structural" | "heuristic" | "configured";

export interface Evidence {
  file: string;
  line: number;
  column: number;
  text: string;
  from?: string;
  to?: string;
  kind?: string;
  typeOnly?: boolean;
  dynamic?: boolean;
  resolved?: boolean;
  conditional?: boolean;
}

export interface Finding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  confidence: Confidence;
  title: string;
  explanation: string;
  changedFile?: string;
  affectedFile?: string;
  rule?: string;
  /** Changed module first. Each following module imports the previous one. */
  impactPath: string[];
  evidence: Evidence[];
  hops?: number;
  symbols?: string[];
}

export type TestRelationship =
  | "structural-direct"
  | "structural-transitive"
  | "explicit-mapping"
  | "heuristic-name";

export interface TestRecommendation {
  file: string;
  relationship: TestRelationship;
  confidence: Confidence;
  explanation: string;
  relatedFiles: string[];
  evidence: Evidence[];
}

export interface ReportCycle {
  members: string[];
  path: string[];
  typeOnly: boolean;
  edges: Evidence[];
}

export interface ReportGraphNode {
  id: string;
  path: string;
  language: string;
  packageName?: string;
  external: boolean;
  test: boolean;
  parseStatus: string;
  role:
    | "changed"
    | "direct"
    | "transitive"
    | "test"
    | "cycle"
    | "context"
    | "external";
  hop?: number;
}

export interface ReportGraph {
  direction: "dependency";
  directionMeaning: string;
  nodes: ReportGraphNode[];
  edges: DependencyEdge[];
}

export interface ImpactReport {
  version: "1";
  tool: { name: "impactmap"; version: string };
  deterministic: true;
  repositoryRoot: string;
  comparison?: {
    baseRef: string;
    baseSha: string;
    headRef: string;
    headSha: string;
    mergeBase: string;
  };
  summary: {
    filesScanned: number;
    filesSkipped: number;
    filesUnsupported: number;
    parseErrors: number;
    unresolvedImports: number;
    dynamicNonLiteral: number;
    nodes: number;
    edges: number;
    packages: number;
    changedFiles: number;
    directImpacts: number;
    transitiveImpacts: number;
    interfaceImpacts: number;
    architecturalImpacts: number;
    testsStructural: number;
    testsHeuristic: number;
    testsConfigured: number;
    cycles: number;
    partial: boolean;
  };
  limitations: string[];
  diagnostics: GraphDiagnostic[];
  changes: FileChange[];
  findings: Finding[];
  cycles: ReportCycle[];
  tests: TestRecommendation[];
  graph?: ReportGraph;
  cache: CacheStats;
}

export function evidenceFromEdge(edge: DependencyEdge): Evidence {
  return {
    file: edge.evidence.file,
    line: edge.evidence.line,
    column: edge.evidence.column,
    text: edge.evidence.text,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    typeOnly: edge.typeOnly,
    dynamic: edge.dynamic,
    resolved: edge.resolved,
    conditional: edge.conditional,
  };
}

export function emptyDirectionMeaning(): string {
  return GRAPH_DIRECTION_MEANING;
}
