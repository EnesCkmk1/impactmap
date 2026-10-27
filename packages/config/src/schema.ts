/**
 * ImpactMap configuration.
 *
 * Only fields validated here are supported. Unknown keys are rejected so the file
 * cannot advertise behavior the engine does not implement.
 */

export type Severity = "warning" | "error";
export type FailOn = "never" | "error" | "warning";

export interface TestMapping {
  name?: string;
  tests: string[];
  modules: string[];
}

export interface ForbiddenDependencyRule {
  name: string;
  severity: Severity;
  description?: string;
  type: "forbidden-dependency";
  /** Globs matched against the importing file. */
  from: string[];
  /** Globs matched against the imported file or `external:<package>` id. */
  to: string[];
}

export interface AllowedDependenciesRule {
  name: string;
  severity: Severity;
  description?: string;
  type: "allowed-dependencies";
  from: string[];
  /** Dependency targets the matched importers may use. Anything else is a violation. */
  allow: string[];
}

export interface NoCircularRule {
  name: string;
  severity: Severity;
  description?: string;
  type: "no-circular";
  /**
   * When set, a cycle is reported only if every member matches at least one pattern.
   * When omitted, every project cycle is reported.
   */
  within?: string[];
}

export interface RestrictedModuleRule {
  name: string;
  severity: Severity;
  description?: string;
  type: "restricted-module";
  /** Files that other modules must not import. */
  modules: string[];
  /** Importers that are forbidden from depending on `modules`. */
  importers: string[];
}

export interface PublicApiReviewRule {
  name: string;
  severity: Severity;
  description?: string;
  type: "public-api-review";
  /** Entry files whose exported declaration text should be reviewed when it changes. */
  files: string[];
}

export type ArchitectureRule =
  | ForbiddenDependencyRule
  | AllowedDependenciesRule
  | NoCircularRule
  | RestrictedModuleRule
  | PublicApiReviewRule;

export interface ImpactMapConfig {
  /**
   * POSIX glob patterns. A file is analyzed when it matches any include pattern.
   * Replaces the default include set.
   */
  include: string[];
  /**
   * POSIX glob patterns. Replaces the default soft excludes.
   * `.git`, `node_modules`, and `.impactmap` are always excluded.
   */
  exclude: string[];
  test: {
    patterns: string[];
    mappings: TestMapping[];
    /**
     * Argv of an existing test command. ImpactMap appends selected test paths.
     * Executed only when `impactmap tests --run` is used. Never invoked by analysis.
     */
    command?: string[];
  };
  impact: {
    /** Maximum reverse-dependency hops. `1` keeps direct dependents only. */
    depth: number;
    includeTypeOnly: boolean;
    includeDynamic: boolean;
  };
  rules: ArchitectureRule[];
  ci: {
    failOn: FailOn;
  };
  cache: {
    enabled: boolean;
    /** Repository-relative directory. */
    directory: string;
  };
  output: {
    maxFindings: number;
    /** `neighborhood` exports changed files, affected files, and edges between them. */
    graph: "neighborhood" | "full" | "none";
  };
  limits: {
    maxFiles: number;
    maxBytesPerFile: number;
    maxTotalBytes: number;
    timeoutMs: number;
  };
  ai: {
    /** Off unless a user sets this and passes `--ai`. */
    enabled: boolean;
    endpoint?: string;
    model?: string;
    /**
     * When false, only the structured report summary is eligible to be sent.
     * Source text is never sent unless this is true.
     */
    includeSource: boolean;
    maxSourceBytes: number;
  };
}

export interface ConfigDiagnostic {
  path: string;
  message: string;
}

export class ConfigError extends Error {
  readonly diagnostics: ConfigDiagnostic[];

  constructor(diagnostics: ConfigDiagnostic[]) {
    super(
      diagnostics.map((item) => `${item.path}: ${item.message}`).join("\n"),
    );
    this.name = "ConfigError";
    this.diagnostics = diagnostics;
  }
}

export const DEFAULT_INCLUDE = [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "**/*.mjs",
  "**/*.cjs",
  "**/*.mts",
  "**/*.cts",
  "**/*.py",
];

export const DEFAULT_EXCLUDE = [
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.venv/**",
  "**/venv/**",
  "**/*.min.js",
];

