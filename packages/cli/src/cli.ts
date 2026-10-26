import fs from "node:fs";
import path from "node:path";
import type { FailOn } from "@impactmap/config";
import { starterConfigText } from "@impactmap/config";
import {
  type AnalyzeOptions,
  buildAiPayload,
  deterministicExplanation,
  exitCodeFor,
  ImpactMapError,
  type ImpactReport,
  isImpactMapError,
  readTextInside,
  requestModelCommentary,
  runAnalysis,
  TOOL_VERSION,
  transmittedFields,
} from "@impactmap/core";
import {
  publishPullRequestComment,
  renderPullRequestComment,
} from "@impactmap/github";
import { Command, CommanderError } from "commander";
import { renderFiles, renderJson, renderText } from "./render.js";

export async function run(argv: string[]): Promise<number> {
  const status = { code: 0 };
  const program = new Command();
  program
    .name("impactmap")
    .description("Explainable change-impact analysis for Git repositories.")
    .version(TOOL_VERSION);

  program
    .command("analyze")
    .description(
      "Analyze the working tree and report dependencies, cycles, and configured architecture rules.",
    )
    .option("-c, --config <file>", "configuration file")
    .option("-f, --format <format>", "text or json", "text")
    .option("-o, --output <file>", "also write the report to this path")
    .option("--no-cache", "do not read or write the analysis cache")
    .option("--graph <mode>", "neighborhood, full, or none")
    .action(async (opts) => {
      const result = await runAnalysis(baseOptions(opts));
      await emit(result.report, opts.format, opts.output, "affected");
      status.code = result.report.summary.partial ? 3 : 0;
    });

  program
    .command("impact")
    .description(
      "Report modules affected by changes since the merge base of --base.",
    )
    .requiredOption(
      "--base <ref>",
      "base Git revision, usually the target branch",
    )
    .option("--head <ref>", "head commit; omit to include uncommitted work")
    .option("-c, --config <file>", "configuration file")
    .option("-f, --format <format>", "text, json, or files", "text")
    .option("-o, --output <file>", "also write the report to this path")
    .option("--depth <n>", "maximum reverse-dependency hops", integer)
    .option("--fail-on <policy>", "never, error, or warning")
    .option("--no-cache", "do not read or write the analysis cache")
    .option("--graph <mode>", "neighborhood, full, or none")
    .action(async (opts) => {
      const result = await runAnalysis({
        ...baseOptions(opts),
        base: opts.base,
        head: opts.head,
      });
      await emit(result.report, opts.format, opts.output, "affected");
      status.code = exitCodeFor(
        result.report,
        parseFailOn(opts.failOn) ?? "never",
      );
    });

  program
    .command("graph")
    .description(
      "Export the dependency graph. Edges point from importer to dependency.",
    )
    .option("-c, --config <file>", "configuration file")
    .option("-f, --format <format>", "json or text", "json")
    .option("-o, --output <file>", "write the graph document to this path")
    .option("--no-cache", "do not read or write the analysis cache")
    .action(async (opts) => {
      const result = await runAnalysis({ ...baseOptions(opts), graph: "full" });
      const document = result.graph.toJSON();
      const text =
        opts.format === "text"
          ? renderText(result.report)
          : `${JSON.stringify(document, null, 2)}\n`;
      writeOutput(text, opts.output);
      status.code = result.report.summary.partial ? 3 : 0;
    });

  program
    .command("cycles")
    .description("List circular dependency components.")
    .option("-c, --config <file>", "configuration file")
    .option("-f, --format <format>", "text or json", "text")
    .option("-o, --output <file>", "also write the report to this path")
    .option("--strict", "exit 1 when a cycle exists")
    .option("--no-cache", "do not read or write the analysis cache")
    .action(async (opts) => {
      const result = await runAnalysis(baseOptions(opts));
      await emit(result.report, opts.format, opts.output, "affected");
      status.code = result.report.summary.partial
        ? 3
        : opts.strict && result.report.cycles.length > 0
          ? 1
          : 0;
    });

  program
    .command("tests")
    .description(
      "Recommend tests related to changes since --base. Does not run them unless --run is set.",
    )
    .requiredOption("--base <ref>", "base Git revision")
    .option("--head <ref>", "head commit; omit to include uncommitted work")
    .option("-c, --config <file>", "configuration file")
    .option("-f, --format <format>", "text, json, or files", "files")
    .option("-o, --output <file>", "also write the report to this path")
    .option("--no-cache", "do not read or write the analysis cache")
    .option(
      "--run",
      "execute the configured test.command with the recommended test paths appended",
    )
    .action(async (opts) => {
      const result = await runAnalysis({
        ...baseOptions(opts),
        base: opts.base,
        head: opts.head,
        graph: "none",
      });
      await emit(result.report, opts.format, opts.output, "tests");
      if (opts.run) {
        await runConfiguredTests(
          result.config.test.command,
          result.report.tests.map((test) => test.file),
          result.report.repositoryRoot,
        );
      }
      status.code = result.report.summary.partial ? 3 : 0;
    });

  program
    .command("check")
    .description(
      "Run impact analysis and architecture rules. Exit 1 when the failure policy matches.",
    )
    .requiredOption("--base <ref>", "base Git revision")
    .option("--head <ref>", "head commit; omit to include uncommitted work")
    .option("-c, --config <file>", "configuration file")
    .option("-f, --format <format>", "text or json", "text")
    .option("-o, --output <file>", "also write the report to this path")
    .option(
      "--fail-on <policy>",
      "never, error, or warning; overrides ci.failOn",
    )
    .option("--no-cache", "do not read or write the analysis cache")
    .option("--graph <mode>", "neighborhood, full, or none")
    .action(async (opts) => {
      const result = await runAnalysis({
        ...baseOptions(opts),
        base: opts.base,
        head: opts.head,
      });
      await emit(result.report, opts.format, opts.output, "affected");
      status.code = exitCodeFor(
        result.report,
        parseFailOn(opts.failOn) ?? result.failOn,
      );
    });

  program
    .command("init")
    .description(
      "Write a starter impactmap.config.json and explain the supported options.",
    )
    .option("--force", "overwrite an existing configuration file")
    .action((opts) => {
      const target = path.resolve("impactmap.config.json");
      if (fs.existsSync(target) && !opts.force) {
        throw new ImpactMapError(
          `Refusing to overwrite ${target}. Pass --force to replace it.`,
          2,
          "config-exists",
        );
      }
      fs.writeFileSync(target, starterConfigText());
      process.stdout.write(initHelp(target));
      status.code = 0;
    });

  program
    .command("explain")
    .description(
      "Print a deterministic explanation. With --ai, request optional model commentary.",
    )
    .requiredOption("--base <ref>", "base Git revision")
    .option("--head <ref>", "head commit")
    .option("-c, --config <file>", "configuration file")
    .option("--ai", "send the report summary to the configured model endpoint")
    .option("--no-cache", "do not read or write the analysis cache")
    .action(async (opts) => {
      const result = await runAnalysis({
        ...baseOptions(opts),
        base: opts.base,
        head: opts.head,
      });
      process.stdout.write(`${deterministicExplanation(result.report)}\n`);
      if (!opts.ai) {
        status.code = 0;
        return;
      }
      if (!result.config.ai.enabled) {
        throw new ImpactMapError(
          "Pass a configuration with ai.enabled=true before using --ai.",
          2,
          "ai-disabled",
        );
      }
      const payload = buildAiPayload(result.report, result.config, (file) =>
        readTextInside(result.report.repositoryRoot, file),
      );
      process.stderr.write(
        `AI commentary: sending ${transmittedFields(payload).join(", ")} to ${result.config.ai.endpoint}. Source is ${payload.source ? "included" : "not included"}.\n`,
      );
      const commentary = await requestModelCommentary(
        payload,
        result.config,
        globalThis.fetch,
      );
      process.stdout.write(
        `\nModel commentary (not a substitute for the findings above):\n${commentary}\n`,
      );
      status.code = 0;
    });

  program
    .command("comment")
    .description(
      "Publish a pull request comment from a JSON report. Requires GITHUB_TOKEN.",
    )
    .requiredOption("--report <file>", "ImpactMap JSON report")
    .option("--repository <owner/name>", "defaults to GITHUB_REPOSITORY")
    .option(
      "--pr <number>",
      "pull request number; defaults to the GitHub event payload",
    )
    .action(async (opts) => {
      const report = JSON.parse(
        fs.readFileSync(opts.report, "utf8"),
      ) as ImpactReport;
      if (report.version !== "1" || report.tool?.name !== "impactmap") {
        throw new ImpactMapError(
          "The report file is not an ImpactMap version 1 report.",
          2,
          "bad-report",
        );
      }
      const repository = opts.repository ?? process.env.GITHUB_REPOSITORY;
      const pullRequest = opts.pr ? Number(opts.pr) : pullRequestFromEvent();
      const token = process.env.GITHUB_TOKEN ?? "";
      if (!repository)
        throw new ImpactMapError(
          "Set --repository or GITHUB_REPOSITORY.",
          2,
          "bad-repository",
        );
      await publishPullRequestComment({
        token,
        repository,
        pullRequest,
        body: renderPullRequestComment(report),
        ...(process.env.GITHUB_API_URL
          ? { apiUrl: process.env.GITHUB_API_URL }
          : {}),
      });
      process.stdout.write("Published ImpactMap pull request comment.\n");
      status.code = 0;
    });

  program.exitOverride();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version"
      )
        return 0;
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    const formatted = formatError(error);
    process.stderr.write(`${formatted.message}\n`);
    return formatted.exitCode;
  }
  return status.code;

  function baseOptions(opts: {
    config?: string;
    cache?: boolean;
    depth?: number;
    graph?: string;
    failOn?: string;
  }): AnalyzeOptions {
    const graph = parseGraph(opts.graph);
    return {
      cwd: process.cwd(),
      ...(opts.config ? { configPath: opts.config } : {}),
      cache: opts.cache,
      ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
      ...(graph ? { graph } : {}),
      ...(parseFailOn(opts.failOn) ? { failOn: parseFailOn(opts.failOn) } : {}),
    };
  }
}

