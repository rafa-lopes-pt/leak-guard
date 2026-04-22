// Platform-specific install command detection for external tools.
// Used by setup.js for gitleaks and 7z installation prompts.

import { platform, arch } from "node:os";

import { commandExists } from "./rc.js";

const TOOLS = {
  gitleaks: {
    linux: (cpu, version) => {
      const archMap = { x64: "x64", arm64: "arm64" };
      const gitleaksArch = archMap[cpu] || "x64";
      const url = `https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_${gitleaksArch}.tar.gz`;
      return {
        command: `curl -sSfL "${url}" | sudo tar -xz -C /usr/local/bin gitleaks`,
        fallback: "Install manually: https://github.com/gitleaks/gitleaks#installing",
      };
    },
    darwin: () => {
      if (commandExists("brew")) {
        return { command: "brew install gitleaks" };
      }
      return { fallback: "Install Homebrew first, then run: brew install gitleaks" };
    },
    win32: () => {
      if (commandExists("scoop")) {
        return { command: "scoop install gitleaks" };
      }
      return {
        fallback: "Install Scoop (https://scoop.sh), then run: scoop install gitleaks\n" +
          "Or download from: https://github.com/gitleaks/gitleaks/releases",
      };
    },
  },
  "7z": {
    linux: () => ({
      command: "sudo apt-get update -qq && sudo apt-get install -y -qq p7zip-full",
      fallback: "Try manually: sudo apt-get install p7zip-full",
    }),
    darwin: () => {
      if (commandExists("brew")) {
        return { command: "brew install p7zip" };
      }
      return { fallback: "Install Homebrew first, then run: brew install p7zip" };
    },
    win32: () => ({
      fallback: "On Windows, download 7-Zip from: https://7-zip.org\n" +
        "After installing, add 7z.exe to your PATH.",
    }),
  },
};

/**
 * Returns { command, fallback } for installing a tool on the current platform.
 * - command: shell command to run (may be null if no auto-install available)
 * - fallback: manual install instructions (shown on failure or when no command)
 * @param {string} tool - "gitleaks" or "7z"
 * @param {{ version?: string }} opts - optional version for gitleaks
 */
export function getInstallCommand(tool, opts = {}) {
  const os = platform();
  const cpu = arch();
  const entry = TOOLS[tool]?.[os];
  if (!entry) return { fallback: `No auto-install available for ${tool} on ${os}.` };
  return entry(cpu, opts.version);
}
