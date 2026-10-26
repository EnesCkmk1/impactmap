import path from "node:path";
import type { ImpactMapConfig } from "@impactmap/config";
import {
  type DependencyEdge,
  DependencyGraph,
  type GraphDiagnostic,
  type GraphNode,
} from "@impactmap/graph";
import {
  type LanguageParser,
  PARSER_VERSION,
  type ParsedImport,
  type ParseResult,
  parseSource,
} from "@impactmap/parsers";
import {
  type AnalysisCache,
  type CacheStats,
  disabledCacheStats,
  hashContent,
  hashList,
} from "./cache.js";
import { type PackageInfo, packageNameFor } from "./discover.js";
import {
  createResolutionHost,
  type LoadedTsconfig,
  loadTsconfigFile,
  nearestTsconfig,
  resolveSpecifier,
} from "./resolve.js";

export interface SourceFile {
  path: string;
  source: string;
  language: string;
}

export interface GraphBuild {
  graph: DependencyGraph;
  diagnostics: GraphDiagnostic[];
  limitations: string[];
  cache: CacheStats;
  unresolved: number;
  dynamicNonLiteral: number;
  parseErrors: number;
  partial: boolean;
}

export function buildDependencyGraph(input: {
  root: string;
  files: SourceFile[];
  config: ImpactMapConfig;
  packages: PackageInfo[];
  metadataFiles: Array<{ path: string; source: string }>;
  deleted: Set<string>;
  testPatterns: (file: string) => boolean;
  cache: AnalysisCache | null;
  parsers?: LanguageParser[];
  deadlineMs: number;
  readMetadata: (file: string) => string | null;
}): GraphBuild {
  const diagnostics: GraphDiagnostic[] = [];
  const limitations: string[] = [];
  const graph = new DependencyGraph();
  const fileSet = new Set(input.files.map((file) => file.path));
  let partial = false;
  let unresolved = 0;
  let dynamicNonLiteral = 0;
  let parseErrors = 0;

  const parsed = new Map<
    string,
    { result: ParseResult; contentHash: string }
  >();
  for (const file of input.files) {
    if (Date.now() > input.deadlineMs) {
      partial = true;
      limitations.push(
        "Analysis stopped because the configured timeout was reached. Results are partial.",
      );
      diagnostics.push({
        severity: "error",
        code: "timeout",
        message: "Analysis timed out before every file was parsed.",
        file: file.path,
      });
      break;
    }
    if (file.source.length > input.config.limits.maxBytesPerFile) {
      diagnostics.push({
        severity: "warning",
        code: "file-too-large",
        message: `Skipped ${file.path} because it exceeds maxBytesPerFile.`,
        file: file.path,
      });
      continue;
    }
    if (file.source.includes("\0")) {
      diagnostics.push({
        severity: "info",
        code: "binary-file",
        message: `Skipped binary file ${file.path}.`,
        file: file.path,
      });
      continue;
    }
    const contentHash = hashContent(file.source);
    let result = input.cache?.getParse(contentHash) ?? null;
    if (!result) {
      result = parseSource(
        { path: file.path, source: file.source },
        input.parsers,
      );
      input.cache?.setParse(contentHash, result);
    }
    parsed.set(file.path, { result, contentHash });
    if (result.status === "error") parseErrors += 1;
    dynamicNonLiteral += result.imports.filter(
      (item) => item.nonLiteral,
    ).length;
    graph.addNode(
      nodeFrom(file, result, input.packages, input.testPatterns(file.path)),
    );
  }

  const tsconfigs = loadConfigs(
    input.root,
    input.metadataFiles,
    input.readMetadata,
  );
  const host = createResolutionHost(input.root, fileSet, input.readMetadata);
  const resolverHash = hashList(
    input.metadataFiles
      .map((file) => `${file.path}\0${hashContent(file.source)}`)
      .sort(),
  );
  const configHash = hashList([
    JSON.stringify(input.config.include),
    JSON.stringify(input.config.exclude),
    JSON.stringify(input.config.impact),
  ]);
  const fileSetHash = hashList([...fileSet].sort());
  const deletedHash = hashList([...input.deleted].sort());
  const manifest = input.cache?.loadManifest() ?? null;
  const canReuse =
    manifest !== null &&
    manifest.parserVersion === PARSER_VERSION &&
    manifest.configHash === configHash &&
    manifest.resolverHash === resolverHash &&
    manifest.fileSetHash === fileSetHash &&
    manifest.deletedHash === deletedHash;
  if (input.cache) input.cache.resolutionReused = canReuse;

  const nextManifestFiles: ResolutionManifestFiles = {};
  for (const file of input.files) {
    const entry = parsed.get(file.path);
    const node = graph.node(file.path);
    if (!entry || !node) continue;
    for (const diagnostic of entry.result.diagnostics) {
      diagnostics.push({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        file: file.path,
        ...(diagnostic.line ? { line: diagnostic.line } : {}),
      });
    }
    const cached = canReuse ? manifest?.files[file.path] : undefined;
    if (cached && cached.contentHash === entry.contentHash) {
      for (const diagnostic of cached.diagnostics) diagnostics.push(diagnostic);
      for (const edge of cached.edges) {
        ensureTarget(graph, edge.to, input.deleted, input.packages);
        if (graph.hasNode(edge.from) && graph.hasNode(edge.to))
          graph.addEdge(edge);
      }
      nextManifestFiles[file.path] = cached;
      continue;
    }
    const edges: DependencyEdge[] = [];
    const resolutionDiagnostics: GraphDiagnostic[] = [];
    const tsconfig = nearestTsconfig(file.path, tsconfigs);
    for (const item of entry.result.imports) {
      if (item.nonLiteral) continue;
      const resolution = resolveSpecifier({
        from: file.path,
        specifier: item.specifier,
        language: file.language,
        files: fileSet,
        deleted: input.deleted,
        packages: input.packages,
        ...(tsconfig ? { tsconfig } : {}),
        host,
        root: input.root,
        names: item.names.map((name) => name.imported),
      });
      if (resolution.status === "unresolved") {
        resolutionDiagnostics.push({
          severity: "warning",
          code: "unresolved-import",
          message: `Could not resolve "${item.specifier}" in ${file.path}.`,
          file: file.path,
          line: item.line,
        });
        if (item.specifier.startsWith("..")) {
          limitations.push(
            `Import "${item.specifier}" from ${file.path} was not followed outside the repository.`,
          );
        }
        continue;
      }
      ensureTarget(
        graph,
        resolution.target,
        input.deleted,
        input.packages,
        resolution.packageName,
      );
      const edge = edgeFrom(
        file.path,
        resolution.target,
        item,
        resolution.status === "resolved",
      );
      edges.push(edge);
      graph.addEdge(edge);
      if (resolution.status === "deleted") {
        resolutionDiagnostics.push({
          severity: "warning",
          code: "deleted-import",
          message: `${file.path} imports ${resolution.target}, which is not in the analyzed snapshot.`,
          file: file.path,
          line: item.line,
        });
      }
    }
    diagnostics.push(...resolutionDiagnostics);
    nextManifestFiles[file.path] = {
      contentHash: entry.contentHash,
      edges,
      diagnostics: resolutionDiagnostics,
    };
  }

  unresolved = diagnostics.filter(
    (item) => item.code === "unresolved-import",
  ).length;

  if (input.cache && !partial) {
    input.cache.saveManifest({
      version: 1,
      parserVersion: PARSER_VERSION,
      configHash,
      resolverHash,
      fileSetHash,
      deletedHash,
      files: nextManifestFiles,
    });
  }

  if (unresolved > 0) {
    limitations.push(
      `${unresolved} import${unresolved === 1 ? "" : "s"} could not be resolved. Affected-module results do not follow those specifiers.`,
    );
  }
  if (dynamicNonLiteral > 0) {
    limitations.push(
      `${dynamicNonLiteral} dynamic import${dynamicNonLiteral === 1 ? "" : "s"} used a non-literal specifier and ${dynamicNonLiteral === 1 ? "was" : "were"} not resolved.`,
    );
  }
  limitations.push(
    "A static import is evidence of a structural dependency. It does not prove a runtime call, and a dependent module is not reported as broken.",
  );

  return {
    graph,
    diagnostics: dedupe(diagnostics),
    limitations: [...new Set(limitations)],
    cache: input.cache?.stats() ?? disabledCacheStats(),
    unresolved,
    dynamicNonLiteral,
    parseErrors,
    partial,
  };
}

