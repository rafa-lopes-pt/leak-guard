#!/usr/bin/env node
// Interactive TUI setup for GitHub security hardening.
// Run from any repo root: node /path/to/github-security/scripts/setup.js
//
// Cross-platform: works on Linux, macOS, and Windows (Git Bash / PowerShell).

import { select, checkbox, confirm, input } from "@inquirer/prompts";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch, tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = process.cwd();
const IS_WINDOWS = platform() === "win32";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function commandExists(cmd) {
  try {
    execSync(IS_WINDOWS ? `where ${cmd}` : `which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts }).trim();
}

function isGitRepo() {
  try {
    run("git rev-parse --show-toplevel");
    return true;
  } catch {
    return false;
  }
}

function ensureGitignoreEntry(entry) {
  const gitignorePath = join(REPO_ROOT, ".gitignore");
  let content = "";
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf-8");
  }
  const lines = content.split("\n").map((l) => l.trim());
  if (!lines.includes(entry)) {
    const separator = content.endsWith("\n") || content === "" ? "" : "\n";
    writeFileSync(gitignorePath, content + separator + entry + "\n");
  }
}

function printHeader(text) {
  console.log(`\n--- ${text} ---\n`);
}

function syncGitHubSecret(keyFile) {
  if (!commandExists("gh")) {
    console.log("\nWARNING: gh CLI not found. Install it to auto-sync the key to GitHub.");
    console.log("  https://cli.github.com/\n");
    return;
  }

  try {
    run("gh auth status");
  } catch {
    console.log("\nWARNING: gh CLI is not authenticated. Run 'gh auth login' first.");
    console.log("  The key was NOT synced to GitHub.\n");
    return;
  }

  const key = readFileSync(keyFile, "utf-8").trim();
  try {
    run(`gh secret set LEAKGUARD_SECURITY_KEY --body "${key}"`);
    console.log("Synced encryption key to GitHub secret LEAKGUARD_SECURITY_KEY.");
  } catch (e) {
    console.log(`\nWARNING: Failed to sync key to GitHub: ${e.message}`);
    console.log("  Set it manually: gh secret set LEAKGUARD_SECURITY_KEY < .security-key\n");
  }
}

// ---------------------------------------------------------------------------
// Default file type blocklist
// ---------------------------------------------------------------------------

const DEFAULT_BLOCKED_EXTENSIONS = [
  ".exe", ".dll", ".so", ".dylib", ".bin", ".msi", ".dmg",
  ".env", ".pem", ".key", ".p12", ".pfx", ".keystore", ".jks",
  ".sqlite", ".db", ".mdb",
  ".jar", ".war", ".class",
];

const DEFAULT_BLOCKED_MIME_TYPES = [
  "image/",
  "video/",
  "audio/",
  "font/",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.",
  "application/vnd.ms-",
  "application/zip",
  "application/x-rar",
  "application/gzip",
  "application/x-iso9660-image",
];

const DEFAULT_ALLOWED_TYPES = ["application/x-7z-compressed"];

// ---------------------------------------------------------------------------
// Step 1: Welcome
// ---------------------------------------------------------------------------

async function stepWelcome() {
  console.log(`
=====================================
       LeakGuard Setup
=====================================

This tool will configure security scanning for this repository:
  ${REPO_ROOT}

It will:
  1. Check/install gitleaks (secret scanner)
  2. Set up an encryption key for sensitive keyword scanning
  3. Configure a keyword blocklist (encrypted)
  4. Configure blocked file types (extensions + MIME types)
  5. Check/install 7z (for encrypted archives)
  6. Install a pre-commit hook
  7. Copy CI workflow and gitleaks config
`);

  if (!isGitRepo()) {
    console.log("ERROR: Current directory is not a git repository.");
    console.log("Run this script from the root of a git repository.");
    process.exit(1);
  }

  const proceed = await confirm({ message: "Continue with setup?", default: true });
  if (!proceed) process.exit(0);
}

// ---------------------------------------------------------------------------
// Step 2: Gitleaks check
// ---------------------------------------------------------------------------

async function stepGitleaks() {
  printHeader("Gitleaks");

  if (commandExists("gitleaks")) {
    const version = run("gitleaks version").replace(/^v/, "");
    console.log(`gitleaks is installed (v${version}).`);
    return;
  }

  console.log("gitleaks is not installed.");

  const install = await confirm({
    message: "Install gitleaks now?",
    default: true,
  });

  if (!install) {
    console.log("Skipping gitleaks install. The pre-commit hook will warn when gitleaks is missing.");
    return;
  }

  const os = platform();
  const cpu = arch();

  if (os === "linux") {
    const archMap = { x64: "x64", arm64: "arm64" };
    const gitleaksArch = archMap[cpu] || "x64";
    const version = "8.21.2";
    const url = `https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_${gitleaksArch}.tar.gz`;
    console.log(`Downloading gitleaks v${version} for linux/${gitleaksArch}...`);
    try {
      run(`curl -sSfL "${url}" | sudo tar -xz -C /usr/local/bin gitleaks`);
      console.log("gitleaks installed to /usr/local/bin/gitleaks");
    } catch (e) {
      console.log(`Install failed: ${e.message}`);
      console.log("Install manually: https://github.com/gitleaks/gitleaks#installing");
    }
  } else if (os === "darwin") {
    if (commandExists("brew")) {
      console.log("Installing via Homebrew...");
      try {
        run("brew install gitleaks");
        console.log("gitleaks installed.");
      } catch (e) {
        console.log(`Install failed: ${e.message}`);
      }
    } else {
      console.log("Install Homebrew first, then run: brew install gitleaks");
    }
  } else if (os === "win32") {
    if (commandExists("scoop")) {
      console.log("Installing via Scoop...");
      try {
        run("scoop install gitleaks");
        console.log("gitleaks installed.");
      } catch (e) {
        console.log(`Install failed: ${e.message}`);
      }
    } else {
      console.log("Install Scoop (https://scoop.sh), then run: scoop install gitleaks");
      console.log("Or download from: https://github.com/gitleaks/gitleaks/releases");
    }
  }
}

// ---------------------------------------------------------------------------
// Step 3: Encryption key setup
// ---------------------------------------------------------------------------

async function stepEncryptionKey() {
  printHeader("Encryption Key");

  const keyFile = join(REPO_ROOT, ".security-key");

  if (existsSync(keyFile)) {
    console.log(".security-key already exists.");
    const keep = await confirm({ message: "Keep existing key?", default: true });
    if (keep) return;
  }

  const choice = await select({
    message: "Encryption key setup:",
    choices: [
      { name: "Generate a new key (first-time org setup)", value: "generate" },
      { name: "Enter an existing key (joining the team)", value: "existing" },
    ],
  });

  let key;
  if (choice === "generate") {
    key = randomBytes(32).toString("base64");
    console.log("\nGenerated key. Share it with teammates via a secure channel (Signal, 1Password, in person).");
    console.log("The key will NOT be displayed again after this setup.\n");
    console.log(`  Key: ${key}\n`);
  } else {
    key = await input({
      message: "Paste the encryption key from your teammate:",
      validate: (v) => (v.trim().length > 0 ? true : "Key cannot be empty."),
    });
    key = key.trim();
  }

  writeFileSync(keyFile, key + "\n", { mode: 0o600 });
  console.log("Saved .security-key (permissions: owner-only read/write).");
  syncGitHubSecret(keyFile);
}

// ---------------------------------------------------------------------------
// Step 4: Keyword list
// ---------------------------------------------------------------------------

async function stepKeywords() {
  printHeader("Keyword List");

  const encFile = join(REPO_ROOT, "security-keywords.enc");

  if (existsSync(encFile)) {
    console.log("security-keywords.enc already exists.");
    console.log("Manage keywords with: leakguard blacklist");
    return;
  }

  console.log("No keyword blocklist configured yet.");
  console.log("After setup, add keywords with:\n");
  console.log("  leakguard blacklist keyword1 keyword2 \"keyword 3\"\n");
  console.log("Run 'leakguard blacklist --help' for all options.");
}

// ---------------------------------------------------------------------------
// Step 5: File type blocking
// ---------------------------------------------------------------------------

async function stepFileTypes() {
  printHeader("File Type Blocking");

  const configPath = join(REPO_ROOT, ".security-filetypes");
  if (existsSync(configPath)) {
    const keep = await confirm({ message: ".security-filetypes already exists. Keep it?", default: true });
    if (keep) return;
  }

  // Blocked extensions
  const selectedExts = await checkbox({
    message: "Blocked file extensions (deselect to allow):",
    choices: DEFAULT_BLOCKED_EXTENSIONS.map((ext) => ({
      name: ext,
      value: ext,
      checked: true,
    })),
  });

  const customExts = await input({
    message: "Additional extensions to block (comma-separated, e.g. .bak,.tmp) or leave empty:",
  });
  const extraExts = customExts
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => (e.startsWith(".") ? e : `.${e}`));
  const allExts = [...new Set([...selectedExts, ...extraExts])];

  // Blocked MIME types
  const selectedMimes = await checkbox({
    message: "Blocked MIME type prefixes (deselect to allow):",
    choices: DEFAULT_BLOCKED_MIME_TYPES.map((mime) => ({
      name: mime,
      value: mime,
      checked: true,
    })),
  });

  const customMimes = await input({
    message: "Additional MIME type prefixes to block (comma-separated) or leave empty:",
  });
  const extraMimes = customMimes
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const allMimes = [...new Set([...selectedMimes, ...extraMimes])];

  // Build config
  let config = `# Security file type blocklist
# Generated by setup.js -- customize as needed

# Blocked extensions (always blocked, regardless of content)
[extensions]
${allExts.join("\n")}

# Blocked MIME type prefixes (detected via file content, not extension)
[mime-types]
${allMimes.join("\n")}

# Allowed MIME type exceptions (override above rules)
[allowed-types]
${DEFAULT_ALLOWED_TYPES.join("\n")}

# Allowed specific files (path relative to repo root, override ALL rules)
[allowed-files]
# assets/logo.png
# docs/architecture.pdf
`;

  writeFileSync(configPath, config);
  console.log("Created .security-filetypes");
}

// ---------------------------------------------------------------------------
// Step 6: 7z check
// ---------------------------------------------------------------------------

async function step7z() {
  printHeader("7z (Encrypted Archives)");

  if (commandExists("7z")) {
    console.log("7z is installed.");
    return;
  }

  console.log("7z is not installed.");
  console.log("7z is needed to create encrypted archives for binary files that can't be scanned.\n");

  const install = await confirm({ message: "Install 7z now?", default: true });
  if (!install) {
    console.log("Skipping. Install later if you need to commit binary files.");
    return;
  }

  const os = platform();
  if (os === "linux") {
    try {
      run("sudo apt-get update -qq && sudo apt-get install -y -qq p7zip-full", { stdio: "inherit" });
      console.log("7z installed.");
    } catch (e) {
      console.log("Install failed. Try manually: sudo apt-get install p7zip-full");
    }
  } else if (os === "darwin") {
    if (commandExists("brew")) {
      try {
        run("brew install p7zip", { stdio: "inherit" });
        console.log("7z installed.");
      } catch (e) {
        console.log("Install failed. Try: brew install p7zip");
      }
    } else {
      console.log("Install Homebrew first, then run: brew install p7zip");
    }
  } else {
    console.log("On Windows, download 7-Zip from: https://7-zip.org");
    console.log("After installing, add 7z.exe to your PATH.");
  }
}

// ---------------------------------------------------------------------------
// Step 7: Public Distribution
// ---------------------------------------------------------------------------

async function stepPublicDist() {
  printHeader("Public Distribution");

  const enable = await confirm({
    message: "Enable public distribution? (push curated content to a public -dist repo)",
    default: false,
  });
  if (!enable) return;

  // Parse org/repo from git remote
  let org, repo;
  try {
    const origin = run("git remote get-url origin");
    let fullName;
    if (origin.startsWith("git@")) {
      fullName = origin.split(":")[1].replace(/\.git$/, "");
    } else {
      const url = new URL(origin);
      fullName = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
    }
    [org, repo] = fullName.split("/");
  } catch {
    console.log("WARNING: Could not parse git remote. Skipping distribution setup.");
    return;
  }

  if (!org || !repo) {
    console.log("WARNING: Could not determine org/repo from remote. Skipping.");
    return;
  }

  const distFolder = await input({
    message: "Distribution folder path:",
    default: "public-dist",
  });

  const distRepoName = `${repo}-dist`;
  const distRepo = `${org}/${distRepoName}`;

  // Check gh CLI
  if (!commandExists("gh")) {
    console.log("\nWARNING: gh CLI not found. Install it to auto-create the -dist repo.");
    console.log("  https://cli.github.com/");
    console.log(`\nManual step: create ${distRepo} on GitHub, then run \`leakguard deploy\`.`);
    writeRc(distFolder, distRepo);
    createDistFolder(distFolder);
    return;
  }

  try {
    run("gh auth status");
  } catch {
    console.log("\nWARNING: gh CLI is not authenticated. Run 'gh auth login' first.");
    console.log(`\nManual step: create ${distRepo} on GitHub, then run \`leakguard deploy\`.`);
    writeRc(distFolder, distRepo);
    createDistFolder(distFolder);
    return;
  }

  // Check if -dist repo exists
  let repoExists = false;
  try {
    run(`gh repo view ${distRepo}`);
    repoExists = true;
    console.log(`\n${distRepo} already exists.`);
  } catch {
    // repo doesn't exist yet
  }

  if (!repoExists) {
    const create = await confirm({
      message: `Create public repo ${distRepo}?`,
      default: true,
    });

    if (create) {
      try {
        run(`gh repo create ${distRepo} --public --confirm`);
        console.log(`Created ${distRepo}.`);
      } catch (e) {
        console.log(`WARNING: Failed to create repo: ${e.message}`);
        console.log(`Create it manually on GitHub, then run \`leakguard deploy\`.`);
        writeRc(distFolder, distRepo);
        createDistFolder(distFolder);
        return;
      }

      // Bootstrap -dist repo with leakguard protection
      const cloneTmp = join(tmpdir(), `leakguard-init-dist-${Date.now()}`);
      try {
        const origin = run("git remote get-url origin");
        let cloneUrl;
        if (origin.startsWith("git@")) {
          const host = origin.split(":")[0];
          cloneUrl = `${host}:${distRepo}.git`;
        } else {
          const url = new URL(origin);
          cloneUrl = `${url.protocol}//${url.host}/${distRepo}.git`;
        }

        run(`git clone "${cloneUrl}" "${cloneTmp}"`, { stdio: "pipe" });

        // Copy leakguard config files
        const gitleaksConfig = join(PROJECT_ROOT, ".gitleaks.toml");
        if (existsSync(gitleaksConfig)) {
          copyFileSync(gitleaksConfig, join(cloneTmp, ".gitleaks.toml"));
        }

        const workflowSrc = join(PROJECT_ROOT, "workflows", "secret-scan.yml");
        if (existsSync(workflowSrc)) {
          const wfDir = join(cloneTmp, ".github", "workflows");
          mkdirSync(wfDir, { recursive: true });
          copyFileSync(workflowSrc, join(wfDir, "secret-scan.yml"));
        }

        // Copy .security-filetypes from source repo if available, otherwise from default
        const srcFileTypes = join(REPO_ROOT, ".security-filetypes");
        const defaultFileTypes = join(PROJECT_ROOT, ".security-filetypes.default");
        if (existsSync(srcFileTypes)) {
          copyFileSync(srcFileTypes, join(cloneTmp, ".security-filetypes"));
        } else if (existsSync(defaultFileTypes)) {
          copyFileSync(defaultFileTypes, join(cloneTmp, ".security-filetypes"));
        }

        // Create .gitignore with standard leakguard entries
        writeFileSync(join(cloneTmp, ".gitignore"), ".security-key\nreports/\n");

        // Install dist-specific pre-commit hook (allowlist: only .7z + config)
        const distHookSrc = join(PROJECT_ROOT, "scripts", "hooks", "pre-commit-dist");
        if (existsSync(distHookSrc)) {
          const hookDir = join(cloneTmp, ".git", "hooks");
          mkdirSync(hookDir, { recursive: true });
          copyFileSync(distHookSrc, join(hookDir, "pre-commit"));
          chmodSync(join(hookDir, "pre-commit"), 0o755);
        }

        run(`git -C "${cloneTmp}" add -A`);
        const status = run(`git -C "${cloneTmp}" status --porcelain`);
        if (status) {
          run(`git -C "${cloneTmp}" commit -m "Add leakguard security config"`);
          run(`git -C "${cloneTmp}" push`, { stdio: "pipe" });
          console.log("Pushed leakguard config to -dist repo.");
        }
      } catch (e) {
        console.log(`WARNING: Could not bootstrap -dist repo: ${e.message}`);
      } finally {
        rmSync(cloneTmp, { recursive: true, force: true });
      }
    }
  }

  writeRc(distFolder, distRepo);
  createDistFolder(distFolder);
}

