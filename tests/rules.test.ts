import fs from "node:fs";
import path from "node:path";
import { ConfigError, validateConfig } from "@impactmap/config";
import { exitCodeFor, runAnalysis } from "@impactmap/core";
import { describe, expect, it } from "vitest";
import { useFixture } from "./helpers.js";

describe("architecture rules", () => {
  it("reports forbidden edges, restricted modules, and allowed-dependency misses", async () => {
    const dir = useFixture("architecture");
    const { report } = await runAnalysis({ cwd: dir, cache: false });
    const rules = report.findings.filter(
      (finding) => finding.category === "architectural",
    );
    expect(rules.map((finding) => finding.rule).sort()).toEqual([
      "domain-allowed",
      "domain-no-infra",
      "ui-no-infra",
      "web-no-secrets",
    ]);
    const domain = rules.find((finding) => finding.rule === "domain-no-infra");
    expect(domain?.severity).toBe("error");
    expect(domain?.impactPath).toEqual([
      "src/infra/db.ts",
      "src/domain/order.ts",
    ]);
    expect(domain?.evidence[0]?.text).toContain("../infra/db.js");
    expect(exitCodeFor(report, "error")).toBe(1);
    expect(exitCodeFor(report, "never")).toBe(0);
  });

  it("detects a three-node cycle and a self-import", async () => {
    const dir = useFixture("cycles");
    const { report } = await runAnalysis({ cwd: dir, cache: false });
    const members = report.cycles
      .map((cycle) => cycle.members.join(","))
      .sort();
    expect(members).toContain("src/a.ts,src/b.ts,src/c.ts");
    expect(
      report.cycles.some(
        (cycle) =>
          cycle.members.length === 1 && cycle.path[0] === "src/self.ts",
      ),
    ).toBe(true);
    expect(
      report.cycles.some((cycle) => cycle.members.includes("src/ok.ts")),
    ).toBe(false);
  });
});

describe("configuration", () => {
  it("rejects unknown keys and malformed rule shapes", () => {
    expect(() => validateConfig({ mystery: true })).toThrow(ConfigError);
    expect(() =>
      validateConfig({
        rules: [{ name: "x", severity: "error", type: "nope" }],
      }),
    ).toThrow(ConfigError);
    expect(() =>
      validateConfig({ cache: { directory: "../outside" } }),
    ).toThrow(ConfigError);
    const config = validateConfig({
      impact: { depth: 2, includeDynamic: false },
    });
    expect(config.impact.depth).toBe(2);
    expect(config.impact.includeTypeOnly).toBe(true);
  });

  it("refuses a code config when execution is disabled", async () => {
    const dir = useFixture("ts-basic");
    fs.writeFileSync(
      path.join(dir, "impactmap.config.mjs"),
      "export default { impact: { depth: 1 } };\n",
    );
    fs.rmSync(path.join(dir, "impactmap.config.json"));
    const previous = process.env.IMPACTMAP_DISABLE_CODE_CONFIG;
    process.env.IMPACTMAP_DISABLE_CODE_CONFIG = "1";
    try {
      await expect(
        runAnalysis({ cwd: dir, cache: false }),
      ).rejects.toMatchObject({ code: "code-config-disabled" });
    } finally {
      if (previous === undefined)
        delete process.env.IMPACTMAP_DISABLE_CODE_CONFIG;
      else process.env.IMPACTMAP_DISABLE_CODE_CONFIG = previous;
    }
  });
});