type ResolutionManifestFiles = Record<
  string,
  {
    contentHash: string;
    edges: DependencyEdge[];
    diagnostics: GraphDiagnostic[];
  }
>;

function nodeFrom(
  file: SourceFile,
  result: ParseResult,
  packages: PackageInfo[],
  test: boolean,
): GraphNode {
  const packageName = packageNameFor(file.path, packages);
  return {
    id: file.path,
    path: file.path,
    language: result.language,
    ...(packageName ? { packageName } : {}),
    external: false,
    test,
    exports: result.exports.map((item) => ({
      name: item.name,
      kind: item.kind,
      typeOnly: item.typeOnly,
      line: item.line,
      text: item.text,
    })),
    parseStatus:
      result.status === "unsupported" ? "unsupported" : result.status,
    diagnostics: [],
  };
}

function edgeFrom(
  from: string,
  to: string,
  item: ParsedImport,
  resolved: boolean,
): DependencyEdge {
  return {
    from,
    to,
    kind: item.kind === "static" ? "import" : item.kind,
    typeOnly: item.typeOnly,
    dynamic: item.dynamic,
    resolved,
    conditional: item.conditional,
    specifiers: item.names.map((name) => name.imported),
    evidence: {
      file: from,
      line: item.line,
      column: item.column,
      text: item.text,
    },
  };
}

