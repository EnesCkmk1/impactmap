import fs from "node:fs";
import path from "node:path";
import type { ImpactMapConfig } from "@impactmap/config";
import type { GraphDiagnostic } from "@impactmap/graph";
import { languageForPath } from "@impactmap/parsers";
import ignore, { type Ignore } from "ignore";
import picomatch from "picomatch";
import { isInside, toPosix } from "./paths.js";

export interface DiscoveredFile {
  path: string;
  language: string;
}

export interface PackageInfo {
  name?: string;
  /** Repository-relative directory. Empty string is the repository root. */
  dir: string;
  main?: string;
  exports?: unknown;
  dependencies: string[];
}

export interface DiscoveryResult {
  files: DiscoveredFile[];
  metadataFiles: string[];
  packages: PackageInfo[];
  skipped: Array<{ path: string; reason: string }>;
  diagnostics: GraphDiagnostic[];
  limitations: string[];
}

const HARD_DIRECTORIES = new Set([".git", "node_modules", ".impactmap"]);

export function discoverRepository(
  root: string,
  config: ImpactMapConfig,
  options: { fileList?: string[]; read?: (file: string) => string | null } = {},
): DiscoveryResult {
  const diagnostics: GraphDiagnostic[] = [];
  const limitations = [
    "Files outside the repository, including symlinks whose real path escapes it, are not read.",
    "node_modules, .git, and .impactmap are never scanned.",
  ];
  const walked = options.fileList
    ? {
        files: options.fileList.map((file) => toPosix(file)),
        escaped: [] as string[],
      }
    : walkRepository(root, diagnostics);

  for (const escaped of walked.escaped) {
    diagnostics.push({
      severity: "warning",
      code: "escaped-symlink",
      message: `Skipped ${escaped} because it resolves outside the repository.`,
      file: escaped,
    });
  }

  const metadataFiles = walked.files.filter(
    (file) => isMetadata(file) && !isHardExcluded(file),
  );
  const packages = readPackages(root, metadataFiles, options.read);
  const skipped: Array<{ path: string; reason: string }> = [];
  const include = config.include.map((pattern) =>
    picomatch(pattern, { dot: true }),
  );
  const exclude = config.exclude.map((pattern) =>
    picomatch(pattern, { dot: true }),
  );
  const files: DiscoveredFile[] = [];

  for (const file of walked.files) {
    if (isHardExcluded(file)) {
      skipped.push({ path: file, reason: "hard-exclude" });
      continue;
    }
    if (exclude.some((match) => match(file))) {
      skipped.push({ path: file, reason: "exclude" });
      continue;
    }
    if (!include.some((match) => match(file))) {
      skipped.push({ path: file, reason: "include" });
      continue;
    }
    const language = languageForPath(file);
    if (language === "unknown") {
      skipped.push({ path: file, reason: "unsupported" });
      continue;
    }
    files.push({ path: file, language });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    metadataFiles: metadataFiles.sort(),
    packages,
    skipped,
    diagnostics,
    limitations,
  };
}

