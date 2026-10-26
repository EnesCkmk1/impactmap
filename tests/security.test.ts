import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseCatFileBatch,
  parseNameStatusZ,
  readTextInside,
  runAnalysis,
} from "@impactmap/core";
import { describe, expect, it } from "vitest";
import { git, tempDir, useFixture } from "./helpers.js";

describe("filesystem and git boundaries", () => {
  it("does not read a symlink that leaves the repository", async () => {
    const dir = useFixture("ts-basic");
    const outside = path.join(
      os.tmpdir(),
      `impactmap-outside-${process.pid}.txt`,
    );
    fs.writeFileSync(outside, "SUPER_SECRET_OUTSIDE");
    fs.symlinkSync(outside, path.join(dir, "src/escaped.ts"));
    const { report } = await runAnalysis({ cwd: dir, cache: false });
    expect(JSON.stringify(report)).not.toContain("SUPER_SECRET_OUTSIDE");
    expect(
      report.diagnostics.some((item) => item.code === "escaped-symlink"),
    ).toBe(true);
    fs.rmSync(outside, { force: true });
  });

  it("parses NUL-delimited git diffs and cat-file batches", () => {
    expect(
      parseNameStatusZ("M\0src/a.ts\0R090\0old.ts\0new.ts\0D\0gone.ts\0"),
    ).toEqual([
      { status: "modified", path: "src/a.ts" },
      { status: "renamed", path: "new.ts", previousPath: "old.ts" },
      { status: "deleted", path: "gone.ts" },
    ]);
    const payload = Buffer.concat([
      Buffer.from("abc blob 5\n"),
      Buffer.from("hello"),
      Buffer.from("\n"),
      Buffer.from("def missing\n"),
    ]);
    const parsed = parseCatFileBatch(payload, ["hello.ts", "missing.ts"]);
    expect(parsed.get("hello.ts")?.toString("utf8")).toBe("hello");
    expect(parsed.get("missing.ts")).toBeNull();
  });

  it("does not read a sibling directory that shares the repository path prefix", () => {
    const dir = tempDir();
    const sibling = `${dir}-evil`;
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(dir, "inside.txt"), "inside");
    fs.writeFileSync(path.join(sibling, "secret.txt"), "SUPER_SECRET_OUTSIDE");
    fs.symlinkSync(
      path.join(sibling, "secret.txt"),
      path.join(dir, "leak.txt"),
    );
    expect(readTextInside(dir, "inside.txt")).toBe("inside");
    expect(readTextInside(dir, "../secret.txt")).toBeNull();
    expect(readTextInside(dir, path.join(sibling, "secret.txt"))).toBeNull();
    expect(readTextInside(dir, "leak.txt")).toBeNull();
    fs.rmSync(sibling, { recursive: true, force: true });
  });

  it("rejects a missing git revision", async () => {
    const dir = useFixture("ts-basic");
    await expect(
      runAnalysis({ cwd: dir, base: "does-not-exist", cache: false }),
    ).rejects.toMatchObject({
      code: "bad-ref",
      exitCode: 2,
    });
  });

  it("refuses to treat a non-repository as a comparison root", async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    await expect(runAnalysis({ cwd: dir, cache: false })).rejects.toMatchObject(
      { code: "not-a-repository" },
    );
  });
});

describe("git execution", () => {
  it("uses argument arrays for rev-parse", () => {
    const dir = useFixture("cycles");
    const sha = git(dir, ["rev-parse", "HEAD"]).trim();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});
