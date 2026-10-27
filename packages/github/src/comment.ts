import type { ImpactReport } from "@impactmap/core";
import { ImpactMapError } from "@impactmap/core";

const MAX_BODY = 60_000;

/**
 * Renders a pull request comment from a verified report.
 * The comment repeats structural findings and states that they are not runtime failures.
 */
export function renderPullRequestComment(report: ImpactReport): string {
  const lines = [
    "<!-- impactmap-report -->",
    "## ImpactMap",
    "",
    `Scanned **${report.summary.filesScanned}** files. **${report.summary.changedFiles}** changed files, **${report.summary.directImpacts}** direct dependents, **${report.summary.transitiveImpacts}** transitive dependents, **${report.summary.architecturalImpacts}** architectural findings, **${report.summary.cycles}** circular components.`,
    "",
    "These are static dependency facts. A dependent module is not reported as broken, and recommended tests were not executed by this comment.",
    "",
  ];
  if (report.comparison) {
    lines.push(
      `Comparison: \`${report.comparison.mergeBase.slice(0, 12)}\` → \`${report.comparison.headSha.slice(0, 12)}\` (${report.comparison.headRef}).`,
      "",
    );
  }
  const top = report.findings.slice(0, 15);
  if (top.length === 0)
    lines.push(
      "No impact findings for the configured rules and dependency graph.",
      "",
    );
  else {
    lines.push("| Severity | Category | Finding |", "| --- | --- | --- |");
    for (const finding of top) {
      const path =
        finding.impactPath.length > 0
          ? `<br>${escapeCell(finding.impactPath.join(" → "))}`
          : "";
      lines.push(
        `| ${finding.severity} | ${finding.category} | ${escapeCell(finding.title)}${path} |`,
      );
    }
    lines.push("");
  }
  if (report.tests.length > 0) {
    lines.push("### Tests to consider", "");
    for (const test of report.tests.slice(0, 15)) {
      lines.push(`- \`${test.file}\` (${test.relationship})`);
    }
    lines.push("");
  }
  if (report.limitations.length > 0) {
    lines.push("### Limitations", "");
    for (const limitation of report.limitations.slice(0, 8))
      lines.push(`- ${limitation}`);
    lines.push("");
  }
  lines.push("Full machine-readable output is the ImpactMap JSON report.");
  const body = lines.join("\n");
  if (body.length <= MAX_BODY) return body;
  return `${body.slice(0, MAX_BODY)}\n\n_Comment truncated._`;
}

export async function publishPullRequestComment(input: {
  token: string;
  repository: string;
  pullRequest: number;
  body: string;
  apiUrl?: string;
  fetcher?: typeof globalThis.fetch;
}): Promise<void> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)) {
    throw new ImpactMapError(
      "Repository must look like owner/name.",
      2,
      "bad-repository",
    );
  }
  if (!Number.isInteger(input.pullRequest) || input.pullRequest <= 0) {
    throw new ImpactMapError(
      "Pull request number must be a positive integer.",
      2,
      "bad-pull-request",
    );
  }
  if (!input.token)
    throw new ImpactMapError(
      "A GitHub token is required to publish a comment.",
      2,
      "missing-token",
    );
  const fetcher = input.fetcher ?? globalThis.fetch;
  const api = (input.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const response = await fetcher(
    `${api}/repos/${input.repository}/issues/${input.pullRequest}/comments`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "impactmap",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ body: input.body }),
    },
  );
  if (!response.ok) {
    throw new ImpactMapError(
      `GitHub comment failed with HTTP ${response.status}.`,
      3,
      "github-comment-failed",
    );
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