function integer(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new ImpactMapError(
      "--depth must be an integer from 0 to 100.",
      2,
      "bad-depth",
    );
  }
  return parsed;
}

function parseFailOn(value: string | undefined): FailOn | undefined {
  if (!value) return undefined;
  if (value === "never" || value === "error" || value === "warning")
    return value;
  throw new ImpactMapError(
    "--fail-on must be never, error, or warning.",
    2,
    "bad-fail-on",
  );
}

function parseGraph(
  value: string | undefined,
): "neighborhood" | "full" | "none" | undefined {
  if (!value) return undefined;
  if (value === "neighborhood" || value === "full" || value === "none")
    return value;
  throw new ImpactMapError(
    "--graph must be neighborhood, full, or none.",
    2,
    "bad-graph",
  );
}

async function emit(
  report: ImpactReport,
  format: string,
  output: string | undefined,
  filesKind: "tests" | "affected",
): Promise<void> {
  const text =
    format === "json"
      ? renderJson(report)
      : format === "files"
        ? renderFiles(report, filesKind)
        : format === "text"
          ? renderText(report)
          : undefined;
  if (!text)
    throw new ImpactMapError(
      `Unknown format "${format}". Use text, json, or files.`,
      2,
      "bad-format",
    );
  writeOutput(text, output);
}

