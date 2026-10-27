import type { ArchitectureRule, ImpactMapConfig } from "@impactmap/config";
import type { Cycle, DependencyGraph } from "@impactmap/graph";
import picomatch from "picomatch";
import type { FileChange } from "./git.js";
import type { ExportDiff } from "./impact.js";
import { findingId } from "./impact.js";
import { evidenceFromEdge, type Finding } from "./report.js";

export function evaluateRules(input: {
  graph: DependencyGraph;
  config: ImpactMapConfig;
  changes: FileChange[];
  diffs: Map<string, ExportDiff>;
  cycles: Cycle[];
}): Finding[] {
  const findings: Finding[] = [];
  const changed = new Set(input.changes.map((change) => change.path));
  for (const rule of input.config.rules) {
    if (rule.type === "no-circular") {
      findings.push(...cycleFindings(rule, input.cycles));
      continue;
    }
    if (rule.type === "public-api-review") {
      findings.push(...publicApiFindings(rule, input.diffs, changed));
      continue;
    }
    findings.push(...edgeFindings(rule, input.graph, changed));
  }
  return findings.sort(compareFindings);
}

function edgeFindings(
  rule: Extract<
    ArchitectureRule,
    {
      type:
        | "forbidden-dependency"
        | "allowed-dependencies"
        | "restricted-module";
    }
  >,
  graph: DependencyGraph,
  changed: Set<string>,
): Finding[] {
  const findings: Finding[] = [];
  for (const edge of graph.allEdges()) {
    if (!edge.resolved && graph.node(edge.to)?.parseStatus !== "deleted")
      continue;
    let violated = false;
    const target = edge.to;
    if (rule.type === "forbidden-dependency") {
      violated = matches(edge.from, rule.from) && matches(target, rule.to);
    } else if (rule.type === "restricted-module") {
      violated =
        matches(target, rule.modules) && matches(edge.from, rule.importers);
    } else {
      violated =
        matches(edge.from, rule.from) &&
        !matches(target, rule.allow) &&
        edge.from !== edge.to;
    }
    if (!violated) continue;
    const touched = changed.has(edge.from) || changed.has(edge.to);
    findings.push({
      id: findingId([
        "rule",
        rule.name,
        edge.from,
        edge.to,
        String(edge.evidence.line),
      ]),
      category: "architectural",
      severity: rule.severity,
      confidence: "structural",
      title: `${rule.name}: ${edge.from} depends on ${edge.to}`,
      explanation: [
        rule.description ??
          `Architectural rule "${rule.name}" (${rule.type}) was violated.`,
        `${edge.from} depends on ${edge.to}.`,
        `Impact path: ${edge.to} → ${edge.from}.`,
        touched
          ? "This dependency touches a file in the current change set."
          : "Neither endpoint is in the current change set. The rule matches the repository as analyzed.",
        "The finding is a static dependency fact. It does not by itself mean the build fails.",
      ].join(" "),
      changedFile: edge.to,
      affectedFile: edge.from,
      rule: rule.name,
      impactPath: [edge.to, edge.from],
      evidence: [evidenceFromEdge(edge)],
      hops: 1,
    });
  }
  return findings;
}

function cycleFindings(
  rule: Extract<ArchitectureRule, { type: "no-circular" }>,
  cycles: Cycle[],
): Finding[] {
  const findings: Finding[] = [];
  for (const cycle of cycles) {
    if (
      rule.within &&
      !cycle.members.every((member) => matches(member, rule.within ?? []))
    )
      continue;
    const path = cycle.path.length > 0 ? cycle.path : cycle.members;
    findings.push({
      id: findingId(["cycle-rule", rule.name, cycle.members.join("|")]),
      category: "architectural",
      severity: rule.severity,
      confidence: "structural",
      title: `${rule.name}: circular dependency among ${cycle.members.join(", ")}`,
      explanation: [
        rule.description ??
          `Architectural rule "${rule.name}" forbids this circular dependency.`,
        `Strongly connected component: ${cycle.members.join(", ")}.`,
        `One dependency cycle: ${path.join(" → ")}.`,
        cycle.typeOnly
          ? "Every edge in the traced cycle is type-only."
          : "The cycle includes a value import or re-export.",
        "Cycle direction follows imports: each module depends on the next, and the last depends on the first.",
      ].join(" "),
      rule: rule.name,
      impactPath: path,
      evidence: cycle.edges.map(evidenceFromEdge),
    });
  }
  return findings;
}

function publicApiFindings(
  rule: Extract<ArchitectureRule, { type: "public-api-review" }>,
  diffs: Map<string, ExportDiff>,
  changed: Set<string>,
): Finding[] {
  const findings: Finding[] = [];
  for (const [file, diff] of diffs) {
    if (!changed.has(file) || !matches(file, rule.files)) continue;
    if (!diff.compared) continue;
    if (
      diff.added.length === 0 &&
      diff.removed.length === 0 &&
      diff.changed.length === 0
    )
      continue;
    const symbols = [...diff.added, ...diff.removed, ...diff.changed].sort();
    findings.push({
      id: findingId(["public-api", rule.name, file, symbols.join("|")]),
      category: "architectural",
      severity: rule.severity,
      confidence: "structural",
      title: `${rule.name}: public declarations changed in ${file}`,
      explanation: [
        rule.description ??
          `Architectural rule "${rule.name}" marks this file for review when exported declaration text changes.`,
        `Changed exports: ${symbols.join(", ")}.`,
        "This compares declaration source text between the base revision and the analyzed snapshot. It is not a semantic breaking-change proof.",
      ].join(" "),
      changedFile: file,
      rule: rule.name,
      impactPath: [file],
      evidence: [],
      symbols,
    });
  }
  return findings;
}

function matches(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => picomatch(pattern, { dot: true })(file));
}

function compareFindings(a: Finding, b: Finding): number {
  return `${a.rule}\0${a.affectedFile ?? ""}\0${a.changedFile ?? ""}`.localeCompare(
    `${b.rule}\0${b.affectedFile ?? ""}\0${b.changedFile ?? ""}`,
  );
}
