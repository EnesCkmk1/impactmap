import path from "node:path";
import ts from "typescript";
import type { PackageInfo } from "./discover.js";
import { toPosix } from "./paths.js";

export interface LoadedTsconfig {
  file: string;
  dir: string;
  options: ts.CompilerOptions;
}

export interface Resolution {
  status: "resolved" | "external" | "unresolved" | "deleted";
  target: string;
  packageName?: string;
  resolvedBy:
    | "relative"
    | "paths"
    | "workspace"
    | "typescript"
    | "python"
    | "external"
    | "deleted"
    | "unresolved";
}

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".d.ts",
  ".py",
  ".json",
];

export function loadTsconfigFile(
  root: string,
  relativeFile: string,
  read: (file: string) => string | null,
): LoadedTsconfig | null {
  const absolute = path.join(root, relativeFile);
  const source = read(relativeFile);
  if (source === null) return null;
  const parsedJson = ts.parseConfigFileTextToJson(absolute, source);
  if (parsedJson.error || !parsedJson.config) return null;
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    readDirectory: ts.sys.readDirectory,
    fileExists: (file) => {
      const relative = toPosix(path.relative(root, file));
      return read(relative) !== null || ts.sys.fileExists(file);
    },
    readFile: (file) => {
      const relative = toPosix(path.relative(root, file));
      return read(relative) ?? ts.sys.readFile(file);
    },
  };
  const parsed = ts.parseJsonConfigFileContent(
    parsedJson.config,
    host,
    path.dirname(absolute),
    undefined,
    absolute,
  );
  return {
    file: relativeFile,
    dir:
      path.posix.dirname(relativeFile) === "."
        ? ""
        : path.posix.dirname(relativeFile),
    options: parsed.options,
  };
}

export function nearestTsconfig(
  file: string,
  configs: LoadedTsconfig[],
): LoadedTsconfig | undefined {
  let current = path.posix.dirname(file);
  if (current === ".") current = "";
  while (true) {
    const found = configs.find((config) => config.dir === current);
    if (found) return found;
    if (current === "") break;
    const parent = path.posix.dirname(current);
    current = parent === "." || parent === current ? "" : parent;
  }
  return undefined;
}

export function createResolutionHost(
  root: string,
  files: Set<string>,
  read: (file: string) => string | null,
): ts.ModuleResolutionHost {
  const rootResolved = path.resolve(root);
  const asRelative = (fileName: string): string => {
    const relative = path.isAbsolute(fileName)
      ? path.relative(rootResolved, fileName)
      : fileName;
    return toPosix(relative);
  };
  const inside = (fileName: string): boolean => {
    if (!path.isAbsolute(fileName))
      return !asRelative(fileName).startsWith("..");
    const relative = path.relative(rootResolved, fileName);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  };

  return {
    fileExists: (fileName) => {
      if (!inside(fileName)) return false;
      const relative = asRelative(fileName);
      if (files.has(relative) || read(relative) !== null) return true;
      return false;
    },
    readFile: (fileName) => {
      if (!inside(fileName)) return undefined;
      const relative = asRelative(fileName);
      const text = read(relative);
      return text ?? undefined;
    },
    directoryExists: (directory) => {
      if (!inside(directory)) return false;
      const relative = asRelative(directory);
      const prefix = relative === "" || relative === "." ? "" : `${relative}/`;
      if (prefix === "") return true;
      for (const file of files) {
        if (file.startsWith(prefix)) return true;
      }
      return false;
    },
    getCurrentDirectory: () => rootResolved,
    realpath: (fileName) => fileName,
    getDirectories: (directory) => {
      if (!inside(directory)) return [];
      const relative = asRelative(directory);
      const prefix = relative === "" || relative === "." ? "" : `${relative}/`;
      const children = new Set<string>();
      for (const file of files) {
        if (prefix && !file.startsWith(prefix)) continue;
        const rest = prefix ? file.slice(prefix.length) : file;
        const child = rest.split("/")[0];
        if (child && rest.includes("/")) children.add(child);
      }
      return [...children];
    },
  };
}

