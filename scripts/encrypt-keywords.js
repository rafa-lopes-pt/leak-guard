#!/usr/bin/env node
// CLI-driven keyword management for LeakGuard.
// Encrypts/decrypts security-keywords.enc using .security-key (AES-256-CBC, PBKDF2).
// No plaintext files ever touch disk -- encryption/decryption uses stdin/stdout pipes.

import { existsSync } from "node:fs";

import { ENC_FILE } from "./lib/rc.js";
import { requireKeyFile, decryptKeywords, encryptKeywords as encryptList } from "./lib/crypto.js";
import { ok, info, warn, error, done, hint, filePath, list } from "./lib/ui.js";

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export function encryptKeywords({ keywords, override = false }) {
  requireKeyFile();

  if (!override && existsSync(ENC_FILE)) {
    const existing = decryptKeywords();
    if (!existing) {
      error("Failed to decrypt security-keywords.enc (wrong key?).");
      process.exit(1);
    }
    const unique = encryptList([...existing, ...keywords]);
    const added = unique.length - existing.length;
    ok(`Merged: ${added} new + ${existing.length} existing = ${unique.length} total keywords.`);
  } else {
    const unique = encryptList(keywords);
    ok(`Encrypted ${unique.length} keyword(s) -> ${filePath("security-keywords.enc")}`);
  }

  hint(`Remember to commit ${filePath("security-keywords.enc")}.`);
}

export function listKeywords() {
  requireKeyFile();

  if (!existsSync(ENC_FILE)) {
    info("No keywords configured. Use 'leakguard blacklist <keywords>' to add some.");
    return;
  }

  const keywords = decryptKeywords();
  if (!keywords) {
    error("Failed to decrypt security-keywords.enc (wrong key?).");
    process.exit(1);
  }

  info(`${keywords.length} keyword(s):`);
  list(keywords, 4);
}

export function removeKeywords({ keywords }) {
  requireKeyFile();

  if (!existsSync(ENC_FILE)) {
    info("No keywords configured. Nothing to remove.");
    return;
  }

  const existing = decryptKeywords();
  if (!existing) {
    error("Failed to decrypt security-keywords.enc (wrong key?).");
    process.exit(1);
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
    done(`Removed: ${removed.join(", ")}`);
  }
  if (notFound.length > 0) {
    warn(`Not found: ${notFound.join(", ")}`);
  }

  info(`${remaining.length} keyword(s) remaining.`);
  if (removed.length > 0) {
    hint(`Remember to commit ${filePath("security-keywords.enc")}.`);
  }
}
