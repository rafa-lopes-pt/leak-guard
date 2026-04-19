#!/usr/bin/env node
// CLI-driven keyword management for LeakGuard.
// Encrypts/decrypts security-keywords.enc using .security-key (AES-256-CBC, PBKDF2).
// No plaintext files ever touch disk -- encryption/decryption uses stdin/stdout pipes.

import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const KEY_FILE = join(REPO_ROOT, ".security-key");
const ENC_FILE = join(REPO_ROOT, "security-keywords.enc");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function requireKey() {
  if (!existsSync(KEY_FILE)) {
    console.error("ERROR: Encryption key not found (.security-key).");
    console.error("Run 'leakguard init' first, or create .security-key with your passphrase.");
    process.exit(1);
  }
}

function decryptKeywords() {
  if (!existsSync(ENC_FILE)) {
    return null;
  }

  try {
    const raw = execSync(
      `openssl enc -aes-256-cbc -pbkdf2 -d -in "${ENC_FILE}" -pass "file:${KEY_FILE}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    console.error("ERROR: Failed to decrypt security-keywords.enc (wrong key?).");
    process.exit(1);
  }
}

function encryptList(keywords) {
  const content = keywords.join("\n") + "\n";
  const result = spawnSync(
    "openssl",
    ["enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-out", ENC_FILE, "-pass", `file:${KEY_FILE}`],
    { input: content, stdio: ["pipe", "pipe", "pipe"] },
  );
  if (result.status !== 0) {
    console.error(`Encryption failed: ${result.stderr?.toString() || "unknown error"}`);
    process.exit(1);
  }
}

function dedup(keywords) {
  const seen = new Map();
  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, kw);
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export function encryptKeywords({ keywords, override = false }) {
  requireKey();

  if (!override && existsSync(ENC_FILE)) {
    const existing = decryptKeywords();
    const merged = dedup([...existing, ...keywords]);
    const added = merged.length - existing.length;
    encryptList(merged);
    console.log(`Merged: ${added} new + ${existing.length} existing = ${merged.length} total keywords.`);
  } else {
    const unique = dedup(keywords);
    encryptList(unique);
    console.log(`Encrypted ${unique.length} keyword(s) -> security-keywords.enc`);
  }

  console.log("Remember to commit security-keywords.enc.");
}

export function listKeywords() {
  requireKey();

  const keywords = decryptKeywords();
  if (!keywords) {
    console.log("No keywords configured. Use 'leakguard blacklist <keywords>' to add some.");
    return;
  }

  console.log(`${keywords.length} keyword(s):\n`);
  for (const kw of keywords) {
    console.log(`  ${kw}`);
  }
}

export function removeKeywords({ keywords }) {
  requireKey();

  const existing = decryptKeywords();
  if (!existing) {
    console.log("No keywords configured. Nothing to remove.");
    return;
  }

  const toRemove = new Set(keywords.map((k) => k.toLowerCase()));
  const removed = [];
  const remaining = [];

  for (const kw of existing) {
    if (toRemove.has(kw.toLowerCase())) {
      removed.push(kw);
    } else {
      remaining.push(kw);
    }
  }

  const notFound = keywords.filter(
    (k) => !removed.some((r) => r.toLowerCase() === k.toLowerCase()),
  );

  if (removed.length > 0) {
    encryptList(remaining);
    console.log(`Removed: ${removed.join(", ")}`);
  }
  if (notFound.length > 0) {
    console.log(`Not found: ${notFound.join(", ")}`);
  }

  console.log(`${remaining.length} keyword(s) remaining.`);
  if (removed.length > 0) {
    console.log("Remember to commit security-keywords.enc.");
  }
}