export function resolveSpecifier(input: {
  from: string;
  specifier: string;
  language: string;
  files: Set<string>;
  deleted: Set<string>;
  packages: PackageInfo[];
  tsconfig?: LoadedTsconfig;
  host: ts.ModuleResolutionHost;
  root: string;
  names?: string[];
}): Resolution {
  if (input.specifier === "<non-literal>") {
    return {
      status: "unresolved",
      target: "unresolved:<non-literal>",
      resolvedBy: "unresolved",
    };
  }
  if (input.language === "python") return resolvePython(input);

  if (input.specifier.startsWith(".")) {
    if (escapesRepository(input.from, input.specifier)) {
      return {
        status: "unresolved",
        target: `unresolved:${input.specifier}`,
        resolvedBy: "unresolved",
      };
    }
    const relative = resolveCandidates(
      relativeBase(input.from, input.specifier),
      input.files,
      input.deleted,
    );
    if (relative) return relative;
  }

  const workspace = resolveWorkspace(
    input.specifier,
    input.packages,
    input.files,
    input.deleted,
  );
  if (workspace) return workspace;

  const mapped = mappedBases(input.specifier, input.tsconfig, input.root);
  for (const base of mapped) {
    const found = resolveCandidates(base, input.files, input.deleted);
    if (found)
      return {
        ...found,
        resolvedBy: found.status === "deleted" ? "deleted" : "paths",
      };
  }

  const typescriptResolved = resolveWithTypeScript(input);
  if (typescriptResolved) return typescriptResolved;

  if (!input.specifier.startsWith(".")) {
    const packageName = externalPackageName(input.specifier);
    return {
      status: "external",
      target: `external:${packageName}`,
      packageName,
      resolvedBy: "external",
    };
  }
  return {
    status: "unresolved",
    target: `unresolved:${input.specifier}`,
    resolvedBy: "unresolved",
  };
}

function resolvePython(input: {
  from: string;
  specifier: string;
  files: Set<string>;
  deleted: Set<string>;
  names?: string[];
}): Resolution {
  if (input.specifier.startsWith(".")) {
    const bases = pythonRelativeBases(
      input.from,
      input.specifier,
      input.names ?? [],
    );
    for (const base of bases) {
      if (base.startsWith("..")) {
        return {
          status: "unresolved",
          target: `unresolved:${input.specifier}`,
          resolvedBy: "unresolved",
        };
      }
      const found = matchPython(base, input.files, input.deleted);
      if (found) return found;
    }
    return {
      status: "unresolved",
      target: `unresolved:${input.specifier}`,
      resolvedBy: "unresolved",
    };
  }
  const asPath = input.specifier.replace(/\./g, "/");
  const found = matchPython(asPath, input.files, input.deleted);
  if (found) return found;
  const top = input.specifier.split(".")[0] ?? input.specifier;
  return {
    status: "external",
    target: `external:${top}`,
    packageName: top,
    resolvedBy: "external",
  };
}

function pythonRelativeBases(
  from: string,
  specifier: string,
  names: string[],
): string[] {
  let dots = 0;
  while (specifier[dots] === ".") dots += 1;
  const rest = specifier.slice(dots);
  let dir = path.posix.dirname(from);
  if (dir === ".") dir = "";
  for (let index = 1; index < dots; index += 1) {
    if (dir === "") return [".."];
    const parent = path.posix.dirname(dir);
    dir = parent === "." ? "" : parent;
  }
  const bases: string[] = [];
  if (rest)
    bases.push(
      path.posix.normalize(path.posix.join(dir, rest.replace(/\./g, "/"))),
    );
  else {
    for (const name of names) {
      if (name === "*") continue;
      bases.push(path.posix.normalize(path.posix.join(dir, name)));
    }
    bases.push(dir);
  }
  return bases;
}

