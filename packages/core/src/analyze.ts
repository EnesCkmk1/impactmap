import fs from "node:fs";
import path from "node:path";
import type { FailOn, ImpactMapConfig } from "@impactmap/config";
import { type DependencyGraph, edgeAllowed } from "@impactmap/graph";
import picomatch from "picomatch";
import { buildDependencyGraph } from "./build-graph.js";
import { AnalysisCache } from "./cache.js";
import { loadImpactConfig } from "./config-file.js";
import { discoverRepository } from "./discover.js";
import { ImpactMapError } from "./errors.js";
import {
  diffChanges,
  type FileChange,
  findRepositoryRoot,
  headCommit,
  listFilesAtRevision,
  mergeBase,
  readBlob,
  readBlobs,
  resolveCommit,
  worktreeDirty,
} from "./git.js";
import { computeImpact, type ExportDiff } from "./impact.js";
import { isInside, realpathInside } from "./paths.js";
import {
  emptyDirectionMeaning,
  evidenceFromEdge,
  type Finding,
  type ImpactReport,
  type ReportGraph,
  type ReportGraphNode,
} from "./report.js";
import { evaluateRules } from "./rules.js";
import { selectTests } from "./test-selection.js";

export const TOOL_VERSION = "0.1.0";

export interface AnalyzeOptions {
  cwd?: string;
  configPath?: string;
  /** When set, compare this revision (through the merge base) to the head snapshot. */
  base?: string;
  /** Commit to analyze. Omit to analyze the working tree, including uncommitted files. */
  head?: string;
  cache?: boolean;
  depth?: number;
  graph?: ImpactMapConfig["output"]["graph"];
  failOn?: FailOn;
}

export interface AnalysisResult {
  report: ImpactReport;
  config: ImpactMapConfig;
  failOn: FailOn;
  graph: DependencyGraph;
}

