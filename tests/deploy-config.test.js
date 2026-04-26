import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("deploy-config", () => {
  let tmpDir, origCwd;
  let resolveDeployConfig, DEPLOY_DEFAULTS, writeDeployConfig, parseChunkSize, parseExpiry;
  let writeRc;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "leakguard-test-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);

    const rc = await import("../scripts/lib/rc.js");
    writeRc = rc.writeRc;

    const mod = await import("../scripts/lib/deploy-config.js");
    resolveDeployConfig = mod.resolveDeployConfig;
    DEPLOY_DEFAULTS = mod.DEPLOY_DEFAULTS;
    writeDeployConfig = mod.writeDeployConfig;
    parseChunkSize = mod.parseChunkSize;
    parseExpiry = mod.parseExpiry;
  });

  after(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const rc = join(tmpDir, ".leakguardrc");
    if (existsSync(rc)) rmSync(rc);
  });

  it("DEPLOY_DEFAULTS has all expected keys", () => {
    const expected = [
      "defaultMode", "chunkSize", "archiveName",
      "skipGitleaks", "skipKeywords", "commitMessage",
      "keepArchive", "createRelease", "expires",
    ];
    for (const key of expected) {
      assert.ok(key in DEPLOY_DEFAULTS, `missing key: ${key}`);
    }
  });

  it("resolveDeployConfig returns defaults when no rc", () => {
    const config = resolveDeployConfig();
    assert.deepEqual(config, DEPLOY_DEFAULTS);
  });

  it("resolveDeployConfig merges saved config with defaults", () => {
    writeRc({ deploy: { defaultMode: "7z", chunkSize: 100000 } });
    const config = resolveDeployConfig();
    assert.equal(config.defaultMode, "7z");
    assert.equal(config.chunkSize, 100000);
    // Unset keys fall back to defaults
    assert.equal(config.skipGitleaks, DEPLOY_DEFAULTS.skipGitleaks);
    assert.equal(config.commitMessage, DEPLOY_DEFAULTS.commitMessage);
  });

  it("writeDeployConfig persists settings", () => {
    writeRc({});
    writeDeployConfig({ skipGitleaks: true });
    const config = resolveDeployConfig();
    assert.equal(config.skipGitleaks, true);
  });

  describe("parseChunkSize", () => {
    it("raw number passthrough", () => {
      assert.equal(parseChunkSize(500000, 1000), 500000);
    });

    it("string kb", () => {
      assert.equal(parseChunkSize("500kb", 1000), 500000);
    });

    it("string mb with decimal", () => {
      assert.equal(parseChunkSize("0.5mb", 1000), 500000);
    });

    it("string mb with leading dot", () => {
      assert.equal(parseChunkSize(".5mb", 1000), 500000);
    });

    it("string gb", () => {
      assert.equal(parseChunkSize("1gb", 1000), 1000000000);
    });

    it("count mode even split", () => {
      assert.equal(parseChunkSize("3n", 900), 300);
    });

    it("count mode with ceil", () => {
      assert.equal(parseChunkSize("3n", 1000), 334);
    });

    it("plain number as string", () => {
      assert.equal(parseChunkSize("500000", 1000), 500000);
    });

    it("invalid string returns null", () => {
      assert.equal(parseChunkSize("abc", 1000), null);
    });

    it("case insensitive", () => {
      assert.equal(parseChunkSize("500KB", 1000), 500000);
      assert.equal(parseChunkSize("0.5MB", 1000), 500000);
    });
  });

  describe("parseExpiry", () => {
    it("30m duration", () => {
      const result = parseExpiry("30m");
      assert.equal(result.ms, 30 * 60_000);
      assert.ok(result.iso);
    });

    it("8h duration", () => {
      const result = parseExpiry("8h");
      assert.equal(result.ms, 8 * 3_600_000);
      assert.ok(result.iso);
    });

    it("1d duration", () => {
      const result = parseExpiry("1d");
      assert.equal(result.ms, 86_400_000);
      assert.ok(result.iso);
    });

    it("7d duration", () => {
      const result = parseExpiry("7d");
      assert.equal(result.ms, 7 * 86_400_000);
    });

    it("2w duration", () => {
      const result = parseExpiry("2w");
      assert.equal(result.ms, 2 * 604_800_000);
    });

    it("zero returns ms:0, iso:null", () => {
      const result = parseExpiry("0");
      assert.equal(result.ms, 0);
      assert.equal(result.iso, null);
    });

    it("never returns ms:0, iso:null", () => {
      const result = parseExpiry("never");
      assert.equal(result.ms, 0);
      assert.equal(result.iso, null);
    });

    it("future ISO date is valid", () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const result = parseExpiry(future);
      assert.ok(result.ms > 0);
      assert.ok(result.iso);
    });

    it("past ISO date returns null", () => {
      const past = new Date(Date.now() - 86_400_000).toISOString();
      assert.equal(parseExpiry(past), null);
    });

    it("invalid string returns null", () => {
      assert.equal(parseExpiry("abc"), null);
      assert.equal(parseExpiry(""), null);
      assert.equal(parseExpiry("10x"), null);
    });

    it("case insensitive", () => {
      const result = parseExpiry("7D");
      assert.equal(result.ms, 7 * 86_400_000);
    });

    it("null/undefined returns null", () => {
      assert.equal(parseExpiry(null), null);
      assert.equal(parseExpiry(undefined), null);
    });
  });
});