export const DEFAULT_TEST_PATTERNS = [
  "**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}",
  "**/__tests__/**/*.{ts,tsx,js,jsx,mjs,cjs}",
  "**/test_*.py",
  "**/*_test.py",
];

export function defaultConfig(): ImpactMapConfig {
  return {
    include: [...DEFAULT_INCLUDE],
    exclude: [...DEFAULT_EXCLUDE],
    test: {
      patterns: [...DEFAULT_TEST_PATTERNS],
      mappings: [],
    },
    impact: {
      depth: 8,
      includeTypeOnly: true,
      includeDynamic: true,
    },
    rules: [],
    ci: { failOn: "error" },
    cache: { enabled: true, directory: ".impactmap/cache" },
    output: { maxFindings: 1000, graph: "neighborhood" },
    limits: {
      maxFiles: 20_000,
      maxBytesPerFile: 2_000_000,
      maxTotalBytes: 200_000_000,
      timeoutMs: 120_000,
    },
    ai: {
      enabled: false,
      includeSource: false,
      maxSourceBytes: 8_000,
    },
  };
}

const RULE_TYPES = new Set([
  "forbidden-dependency",
  "allowed-dependencies",
  "no-circular",
  "restricted-module",
  "public-api-review",
]);

export function validateConfig(input: unknown): ImpactMapConfig {
  const diagnostics: ConfigDiagnostic[] = [];
  const base = defaultConfig();
  if (input === undefined) return base;
  if (!isRecord(input)) {
    throw new ConfigError([
      { path: "$", message: "Configuration must be a JSON object." },
    ]);
  }

  const allowedRoot = new Set([
    "include",
    "exclude",
    "test",
    "impact",
    "rules",
    "ci",
    "cache",
    "output",
    "limits",
    "ai",
  ]);
  rejectUnknown(input, allowedRoot, "$", diagnostics);

  if (input.include !== undefined)
    base.include = readStringArray(input.include, "include", diagnostics);
  if (input.exclude !== undefined)
    base.exclude = readStringArray(input.exclude, "exclude", diagnostics);

  if (input.test !== undefined) {
    if (!isRecord(input.test)) {
      diagnostics.push({ path: "test", message: "Expected an object." });
    } else {
      rejectUnknown(
        input.test,
        new Set(["patterns", "mappings", "command"]),
        "test",
        diagnostics,
      );
      if (input.test.patterns !== undefined) {
        base.test.patterns = readStringArray(
          input.test.patterns,
          "test.patterns",
          diagnostics,
        );
      }
      if (input.test.command !== undefined) {
        base.test.command = readStringArray(
          input.test.command,
          "test.command",
          diagnostics,
        );
        if (base.test.command && base.test.command.length === 0) {
          diagnostics.push({
            path: "test.command",
            message: "Command argv must not be empty.",
          });
        }
      }
      if (input.test.mappings !== undefined) {
        base.test.mappings = readMappings(input.test.mappings, diagnostics);
      }
    }
  }

  if (input.impact !== undefined) {
    if (!isRecord(input.impact)) {
      diagnostics.push({ path: "impact", message: "Expected an object." });
    } else {
      rejectUnknown(
        input.impact,
        new Set(["depth", "includeTypeOnly", "includeDynamic"]),
        "impact",
        diagnostics,
      );
      if (input.impact.depth !== undefined) {
        base.impact.depth = readInteger(
          input.impact.depth,
          "impact.depth",
          diagnostics,
          0,
          100,
        );
      }
      if (input.impact.includeTypeOnly !== undefined) {
        base.impact.includeTypeOnly = readBoolean(
          input.impact.includeTypeOnly,
          "impact.includeTypeOnly",
          diagnostics,
        );
      }
      if (input.impact.includeDynamic !== undefined) {
        base.impact.includeDynamic = readBoolean(
          input.impact.includeDynamic,
          "impact.includeDynamic",
          diagnostics,
        );
      }
    }
  }

  if (input.rules !== undefined)
    base.rules = readRules(input.rules, diagnostics);

  if (input.ci !== undefined) {
    if (!isRecord(input.ci))
      diagnostics.push({ path: "ci", message: "Expected an object." });
    else {
      rejectUnknown(input.ci, new Set(["failOn"]), "ci", diagnostics);
      if (input.ci.failOn !== undefined) {
        base.ci.failOn = readEnum(
          input.ci.failOn,
          "ci.failOn",
          ["never", "error", "warning"],
          diagnostics,
        );
      }
    }
  }

  if (input.cache !== undefined) {
    if (!isRecord(input.cache))
      diagnostics.push({ path: "cache", message: "Expected an object." });
    else {
      rejectUnknown(
        input.cache,
        new Set(["enabled", "directory"]),
        "cache",
        diagnostics,
      );
      if (input.cache.enabled !== undefined) {
        base.cache.enabled = readBoolean(
          input.cache.enabled,
          "cache.enabled",
          diagnostics,
        );
      }
      if (input.cache.directory !== undefined) {
        base.cache.directory = readString(
          input.cache.directory,
          "cache.directory",
          diagnostics,
        );
        if (
          base.cache.directory.startsWith("/") ||
          base.cache.directory.split("/").includes("..")
        ) {
          diagnostics.push({
            path: "cache.directory",
            message:
              "Cache directory must be a relative path inside the repository.",
          });
        }
      }
    }
  }

  if (input.output !== undefined) {
    if (!isRecord(input.output))
      diagnostics.push({ path: "output", message: "Expected an object." });
    else {
      rejectUnknown(
        input.output,
        new Set(["maxFindings", "graph"]),
        "output",
        diagnostics,
      );
      if (input.output.maxFindings !== undefined) {
        base.output.maxFindings = readInteger(
          input.output.maxFindings,
          "output.maxFindings",
          diagnostics,
          1,
          100_000,
        );
      }
      if (input.output.graph !== undefined) {
        base.output.graph = readEnum(
          input.output.graph,
          "output.graph",
          ["neighborhood", "full", "none"],
          diagnostics,
        );
      }
    }
  }

  if (input.limits !== undefined) {
    if (!isRecord(input.limits))
      diagnostics.push({ path: "limits", message: "Expected an object." });
    else {
      rejectUnknown(
        input.limits,
        new Set(["maxFiles", "maxBytesPerFile", "maxTotalBytes", "timeoutMs"]),
        "limits",
        diagnostics,
      );
      if (input.limits.maxFiles !== undefined) {
        base.limits.maxFiles = readInteger(
          input.limits.maxFiles,
          "limits.maxFiles",
          diagnostics,
          1,
          1_000_000,
        );
      }
      if (input.limits.maxBytesPerFile !== undefined) {
        base.limits.maxBytesPerFile = readInteger(
          input.limits.maxBytesPerFile,
          "limits.maxBytesPerFile",
          diagnostics,
          1,
          50_000_000,
        );
      }
      if (input.limits.maxTotalBytes !== undefined) {
        base.limits.maxTotalBytes = readInteger(
          input.limits.maxTotalBytes,
          "limits.maxTotalBytes",
          diagnostics,
          1,
          5_000_000_000,
        );
      }
      if (input.limits.timeoutMs !== undefined) {
        base.limits.timeoutMs = readInteger(
          input.limits.timeoutMs,
          "limits.timeoutMs",
          diagnostics,
          1,
          3_600_000,
        );
      }
    }
  }

  if (input.ai !== undefined) {
    if (!isRecord(input.ai))
      diagnostics.push({ path: "ai", message: "Expected an object." });
    else {
      rejectUnknown(
        input.ai,
        new Set([
          "enabled",
          "endpoint",
          "model",
          "includeSource",
          "maxSourceBytes",
        ]),
        "ai",
        diagnostics,
      );
      if (input.ai.enabled !== undefined)
        base.ai.enabled = readBoolean(
          input.ai.enabled,
          "ai.enabled",
          diagnostics,
        );
      if (input.ai.endpoint !== undefined)
        base.ai.endpoint = readString(
          input.ai.endpoint,
          "ai.endpoint",
          diagnostics,
        );
      if (input.ai.model !== undefined)
        base.ai.model = readString(input.ai.model, "ai.model", diagnostics);
      if (input.ai.includeSource !== undefined) {
        base.ai.includeSource = readBoolean(
          input.ai.includeSource,
          "ai.includeSource",
          diagnostics,
        );
      }
      if (input.ai.maxSourceBytes !== undefined) {
        base.ai.maxSourceBytes = readInteger(
          input.ai.maxSourceBytes,
          "ai.maxSourceBytes",
          diagnostics,
          0,
          1_000_000,
        );
      }
    }
  }

  if (diagnostics.length > 0) throw new ConfigError(diagnostics);
  return base;
}

