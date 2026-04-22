import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("rc", () => {
  let tmpDir, origCwd;
  let readRc, writeRc, ensureGitignoreEntry;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "leakguard-test-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    // Dynamic import so REPO_ROOT = process.cwd() picks up tmpDir
    const mod = await import("../scripts/lib/rc.js");
    readRc = mod.readRc;
    writeRc = mod.writeRc;
    ensureGitignoreEntry = mod.ensureGitignoreEntry;
  });

  after(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    for (const f of [".leakguardrc", ".gitignore"]) {
      const p = join(tmpDir, f);
      if (existsSync(p)) rmSync(p);
    }
  });

  it("readRc returns null when no file exists", () => {
    assert.equal(readRc(), null);
  });

  it("readRc returns parsed JSON", () => {
    writeFileSync(join(tmpDir, ".leakguardrc"), '{"distRepo":"org/repo"}');
    assert.deepEqual(readRc(), { distRepo: "org/repo" });
  });

  it("readRc returns null on invalid JSON", () => {
    writeFileSync(join(tmpDir, ".leakguardrc"), "not json{");
    assert.equal(readRc(), null);
  });

  it("writeRc creates config file", () => {
    writeRc({ distRepo: "org/repo" });
    const content = JSON.parse(readFileSync(join(tmpDir, ".leakguardrc"), "utf-8"));
    assert.equal(content.distRepo, "org/repo");
  });

  it("writeRc merges with existing config", () => {
    writeRc({ distRepo: "org/repo" });
    writeRc({ distFolder: "public-dist" });
    const content = JSON.parse(readFileSync(join(tmpDir, ".leakguardrc"), "utf-8"));
    assert.equal(content.distRepo, "org/repo");
    assert.equal(content.distFolder, "public-dist");
  });

  it("ensureGitignoreEntry creates .gitignore if missing", () => {
    ensureGitignoreEntry("node_modules/");
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    assert.ok(content.includes("node_modules/"));
  });

  it("ensureGitignoreEntry does not duplicate entries", () => {
    ensureGitignoreEntry("node_modules/");
    ensureGitignoreEntry("node_modules/");
    const lines = readFileSync(join(tmpDir, ".gitignore"), "utf-8")
      .split("\n").filter((l) => l.trim() === "node_modules/");
    assert.equal(lines.length, 1);
  });

  it("ensureGitignoreEntry appends to existing file", () => {
    writeFileSync(join(tmpDir, ".gitignore"), "dist/\n");
    ensureGitignoreEntry(".env");
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    assert.ok(content.includes("dist/"));
    assert.ok(content.includes(".env"));
  });
});
