import path from "node:path";
import type { ImpactMapConfig } from "@impactmap/config";
import {
  type DependencyGraph,
  edgeAllowed,
  type WalkOptions,
} from "@impactmap/graph";
import picomatch from "picomatch";
import type { FileChange } from "./git.js";
import {
  evidenceFromEdge,
  type Finding,
  type TestRecommendation,
} from "./report.js";

export function selectTests(input: {
  graph: DependencyGraph;
  config: ImpactMapConfig;
  changes: FileChange[];
  findings: Finding[];
}): { tests: TestRecommendation[]; limitations: string[] } {
  const limitations: string[] = [];
  const changed = input.changes.map((change) => change.path);
  const changedSet = new Set(changed);
  const affected = new Set(
    input.findings
      .filter(
        (finding) =>
          finding.category === "direct" || finding.category === "transitive",
      )
      .flatMap((finding) =>
        [finding.affectedFile, finding.changedFile].filter(
          (file): file is string => Boolean(file),
        ),
      ),
  );
  for (const file of changed) affected.add(file);

  const walk: WalkOptions = {
    maxDepth: 1,
    includeTypeOnly: input.config.impact.includeTypeOnly,
    includeDynamic: input.config.impact.includeDynamic,
    includeExternal: false,
    includeUnresolved: false,
  };

  const recommendations = new Map<string, TestRecommendation>();
  const testFiles = input.graph.allNodes().filter((node) => node.test);

  for (const test of testFiles) {
    const edges = input.graph.dependenciesOf(test.id).filter((edge) => {
      if (input.graph.node(edge.to)?.parseStatus === "deleted") return true;
      return edgeAllowed(edge, input.graph, walk);
    });
    const direct = edges.filter((edge) => changedSet.has(edge.to));
    if (direct.length > 0) {
      recommendations.set(test.id, {
        file: test.id,
        relationship: "structural-direct",
        confidence: "structural",
        explanation: `${test.id} imports changed file ${direct.map((edge) => edge.to).join(", ")}. This is a structural relationship, not evidence that the test was executed or that it covers the change.`,
        relatedFiles: [...new Set(direct.map((edge) => edge.to))].sort(),
        evidence: direct.map(evidenceFromEdge),
      });
      continue;
    }
    const transitive = edges.filter(
      (edge) => affected.has(edge.to) && !changedSet.has(edge.to),
    );
    if (transitive.length > 0) {
      recommendations.set(test.id, {
        file: test.id,
        relationship: "structural-transitive",
        confidence: "structural",
        explanation: `${test.id} imports ${transitive.map((edge) => edge.to).join(", ")}, which is affected by the change set. The test does not directly import a changed file. Running it does not guarantee the absence of regressions.`,
        relatedFiles: [...new Set(transitive.map((edge) => edge.to))].sort(),
        evidence: transitive.map(evidenceFromEdge),
      });
    }
  }

  for (const mapping of input.config.test.mappings) {
    const matchedModules = changed.filter((file) =>
      matches(file, mapping.modules),
    );
    if (matchedModules.length === 0) continue;
    const tests = testFiles
      .filter((test) => matches(test.id, mapping.tests))
      .map((test) => test.id);
    const label = mapping.name ?? "configured mapping";
    if (tests.length === 0) {
      limitations.push(
        `Test mapping "${label}" matched changed modules but no test files matched its test patterns.`,
      );
      continue;
    }
    for (const test of tests) {
      if (recommendations.has(test)) continue;
      recommendations.set(test, {
        file: test,
        relationship: "explicit-mapping",
        confidence: "configured",
        explanation: `${test} was selected by the configured mapping "${label}" because changed files match its modules: ${matchedModules.join(", ")}.`,
        relatedFiles: matchedModules,
        evidence: [],
      });
    }
  }

  const knownTests = new Set(testFiles.map((test) => test.id));
  for (const file of changed) {
    for (const candidate of heuristicCandidates(file)) {
      if (!knownTests.has(candidate) || recommendations.has(candidate))
        continue;
      recommendations.set(candidate, {
        file: candidate,
        relationship: "heuristic-name",
        confidence: "heuristic",
        explanation: `${candidate} matches a filename convention for ${file}, but no import from that test to the changed module was found. Treat this as a hint, not a structural dependency.`,
        relatedFiles: [file],
        evidence: [],
      });
    }
  }

  if (changed.length > 0 && recommendations.size === 0) {
    limitations.push(
      "No structurally linked or configured tests were found for the changed files. This does not mean the change is untested; ImpactMap only reports relationships it can establish.",
    );
  }

  const tests = [...recommendations.values()].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.relationship.localeCompare(b.relationship),
  );
  return { tests, limitations };
}

function heuristicCandidates(file: string): string[] {
  const extension = path.posix.extname(file);
  const dir = path.posix.dirname(file);
  const base = path.posix.basename(file, extension);
  const candidates = [
    path.posix.join(dir, `${base}.test${extension}`),
    path.posix.join(dir, `${base}.spec${extension}`),
    path.posix.join(dir, "__tests__", `${base}${extension}`),
    path.posix.join(dir, "__tests__", `${base}.test${extension}`),
    `tests/${base}.test${extension}`,
    `tests/${base}.spec${extension}`,
    `test/${base}.test${extension}`,
  ];
  if (extension === ".py") {
    candidates.push(
      path.posix.join(dir, `test_${base}.py`),
      `tests/test_${base}.py`,
      `test/test_${base}.py`,
    );
  }
  return candidates.map((candidate) => candidate.replace(/^\.\//, ""));
}

function matches(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => picomatch(pattern, { dot: true })(file));
}
