import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("deploy-config", () => {
  let tmpDir, origCwd;
  let resolveDeployConfig, DEPLOY_DEFAULTS, writeDeployConfig;
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
      "keepArchive", "createRelease",
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
});