export async function runAnalysis(
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const repoRoot = await resolveRoot(cwd);
  if (
    !isInside(repoRoot, cwd) &&
    path.resolve(cwd) !== path.resolve(repoRoot)
  ) {
    throw new ImpactMapError(
      "Refusing to analyze outside the repository root.",
      2,
      "escaped-root",
    );
  }
  const loaded = await loadImpactConfig(repoRoot, options.configPath);
  const config = loaded.config;
  if (options.depth !== undefined) config.impact.depth = options.depth;
  if (options.graph) config.output.graph = options.graph;
  const failOn = options.failOn ?? config.ci.failOn;

  const comparison = options.base
    ? await loadComparison(repoRoot, options.base, options.head)
    : undefined;
  const snapshot = await loadSnapshot(repoRoot, comparison);
  const discovery = discoverRepository(
    repoRoot,
    config,
    snapshot.fileList
      ? { fileList: snapshot.fileList, read: snapshot.read }
      : { read: snapshot.read },
  );

  if (discovery.files.length > config.limits.maxFiles) {
    throw new ImpactMapError(
      `Refusing to scan ${discovery.files.length} files because it exceeds limits.maxFiles (${config.limits.maxFiles}). Narrow include or raise the limit.`,
      3,
      "too-many-files",
    );
  }

  const deadline = Date.now() + config.limits.timeoutMs;
  const sources: Array<{ path: string; source: string; language: string }> = [];
  let totalBytes = 0;
  let partial = false;
  const limitations = [...discovery.limitations];
  for (const file of discovery.files) {
    if (Date.now() > deadline) {
      partial = true;
      limitations.push(
        "Analysis stopped because the configured timeout was reached. Results are partial.",
      );
      break;
    }
    const source = snapshot.read(file.path);
    if (source === null) {
      discovery.diagnostics.push({
        severity: "warning",
        code: "unreadable-file",
        message: `Could not read ${file.path}.`,
        file: file.path,
      });
      continue;
    }
    totalBytes += source.length;
    if (totalBytes > config.limits.maxTotalBytes) {
      partial = true;
      limitations.push(
        "Analysis stopped because limits.maxTotalBytes was exceeded. Results are partial.",
      );
      break;
    }
    sources.push({ path: file.path, source, language: file.language });
  }

  const metadata = readMetadata(
    repoRoot,
    discovery.metadataFiles,
    snapshot.read,
  );
  const deleted = deletedPaths(comparison?.changes ?? []);
  const cache =
    config.cache.enabled &&
    options.cache !== false &&
    snapshot.mode === "worktree"
      ? safeCache(repoRoot, config.cache.directory, limitations)
      : null;
  const testMatch = (file: string) =>
    config.test.patterns.some((pattern) =>
      picomatch(pattern, { dot: true })(file),
    );
  const built = buildDependencyGraph({
    root: repoRoot,
    files: sources,
    config,
    packages: discovery.packages,
    metadataFiles: metadata,
    deleted,
    testPatterns: testMatch,
    cache,
    deadlineMs: deadline,
    readMetadata: (file) =>
      metadata.find((item) => item.path === file)?.source ??
      snapshot.read(file),
  });
  partial = partial || built.partial;

  const changes = filterChanges(comparison?.changes ?? [], config);
  const baseTexts = new Map<string, string | null>();
  if (comparison) {
    for (const change of changes) {
      if (change.status === "added") continue;
      const basePath = change.previousPath ?? change.path;
      baseTexts.set(
        basePath,
        await readBlob(repoRoot, comparison.mergeBase, basePath),
      );
    }
  }
  const impact = comparison
    ? computeImpact({
        graph: built.graph,
        changes,
        config,
        readBase: (file) =>
          baseTexts.has(file) ? (baseTexts.get(file) ?? null) : null,
        readHead: (file) => snapshot.read(file),
      })
    : { findings: [], diffs: new Map<string, ExportDiff>(), limitations: [] };

  const cycles = built.graph.cycles({
    includeTypeOnly: config.impact.includeTypeOnly,
    includeDynamic: config.impact.includeDynamic,
    includeExternal: false,
    includeUnresolved: false,
    maxDepth: Number.POSITIVE_INFINITY,
  });
  const ruleFindings = evaluateRules({
    graph: built.graph,
    config,
    changes,
    diffs: impact.diffs,
    cycles,
  });
  const testSelection = selectTests({
    graph: built.graph,
    config,
    changes,
    findings: impact.findings,
  });

  let findings = [...impact.findings, ...ruleFindings].sort(compareFindings);
  if (findings.length > config.output.maxFindings) {
    limitations.push(
      `Findings truncated to output.maxFindings (${config.output.maxFindings}).`,
    );
    findings = findings.slice(0, config.output.maxFindings);
  }

  const reportCycles = cycles.map((cycle) => ({
    members: cycle.members,
    path: cycle.path,
    typeOnly: cycle.typeOnly,
    edges: cycle.edges.map(evidenceFromEdge),
  }));

  const unsupported = discovery.skipped.filter(
    (item) => item.reason === "unsupported",
  ).length;
  const report: ImpactReport = {
    version: "1",
    tool: { name: "impactmap", version: TOOL_VERSION },
    deterministic: true,
    repositoryRoot: repoRoot,
    ...(comparison
      ? {
          comparison: {
            baseRef: comparison.baseRef,
            baseSha: comparison.baseSha,
            headRef: comparison.headRef,
            headSha: comparison.headSha,
            mergeBase: comparison.mergeBase,
          },
        }
      : {}),
    summary: {
      filesScanned: sources.length,
      filesSkipped: discovery.skipped.length,
      filesUnsupported: unsupported,
      parseErrors: built.parseErrors,
      unresolvedImports: built.unresolved,
      dynamicNonLiteral: built.dynamicNonLiteral,
      nodes: built.graph.allNodes().length,
      edges: built.graph.allEdges().length,
      packages: discovery.packages.filter((pkg) => pkg.name).length,
      changedFiles: changes.length,
      directImpacts: findings.filter((finding) => finding.category === "direct")
        .length,
      transitiveImpacts: findings.filter(
        (finding) => finding.category === "transitive",
      ).length,
      interfaceImpacts: findings.filter(
        (finding) => finding.category === "interface",
      ).length,
      architecturalImpacts: findings.filter(
        (finding) => finding.category === "architectural",
      ).length,
      testsStructural: testSelection.tests.filter(
        (test) => test.confidence === "structural",
      ).length,
      testsHeuristic: testSelection.tests.filter(
        (test) => test.confidence === "heuristic",
      ).length,
      testsConfigured: testSelection.tests.filter(
        (test) => test.confidence === "configured",
      ).length,
      cycles: reportCycles.length,
      partial,
    },
    limitations: unique([
      ...limitations,
      ...built.limitations,
      ...impact.limitations,
      ...testSelection.limitations,
    ]),
    diagnostics: [...discovery.diagnostics, ...built.diagnostics].sort((a, b) =>
      `${a.file ?? ""}\0${a.code}`.localeCompare(`${b.file ?? ""}\0${b.code}`),
    ),
    changes,
    findings,
    cycles: reportCycles,
    tests: testSelection.tests,
    cache: built.cache,
    ...(config.output.graph === "none"
      ? {}
      : {
          graph: reportGraph(
            built.graph,
            changes,
            findings,
            testSelection.tests.map((test) => test.file),
            reportCycles,
            config.output.graph,
          ),
        }),
  };

  return { report, config, failOn, graph: built.graph };
}

