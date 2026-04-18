#!/usr/bin/env node
// Encrypts security-keywords.txt -> security-keywords.enc using .security-key
// Uses AES-256-CBC with PBKDF2 key derivation (same format as pre-commit hook and CI).

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export async function encryptKeywords() {
  const repoRoot = process.cwd();
  const keyFile = join(repoRoot, ".security-key");
  const inputFile = join(repoRoot, "security-keywords.txt");
  const outputFile = join(repoRoot, "security-keywords.enc");

  if (!existsSync(keyFile)) {
    console.error(`ERROR: Encryption key not found at ${keyFile}`);
    console.error("Run 'leakguard init' first, or create .security-key with your passphrase.");
    process.exit(1);
  }

  if (!existsSync(inputFile)) {
    console.error(`ERROR: Keyword list not found at ${inputFile}`);
    console.error("Create security-keywords.txt with one keyword per line (see security-keywords.txt.example).");
    process.exit(1);
  }

  // Count non-comment, non-empty lines
  const content = readFileSync(inputFile, "utf-8");
  const keywordCount = content
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .length;

  try {
    execSync(
      `openssl enc -aes-256-cbc -pbkdf2 -salt -in "${inputFile}" -out "${outputFile}" -pass "file:${keyFile}"`,
      { stdio: "pipe" },
    );
  } catch (e) {
    console.error(`Encryption failed: ${e.message}`);
    process.exit(1);
  }

  console.log(`Encrypted ${keywordCount} keywords -> ${outputFile}`);
  console.log("Remember to commit security-keywords.enc (NOT security-keywords.txt).");
}