function writeRc(distFolder, distRepo) {
  const rcPath = join(REPO_ROOT, ".leakguardrc");
  const rc = existsSync(rcPath) ? JSON.parse(readFileSync(rcPath, "utf-8")) : {};
  rc.distFolder = distFolder;
  rc.distRepo = distRepo;
  writeFileSync(rcPath, JSON.stringify(rc, null, 2) + "\n");
  console.log(`Saved .leakguardrc (distFolder: ${distFolder}, distRepo: ${distRepo})`);
}

function createDistFolder(distFolder) {
  const folderPath = join(REPO_ROOT, distFolder);
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true });
    writeFileSync(join(folderPath, ".gitkeep"), "");
    console.log(`Created ${distFolder}/ with .gitkeep`);
  }
}

// ---------------------------------------------------------------------------
// Step 8: Summary and execution
// ---------------------------------------------------------------------------

async function stepExecute() {
  printHeader("Summary");

  const actions = [];

  // What we'll do
  actions.push("Add .security-key to .gitignore");

  const gitleaksConfig = join(REPO_ROOT, ".gitleaks.toml");
  if (!existsSync(gitleaksConfig)) {
    actions.push("Copy .gitleaks.toml into repo");
  }

  const workflowDir = join(REPO_ROOT, ".github", "workflows");
  const workflowDest = join(workflowDir, "secret-scan.yml");
  if (!existsSync(workflowDest)) {
    actions.push("Copy secret-scan.yml to .github/workflows/");
  }

  const hookDir = join(REPO_ROOT, ".git", "hooks");
  const hookDest = join(hookDir, "pre-commit");
  actions.push(existsSync(hookDest) ? "Replace existing pre-commit hook" : "Install pre-commit hook");

  console.log("The following actions will be performed:\n");
  actions.forEach((a) => console.log(`  - ${a}`));
  console.log();

  const proceed = await confirm({ message: "Proceed?", default: true });
  if (!proceed) {
    console.log("Setup cancelled.");
    process.exit(0);
  }

  // Execute
  console.log();

  // .gitignore entries
  const gitignoreEntries = [
    ".security-key",
    "reports/",
  ];
  for (const entry of gitignoreEntries) {
    ensureGitignoreEntry(entry);
  }
  console.log("Updated .gitignore");

  // .gitleaks.toml
  if (!existsSync(gitleaksConfig)) {
    copyFileSync(join(PROJECT_ROOT, ".gitleaks.toml"), gitleaksConfig);
    console.log("Copied .gitleaks.toml");
  }

  // Workflow
  if (!existsSync(workflowDest)) {
    mkdirSync(workflowDir, { recursive: true });
    copyFileSync(join(PROJECT_ROOT, "workflows", "secret-scan.yml"), workflowDest);
    console.log("Copied .github/workflows/secret-scan.yml");
  }

  // Pre-commit hook
  mkdirSync(hookDir, { recursive: true });
  copyFileSync(join(PROJECT_ROOT, "scripts", "hooks", "pre-commit"), hookDest);
  chmodSync(hookDest, 0o755);
  console.log("Installed pre-commit hook");

  // Done
  printHeader("Setup Complete");

  console.log("Files to commit:");
  console.log("  - .gitignore");
  if (existsSync(join(REPO_ROOT, ".gitleaks.toml"))) console.log("  - .gitleaks.toml");
  if (existsSync(join(REPO_ROOT, ".security-filetypes"))) console.log("  - .security-filetypes");
  if (existsSync(join(REPO_ROOT, ".github", "workflows", "secret-scan.yml")))
    console.log("  - .github/workflows/secret-scan.yml");
  if (existsSync(join(REPO_ROOT, "security-keywords.enc"))) console.log("  - security-keywords.enc");

  console.log("\nDo NOT commit .security-key (it is gitignored).");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  try {
    await stepWelcome();
    await stepGitleaks();
    await stepEncryptionKey();
    await stepKeywords();
    await stepFileTypes();
    await step7z();
    await stepPublicDist();
    await stepExecute();
  } catch (e) {
    if (e.name === "ExitPromptError") {
      console.log("\nSetup cancelled.");
      process.exit(0);
    }
    throw e;
  }
}

export { main };
