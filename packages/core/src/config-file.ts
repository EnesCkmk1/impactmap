import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ConfigError,
  defaultConfig,
  type ImpactMapConfig,
  validateConfig,
} from "@impactmap/config";
import ts from "typescript";
import { ImpactMapError } from "./errors.js";
import { isInside, realpathInside } from "./paths.js";

const CANDIDATES = [
  "impactmap.config.json",
  "impactmap.config.mjs",
  "impactmap.config.ts",
  "impactmap.config.cjs",
  "impactmap.config.js",
];

export async function loadImpactConfig(
  repoRoot: string,
  explicitPath?: string,
): Promise<{ config: ImpactMapConfig; path?: string }> {
  const selected = explicitPath
    ? path.resolve(repoRoot, explicitPath)
    : findConfig(repoRoot);
  if (!selected) return { config: defaultConfig() };
  if (!isInside(repoRoot, selected)) {
    throw new ImpactMapError(
      "Configuration path must stay inside the repository.",
      2,
      "config-escapes",
    );
  }
  const real = realpathInside(repoRoot, selected);
  if (!real) {
    throw new ImpactMapError(
      `Configuration file was not found: ${explicitPath ?? selected}`,
      2,
      "config-missing",
    );
  }
  const extension = path.extname(real);
  if (
    extension !== ".json" &&
    process.env.IMPACTMAP_DISABLE_CODE_CONFIG === "1"
  ) {
    throw new ImpactMapError(
      "Refusing to execute a JavaScript or TypeScript configuration. Use impactmap.config.json, or unset IMPACTMAP_DISABLE_CODE_CONFIG to run a code config with this process's privileges.",
      2,
      "code-config-disabled",
    );
  }
  try {
    const value =
      extension === ".json"
        ? JSON.parse(fs.readFileSync(real, "utf8"))
        : await importConfigModule(real);
    return {
      config: validateConfig(value),
      path: path.relative(repoRoot, real) || path.basename(real),
    };
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new ImpactMapError(error.message, 2, "config-invalid");
    }
    if (error instanceof ImpactMapError) throw error;
    if (error instanceof SyntaxError) {
      throw new ImpactMapError(
        `Configuration file is not valid JSON.\n${error.message}`,
        2,
        "config-invalid",
      );
    }
    throw new ImpactMapError(
      error instanceof Error
        ? `Failed to load configuration.\n${error.message}`
        : "Failed to load configuration.",
      2,
      "config-invalid",
    );
  }
}

function findConfig(repoRoot: string): string | undefined {
  for (const candidate of CANDIDATES) {
    const absolute = path.join(repoRoot, candidate);
    if (fs.existsSync(absolute)) return absolute;
  }
  return undefined;
}

async function importConfigModule(file: string): Promise<unknown> {
  let modulePath = file;
  let temporary: string | undefined;
  if (file.endsWith(".ts")) {
    const source = fs.readFileSync(file, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        isolatedModules: true,
      },
      fileName: file,
    }).outputText;
    temporary = path.join(
      os.tmpdir(),
      `impactmap-config-${process.pid}-${Date.now()}.mjs`,
    );
    fs.writeFileSync(temporary, compiled);
    modulePath = temporary;
  }
  try {
    const imported = (await import(pathToFileURL(modulePath).href)) as {
      default?: unknown;
      config?: unknown;
    };
    const value = imported.default ?? imported.config;
    if (value === undefined) {
      throw new ImpactMapError(
        "Configuration module must default-export an object or export a config object.",
        2,
        "config-invalid",
      );
    }
    return value;
  } finally {
    if (temporary) fs.rmSync(temporary, { force: true });
  }
}
