import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "ImpactMap Tests",
  GIT_AUTHOR_EMAIL: "impactmap@example.com",
  GIT_COMMITTER_NAME: "ImpactMap Tests",
  GIT_COMMITTER_EMAIL: "impactmap@example.com",
};

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnv });
}

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "impactmap-"));
}

export function copyFixture(name: string, dest: string): void {
  fs.cpSync(path.resolve("fixtures", name), dest, { recursive: true });
}

export function initRepo(dir: string): void {
  git(dir, ["init", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "base"]);
}

export function useFixture(name: string): string {
  const dir = tempDir();
  copyFixture(name, dir);
  initRepo(dir);
  return dir;
}

export function commitAll(dir: string, message: string): void {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", message]);
}

export function branch(dir: string, name: string): void {
  git(dir, ["checkout", "-b", name]);
}
