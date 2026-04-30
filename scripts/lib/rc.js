// Shared helpers and constants for all LeakGuard scripts.
// Extracted to avoid duplication across setup.js, deploy.js, encrypt-keywords.js, etc.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = process.cwd();
export const RC_FILE = join(REPO_ROOT, ".leakguardrc");
export const KEY_FILE = join(REPO_ROOT, ".security-key");
export const ENC_FILE = join(REPO_ROOT, "security-keywords.enc");
export const DEPLOY_PWD_FILE = join(REPO_ROOT, ".deploy-password.enc");
export const IS_WINDOWS = process.platform === "win32";

export function commandExists(cmd) {
  try {
    execSync(IS_WINDOWS ? `where ${cmd}` : `which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function run(cmd, opts = {}) {
  const result = execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts });
  return result == null ? "" : result.trim();
}

export function isGitRepo() {
  try {
    run("git rev-parse --show-toplevel");
    return true;
  } catch {
    return false;
  }
}

export function getRemoteUrl() {
  try {
    const origin = run("git remote get-url origin");
    if (origin.startsWith("git@")) {
      const host = origin.split(":")[0].replace(/^git@/, "");
      const path = origin.split(":")[1].replace(/\.git$/, "");
      return `https://${host}/${path}`;
    }
    const url = new URL(origin);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\.git$/, "")}`;
  } catch {
    return null;
  }
}

export function ensureGitignoreEntry(entry) {
  const gitignorePath = join(REPO_ROOT, ".gitignore");
  let content = "";
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf-8");
  }
  const lines = content.split("\n").map((l) => l.trim());
  if (!lines.includes(entry)) {
    const separator = content.endsWith("\n") || content === "" ? "" : "\n";
    writeFileSync(gitignorePath, content + separator + entry + "\n");
  }
}

export function removeGitignoreEntries(entries) {
  const gitignorePath = join(REPO_ROOT, ".gitignore");
  if (!existsSync(gitignorePath)) return false;
  const content = readFileSync(gitignorePath, "utf-8");
  const entrySet = new Set(entries.map((e) => e.trim()));
  const filtered = content.split("\n").filter((line) => !entrySet.has(line.trim()));
  const newContent = filtered.join("\n");
  if (newContent === content) return false;
  writeFileSync(gitignorePath, newContent);
  return true;
}

export function readRc() {
  if (!existsSync(RC_FILE)) return null;
  try {
    return JSON.parse(readFileSync(RC_FILE, "utf-8"));
  } catch (e) {
    console.error(`WARNING: ${RC_FILE} contains invalid JSON and was ignored. ${e.message}`);
    return null;
  }
}

export function writeRc(updates) {
  const rc = readRc() || {};
  Object.assign(rc, updates);
  writeFileSync(RC_FILE, JSON.stringify(rc, null, 2) + "\n");
  return rc;
}