function matchPython(
  base: string,
  files: Set<string>,
  deleted: Set<string>,
): Resolution | null {
  const candidates = [
    `${base}.py`,
    path.posix.join(base, "__init__.py"),
  ].filter((candidate) => !candidate.startsWith("/"));
  return resolveCandidatesList(candidates, files, deleted, "python");
}

function resolveWithTypeScript(input: {
  from: string;
  specifier: string;
  files: Set<string>;
  root: string;
  tsconfig?: LoadedTsconfig;
  host: ts.ModuleResolutionHost;
}): Resolution | null {
  const options: ts.CompilerOptions = {
    ...(input.tsconfig?.options ?? {}),
    moduleResolution:
      input.tsconfig?.options.moduleResolution ??
      ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    baseUrl: input.tsconfig?.options.baseUrl,
  };
  const containing = path.join(input.root, input.from);
  const resolved = ts.resolveModuleName(
    input.specifier,
    containing,
    options,
    input.host,
  );
  const fileName = resolved.resolvedModule?.resolvedFileName;
  if (!fileName) return null;
  const relative = toPosix(path.relative(input.root, fileName));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (relative.split("/").includes("node_modules")) {
    const packageName =
      packageNameFromNodeModules(relative) ??
      externalPackageName(input.specifier);
    return {
      status: "external",
      target: `external:${packageName}`,
      packageName,
      resolvedBy: "typescript",
    };
  }
  if (!input.files.has(relative)) return null;
  return { status: "resolved", target: relative, resolvedBy: "typescript" };
}

function packageNameFromNodeModules(relative: string): string | undefined {
  const parts = relative.split("/");
  const index = parts.lastIndexOf("node_modules");
  const scope = parts[index + 1];
  const name = parts[index + 2];
  if (!scope) return undefined;
  if (scope.startsWith("@") && name) return `${scope}/${name}`;
  return scope;
}

function mappedBases(
  specifier: string,
  tsconfig: LoadedTsconfig | undefined,
  root: string,
): string[] {
  const paths = tsconfig?.options.paths;
  if (!paths) return [];
  const baseUrlOption = tsconfig.options.baseUrl;
  const baseUrl = baseUrlOption
    ? toPosix(
        path.isAbsolute(baseUrlOption)
          ? path.relative(root, baseUrlOption)
          : baseUrlOption,
      )
    : tsconfig.dir;
  const bases: string[] = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    const star = pattern.indexOf("*");
    for (const target of targets) {
      if (star === -1) {
        if (specifier === pattern) bases.push(normalizeJoined(baseUrl, target));
        continue;
      }
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
        const middle = specifier.slice(
          prefix.length,
          specifier.length - suffix.length,
        );
        bases.push(normalizeJoined(baseUrl, target.replace("*", middle)));
      }
    }
  }
  return bases;
}

