// Persisted deploy password storage.
// Cipher text in .deploy-password.enc (gitignored). Encrypted with .security-key
// via openssl AES-256-CBC + PBKDF2, matching the keyword-encryption pattern.
// Kept out of .leakguardrc so the GitHub-hosted LEAKGUARD_SECURITY_KEY secret
// cannot be combined with a committed cipher to recover the deploy password.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

import { KEY_FILE, DEPLOY_PWD_FILE, ensureGitignoreEntry } from "./rc.js";

export function hasSavedPassword() {
  return existsSync(DEPLOY_PWD_FILE);
}

export function savePassword(plaintext) {
  if (!existsSync(KEY_FILE)) {
    throw new Error(".security-key not found -- cannot save deploy password.");
  }
  const result = spawnSync(
    "openssl",
    ["enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-out", DEPLOY_PWD_FILE, "-pass", `file:${KEY_FILE}`],
    { input: plaintext, stdio: ["pipe", "pipe", "pipe"] },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to encrypt deploy password: ${result.stderr?.toString() || "unknown error"}`);
  }
  ensureGitignoreEntry(".deploy-password.enc");
}

export function loadPassword() {
  if (!existsSync(DEPLOY_PWD_FILE) || !existsSync(KEY_FILE)) return null;
  const result = spawnSync(
    "openssl",
    ["enc", "-aes-256-cbc", "-pbkdf2", "-d", "-in", DEPLOY_PWD_FILE, "-pass", `file:${KEY_FILE}`],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  if (result.status !== 0) return null;
  const out = result.stdout?.toString() ?? "";
  return out.length > 0 ? out : null;
}

export function clearPassword() {
  rmSync(DEPLOY_PWD_FILE, { force: true });
}