function writeOutput(text: string, output?: string): void {
  process.stdout.write(text);
  if (!output) return;
  const resolved = path.resolve(output);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, text);
}

async function runConfiguredTests(
  command: string[] | undefined,
  tests: string[],
  cwd: string,
): Promise<void> {
  if (!command || command.length === 0) {
    throw new ImpactMapError(
      "Configure test.command as an argv array before using --run.",
      2,
      "missing-test-command",
    );
  }
  const [bin, ...args] = command;
  if (!bin)
    throw new ImpactMapError(
      "test.command is empty.",
      2,
      "missing-test-command",
    );
  const { spawn } = await import("node:child_process");
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(bin, [...args, ...tests], {
      cwd,
      shell: false,
      stdio: "inherit",
    });
    child.on("error", (error) =>
      reject(
        new ImpactMapError(
          `Could not run ${bin}. ${error.message}`,
          2,
          "test-command-failed",
        ),
      ),
    );
    child.on("close", (status) => resolve(status ?? 1));
  });
  if (code !== 0)
    throw new ImpactMapError(
      `Test command exited ${code}.`,
      code === 1 ? 1 : 3,
      "test-command-failed",
    );
}

function pullRequestFromEvent(): number {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath)
    throw new ImpactMapError(
      "Set --pr or run inside GitHub Actions.",
      2,
      "bad-pull-request",
    );
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8")) as {
    pull_request?: { number?: unknown };
  };
  const number = event.pull_request?.number;
  if (typeof number !== "number")
    throw new ImpactMapError(
      "The GitHub event has no pull request number.",
      2,
      "bad-pull-request",
    );
  return number;
}

function initHelp(target: string): string {
  return [
    `Wrote ${target}`,
    "",
    "Supported options:",
    "  include, exclude          POSIX globs. Setting either replaces that default list.",
    "  impact.depth              Reverse dependency hops. 1 is direct dependents only.",
    "  impact.includeTypeOnly    Follow TypeScript type-only imports.",
    "  impact.includeDynamic     Follow literal dynamic import() targets.",
    "  test.patterns             Globs that mark a file as a test.",
    "  test.mappings             Explicit test-to-module associations.",
    "  test.command              Argv array used only by `impactmap tests --run`.",
    "  rules                     forbidden-dependency, allowed-dependencies, no-circular,",
    "                            restricted-module, public-api-review.",
    "  ci.failOn                 never, error, or warning. Used by `impactmap check`.",
    "  cache.enabled/directory   Per-file parse cache. Invalidated by content, config, and resolver inputs.",
    "  output.maxFindings/graph  neighborhood, full, or none.",
    "  limits                    maxFiles, maxBytesPerFile, maxTotalBytes, timeoutMs.",
    "  ai.enabled                Off by default. --ai also has to be passed. Source is sent only when ai.includeSource is true.",
    "",
    "Unknown keys are rejected. See docs/configuration.md.",
    "",
  ].join("\n");
}

export function formatError(error: unknown): {
  message: string;
  exitCode: number;
} {
  if (isImpactMapError(error))
    return { message: error.message, exitCode: error.exitCode };
  if (error instanceof Error) return { message: error.message, exitCode: 3 };
  return { message: "Unexpected analysis failure.", exitCode: 3 };
}
