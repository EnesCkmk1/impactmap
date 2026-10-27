import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Repository paths are POSIX, even on Windows, so reports stay stable. */
export function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * Resolve `target` and accept it only when its real path stays inside `root`.
 * Symlinks that escape the repository return null.
 */
export function realpathInside(root: string, target: string): string | null {
  try {
    const rootReal = fs.realpathSync(root);
    const targetReal = fs.realpathSync(target);
    if (!isInside(rootReal, targetReal)) return null;
    return targetReal;
  } catch {
    return null;
  }
}

export function repoRelative(root: string, absolute: string): string {
  const relative = toPosix(path.relative(root, absolute));
  return relative === "" ? "" : relative;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Read a text file only when its real path stays inside `root`.
 * Sibling prefixes such as `/repo-evil` and symlinks that leave the repository return null.
 */
export function readTextInside(
  root: string,
  relativePath: string,
): string | null {
  if (relativePath.includes("\0")) return null;
  const absolute = path.resolve(root, relativePath);
  if (!isInside(root, absolute)) return null;
  const real = realpathInside(root, absolute);
  if (!real) return null;
  try {
    return fs.readFileSync(real, "utf8");
  } catch {
    return null;
  }
}