export function starterConfigText(): string {
  return `{
  "include": ${JSON.stringify(DEFAULT_INCLUDE, null, 2).replace(/\n/g, "\n  ")},
  "exclude": ${JSON.stringify(DEFAULT_EXCLUDE, null, 2).replace(/\n/g, "\n  ")},
  "impact": {
    "depth": 8,
    "includeTypeOnly": true,
    "includeDynamic": true
  },
  "test": {
    "patterns": ${JSON.stringify(DEFAULT_TEST_PATTERNS, null, 2).replace(/\n/g, "\n    ")},
    "mappings": [
      {
        "name": "auth",
        "tests": ["tests/auth/**"],
        "modules": ["src/auth/**"]
      }
    ],
    "command": ["npm", "test", "--"]
  },
  "rules": [
    {
      "name": "domain-does-not-import-infra",
      "severity": "error",
      "type": "forbidden-dependency",
      "from": ["src/domain/**"],
      "to": ["src/infra/**"],
      "description": "Domain modules must not depend on infrastructure implementations."
    },
    {
      "name": "no-cycles",
      "severity": "warning",
      "type": "no-circular",
      "within": ["src/**"]
    },
    {
      "name": "web-cannot-import-secrets",
      "severity": "error",
      "type": "restricted-module",
      "modules": ["src/server/secrets.ts"],
      "importers": ["src/web/**"]
    },
    {
      "name": "public-api-review",
      "severity": "warning",
      "type": "public-api-review",
      "files": ["src/index.ts"]
    }
  ],
  "ci": { "failOn": "error" },
  "cache": { "enabled": true, "directory": ".impactmap/cache" },
  "ai": { "enabled": false, "includeSource": false }
}
`;
}

