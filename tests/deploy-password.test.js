import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let hasOpenssl = false;
try {
  execSync("openssl version", { stdio: "pipe" });
  hasOpenssl = true;
} catch {}

describe("deploy-password", { skip: !hasOpenssl && "openssl not available" }, () => {
  let tmpDir, origCwd;
  let savePassword, loadPassword, clearPassword, hasSavedPassword;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "leakguard-pwd-test-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);

    writeFileSync(join(tmpDir, ".security-key"), "test-passphrase-for-ci");

    const mod = await import("../scripts/lib/deploy-password.js");
    savePassword = mod.savePassword;
    loadPassword = mod.loadPassword;
    clearPassword = mod.clearPassword;
    hasSavedPassword = mod.hasSavedPassword;
  });

  after(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("save then load returns same password", () => {
    savePassword("super-secret-deploy-pass");
    assert.ok(hasSavedPassword());
    assert.ok(existsSync(join(tmpDir, ".deploy-password.enc")));
    assert.equal(loadPassword(), "super-secret-deploy-pass");
  });

  it("save adds .deploy-password.enc to .gitignore", () => {
    savePassword("another-pass");
    const gi = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    assert.ok(gi.split("\n").some((l) => l.trim() === ".deploy-password.enc"));
  });

  it("loadPassword returns null when file missing", () => {
    clearPassword();
    assert.equal(hasSavedPassword(), false);
    assert.equal(loadPassword(), null);
  });

  it("loadPassword returns null when key file missing", () => {
    savePassword("x".repeat(20));
    rmSync(join(tmpDir, ".security-key"));
    assert.equal(loadPassword(), null);
    writeFileSync(join(tmpDir, ".security-key"), "test-passphrase-for-ci");
    clearPassword();
  });

  it("loadPassword returns null on corrupt cipher", () => {
    writeFileSync(join(tmpDir, ".deploy-password.enc"), "not-real-openssl-output");
    assert.equal(loadPassword(), null);
    clearPassword();
  });

  it("savePassword throws when key file missing", () => {
    rmSync(join(tmpDir, ".security-key"));
    assert.throws(() => savePassword("whatever"), /\.security-key not found/);
    writeFileSync(join(tmpDir, ".security-key"), "test-passphrase-for-ci");
  });
});