function walkRepository(
  root: string,
  diagnostics: GraphDiagnostic[],
): { files: string[]; escaped: string[] } {
  const rootReal = fs.realpathSync(root);
  const files: string[] = [];
  const escaped: string[] = [];
  const gitignores = new Map<string, Ignore>();
  const visited = new Set<string>();

  const ignored = (relative: string): boolean => {
    const parts = relative.split("/");
    for (let index = 0; index <= parts.length; index += 1) {
      const dir = parts.slice(0, index).join("/");
      const matcher = gitignores.get(dir);
      if (!matcher) continue;
      const rest = parts.slice(index).join("/");
      if (rest && matcher.ignores(rest)) return true;
    }
    return false;
  };

  const recurse = (directory: string, relative: string): void => {
    let real: string;
    try {
      real = fs.realpathSync(directory);
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "unreadable-directory",
        message:
          error instanceof Error ? error.message : "Unreadable directory.",
        file: relative || ".",
      });
      return;
    }
    if (!isInside(rootReal, real)) {
      if (relative) escaped.push(relative);
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);

    const gitignorePath = path.join(directory, ".gitignore");
    if (
      fs.existsSync(gitignorePath) &&
      realpathInsideSafe(rootReal, gitignorePath)
    ) {
      gitignores.set(
        relative,
        ignore().add(fs.readFileSync(gitignorePath, "utf8")),
      );
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "unreadable-directory",
        message:
          error instanceof Error ? error.message : "Unreadable directory.",
        file: relative || ".",
      });
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git" || HARD_DIRECTORIES.has(entry.name)) continue;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const linkReal = realpathInsideSafe(rootReal, absolute);
        if (!linkReal) {
          escaped.push(childRelative);
          continue;
        }
        if (ignored(childRelative)) continue;
        const stat = fs.statSync(linkReal);
        if (stat.isDirectory()) recurse(absolute, childRelative);
        else if (stat.isFile()) files.push(childRelative);
        continue;
      }
      if (ignored(childRelative)) continue;
      if (entry.isDirectory()) recurse(absolute, childRelative);
      else if (entry.isFile()) files.push(childRelative);
    }
  };

  recurse(root, "");
  return { files, escaped };
}

function realpathInsideSafe(rootReal: string, target: string): string | null {
  try {
    const real = fs.realpathSync(target);
    return isInside(rootReal, real) ? real : null;
  } catch {
    return null;
  }
}

function isHardExcluded(file: string): boolean {
  const parts = file.split("/");
  return parts.some((part) => HARD_DIRECTORIES.has(part));
}

function isMetadata(file: string): boolean {
  const base = path.posix.basename(file);
  return (
    base === "package.json" ||
    base === "jsconfig.json" ||
    (base.startsWith("tsconfig") && base.endsWith(".json"))
  );
}

function readPackages(
  root: string,
  metadataFiles: string[],
  read: ((file: string) => string | null) | undefined,
): PackageInfo[] {
  const manifests = metadataFiles.filter(
    (file) => file === "package.json" || file.endsWith("/package.json"),
  );
  const packages: PackageInfo[] = [];
  for (const manifest of manifests) {
    try {
      const text = read ? read(manifest) : readManifest(root, manifest);
      if (text === null || text === undefined) continue;
      packages.push(parsePackage(manifest, text));
    } catch {}
  }
  return packages;
}

function readManifest(root: string, manifest: string): string | null {
  const absolute = path.join(root, manifest);
  if (!realpathInsideSafe(fs.realpathSync(root), absolute)) return null;
  return fs.readFileSync(absolute, "utf8");
}

export function parsePackage(manifestPath: string, text: string): PackageInfo {
  let json: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      json = parsed as Record<string, unknown>;
  } catch {
    json = {};
  }
  const dirName = path.posix.dirname(manifestPath);
  const dependencies = {
    ...record(json.dependencies),
    ...record(json.peerDependencies),
    ...record(json.optionalDependencies),
  };
  return {
    ...(typeof json.name === "string" ? { name: json.name } : {}),
    dir: dirName === "." ? "" : dirName,
    ...(typeof json.main === "string" ? { main: json.main } : {}),
    ...(json.exports !== undefined ? { exports: json.exports } : {}),
    dependencies: Object.keys(dependencies).sort(),
  };
}

function record(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") output[key] = item;
  }
  return output;
}

export function packageNameFor(
  file: string,
  packages: PackageInfo[],
): string | undefined {
  let best: PackageInfo | undefined;
  for (const pkg of packages) {
    if (!pkg.name) continue;
    const matches =
      pkg.dir === "" || file === pkg.dir || file.startsWith(`${pkg.dir}/`);
    if (!matches) continue;
    if (!best || pkg.dir.length > best.dir.length) best = pkg;
  }
  return best?.name;
}