function readRules(
  value: unknown,
  diagnostics: ConfigDiagnostic[],
): ArchitectureRule[] {
  if (!Array.isArray(value)) {
    diagnostics.push({ path: "rules", message: "Expected an array." });
    return [];
  }
  const rules: ArchitectureRule[] = [];
  value.forEach((entry, index) => {
    const path = `rules[${index}]`;
    if (!isRecord(entry)) {
      diagnostics.push({ path, message: "Expected an object." });
      return;
    }
    const type = entry.type;
    if (typeof type !== "string" || !RULE_TYPES.has(type)) {
      diagnostics.push({
        path: `${path}.type`,
        message: `Expected one of ${[...RULE_TYPES].join(", ")}.`,
      });
      return;
    }
    const name = readString(entry.name, `${path}.name`, diagnostics);
    const severity = readEnum(
      entry.severity,
      `${path}.severity`,
      ["warning", "error"],
      diagnostics,
    );
    const description =
      entry.description === undefined
        ? undefined
        : readString(entry.description, `${path}.description`, diagnostics);
    if (!name || !severity) return;

    if (type === "forbidden-dependency") {
      rejectUnknown(
        entry,
        new Set(["name", "severity", "description", "type", "from", "to"]),
        path,
        diagnostics,
      );
      const from = readStringArray(entry.from, `${path}.from`, diagnostics);
      const to = readStringArray(entry.to, `${path}.to`, diagnostics);
      if (from.length === 0 || to.length === 0) {
        diagnostics.push({
          path,
          message: "forbidden-dependency requires non-empty from and to globs.",
        });
        return;
      }
      rules.push({
        name,
        severity,
        type,
        from,
        to,
        ...(description ? { description } : {}),
      });
    } else if (type === "allowed-dependencies") {
      rejectUnknown(
        entry,
        new Set(["name", "severity", "description", "type", "from", "allow"]),
        path,
        diagnostics,
      );
      const from = readStringArray(entry.from, `${path}.from`, diagnostics);
      const allow = readStringArray(entry.allow, `${path}.allow`, diagnostics);
      if (from.length === 0) {
        diagnostics.push({
          path,
          message: "allowed-dependencies requires a non-empty from list.",
        });
        return;
      }
      rules.push({
        name,
        severity,
        type,
        from,
        allow,
        ...(description ? { description } : {}),
      });
    } else if (type === "no-circular") {
      rejectUnknown(
        entry,
        new Set(["name", "severity", "description", "type", "within"]),
        path,
        diagnostics,
      );
      const rule: NoCircularRule = {
        name,
        severity,
        type,
        ...(description ? { description } : {}),
      };
      if (entry.within !== undefined)
        rule.within = readStringArray(
          entry.within,
          `${path}.within`,
          diagnostics,
        );
      rules.push(rule);
    } else if (type === "restricted-module") {
      rejectUnknown(
        entry,
        new Set([
          "name",
          "severity",
          "description",
          "type",
          "modules",
          "importers",
        ]),
        path,
        diagnostics,
      );
      const modules = readStringArray(
        entry.modules,
        `${path}.modules`,
        diagnostics,
      );
      const importers = readStringArray(
        entry.importers,
        `${path}.importers`,
        diagnostics,
      );
      if (modules.length === 0 || importers.length === 0) {
        diagnostics.push({
          path,
          message: "restricted-module requires modules and importers.",
        });
        return;
      }
      rules.push({
        name,
        severity,
        type,
        modules,
        importers,
        ...(description ? { description } : {}),
      });
    } else if (type === "public-api-review") {
      rejectUnknown(
        entry,
        new Set(["name", "severity", "description", "type", "files"]),
        path,
        diagnostics,
      );
      const files = readStringArray(entry.files, `${path}.files`, diagnostics);
      if (files.length === 0) {
        diagnostics.push({
          path,
          message: "public-api-review requires files.",
        });
        return;
      }
      rules.push({
        name,
        severity,
        type,
        files,
        ...(description ? { description } : {}),
      });
    }
  });
  return rules;
}

