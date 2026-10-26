import type { ImpactReport } from "@impactmap/core";

export function renderText(report: ImpactReport): string {
  const lines: string[] = [];
  lines.push("ImpactMap");
  if (report.comparison) {
    lines.push(
      `Base ${short(report.comparison.mergeBase)} (${report.comparison.baseRef}) → ${report.comparison.headRef} ${short(report.comparison.headSha)}`,
    );
  } else {
    lines.push(`Repository ${report.repositoryRoot}`);
  }
  lines.push(
    `Scanned ${report.summary.filesScanned} files · skipped ${report.summary.filesSkipped} · unresolved imports ${report.summary.unresolvedImports} · parse errors ${report.summary.parseErrors} · cycles ${report.summary.cycles}`,
  );
  lines.push("");
  if (report.changes.length > 0) {
    lines.push(`Changes (${report.changes.length})`);
    for (const change of report.changes) {
      const marker = {
        added: "A",
        modified: "M",
        deleted: "D",
        renamed: "R",
        copied: "C",
      }[change.status];
      const rename = change.previousPath
        ? ` (from ${change.previousPath})`
        : "";
      lines.push(`  ${marker} ${change.path}${rename}`);
    }
    lines.push("");
  }
  const groups = [
    "architectural",
    "interface",
    "direct",
    "transitive",
  ] as const;
  for (const category of groups) {
    const findings = report.findings.filter(
      (finding) => finding.category === category,
    );
    if (findings.length === 0) continue;
    lines.push(`${label(category)} (${findings.length})`);
    for (const finding of findings) {
      lines.push(`  ${finding.severity.toUpperCase()} ${finding.title}`);
      if (finding.impactPath.length > 1)
        lines.push(`    path: ${finding.impactPath.join(" → ")}`);
      lines.push(`    ${finding.explanation}`);
      for (const evidence of finding.evidence.slice(0, 3)) {
        lines.push(
          `    evidence: ${evidence.file}:${evidence.line} ${evidence.text}`,
        );
      }
    }
    lines.push("");
  }
  if (
    report.cycles.length > 0 &&
    !report.findings.some(
      (finding) => finding.rule && finding.title.includes("circular"),
    )
  ) {
    lines.push(`Cycles (${report.cycles.length})`);
    for (const cycle of report.cycles) {
      lines.push(`  ${cycle.path.join(" → ")}`);
    }
    lines.push("");
  }
  if (report.tests.length > 0) {
    lines.push(`Tests (${report.tests.length})`);
    for (const test of report.tests) {
      lines.push(`  ${test.file}`);
      lines.push(`    ${test.relationship}: ${test.explanation}`);
    }
    lines.push("");
  } else if (report.summary.changedFiles > 0) {
    lines.push("Tests");
    lines.push(
      "  No structurally linked, configured, or filename-convention tests were found.",
    );
    lines.push("");
  }
  if (report.limitations.length > 0) {
    lines.push("Limitations");
    for (const limitation of report.limitations)
      lines.push(`  - ${limitation}`);
    lines.push("");
  }
  if (report.summary.partial)
    lines.push("The report is partial because an analysis limit was reached.");
  return `${lines.join("\n").replace(/\n$/, "")}\n`;
}

export function renderFiles(
  report: ImpactReport,
  kind: "tests" | "affected",
): string {
  if (kind === "tests")
    return `${report.tests.map((test) => test.file).join("\n")}${report.tests.length ? "\n" : ""}`;
  const files = [
    ...new Set(
      report.findings
        .filter(
          (finding) =>
            finding.category === "direct" || finding.category === "transitive",
        )
        .map((finding) => finding.affectedFile)
        .filter((file): file is string => Boolean(file)),
    ),
  ].sort();
  return `${files.join("\n")}${files.length ? "\n" : ""}`;
}

export function renderJson(report: ImpactReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function short(sha: string): string {
  return sha.slice(0, 12);
}

function label(category: string): string {
  if (category === "direct") return "Direct impact";
  if (category === "transitive") return "Transitive impact";
  if (category === "interface") return "Interface impact";
  if (category === "architectural") return "Architectural impact";
  return category;
}
