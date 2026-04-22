import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

describe("installer", () => {
  let getInstallCommand;

  before(async () => {
    const mod = await import("../scripts/lib/installer.js");
    getInstallCommand = mod.getInstallCommand;
  });

  it("returns an object with command or fallback for gitleaks", () => {
    const result = getInstallCommand("gitleaks", { version: "8.21.2" });
    assert.ok(result.command || result.fallback);
  });

  it("returns an object with command or fallback for 7z", () => {
    const result = getInstallCommand("7z");
    assert.ok(result.command || result.fallback);
  });

  it("returns fallback for unknown tool", () => {
    const result = getInstallCommand("nonexistent-tool");
    assert.ok(result.fallback);
    assert.equal(result.command, undefined);
  });

  it("gitleaks command includes version string", () => {
    const result = getInstallCommand("gitleaks", { version: "8.21.2" });
    if (result.command) {
      assert.ok(result.command.includes("8.21.2"));
    }
  });
});
