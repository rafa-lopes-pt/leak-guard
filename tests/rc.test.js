import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("rc", () => {
  let tmpDir, origCwd;
  let readRc, writeRc, ensureGitignoreEntry, removeGitignoreEntries;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "leakguard-test-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    // Dynamic import so REPO_ROOT = process.cwd() picks up tmpDir
    const mod = await import("../scripts/lib/rc.js");
    readRc = mod.readRc;
    writeRc = mod.writeRc;
    ensureGitignoreEntry = mod.ensureGitignoreEntry;
    removeGitignoreEntries = mod.removeGitignoreEntries;
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

  it("removeGitignoreEntries removes matching entries", () => {
    writeFileSync(join(tmpDir, ".gitignore"), ".security-key\nreports/\nnode_modules/\n");
    const changed = removeGitignoreEntries([".security-key", "reports/"]);
    assert.equal(changed, true);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    assert.ok(!content.includes(".security-key"));
    assert.ok(!content.includes("reports/"));
    assert.ok(content.includes("node_modules/"));
  });

  it("removeGitignoreEntries returns false when no match", () => {
    writeFileSync(join(tmpDir, ".gitignore"), "node_modules/\ndist/\n");
    const changed = removeGitignoreEntries([".security-key"]);
    assert.equal(changed, false);
  });

  it("removeGitignoreEntries returns false when .gitignore missing", () => {
    const changed = removeGitignoreEntries([".security-key"]);
    assert.equal(changed, false);
  });

  it("removeGitignoreEntries preserves other lines", () => {
    writeFileSync(join(tmpDir, ".gitignore"), "first\n.security-key\nlast\n");
    removeGitignoreEntries([".security-key"]);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    assert.ok(content.includes("first"));
    assert.ok(content.includes("last"));
    assert.ok(!content.includes(".security-key"));
  });
});

describe("getRemoteUrl", () => {
  let tmpDir, origCwd, getRemoteUrl;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "leakguard-remote-test-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    // Fresh import so run() resolves in the temp dir
    const mod = await import(`../scripts/lib/rc.js?t=${Date.now()}`);
    getRemoteUrl = mod.getRemoteUrl;
  });

  after(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no remote is configured", () => {
    assert.equal(getRemoteUrl(), null);
  });

  it("converts SSH URL to HTTPS", () => {
    execSync("git remote add origin git@github.com:org/repo.git", { cwd: tmpDir });
    try {
      assert.equal(getRemoteUrl(), "https://github.com/org/repo");
    } finally {
      execSync("git remote remove origin", { cwd: tmpDir });
    }
  });

  it("normalizes HTTPS URL and strips .git suffix", () => {
    execSync("git remote add origin https://github.com/org/repo.git", { cwd: tmpDir });
    try {
      assert.equal(getRemoteUrl(), "https://github.com/org/repo");
    } finally {
      execSync("git remote remove origin", { cwd: tmpDir });
    }
  });

  it("preserves clean HTTPS URL", () => {
    execSync("git remote add origin https://github.com/org/repo", { cwd: tmpDir });
    try {
      assert.equal(getRemoteUrl(), "https://github.com/org/repo");
    } finally {
      execSync("git remote remove origin", { cwd: tmpDir });
    }
  });
});