function ensureTarget(
  graph: DependencyGraph,
  target: string,
  deleted: Set<string>,
  packages: PackageInfo[],
  packageName?: string,
): void {
  if (graph.hasNode(target)) return;
  if (target.startsWith("external:")) {
    graph.addNode({
      id: target,
      path: target,
      language: "external",
      ...(packageName
        ? { packageName }
        : { packageName: target.slice("external:".length) }),
      external: true,
      test: false,
      exports: [],
      parseStatus: "external",
      diagnostics: [],
    });
    return;
  }
  const owner = packageNameFor(target, packages);
  graph.addNode({
    id: target,
    path: target,
    language: target.endsWith(".py") ? "python" : "unknown",
    ...(owner ? { packageName: owner } : {}),
    external: false,
    test: false,
    exports: [],
    parseStatus: deleted.has(target) ? "deleted" : "skipped",
    diagnostics: [
      {
        severity: "info",
        code: deleted.has(target) ? "deleted-target" : "unparsed-target",
        message: deleted.has(target)
          ? `${target} is referenced but missing from the analyzed snapshot.`
          : `${target} is a dependency target and was not parsed as source.`,
        file: target,
      },
    ],
  });
}

function loadConfigs(
  root: string,
  metadataFiles: Array<{ path: string; source: string }>,
  read: (file: string) => string | null,
): LoadedTsconfig[] {
  const configs: LoadedTsconfig[] = [];
  for (const file of metadataFiles) {
    if (
      !path.posix.basename(file.path).startsWith("tsconfig") &&
      path.posix.basename(file.path) !== "jsconfig.json"
    ) {
      continue;
    }
    const loaded = loadTsconfigFile(root, file.path, (relative) => {
      if (relative === file.path) return file.source;
      return read(relative);
    });
    if (loaded) configs.push(loaded);
  }
  return configs;
}

function dedupe(items: GraphDiagnostic[]): GraphDiagnostic[] {
  const seen = new Set<string>();
  const output: GraphDiagnostic[] = [];
  for (const item of items) {
    const key = `${item.code}\0${item.file ?? ""}\0${item.line ?? ""}\0${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output.sort((a, b) =>
    `${a.file ?? ""}\0${a.line ?? 0}\0${a.code}`.localeCompare(
      `${b.file ?? ""}\0${b.line ?? 0}\0${b.code}`,
    ),
  );
}
