import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Skip entire suite if openssl is not available
let hasOpenssl = false;
try {
  execSync("openssl version", { stdio: "pipe" });
  hasOpenssl = true;
} catch {}

describe("crypto", { skip: !hasOpenssl && "openssl not available" }, () => {
  let tmpDir, origCwd;
  let encryptKeywords, decryptKeywords;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "leakguard-test-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);

    // Create a key file
    writeFileSync(join(tmpDir, ".security-key"), "test-passphrase-for-ci");

    const mod = await import("../scripts/lib/crypto.js");
    encryptKeywords = mod.encryptKeywords;
    decryptKeywords = mod.decryptKeywords;
  });

  after(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("encrypt then decrypt roundtrip returns same keywords", () => {
    const keywords = ["secret-project", "internal-codename", "api-key-prod"];
    const keyFile = join(tmpDir, ".security-key");
    const encFile = join(tmpDir, "security-keywords.enc");

    encryptKeywords(keywords, keyFile, encFile);
    assert.ok(existsSync(encFile));

    const decrypted = decryptKeywords(keyFile, encFile);
    assert.deepEqual(decrypted, keywords);
  });

  it("decryptKeywords returns null when enc file missing", () => {
    const keyFile = join(tmpDir, ".security-key");
    const result = decryptKeywords(keyFile, join(tmpDir, "nonexistent.enc"));
    assert.equal(result, null);
  });

  it("encryptKeywords deduplicates case-insensitive keywords", () => {
    const keywords = ["Secret", "SECRET", "secret", "other"];
    const keyFile = join(tmpDir, ".security-key");
    const encFile = join(tmpDir, "dedup-test.enc");

    const result = encryptKeywords(keywords, keyFile, encFile);
    assert.equal(result.length, 2);
    assert.ok(result.includes("Secret"));
    assert.ok(result.includes("other"));
  });

  it("encryptKeywords filters empty strings", () => {
    const keywords = ["valid", "", "  ", "also-valid"];
    const keyFile = join(tmpDir, ".security-key");
    const encFile = join(tmpDir, "filter-test.enc");

    const result = encryptKeywords(keywords, keyFile, encFile);
    assert.equal(result.length, 2);
  });
});
