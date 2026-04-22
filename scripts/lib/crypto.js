// Centralized openssl encryption/decryption for keyword management.
// All keyword encryption uses: AES-256-CBC, PBKDF2, salt.
// The bash pre-commit hook (scripts/hooks/pre-commit) and CI workflow
// (workflows/secret-scan.yml) use the same openssl parameters -- if you
// change anything here, update those too.

import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { KEY_FILE, ENC_FILE } from "./rc.js";

export function requireKeyFile() {
  if (!existsSync(KEY_FILE)) {
    console.error("ERROR: Encryption key not found (.security-key).");
    console.error("Run 'leakguard init' first, or create .security-key with your passphrase.");
    process.exit(1);
  }
}

export function decryptKeywords(keyFile = KEY_FILE, encFile = ENC_FILE) {
  if (!existsSync(encFile)) return null;

  try {
    const raw = execSync(
      `openssl enc -aes-256-cbc -pbkdf2 -d -in "${encFile}" -pass "file:${keyFile}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return null;
  }
}

export function encryptKeywords(keywords, keyFile = KEY_FILE, encFile = ENC_FILE) {
  const filtered = keywords.filter((kw) => kw.trim().length > 0);

  // Warn on case-duplicate keywords being deduplicated
  const seen = new Map();
  const dupes = [];
  for (const kw of filtered) {
    const lower = kw.toLowerCase();
    if (seen.has(lower)) {
      dupes.push(`"${kw}" (duplicate of "${seen.get(lower)}")`);
    } else {
      seen.set(lower, kw);
    }
  }
  if (dupes.length > 0) {
    console.log(`Deduplicated: ${dupes.join(", ")}`);
  }

  const unique = [...seen.values()];
  const content = unique.join("\n") + "\n";
  const result = spawnSync(
    "openssl",
    ["enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-out", encFile, "-pass", `file:${keyFile}`],
    { input: content, stdio: ["pipe", "pipe", "pipe"] },
  );
  if (result.status !== 0) {
    console.error(`Encryption failed: ${result.stderr?.toString() || "unknown error"}`);
    process.exit(1);
  }
  return unique;
}
