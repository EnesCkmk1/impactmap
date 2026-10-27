import { defaultConfig } from "@impactmap/config";
import type { ImpactReport } from "@impactmap/core";
import {
  buildAiPayload,
  deterministicExplanation,
  requestModelCommentary,
  transmittedFields,
} from "@impactmap/core";
import { describe, expect, it } from "vitest";

const report = {
  version: "1",
  tool: { name: "impactmap", version: "0.1.0" },
  deterministic: true,
  repositoryRoot: "/repo",
  summary: {
    filesScanned: 2,
    filesSkipped: 0,
    filesUnsupported: 0,
    parseErrors: 0,
    unresolvedImports: 0,
    dynamicNonLiteral: 0,
    nodes: 2,
    edges: 1,
    packages: 1,
    changedFiles: 1,
    directImpacts: 1,
    transitiveImpacts: 0,
    interfaceImpacts: 0,
    architecturalImpacts: 1,
    testsStructural: 0,
    testsHeuristic: 0,
    testsConfigured: 0,
    cycles: 0,
    partial: false,
  },
  limitations: ["Static imports are not runtime proof."],
  diagnostics: [],
  changes: [{ status: "modified", path: "src/a.ts" }],
  findings: [
    {
      id: "abc",
      category: "direct",
      severity: "info",
      confidence: "structural",
      title: "src/b.ts directly depends on src/a.ts",
      explanation: "structural",
      impactPath: ["src/a.ts", "src/b.ts"],
      evidence: [],
    },
  ],
  cycles: [],
  tests: [],
  cache: {
    enabled: false,
    parseHits: 0,
    parseMisses: 0,
    resolutionReused: false,
  },
} satisfies ImpactReport;

describe("optional explanation", () => {
  it("builds a source-free payload unless includeSource is set", () => {
    const config = defaultConfig();
    const payload = buildAiPayload(report, config, () => "SECRET SOURCE");
    expect(payload.source).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("SECRET SOURCE");
    expect(transmittedFields(payload)).not.toContain("source");
    config.ai.includeSource = true;
    const withSource = buildAiPayload(report, config, () => "SECRET SOURCE");
    expect(withSource.source?.[0]?.content).toContain("SECRET SOURCE");
    expect(deterministicExplanation(report)).toContain("not a language-model");
  });

  it("does not call the network when the model request is not invoked", async () => {
    const config = defaultConfig();
    config.ai.enabled = true;
    config.ai.endpoint = "https://example.invalid/v1";
    config.ai.model = "test";
    const previous = process.env.IMPACTMAP_AI_API_KEY;
    delete process.env.IMPACTMAP_AI_API_KEY;
    await expect(
      requestModelCommentary(buildAiPayload(report, config), config, fetch),
    ).rejects.toMatchObject({ code: "ai-unconfigured" });
    if (previous) process.env.IMPACTMAP_AI_API_KEY = previous;
  });
});
