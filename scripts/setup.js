#!/usr/bin/env node
// Interactive TUI setup for GitHub security hardening.
// Run from any repo root: node /path/to/github-security/scripts/setup.js
//
// Cross-platform: works on Linux, macOS, and Windows (Git Bash / PowerShell).

import { select, checkbox, confirm, input } from "@inquirer/prompts";
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { REPO_ROOT, commandExists, run, isGitRepo, ensureGitignoreEntry } from "./lib/rc.js";
import { promptDeployConfig } from "./lib/deploy-config.js";
import { getInstallCommand } from "./lib/installer.js";
import { banner, header, ok, info, warn, error, done, skip, hint, cmd, filePath, gap, list, numberedList } from "./lib/ui.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const PKG = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8"));

const TOTAL_STEPS = 7;

function syncGitHubSecret(keyFile) {
  if (!commandExists("gh")) {
    gap();
    warn("gh CLI not found. Install it to auto-sync the key to GitHub.");
    hint("https://cli.github.com/");
    return;
  }

  try {
    run("gh auth status");
  } catch {
    gap();
    warn("gh CLI is not authenticated. Run 'gh auth login' first.");
    hint("The key was NOT synced to GitHub.");
    return;
  }

  const key = readFileSync(keyFile, "utf-8").trim();
  try {
    run(`gh secret set LEAKGUARD_SECURITY_KEY --body "${key}"`);
    ok("Synced encryption key to GitHub secret LEAKGUARD_SECURITY_KEY.");
  } catch (e) {
    warn(`Failed to sync key to GitHub: ${e.message}`);
    hint(`Set it manually: ${cmd("gh secret set LEAKGUARD_SECURITY_KEY < .security-key")}`);
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
  banner("LeakGuard Setup");

  info(`Repository: ${filePath(REPO_ROOT)}`);
  gap();
  numberedList([
    "Check/install gitleaks (secret scanner)",
    "Set up an encryption key for sensitive keyword scanning",
    "Configure a keyword blocklist (encrypted)",
    "Configure blocked file types (extensions + MIME types)",
    "Check/install 7z (for encrypted archives)",
    "Install pre-commit hook, CI workflow, and gitleaks config",
  ]);
  gap();

  if (!isGitRepo()) {
    error("Current directory is not a git repository.");
    hint("Run this script from the root of a git repository.");
    process.exit(1);
  }

  const proceed = await confirm({ message: "Continue with setup?", default: true });
  if (!proceed) process.exit(0);
}

// ---------------------------------------------------------------------------
// Step 2: Gitleaks check
// ---------------------------------------------------------------------------

async function stepGitleaks() {
  header("Gitleaks", 1, TOTAL_STEPS);

  if (commandExists("gitleaks")) {
    const version = run("gitleaks version").replace(/^v/, "");
    ok(`gitleaks is installed (v${version}).`);
    return;
  }

  warn("gitleaks is not installed.");

  const install = await confirm({
    message: "Install gitleaks now?",
    default: true,
  });

  if (!install) {
    skip("gitleaks install. The pre-commit hook will warn when gitleaks is missing.");
    return;
  }

  const version = PKG.leakguard?.gitleaksVersion || "8.21.2";
  const { command, fallback } = getInstallCommand("gitleaks", { version });

  if (command) {
    info("Installing gitleaks...");
    try {
      run(command, { stdio: "inherit" });
      ok("gitleaks installed.");
    } catch (e) {
      error(`Install failed: ${e.message}`);
      if (fallback) hint(fallback);
    }
  } else if (fallback) {
    hint(fallback);
  }
}

// ---------------------------------------------------------------------------
// Step 3: Encryption key setup
// ---------------------------------------------------------------------------

async function stepEncryptionKey() {
  header("Encryption Key", 2, TOTAL_STEPS);

  const keyFile = join(REPO_ROOT, ".security-key");

  if (existsSync(keyFile)) {
    ok(`${filePath(".security-key")} already exists.`);
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
    gap();
    done("Key generated.");
    hint("Share it with teammates via a secure channel (Signal, 1Password, in person).");
    hint("The key will NOT be displayed again after this setup.");
    gap();
    info(`Key: ${key}`);
    gap();
  } else {
    key = await input({
      message: "Paste the encryption key from your teammate:",
      validate: (v) => (v.trim().length > 0 ? true : "Key cannot be empty."),
    });
    key = key.trim();
  }

  writeFileSync(keyFile, key + "\n", { mode: 0o600 });
  ok(`Saved ${filePath(".security-key")} (permissions: owner-only read/write).`);
  syncGitHubSecret(keyFile);
}

// ---------------------------------------------------------------------------
// Step 4: Keyword list
// ---------------------------------------------------------------------------

async function stepKeywords() {
  header("Keyword List", 3, TOTAL_STEPS);

  const encFile = join(REPO_ROOT, "security-keywords.enc");

  if (existsSync(encFile)) {
    ok(`${filePath("security-keywords.enc")} already exists.`);
    hint(`Manage keywords with: ${cmd("leakguard blacklist")}`);
    return;
  }

  info("No keyword blocklist configured yet.");
  hint("After setup, add keywords with:");
  gap();
  hint(`  ${cmd("leakguard blacklist keyword1 keyword2 \"keyword 3\"")}`);
  gap();
  hint(`Run ${cmd("leakguard blacklist --help")} for all options.`);
}

// ---------------------------------------------------------------------------
// Step 5: File type blocking
// ---------------------------------------------------------------------------

async function stepFileTypes() {
  header("File Type Blocking", 4, TOTAL_STEPS);

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
  ok(`Created ${filePath(".security-filetypes")}`);
}

// ---------------------------------------------------------------------------
// Step 6: 7z check
// ---------------------------------------------------------------------------

async function step7z() {
  header("7z (Encrypted Archives)", 5, TOTAL_STEPS);

  if (commandExists("7z")) {
    ok("7z is installed.");
    return;
  }

  warn("7z is not installed.");
  hint("7z is needed to create encrypted archives for binary files that can't be scanned.");
  gap();

  const install = await confirm({ message: "Install 7z now?", default: true });
  if (!install) {
    skip("Install later if you need to commit binary files.");
    return;
  }

  const { command, fallback } = getInstallCommand("7z");

  if (command) {
    try {
      run(command, { stdio: "inherit" });
      ok("7z installed.");
    } catch {
      error(`Install failed. ${fallback || ""}`);
    }
  } else if (fallback) {
    hint(fallback);
  }
}

// ---------------------------------------------------------------------------
// Step 7: Deploy config
// ---------------------------------------------------------------------------

async function stepDeployConfig() {
  header("Deploy Configuration", 6, TOTAL_STEPS);

  const configure = await confirm({
    message: "Configure deploy defaults now?",
    default: false,
  });

  if (!configure) {
    skip(`Configure later with: ${cmd("leakguard deploy --config")}`);
    return;
  }

  await promptDeployConfig();
}

// ---------------------------------------------------------------------------
// Step 8: Summary and execution
// ---------------------------------------------------------------------------

async function stepExecute() {
  header("Summary", 7, TOTAL_STEPS);

  const actions = [];

  // What we'll do
  actions.push(`Add ${filePath(".security-key")} to .gitignore`);

  const gitleaksConfig = join(REPO_ROOT, ".gitleaks.toml");
  if (!existsSync(gitleaksConfig)) {
    actions.push(`Copy ${filePath(".gitleaks.toml")} into repo`);
  }

  const workflowDir = join(REPO_ROOT, ".github", "workflows");
  const workflowDest = join(workflowDir, "secret-scan.yml");
  if (!existsSync(workflowDest)) {
    actions.push(`Copy ${filePath("secret-scan.yml")} to .github/workflows/`);
  }

  const hookDir = join(REPO_ROOT, ".git", "hooks");
  const hookDest = join(hookDir, "pre-commit");
  actions.push(existsSync(hookDest) ? "Replace existing pre-commit hook" : "Install pre-commit hook");

  info("The following actions will be performed:");
  gap();
  list(actions);
  gap();

  const proceed = await confirm({ message: "Proceed?", default: true });
  if (!proceed) {
    warn("Setup cancelled.");
    process.exit(0);
  }

  // Execute
  gap();

  // .gitignore entries
  const gitignoreEntries = [
    ".security-key",
    "reports/",
  ];
  for (const entry of gitignoreEntries) {
    ensureGitignoreEntry(entry);
  }
  ok(`Updated ${filePath(".gitignore")}`);

  // .gitleaks.toml
  if (!existsSync(gitleaksConfig)) {
    copyFileSync(join(PROJECT_ROOT, ".gitleaks.toml"), gitleaksConfig);
    ok(`Copied ${filePath(".gitleaks.toml")}`);
  }

  // Workflow
  if (!existsSync(workflowDest)) {
    mkdirSync(workflowDir, { recursive: true });
    copyFileSync(join(PROJECT_ROOT, "workflows", "secret-scan.yml"), workflowDest);
    ok(`Copied ${filePath(".github/workflows/secret-scan.yml")}`);
  }

  // Pre-commit hook
  mkdirSync(hookDir, { recursive: true });
  copyFileSync(join(PROJECT_ROOT, "scripts", "hooks", "pre-commit"), hookDest);
  chmodSync(hookDest, 0o755);
  ok("Installed pre-commit hook");

  // Done
  banner("Setup Complete");

  info("Files to commit:");
  const commitFiles = [".gitignore"];
  if (existsSync(join(REPO_ROOT, ".gitleaks.toml"))) commitFiles.push(".gitleaks.toml");
  if (existsSync(join(REPO_ROOT, ".security-filetypes"))) commitFiles.push(".security-filetypes");
  if (existsSync(join(REPO_ROOT, ".github", "workflows", "secret-scan.yml")))
    commitFiles.push(".github/workflows/secret-scan.yml");
  if (existsSync(join(REPO_ROOT, "security-keywords.enc"))) commitFiles.push("security-keywords.enc");
  list(commitFiles.map(f => filePath(f)));

  gap();
  warn(`Do NOT commit ${filePath(".security-key")} (it is gitignored).`);
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
    await stepDeployConfig();
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
