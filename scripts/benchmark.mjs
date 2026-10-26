import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { runAnalysis } from "../packages/core/dist/index.js";

const fileCount = Number(process.argv[2] ?? 300);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "impactmap-bench-"));
fs.mkdirSync(path.join(directory, "src"));
for (let index = 0; index < fileCount; index += 1) {
  const previous =
    index === 0
      ? ""
      : `import { value as previous } from "./m${index - 1}.js";\nexport const used = previous;\n`;
  const fanIn =
    index > 0 && index % 7 === 0
      ? `import { value as side } from "./m${index - 2}.js";\nexport const sideUsed = side;\n`
      : "";
  fs.writeFileSync(
    path.join(directory, "src", `m${index}.ts`),
    `${previous}${fanIn}export function value(): number { return ${index}; }\n`,
  );
}
fs.writeFileSync(
  path.join(directory, "src", `m${fileCount - 1}.test.ts`),
  `import { value } from "./m${fileCount - 1}.js";\nexport const check = value();\n`,
);
execFileSync("git", ["init", "-b", "main"], { cwd: directory });
execFileSync("git", ["add", "-A"], { cwd: directory, env: gitEnv() });
execFileSync("git", ["commit", "-m", "base"], {
  cwd: directory,
  env: gitEnv(),
});
fs.appendFileSync(
  path.join(directory, "src", "m0.ts"),
  "\nexport const changed = true;\n",
);

const coldStart = performance.now();
const cold = await runAnalysis({ cwd: directory, base: "HEAD", cache: true });
const coldMs = performance.now() - coldStart;
const warmStart = performance.now();
const warm = await runAnalysis({ cwd: directory, base: "HEAD", cache: true });
const warmMs = performance.now() - warmStart;

const result = {
  fileCount,
  coldMs: Math.round(coldMs),
  warmMs: Math.round(warmMs),
  nodes: cold.report.summary.nodes,
  edges: cold.report.summary.edges,
  direct: cold.report.summary.directImpacts,
  transitive: cold.report.summary.transitiveImpacts,
  warmParseHits: warm.report.cache.parseHits,
  warmResolutionReused: warm.report.cache.resolutionReused,
  partial: cold.report.summary.partial,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "ImpactMap Bench",
    GIT_AUTHOR_EMAIL: "impactmap@example.com",
    GIT_COMMITTER_NAME: "ImpactMap Bench",
    GIT_COMMITTER_EMAIL: "impactmap@example.com",
  };
}
