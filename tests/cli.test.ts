import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { branch, commitAll, useFixture } from "./helpers.js";

const bin = path.resolve("packages/cli/dist/bin.js");

function run(
  args: string[],
  cwd: string,
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [bin, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failed = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failed.status ?? 1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
    };
  }
}

describe("CLI", () => {
  it("prints help and a stable impact JSON report", () => {
    const help = run(["--help"], process.cwd());
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("impact [options]");
    expect(help.stdout).toContain("check [options]");
    expect(help.stdout).toContain("tests [options]");
    expect(help.stdout).toContain("cycles [options]");

    const dir = useFixture("ts-basic");
    branch(dir, "feature");
    fs.appendFileSync(
      path.join(dir, "src/auth/session.ts"),
      "\nexport const marker = 1;\n",
    );
    commitAll(dir, "change session");
    const output = path.join(dir, "report.json");
    const result = run(
      [
        "impact",
        "--base",
        "main",
        "--format",
        "json",
        "--output",
        output,
        "--no-cache",
      ],
      dir,
    );
    expect(result.status).toBe(0);
    const report = JSON.parse(fs.readFileSync(output, "utf8")) as {
      findings: Array<{ affectedFile?: string; impactPath: string[] }>;
    };
    expect(
      report.findings.some(
        (finding) =>
          finding.affectedFile === "src/routes/account.ts" &&
          finding.impactPath.join(" → ").includes("src/middleware/auth.ts"),
      ),
    ).toBe(true);
    expect(result.stdout).toContain('"version": "1"');
  });

  it("exits 1 when architecture rules fail and 2 for a bad config", () => {
    const dir = useFixture("architecture");
    const failed = run(
      ["check", "--base", "main", "--format", "json", "--no-cache"],
      dir,
    );
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain("domain-no-infra");

    fs.writeFileSync(
      path.join(dir, "impactmap.config.json"),
      '{ "notARealOption": true }',
    );
    const invalid = run(["analyze", "--format", "json", "--no-cache"], dir);
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).toContain("Unknown configuration key");
  });

  it("lists recommended tests and detects cycles", () => {
    const dir = useFixture("ts-basic");
    branch(dir, "feature");
    fs.appendFileSync(path.join(dir, "src/auth/session.ts"), "\n");
    commitAll(dir, "touch");
    const tests = run(
      ["tests", "--base", "main", "--format", "files", "--no-cache"],
      dir,
    );
    expect(tests.status).toBe(0);
    expect(tests.stdout.split("\n")).toContain("tests/session.test.ts");
    expect(tests.stdout).not.toContain("tests/math.test.ts");

    const cycles = run(
      ["cycles", "--strict", "--format", "text", "--no-cache"],
      useFixture("cycles"),
    );
    expect(cycles.status).toBe(1);
    expect(cycles.stdout).toContain("src/a.ts");
  });

  it("writes a starter config without inventing unsupported keys", () => {
    const dir = useFixture("cycles");
    const result = run(["init"], dir);
    expect(result.status).toBe(0);
    const config = JSON.parse(
      fs.readFileSync(path.join(dir, "impactmap.config.json"), "utf8"),
    ) as { rules: unknown[] };
    expect(Array.isArray(config.rules)).toBe(true);
    expect(result.stdout).toContain("Unknown keys are rejected");
  });
});
