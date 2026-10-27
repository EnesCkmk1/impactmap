import fs from "node:fs";
import path from "node:path";
import { runAnalysis } from "@impactmap/core";
import { describe, expect, it } from "vitest";
import { useFixture } from "./helpers.js";

describe("incremental cache", () => {
  it("reuses parses and resolution until the file set changes", async () => {
    const dir = useFixture("ts-basic");
    const first = await runAnalysis({ cwd: dir, cache: true });
    expect(first.report.cache.parseMisses).toBeGreaterThan(0);
    expect(first.report.cache.resolutionReused).toBe(false);

    const second = await runAnalysis({ cwd: dir, cache: true });
    expect(second.report.cache.parseHits).toBe(
      first.report.summary.filesScanned,
    );
    expect(second.report.cache.parseMisses).toBe(0);
    expect(second.report.cache.resolutionReused).toBe(true);
    expect(withoutCache(second.report)).toEqual(withoutCache(first.report));

    fs.appendFileSync(
      path.join(dir, "src/utils/math.ts"),
      "\nexport const extra = 1;\n",
    );
    const third = await runAnalysis({ cwd: dir, cache: true });
    expect(third.report.cache.resolutionReused).toBe(true);
    expect(third.report.cache.parseMisses).toBe(1);
    expect(third.report.cache.parseHits).toBe(
      first.report.summary.filesScanned - 1,
    );

    fs.writeFileSync(
      path.join(dir, "src/utils/extra.ts"),
      "export const extraFile = 1;\n",
    );
    const fourth = await runAnalysis({ cwd: dir, cache: true });
    expect(fourth.report.cache.resolutionReused).toBe(false);
    expect(fourth.report.cache.parseHits).toBeGreaterThan(0);
  });
});

function withoutCache(report: { cache: unknown; summary: unknown }): string {
  return JSON.stringify({ ...report, cache: undefined });
}