export function exitCodeFor(report: ImpactReport, failOn: FailOn): number {
  if (report.summary.partial) return 3;
  if (failOn === "never") return 0;
  const failed = report.findings.some(
    (finding) =>
      finding.severity === "error" ||
      (failOn === "warning" && finding.severity === "warning"),
  );
  return failed ? 1 : 0;
}

interface Comparison {
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  mergeBase: string;
  changes: FileChange[];
  headMode: "worktree" | "revision";
}

async function loadComparison(
  root: string,
  baseRef: string,
  headRef?: string,
): Promise<Comparison> {
  const baseSha = await resolveCommit(root, baseRef);
  const currentHead = await headCommit(root);
  if (!headRef) {
    const basePoint = await mergeBase(root, baseSha, currentHead);
    return {
      baseRef,
      baseSha,
      headRef: "WORKTREE",
      headSha: currentHead,
      mergeBase: basePoint,
      changes: await diffChanges(root, basePoint, { kind: "worktree" }),
      headMode: "worktree",
    };
  }
  const headSha = await resolveCommit(root, headRef);
  const basePoint = await mergeBase(root, baseSha, headSha);
  const dirty = await worktreeDirty(root);
  const useWorktree = headSha === currentHead && !dirty;
  return {
    baseRef,
    baseSha,
    headRef,
    headSha,
    mergeBase: basePoint,
    changes: useWorktree
      ? await diffChanges(root, basePoint, { kind: "worktree" })
      : await diffChanges(root, basePoint, { kind: "commit", sha: headSha }),
    headMode: useWorktree ? "worktree" : "revision",
  };
}

interface Snapshot {
  mode: "worktree" | "revision";
  fileList?: string[];
  read: (file: string) => string | null;
}

async function loadSnapshot(
  root: string,
  comparison: Comparison | undefined,
): Promise<Snapshot> {
  if (!comparison || comparison.headMode === "worktree") {
    return { mode: "worktree", read: (file) => readWorktree(root, file) };
  }
  const files = await listFilesAtRevision(root, comparison.headSha);
  if (files.length > 20_000) {
    throw new ImpactMapError(
      "The selected revision has too many files to snapshot.",
      3,
      "too-many-files",
    );
  }
  const blobs = await readBlobs(root, comparison.headSha, files);
  return {
    mode: "revision",
    fileList: files,
    read: (file) => blobs.get(file) ?? null,
  };
}

function readWorktree(root: string, file: string): string | null {
  if (file.includes("\0") || file.split("/").includes("..")) return null;
  const absolute = path.resolve(root, file);
  if (!isInside(root, absolute)) return null;
  const real = realpathInside(root, absolute);
  if (!real || !fs.existsSync(real) || !fs.statSync(real).isFile()) return null;
  return fs.readFileSync(real, "utf8");
}

function readMetadata(
  root: string,
  files: string[],
  read: (file: string) => string | null,
): Array<{ path: string; source: string }> {
  const output: Array<{ path: string; source: string }> = [];
  for (const file of files) {
    const source = read(file) ?? readWorktree(root, file);
    if (source !== null) output.push({ path: file, source });
  }
  return output;
}

function deletedPaths(changes: FileChange[]): Set<string> {
  const deleted = new Set<string>();
  for (const change of changes) {
    if (change.status === "deleted") deleted.add(change.path);
    if (change.status === "renamed" && change.previousPath)
      deleted.add(change.previousPath);
  }
  return deleted;
}

function filterChanges(
  changes: FileChange[],
  config: ImpactMapConfig,
): FileChange[] {
  const include = config.include.map((pattern) =>
    picomatch(pattern, { dot: true }),
  );
  const exclude = config.exclude.map((pattern) =>
    picomatch(pattern, { dot: true }),
  );
  return changes.filter((change) => {
    const file = change.path;
    if (
      file
        .split("/")
        .some(
          (part) =>
            part === "node_modules" || part === ".git" || part === ".impactmap",
        )
    )
      return false;
    if (exclude.some((match) => match(file))) return false;
    return include.some((match) => match(file));
  });
}

