import { spawn } from "node:child_process";
import path from "node:path";
import { ImpactMapError } from "./errors.js";
import { isInside, toPosix } from "./paths.js";

export interface FileChange {
  status: "added" | "modified" | "deleted" | "renamed" | "copied";
  path: string;
  previousPath?: string;
  additions?: number;
  deletions?: number;
}

interface GitResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/**
 * Runs Git with an argument array and `shell: false`.
 * Revisions passed to other helpers are full SHAs produced by `resolveCommit`.
 */
export function runGit(
  cwd: string,
  args: string[],
  input?: Buffer | string,
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["--no-pager", ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new ImpactMapError(
            "Git is not installed or not on PATH. Install Git to compare revisions.",
            2,
            "git-missing",
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function findRepositoryRoot(start: string): Promise<string> {
  const resolved = path.resolve(start);
  let result: GitResult;
  try {
    result = await runGit(resolved, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    if (error instanceof ImpactMapError) throw error;
    throw new ImpactMapError(
      "Failed to locate a Git repository.",
      2,
      "not-a-repository",
    );
  }
  if (result.code !== 0) {
    throw new ImpactMapError(
      `Not a Git repository: ${resolved}. ${result.stderr.trim()}`.trim(),
      2,
      "not-a-repository",
    );
  }
  const root = result.stdout.toString("utf8").trim();
  if (!root || !isInside(root, resolved)) {
    throw new ImpactMapError(
      `Refusing to use Git root outside the requested directory: ${root}`,
      2,
      "escaped-root",
    );
  }
  return root;
}

export async function resolveCommit(
  root: string,
  ref: string,
): Promise<string> {
  if (
    ref.length === 0 ||
    ref.includes("\0") ||
    ref.includes("\n") ||
    ref.includes("\r")
  ) {
    throw new ImpactMapError(`Invalid Git revision "${ref}".`, 2, "bad-ref");
  }
  const result = await runGit(root, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${ref}^{commit}`,
  ]);
  if (result.code !== 0) {
    throw new ImpactMapError(
      `Unknown Git revision "${ref}". ${result.stderr.trim()}`.trim(),
      2,
      "bad-ref",
    );
  }
  const sha = result.stdout.toString("utf8").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new ImpactMapError(
      `Git returned an unexpected revision id for "${ref}".`,
      2,
      "bad-ref",
    );
  }
  return sha;
}

export async function mergeBase(
  root: string,
  first: string,
  second: string,
): Promise<string> {
  const result = await runGit(root, [
    "merge-base",
    "--end-of-options",
    first,
    second,
  ]);
  if (result.code !== 0) {
    throw new ImpactMapError(
      `No merge base between ${first} and ${second}. ${result.stderr.trim()}`.trim(),
      2,
      "no-merge-base",
    );
  }
  const sha = result.stdout.toString("utf8").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new ImpactMapError(
      "Git returned an unexpected merge base.",
      2,
      "no-merge-base",
    );
  }
  return sha;
}

export async function headCommit(root: string): Promise<string> {
  return resolveCommit(root, "HEAD");
}

export async function worktreeDirty(root: string): Promise<boolean> {
  const result = await runGit(root, [
    "status",
    "--porcelain",
    "--untracked-files=normal",
  ]);
  if (result.code !== 0) return true;
  return result.stdout.toString("utf8").trim().length > 0;
}

export async function diffChanges(
  root: string,
  fromSha: string,
  to: { kind: "worktree" } | { kind: "commit"; sha: string },
): Promise<FileChange[]> {
  const args = [
    "diff",
    "--name-status",
    "-z",
    "-M",
    "--find-renames",
    "--end-of-options",
    fromSha,
  ];
  if (to.kind === "commit") args.push(to.sha);
  const result = await runGit(root, args);
  if (result.code !== 0) {
    throw new ImpactMapError(
      `Git diff failed. ${result.stderr.trim()}`.trim(),
      2,
      "diff-failed",
    );
  }
  const changes = parseNameStatusZ(result.stdout.toString("utf8"));
  const numArgs = ["diff", "--numstat", "--end-of-options", fromSha];
  if (to.kind === "commit") numArgs.push(to.sha);
  const numstat = await runGit(root, numArgs);
  if (numstat.code === 0)
    applyNumstat(changes, numstat.stdout.toString("utf8"));
  if (to.kind === "worktree") {
    const extra = await untrackedFiles(root);
    const known = new Set(changes.map((change) => change.path));
    for (const file of extra) {
      if (!known.has(file))
        changes.push({
          status: "added",
          path: file,
          additions: 0,
          deletions: 0,
        });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export async function untrackedFiles(root: string): Promise<string[]> {
  const result = await runGit(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  if (result.code !== 0) return [];
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter((file) => file.length > 0)
    .map((file) => toPosix(file));
}

export async function listFilesAtRevision(
  root: string,
  sha: string,
): Promise<string[]> {
  const result = await runGit(root, [
    "ls-tree",
    "-r",
    "--name-only",
    "-z",
    "--end-of-options",
    sha,
  ]);
  if (result.code !== 0) {
    throw new ImpactMapError(
      `Unable to list files at ${sha}. ${result.stderr.trim()}`.trim(),
      2,
      "git-list-failed",
    );
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter((file) => file.length > 0)
    .map((file) => toPosix(file));
}

export async function readBlob(
  root: string,
  sha: string,
  file: string,
): Promise<string | null> {
  if (file.includes("\0") || file.includes("\n")) return null;
  const result = await runGit(root, [
    "cat-file",
    "-p",
    "--end-of-options",
    `${sha}:${file}`,
  ]);
  if (result.code !== 0) return null;
  if (result.stdout.includes(0)) return null;
  return result.stdout.toString("utf8");
}

export async function readBlobs(
  root: string,
  sha: string,
  files: string[],
): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  if (files.length === 0) return output;
  const safe = files.filter(
    (file) => !file.includes("\0") && !file.includes("\n"),
  );
  const input = safe.map((file) => `${sha}:${file}\n`).join("");
  const result = await runGit(root, ["cat-file", "--batch"], input);
  if (result.code !== 0 && result.stdout.length === 0) {
    throw new ImpactMapError(
      `Unable to read files at ${sha}. ${result.stderr.trim()}`.trim(),
      2,
      "git-read-failed",
    );
  }
  const parsed = parseCatFileBatch(result.stdout, safe);
  for (const [file, buffer] of parsed) {
    if (!buffer || buffer.includes(0)) continue;
    output.set(file, buffer.toString("utf8"));
  }
  return output;
}

export function parseNameStatusZ(stdout: string): FileChange[] {
  if (!stdout) return [];
  const parts = stdout.split("\0");
  if (parts[parts.length - 1] === "") parts.pop();
  const changes: FileChange[] = [];
  let index = 0;
  while (index < parts.length) {
    const status = parts[index];
    index += 1;
    if (!status) break;
    const code = status[0];
    if (code === "R" || code === "C") {
      const previousPath = parts[index];
      const nextPath = parts[index + 1];
      index += 2;
      if (!previousPath || !nextPath) break;
      changes.push({
        status: code === "R" ? "renamed" : "copied",
        path: toPosix(nextPath),
        previousPath: toPosix(previousPath),
      });
      continue;
    }
    const filePath = parts[index];
    index += 1;
    if (!filePath) break;
    const mapped =
      code === "A"
        ? "added"
        : code === "D"
          ? "deleted"
          : code === "M" || code === "T" || code === "U"
            ? "modified"
            : "modified";
    changes.push({ status: mapped, path: toPosix(filePath) });
  }
  return changes;
}

export function parseCatFileBatch(
  stdout: Buffer,
  requests: string[],
): Map<string, Buffer | null> {
  const output = new Map<string, Buffer | null>();
  let offset = 0;
  for (const request of requests) {
    const newline = stdout.indexOf(0x0a, offset);
    if (newline < 0) {
      output.set(request, null);
      break;
    }
    const header = stdout.subarray(offset, newline).toString("utf8");
    offset = newline + 1;
    if (header.endsWith(" missing")) {
      output.set(request, null);
      continue;
    }
    const match = header.match(/ (\d+)$/);
    const size = match?.[1] ? Number(match[1]) : 0;
    const content = stdout.subarray(offset, offset + size);
    offset += size;
    if (stdout[offset] === 0x0a) offset += 1;
    output.set(request, content);
  }
  return output;
}

function applyNumstat(changes: FileChange[], numstat: string): void {
  const byPath = new Map(changes.map((change) => [change.path, change]));
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!match?.[3]) continue;
    const additions = match[1] === "-" ? 0 : Number(match[1]);
    const deletions = match[2] === "-" ? 0 : Number(match[2]);
    let filePath = match[3];
    const rename = filePath.split(" => ");
    if (rename.length === 2) {
      filePath = rename[1]?.replace(/[{}]/g, "") ?? filePath;
      const left = rename[0] ?? "";
      if (left.includes("{")) {
        const prefix = left.slice(0, left.indexOf("{"));
        filePath = `${prefix}${filePath}`;
      }
    }
    const change = byPath.get(toPosix(filePath));
    if (!change) continue;
    change.additions = additions;
    change.deletions = deletions;
  }
}
