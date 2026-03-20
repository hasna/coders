/**
 * Git integration — repository detection, operations, worktree management
 */
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, resolve } from "path";

export interface GitRepo {
  root: string;
  remote?: string;
  owner?: string;
  name?: string;
  branch?: string;
}

export function detectGitRepo(cwd = process.cwd()): GitRepo | null {
  try {
    const root = execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
    if (!root) return null;

    const repo: GitRepo = { root };

    try { repo.branch = execSync("git branch --show-current", { cwd, encoding: "utf-8", stdio: "pipe" }).trim(); } catch {}
    try {
      const remote = execSync("git remote get-url origin", { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
      repo.remote = remote;
      const parsed = parseGitRemote(remote);
      if (parsed) { repo.owner = parsed.owner; repo.name = parsed.name; }
    } catch {}

    return repo;
  } catch { return null; }
}

export function parseGitRemote(url: string): { owner: string; name: string } | null {
  // SSH: git@github.com:owner/repo.git
  const ssh = url.match(/[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], name: ssh[2] };

  // HTTPS: https://github.com/owner/repo.git
  const https = url.match(/\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (https) return { owner: https[1], name: https[2] };

  return null;
}

export function isAtGitRoot(cwd = process.cwd()): boolean {
  return existsSync(join(cwd, ".git"));
}

export function getGitStatus(cwd = process.cwd()): string {
  try { return execSync("git status --porcelain", { cwd, encoding: "utf-8", stdio: "pipe" }); } catch { return ""; }
}

export function getGitDiff(cwd = process.cwd(), staged = false): string {
  const flag = staged ? "--cached" : "";
  try { return execSync(`git diff ${flag}`, { cwd, encoding: "utf-8", stdio: "pipe" }); } catch { return ""; }
}

export function getGitLog(cwd = process.cwd(), count = 5): string {
  try { return execSync(`git log --oneline -${count}`, { cwd, encoding: "utf-8", stdio: "pipe" }); } catch { return ""; }
}