function safeCache(
  root: string,
  directory: string,
  limitations: string[],
): AnalysisCache | null {
  try {
    return new AnalysisCache(root, directory);
  } catch (error) {
    limitations.push(
      error instanceof Error
        ? error.message
        : "Cache disabled because its directory is invalid.",
    );
    return null;
  }
}

function reportGraph(
  graph: DependencyGraph,
  changes: FileChange[],
  findings: Finding[],
  tests: string[],
  cycles: Array<{ members: string[] }>,
  mode: "neighborhood" | "full" | "none",
): ReportGraph {
  const changed = new Set(changes.map((change) => change.path));
  const roles = new Map<string, ReportGraphNode["role"]>();
  const hops = new Map<string, number>();
  const consider = (
    id: string,
    role: ReportGraphNode["role"],
    hop?: number,
  ) => {
    const rank: Record<ReportGraphNode["role"], number> = {
      changed: 0,
      direct: 1,
      transitive: 2,
      test: 3,
      cycle: 4,
      external: 5,
      context: 6,
    };
    const current = roles.get(id);
    if (!current || rank[role] < rank[current]) roles.set(id, role);
    if (hop !== undefined) {
      const existing = hops.get(id);
      if (existing === undefined || hop < existing) hops.set(id, hop);
    }
  };
  for (const id of changed) if (graph.hasNode(id)) consider(id, "changed", 0);
  for (const finding of findings) {
    if (
      (finding.category === "direct" || finding.category === "transitive") &&
      finding.affectedFile
    ) {
      consider(finding.affectedFile, finding.category, finding.hops);
    }
    for (const id of finding.impactPath) {
      if (!roles.has(id)) consider(id, "context");
    }
  }
  for (const test of tests) consider(test, "test");
  for (const cycle of cycles)
    for (const member of cycle.members) consider(member, "cycle");

  const ids =
    mode === "full"
      ? graph.allNodes().map((node) => node.id)
      : [...roles.keys()];
  if (mode === "full") {
    for (const node of graph.allNodes()) {
      if (!roles.has(node.id))
        consider(node.id, node.external ? "external" : "context");
    }
  }
  const idSet = new Set(ids);
  const nodes: ReportGraphNode[] = graph
    .allNodes()
    .filter((node) => idSet.has(node.id) || mode === "full")
    .map((node) => ({
      id: node.id,
      path: node.path,
      language: node.language,
      ...(node.packageName ? { packageName: node.packageName } : {}),
      external: node.external,
      test: node.test,
      parseStatus: node.parseStatus,
      role: roles.get(node.id) ?? (node.external ? "external" : "context"),
      ...(hops.has(node.id) ? { hop: hops.get(node.id) } : {}),
    }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.allEdges().filter(
    (edge) =>
      nodeIds.has(edge.from) &&
      nodeIds.has(edge.to) &&
      (mode === "full" ||
        edgeAllowed(edge, graph, {
          maxDepth: 100,
          includeTypeOnly: true,
          includeDynamic: true,
          includeExternal: true,
          includeUnresolved: true,
        })),
  );
  return {
    direction: "dependency",
    directionMeaning: emptyDirectionMeaning(),
    nodes,
    edges,
  };
}

function compareFindings(a: Finding, b: Finding): number {
  const category = { architectural: 0, interface: 1, direct: 2, transitive: 3 };
  const severity = { error: 0, warning: 1, info: 2 };
  return (
    category[a.category] - category[b.category] ||
    severity[a.severity] - severity[b.severity] ||
    (a.affectedFile ?? "").localeCompare(b.affectedFile ?? "") ||
    (a.changedFile ?? "").localeCompare(b.changedFile ?? "") ||
    a.id.localeCompare(b.id)
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function resolveRoot(cwd: string): Promise<string> {
  try {
    return await findRepositoryRoot(cwd);
  } catch (error) {
    if (error instanceof ImpactMapError && error.code === "not-a-repository") {
      throw new ImpactMapError(
        `${error.message} ImpactMap analyzes a Git repository so revisions and ignores are well defined.`,
        2,
        error.code,
      );
    }
    throw error;
  }
}
