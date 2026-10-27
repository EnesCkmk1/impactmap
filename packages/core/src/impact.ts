import { createHash } from "node:crypto";
import type { ImpactMapConfig } from "@impactmap/config";
import {
  type DependencyGraph,
  edgeAllowed,
  impactPathFromMap,
  type WalkOptions,
} from "@impactmap/graph";
import { type ParsedExport, parseSource } from "@impactmap/parsers";
import type { FileChange } from "./git.js";
import { evidenceFromEdge, type Finding } from "./report.js";

export interface ExportDiff {
  file: string;
  added: string[];
  removed: string[];
  changed: string[];
  compared: boolean;
}

export function computeImpact(input: {
  graph: DependencyGraph;
  changes: FileChange[];
  config: ImpactMapConfig;
  readBase: (file: string) => string | null;
  readHead: (file: string) => string | null;
}): {
  findings: Finding[];
  diffs: Map<string, ExportDiff>;
  limitations: string[];
} {
  const limitations: string[] = [];
  const diffs = new Map<string, ExportDiff>();
  const walk: WalkOptions = {
    maxDepth: input.config.impact.depth,
    includeTypeOnly: input.config.impact.includeTypeOnly,
    includeDynamic: input.config.impact.includeDynamic,
    includeExternal: false,
    includeUnresolved: true,
  };

  for (const change of input.changes) {
    const headPath = change.path;
    const basePath = change.previousPath ?? change.path;
    if (change.status === "added") {
      diffs.set(
        headPath,
        diffExports([], exportsOf(input.readHead(headPath), headPath)),
      );
      continue;
    }
    if (change.status === "deleted") {
      diffs.set(
        headPath,
        diffExports(exportsOf(input.readBase(basePath), basePath), []),
      );
      continue;
    }
    const before = input.readBase(basePath);
    const after = input.readHead(headPath);
    if (before === null || after === null) {
      diffs.set(headPath, {
        file: headPath,
        added: [],
        removed: [],
        changed: [],
        compared: false,
      });
      limitations.push(
        `Export comparison for ${headPath} was skipped because one side of the revision could not be read.`,
      );
      continue;
    }
    diffs.set(
      headPath,
      diffExports(exportsOf(before, basePath), exportsOf(after, headPath)),
    );
  }

  const starts = [
    ...new Set(
      input.changes.flatMap((change) =>
        [change.path, change.previousPath].filter((file): file is string =>
          Boolean(file),
        ),
      ),
    ),
  ].filter((file) => input.graph.hasNode(file));
  const reached = input.graph.reverseReachable(starts, walk);
  const best = new Map<
    string,
    {
      category: "direct" | "transitive";
      record: ReturnType<typeof reached.get> & object;
    }
  >();

  for (const [id, record] of reached) {
    if (record.hops === 0) continue;
    const category = record.hops === 1 ? "direct" : "transitive";
    const current = best.get(id);
    if (
      !current ||
      record.hops < current.record.hops ||
      (record.hops === current.record.hops &&
        record.source < current.record.source)
    ) {
      best.set(id, { category, record });
    }
  }

  const findings: Finding[] = [];
  for (const [affected, entry] of best) {
    const record = entry.record;
    const path = impactPathFromMap(record, reached);
    const changedFile = path.source;
    const diff = diffs.get(changedFile);
    const directEdges =
      entry.category === "direct"
        ? input.graph
            .dependentsOf(changedFile)
            .filter(
              (edge) =>
                edge.from === affected && edgeAllowed(edge, input.graph, walk),
            )
        : path.edges;
    const evidence = directEdges.map(evidenceFromEdge);
    const symbols = symbolNote(
      diff,
      directEdges.flatMap((edge) => edge.specifiers),
    );
    const conditional = directEdges.some(
      (edge) => edge.conditional || edge.dynamic,
    );
    const deleted =
      input.graph.node(changedFile)?.parseStatus === "deleted" ||
      !directEdges.every((edge) => edge.resolved);
    findings.push({
      id: findingId(["impact", entry.category, changedFile, affected]),
      category: entry.category,
      severity: "info",
      confidence: "structural",
      title:
        entry.category === "direct"
          ? `${affected} directly depends on ${changedFile}`
          : `${affected} transitively depends on ${changedFile}`,
      explanation: impactExplanation({
        category: entry.category,
        changedFile,
        affected,
        impactPath: path.nodes,
        hops: record.hops,
        symbols,
        conditional,
        deletedTarget: deleted && entry.category === "direct",
        compared: diff?.compared ?? false,
      }),
      changedFile,
      affectedFile: affected,
      impactPath: path.nodes,
      evidence,
      hops: record.hops,
      ...(symbols.names.length > 0 ? { symbols: symbols.names } : {}),
    });
  }

  for (const [file, diff] of diffs) {
    if (!diff.compared) continue;
    if (
      diff.added.length === 0 &&
      diff.removed.length === 0 &&
      diff.changed.length === 0
    )
      continue;
    const change = input.changes.find((item) => item.path === file);
    if (
      change?.status === "added" &&
      !input.graph.dependentsOf(file).some((edge) => edge.resolved)
    ) {
      continue;
    }
    findings.push({
      id: findingId([
        "interface",
        file,
        diff.added.join(),
        diff.removed.join(),
        diff.changed.join(),
      ]),
      category: "interface",
      severity: "info",
      confidence: "structural",
      title: `Exported declarations changed in ${file}`,
      explanation: interfaceExplanation(file, diff),
      changedFile: file,
      impactPath: [file],
      evidence: [],
      symbols: [...diff.added, ...diff.removed, ...diff.changed].sort(),
    });
  }

  return { findings, diffs, limitations };
}

