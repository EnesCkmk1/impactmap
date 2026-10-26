export interface Evidence {
  file: string;
  line: number;
  column: number;
  text: string;
  from?: string;
  to?: string;
  dynamic?: boolean;
  typeOnly?: boolean;
  resolved?: boolean;
}

export interface Finding {
  id: string;
  category: "direct" | "transitive" | "interface" | "architectural";
  severity: "info" | "warning" | "error";
  confidence: string;
  title: string;
  explanation: string;
  changedFile?: string;
  affectedFile?: string;
  rule?: string;
  impactPath: string[];
  evidence: Evidence[];
  hops?: number;
  symbols?: string[];
}

export interface TestRecommendation {
  file: string;
  relationship: string;
  confidence: string;
  explanation: string;
  relatedFiles: string[];
}

export interface ReportNode {
  id: string;
  path: string;
  language: string;
  packageName?: string;
  external: boolean;
  test: boolean;
  parseStatus: string;
  role: string;
  hop?: number;
}

export interface ReportEdge {
  from: string;
  to: string;
  kind: string;
  typeOnly: boolean;
  dynamic: boolean;
  resolved: boolean;
  evidence: { file: string; line: number; text: string };
}

export interface ImpactReport {
  version: string;
  tool?: { name?: string; version?: string };
  repositoryRoot?: string;
  comparison?: {
    baseRef: string;
    headRef: string;
    mergeBase: string;
    headSha: string;
  };
  summary: {
    filesScanned: number;
    filesSkipped: number;
    unresolvedImports: number;
    changedFiles: number;
    directImpacts: number;
    transitiveImpacts: number;
    interfaceImpacts: number;
    architecturalImpacts: number;
    cycles: number;
    testsStructural: number;
    testsHeuristic: number;
    testsConfigured: number;
    partial: boolean;
  };
  limitations: string[];
  changes: Array<{ status: string; path: string; previousPath?: string }>;
  findings: Finding[];
  cycles: Array<{ members: string[]; path: string[]; typeOnly: boolean }>;
  tests: TestRecommendation[];
  graph?: {
    direction: string;
    directionMeaning: string;
    nodes: ReportNode[];
    edges: ReportEdge[];
  };
}

export function isImpactReport(value: unknown): value is ImpactReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<ImpactReport>;
  return (
    report.version === "1" &&
    report.tool?.name === "impactmap" &&
    Array.isArray(report.findings)
  );
}