function resolveWorkspace(
  specifier: string,
  packages: PackageInfo[],
  files: Set<string>,
  deleted: Set<string>,
): Resolution | null {
  const named = packages
    .filter(
      (pkg): pkg is PackageInfo & { name: string } =>
        typeof pkg.name === "string",
    )
    .sort((a, b) => b.name.length - a.name.length);
  for (const pkg of named) {
    if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`))
      continue;
    const sub =
      specifier === pkg.name
        ? "."
        : `./${specifier.slice(pkg.name.length + 1)}`;
    const relativeTarget = packageSubpath(pkg, sub);
    if (!relativeTarget) continue;
    const base = path.posix.normalize(path.posix.join(pkg.dir, relativeTarget));
    const found = resolveCandidates(base, files, deleted);
    if (found) {
      return {
        ...found,
        packageName: pkg.name,
        resolvedBy: found.status === "deleted" ? "deleted" : "workspace",
      };
    }
  }
  return null;
}

function packageSubpath(pkg: PackageInfo, sub: string): string | null {
  const exportsField = pkg.exports;
  if (typeof exportsField === "string" && sub === ".")
    return stripRelative(exportsField);
  if (
    exportsField &&
    typeof exportsField === "object" &&
    !Array.isArray(exportsField)
  ) {
    const record = exportsField as Record<string, unknown>;
    if (sub in record) {
      const target = exportTarget(record[sub]);
      if (target) return target;
    }
    for (const [key, value] of Object.entries(record)) {
      if (!key.includes("*")) continue;
      const star = key.indexOf("*");
      const prefix = key.slice(0, star);
      const suffix = key.slice(star + 1);
      if (sub.startsWith(prefix) && sub.endsWith(suffix)) {
        const middle = sub.slice(prefix.length, sub.length - suffix.length);
        const target = exportTarget(value);
        if (target) return target.replace("*", middle);
      }
    }
  }
  if (sub === "." && pkg.main) return stripRelative(pkg.main);
  if (sub.startsWith("./")) return sub.slice(2);
  return null;
}

function exportTarget(value: unknown): string | null {
  if (typeof value === "string") return stripRelative(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["import", "default", "require", "types"]) {
    if (typeof record[key] === "string")
      return stripRelative(record[key] as string);
  }
  return null;
}

function stripRelative(value: string): string {
  return value.startsWith("./") ? value.slice(2) : value;
}

function resolveCandidates(
  base: string,
  files: Set<string>,
  deleted: Set<string>,
): Resolution | null {
  return resolveCandidatesList(candidatesFor(base), files, deleted, "relative");
}

function resolveCandidatesList(
  candidates: string[],
  files: Set<string>,
  deleted: Set<string>,
  resolvedBy: Resolution["resolvedBy"],
): Resolution | null {
  for (const candidate of candidates) {
    if (files.has(candidate))
      return { status: "resolved", target: candidate, resolvedBy };
  }
  for (const candidate of candidates) {
    if (deleted.has(candidate))
      return { status: "deleted", target: candidate, resolvedBy: "deleted" };
  }
  return null;
}

export function candidatesFor(base: string): string[] {
  const normalized = path.posix.normalize(base).replace(/^\.\//, "");
  const output = [normalized];
  const known = SOURCE_EXTENSIONS.some((extension) =>
    normalized.endsWith(extension),
  );
  if (!known) {
    for (const extension of SOURCE_EXTENSIONS)
      output.push(`${normalized}${extension}`);
    for (const extension of [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
    ]) {
      output.push(`${normalized}/index${extension}`);
    }
  } else if (normalized.endsWith(".js")) {
    output.push(
      `${normalized.slice(0, -3)}.ts`,
      `${normalized.slice(0, -3)}.tsx`,
      `${normalized.slice(0, -3)}.d.ts`,
    );
  } else if (normalized.endsWith(".jsx")) {
    output.push(`${normalized.slice(0, -4)}.tsx`);
  } else if (normalized.endsWith(".mjs")) {
    output.push(`${normalized.slice(0, -4)}.mts`);
  } else if (normalized.endsWith(".cjs")) {
    output.push(`${normalized.slice(0, -4)}.cts`);
  }
  return output.filter(
    (candidate) =>
      candidate.length > 0 &&
      !candidate.startsWith("..") &&
      !candidate.includes("/../"),
  );
}

function relativeBase(from: string, specifier: string): string {
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(from), specifier),
  );
}

function escapesRepository(from: string, specifier: string): boolean {
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(from), specifier),
  );
  return base === ".." || base.startsWith("../");
}

function normalizeJoined(base: string, target: string): string {
  const joined = path.posix.normalize(
    path.posix.join(base === "." ? "" : base, stripRelative(target)),
  );
  return joined.replace(/^\.\//, "");
}

export function externalPackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return name ? `${scope}/${name}` : specifier;
  }
  return specifier.split("/")[0] ?? specifier;
}
