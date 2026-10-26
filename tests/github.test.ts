import fs from "node:fs";
import path from "node:path";
import type { ImpactReport } from "@impactmap/core";
import {
  ANALYSIS_PERMISSIONS,
  COMMENT_PERMISSIONS,
  publishPullRequestComment,
  renderPullRequestComment,
} from "@impactmap/github";
import { describe, expect, it } from "vitest";

describe("GitHub integration", () => {
  it("keeps analysis read-only and comment publishing separate in the workflows", () => {
    const analysis = fs.readFileSync(
      path.resolve(".github/workflows/impactmap.yml"),
      "utf8",
    );
    const comment = fs.readFileSync(
      path.resolve(".github/workflows/impactmap-comment.yml"),
      "utf8",
    );
    const action = fs.readFileSync(
      path.resolve(".github/actions/impactmap/action.yml"),
      "utf8",
    );
    expect(analysis).toContain("contents: read");
    expect(analysis).not.toContain("pull-requests: write");
    expect(analysis).toContain('IMPACTMAP_DISABLE_CODE_CONFIG: "1"');
    expect(comment).toContain("pull-requests: write");
    expect(comment).toContain("contents: read");
    const trigger = comment.slice(0, comment.indexOf("permissions:"));
    expect(trigger).not.toContain("pull_request_target");
    expect(comment).toContain("must not execute pull request code");
    expect(action).toContain("IMPACTMAP_DISABLE_CODE_CONFIG");
    expect(action).not.toContain("pull_request_target");
    expect(ANALYSIS_PERMISSIONS.contents).toBe("read");
    expect(COMMENT_PERMISSIONS["pull-requests"]).toBe("write");
  });

  it("posts a comment only to the validated repository and pull request", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetcher = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    await publishPullRequestComment({
      token: "test-token",
      repository: "acme/widgets",
      pullRequest: 12,
      body: renderPullRequestComment(sample()),
      apiUrl: "https://api.github.example",
      fetcher,
    });
    expect(calls[0]?.url).toBe(
      "https://api.github.example/repos/acme/widgets/issues/12/comments",
    );
    expect(calls[0]?.body).toContain("ImpactMap");
    expect(calls[0]?.body).not.toContain("definitely broken");
    await expect(
      publishPullRequestComment({
        token: "t",
        repository: "acme/widgets;rm",
        pullRequest: 1,
        body: "x",
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "bad-repository" });
  });
});

function sample(): ImpactReport {
  return {
    version: "1",
    tool: { name: "impactmap", version: "0.1.0" },
    deterministic: true,
    repositoryRoot: "/repo",
    summary: {
      filesScanned: 1,
      filesSkipped: 0,
      filesUnsupported: 0,
      parseErrors: 0,
      unresolvedImports: 0,
      dynamicNonLiteral: 0,
      nodes: 1,
      edges: 0,
      packages: 0,
      changedFiles: 1,
      directImpacts: 0,
      transitiveImpacts: 0,
      interfaceImpacts: 0,
      architecturalImpacts: 0,
      testsStructural: 0,
      testsHeuristic: 0,
      testsConfigured: 0,
      cycles: 0,
      partial: false,
    },
    limitations: [],
    diagnostics: [],
    changes: [],
    findings: [],
    cycles: [],
    tests: [],
    cache: {
      enabled: false,
      parseHits: 0,
      parseMisses: 0,
      resolutionReused: false,
    },
    comparison: {
      baseRef: "main",
      baseSha: "a".repeat(40),
      headRef: "feature",
      headSha: "b".repeat(40),
      mergeBase: "a".repeat(40),
    },
  };
}
