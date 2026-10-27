import fs from "node:fs";
import path from "node:path";
import { runAnalysis } from "@impactmap/core";
import { describe, expect, it } from "vitest";
import { branch, commitAll, git, useFixture } from "./helpers.js";

async function changedFixture(
  name: string,
  edit: (dir: string) => void,
): Promise<string> {
  const dir = useFixture(name);
  branch(dir, "feature");
  edit(dir);
  commitAll(dir, "change");
  return dir;
}

describe("change impact", () => {
  it("traces direct and transitive dependents of a changed module", async () => {
    const dir = await changedFixture("ts-basic", (root) => {
      const file = path.join(root, "src/auth/session.ts");
      fs.writeFileSync(
        file,
        fs
          .readFileSync(file, "utf8")
          .replace("userId: token", "userId: token.trim()"),
      );
    });
    const { report } = await runAnalysis({
      cwd: dir,
      base: "main",
      cache: false,
    });
    const direct = report.findings
      .filter((finding) => finding.category === "direct")
      .map((finding) => finding.affectedFile);
    expect(direct).toEqual(
      expect.arrayContaining([
        "src/middleware/auth.ts",
        "src/index.ts",
        "src/views/session-view.ts",
        "tests/session.test.ts",
      ]),
    );
    expect(direct).not.toContain("src/routes/account.ts");
    expect(direct).not.toContain("tests/math.test.ts");

    const account = report.findings.find(
      (finding) => finding.affectedFile === "src/routes/account.ts",
    );
    expect(account?.category).toBe("transitive");
    expect(account?.impactPath).toEqual([
      "src/auth/session.ts",
      "src/middleware/auth.ts",
      "src/routes/account.ts",
    ]);
    expect(account?.explanation).toContain(
      "does not mean the affected module is broken",
    );
    expect(account?.evidence.map((item) => item.text).join("\n")).toContain(
      "requireUser",
    );

    const app = report.findings.find(
      (finding) => finding.affectedFile === "src/app.ts",
    );
    expect(app?.impactPath).toEqual([
      "src/auth/session.ts",
      "src/index.ts",
      "src/app.ts",
    ]);

    const structural = report.tests.find(
      (test) => test.file === "tests/session.test.ts",
    );
    expect(structural?.relationship).toBe("structural-direct");
    expect(
      report.tests.find((test) => test.file === "tests/math.test.ts"),
    ).toBeUndefined();
    expect(report.summary.unresolvedImports).toBe(1);
    expect(report.summary.dynamicNonLiteral).toBe(1);
    expect(JSON.stringify(report)).not.toContain("should-be-gitignored");
    expect(JSON.stringify(report)).not.toContain(
      "node_modules-should-not-be-scanned",
    );
    expect(report.graph?.direction).toBe("dependency");
  });

  it("resolves TypeScript path aliases", async () => {
    const dir = useFixture("aliases");
    const { report, graph } = await runAnalysis({ cwd: dir, cache: false });
    const edge = graph
      .dependenciesOf("src/services/users.ts")
      .find((item) => item.to === "src/db/client.ts");
    expect(edge?.resolved).toBe(true);
    expect(edge?.evidence.text).toContain("@app/db/client");
    expect(report.summary.unresolvedImports).toBe(0);
  });

  it("resolves workspace package entry points", async () => {
    const dir = useFixture("monorepo");
    const { graph } = await runAnalysis({ cwd: dir, cache: false });
    expect(
      graph
        .dependenciesOf("packages/app/src/main.ts")
        .some((edge) => edge.to === "packages/domain/src/index.ts"),
    ).toBe(true);
    expect(
      graph
        .dependenciesOf("packages/domain/src/index.ts")
        .some((edge) => edge.to === "packages/domain/src/user.ts"),
    ).toBe(true);
    expect(graph.node("packages/app/src/main.ts")?.packageName).toBe(
      "@acme/app",
    );
    expect(graph.node("packages/domain/src/user.ts")?.packageName).toBe(
      "@acme/domain",
    );
  });

  it("follows Python imports and selects the importing test", async () => {
    const dir = await changedFixture("python-lib", (root) => {
      fs.appendFileSync(path.join(root, "pkg/repo.py"), "\n# changed\n");
    });
    const { report } = await runAnalysis({
      cwd: dir,
      base: "main",
      cache: false,
    });
    expect(
      report.findings.some(
        (finding) =>
          finding.category === "direct" &&
          finding.affectedFile === "pkg/service.py",
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (finding) =>
          finding.affectedFile === "tests/test_service.py" &&
          finding.category === "transitive",
      ),
    ).toBe(true);
    expect(
      report.tests.some(
        (test) =>
          test.file === "tests/test_service.py" &&
          test.relationship === "structural-transitive",
      ),
    ).toBe(true);
  });

  it("reports deleted and renamed files from the Git diff", async () => {
    const dir = useFixture("ts-basic");
    branch(dir, "feature");
    fs.rmSync(path.join(dir, "src/utils/math.ts"));
    git(dir, ["mv", "src/routes/health.ts", "src/routes/status.ts"]);
    commitAll(dir, "delete and rename");
    const { report } = await runAnalysis({
      cwd: dir,
      base: "main",
      cache: false,
    });
    expect(
      report.changes.map((change) => `${change.status}:${change.path}`).sort(),
    ).toEqual(["deleted:src/utils/math.ts", "renamed:src/routes/status.ts"]);
    const dynamic = report.findings.find(
      (finding) => finding.affectedFile === "src/plugins/load.ts",
    );
    expect(dynamic?.category).toBe("direct");
    expect(dynamic?.changedFile).toBe("src/utils/math.ts");
    expect(dynamic?.evidence[0]?.dynamic).toBe(true);
    expect(
      report.tests.some((test) => test.file === "tests/math.test.ts"),
    ).toBe(true);
  });
});