function readMappings(
  value: unknown,
  diagnostics: ConfigDiagnostic[],
): TestMapping[] {
  if (!Array.isArray(value)) {
    diagnostics.push({ path: "test.mappings", message: "Expected an array." });
    return [];
  }
  const mappings: TestMapping[] = [];
  value.forEach((entry, index) => {
    const path = `test.mappings[${index}]`;
    if (!isRecord(entry)) {
      diagnostics.push({ path, message: "Expected an object." });
      return;
    }
    rejectUnknown(
      entry,
      new Set(["name", "tests", "modules"]),
      path,
      diagnostics,
    );
    const tests = readStringArray(entry.tests, `${path}.tests`, diagnostics);
    const modules = readStringArray(
      entry.modules,
      `${path}.modules`,
      diagnostics,
    );
    if (tests.length === 0 || modules.length === 0) {
      diagnostics.push({
        path,
        message: "Mapping requires tests and modules.",
      });
      return;
    }
    const mapping: TestMapping = { tests, modules };
    if (entry.name !== undefined)
      mapping.name = readString(entry.name, `${path}.name`, diagnostics);
    mappings.push(mapping);
  });
  return mappings;
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  diagnostics: ConfigDiagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push({
        path: path === "$" ? key : `${path}.${key}`,
        message: `Unknown configuration key. Supported keys: ${[...allowed].sort().join(", ")}.`,
      });
    }
  }
}

function readStringArray(
  value: unknown,
  path: string,
  diagnostics: ConfigDiagnostic[],
): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    diagnostics.push({
      path,
      message: "Expected an array of non-empty strings.",
    });
    return [];
  }
  return value;
}

function readString(
  value: unknown,
  path: string,
  diagnostics: ConfigDiagnostic[],
): string {
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push({ path, message: "Expected a non-empty string." });
    return "";
  }
  return value;
}

function readBoolean(
  value: unknown,
  path: string,
  diagnostics: ConfigDiagnostic[],
): boolean {
  if (typeof value !== "boolean") {
    diagnostics.push({ path, message: "Expected a boolean." });
    return false;
  }
  return value;
}

function readInteger(
  value: unknown,
  path: string,
  diagnostics: ConfigDiagnostic[],
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    diagnostics.push({
      path,
      message: `Expected an integer from ${min} to ${max}.`,
    });
    return min;
  }
  return value;
}

function readEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  diagnostics: ConfigDiagnostic[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    diagnostics.push({
      path,
      message: `Expected one of ${allowed.join(", ")}.`,
    });
    return allowed[0] as T;
  }
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