function impactExplanation(input: {
  category: "direct" | "transitive";
  changedFile: string;
  affected: string;
  impactPath: string[];
  hops: number;
  symbols: { names: string[]; note: string };
  conditional: boolean;
  deletedTarget: boolean;
  compared: boolean;
}): string {
  const relationship =
    input.category === "direct"
      ? `${input.affected} directly imports or re-exports ${input.changedFile}.`
      : `${input.affected} reaches ${input.changedFile} through ${input.hops} dependency relationships.`;
  const path = `Impact path (changed module first; each next module depends on the previous one): ${input.impactPath.join(" → ")}.`;
  const runtime =
    "This is a structural fact from static imports. It does not mean the affected module is broken or that a runtime path executes the change.";
  const conditional = input.conditional
    ? " At least one relationship is dynamic or nested, so it may be conditional."
    : "";
  const deleted = input.deletedTarget
    ? " The import target is missing from the analyzed snapshot, which includes deleted or renamed paths that are still referenced."
    : "";
  const compared = input.compared
    ? ""
    : " Export declaration text was not compared for the changed file.";
  return `${relationship} ${path} ${runtime}${conditional}${deleted}${compared} ${input.symbols.note}`
    .replace(/\s+/g, " ")
    .trim();
}

function interfaceExplanation(file: string, diff: ExportDiff): string {
  const parts = [
    diff.added.length > 0 ? `added ${diff.added.join(", ")}` : "",
    diff.removed.length > 0 ? `removed ${diff.removed.join(", ")}` : "",
    diff.changed.length > 0 ? `changed for ${diff.changed.join(", ")}` : "",
  ].filter(Boolean);
  return `In ${file}, exported declarations ${parts.join("; ")}. Declaration text includes the exported body when it is in the same statement, so this is not by itself a signature or runtime break. Callers are listed separately as direct or transitive impact.`;
}

function symbolNote(
  diff: ExportDiff | undefined,
  specifiers: string[],
): { names: string[]; note: string } {
  const unique = [...new Set(specifiers.filter((name) => name !== "*"))].sort();
  if (!diff?.compared) {
    return {
      names: unique,
      note:
        unique.length > 0
          ? `Imported names: ${unique.join(", ")}.`
          : "The import does not name specific exports.",
    };
  }
  const changed = new Set([...diff.added, ...diff.removed, ...diff.changed]);
  if (specifiers.length === 0 || specifiers.includes("*")) {
    return {
      names: unique,
      note: "The import is a namespace or side-effect import, so the module is relevant as a whole.",
    };
  }
  const overlap = unique.filter((name) => changed.has(name));
  if (changed.size === 0) {
    return {
      names: unique,
      note: `Imported names (${unique.join(", ")}) were compared with the export list. No exported declaration text changed; the module body outside those declarations, or a dependency of this module, may still be relevant.`,
    };
  }
  if (overlap.length > 0) {
    return {
      names: overlap,
      note: `Imported names overlap exports whose declaration text changed: ${overlap.join(", ")}.`,
    };
  }
  return {
    names: unique,
    note: `Imported names (${unique.join(", ")}) do not overlap exports whose declaration text changed (${[...changed].sort().join(", ")}). The dependency is still reported because the module changed.`,
  };
}

function exportsOf(source: string | null, file: string): ParsedExport[] {
  if (source === null) return [];
  return parseSource({ path: file, source }).exports;
}

function diffExports(
  before: ParsedExport[],
  after: ParsedExport[],
): ExportDiff {
  const previous = new Map(before.map((item) => [item.name, item]));
  const next = new Map(after.map((item) => [item.name, item]));
  const added = [...next.keys()].filter((name) => !previous.has(name)).sort();
  const removed = [...previous.keys()].filter((name) => !next.has(name)).sort();
  const changed = [...next.keys()]
    .filter(
      (name) =>
        previous.has(name) && previous.get(name)?.text !== next.get(name)?.text,
    )
    .sort();
  return { file: "", added, removed, changed, compared: true };
}

function findingId(parts: string[]): string {
  return createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 16);
}

export { findingId };
