#!/usr/bin/env node
// Interactive setup for the public distribution channel.
// Creates a -dist repo on GitHub and configures the local project to use it.

import { confirm, input } from "@inquirer/prompts";
import { randomBytes } from "node:crypto";
import { existsSync, copyFileSync, mkdirSync, chmodSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { REPO_ROOT, commandExists, run, isGitRepo, ensureGitignoreEntry, writeRc } from "./lib/rc.js";
import { banner, ok, info, warn, error, hint, label, filePath, gap } from "./lib/ui.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function setupDist() {
  try {
    await run_setup();
  } catch (e) {
    if (e.name === "ExitPromptError") {
      console.log("\nSetup cancelled.");
      process.exit(0);
    }
    throw e;
  }
}

async function run_setup() {
  banner("LeakGuard Distribution Setup");

  // 1. Verify git repo
  if (!isGitRepo()) {
    error("Current directory is not a git repository.");
    process.exit(1);
  }

  // 2. Check gh CLI
  if (!commandExists("gh")) {
    error("gh CLI is required for distribution setup.");
    hint("Install it from: https://cli.github.com/");
    process.exit(1);
  }

  try {
    run("gh auth status");
  } catch {
    error("gh CLI is not authenticated. Run 'gh auth login' first.");
    process.exit(1);
  }

  // 3. Parse org/repo from git remote
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
    error("Could not parse git remote origin.");
    process.exit(1);
  }

  if (!org || !repo) {
    error("Could not determine org/repo from remote.");
    process.exit(1);
  }

  // 4. Derive dist repo name
  const distRepoName = `${repo}-dist`;
  const distRepo = `${org}/${distRepoName}`;

  label("Source repo", `${org}/${repo}`);
  label("Dist repo", distRepo);
  gap();

  // 5. Check if -dist repo already exists
  let repoExists = false;
  try {
    run(`gh repo view ${distRepo}`);
    repoExists = true;
    ok(`${distRepo} already exists on GitHub.`);
    gap();
  } catch {
    // repo doesn't exist yet
  }

  // 6. Create if needed
  if (!repoExists) {
    const create = await confirm({
      message: `Create public repo ${distRepo}?`,
      default: true,
    });

    if (!create) {
      warn("Aborted. Create the repo manually, then run `leakguard setup-dist` again.");
      return;
    }

    try {
      run(`gh repo create ${distRepo} --public --confirm`);
      ok(`Created ${distRepo}.`);
      gap();
    } catch (e) {
      error(`Failed to create repo: ${e.message}`);
      process.exit(1);
    }
  }

  // 7. Bootstrap -dist repo with leakguard config
  const bootstrap = repoExists
    ? await confirm({ message: "Re-bootstrap -dist repo with leakguard config?", default: false })
    : true;

  if (bootstrap) {
    await bootstrapDistRepo(distRepo);
  }

  // 8. Prompt for public directory name
  const distFolder = await input({
    message: "Local distribution folder name:",
    default: "public-dist",
  });

  // 9. Create the directory with .gitkeep if it doesn't exist
  const folderPath = join(REPO_ROOT, distFolder);
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true });
    writeFileSync(join(folderPath, ".gitkeep"), "");
    ok(`Created ${filePath(distFolder + "/")} with .gitkeep`);
  }

  // 10. Add the directory to .gitignore
  ensureGitignoreEntry(distFolder + "/");

  // 11. Write .leakguardrc
  writeRc({ distFolder, distRepo });

  // 12. Summary
  banner("Distribution Setup Complete");
  label("Dist repo", distRepo);
  label("Dist folder", distFolder + "/");
  label("Config", filePath(".leakguardrc"));
  gap();
  hint(`Add files to ${filePath(distFolder + "/")}, then run \`leakguard deploy\` to publish.`);
}

async function bootstrapDistRepo(distRepo) {
  const cloneTmp = join(tmpdir(), `leakguard-setup-dist-${randomBytes(8).toString("hex")}`);

  try {
    // Derive clone URL from current repo's remote style
    const origin = run("git remote get-url origin");
    let cloneUrl;
    if (origin.startsWith("git@")) {
      const host = origin.split(":")[0];
      cloneUrl = `${host}:${distRepo}.git`;
    } else {
      const url = new URL(origin);
      cloneUrl = `${url.protocol}//${url.host}/${distRepo}.git`;
    }

    info("Bootstrapping -dist repo with leakguard config...");
    run(`git clone "${cloneUrl}" "${cloneTmp}"`, { stdio: "pipe" });

    // Copy .gitleaks.toml
    const gitleaksConfig = join(PROJECT_ROOT, ".gitleaks.toml");
    if (existsSync(gitleaksConfig)) {
      copyFileSync(gitleaksConfig, join(cloneTmp, ".gitleaks.toml"));
    }

    // Copy workflow
    const workflowSrc = join(PROJECT_ROOT, "workflows", "secret-scan.yml");
    if (existsSync(workflowSrc)) {
      const wfDir = join(cloneTmp, ".github", "workflows");
      mkdirSync(wfDir, { recursive: true });
      copyFileSync(workflowSrc, join(wfDir, "secret-scan.yml"));
    }

    // Copy .security-filetypes (from source repo or default)
    const srcFileTypes = join(REPO_ROOT, ".security-filetypes");
    const defaultFileTypes = join(PROJECT_ROOT, ".security-filetypes.default");
    if (existsSync(srcFileTypes)) {
      copyFileSync(srcFileTypes, join(cloneTmp, ".security-filetypes"));
    } else if (existsSync(defaultFileTypes)) {
      copyFileSync(defaultFileTypes, join(cloneTmp, ".security-filetypes"));
    }

    // Create .gitignore
    writeFileSync(join(cloneTmp, ".gitignore"), ".security-key\nreports/\n");

    // Install pre-commit-dist hook
    const distHookSrc = join(PROJECT_ROOT, "scripts", "hooks", "pre-commit-dist");
    if (existsSync(distHookSrc)) {
      const hookDir = join(cloneTmp, ".git", "hooks");
      mkdirSync(hookDir, { recursive: true });
      copyFileSync(distHookSrc, join(hookDir, "pre-commit"));
      chmodSync(join(hookDir, "pre-commit"), 0o755);
    }

    // Commit and push
    run(`git -C "${cloneTmp}" add -A`);
    const status = run(`git -C "${cloneTmp}" status --porcelain`);
    if (status) {
      run(`git -C "${cloneTmp}" commit -m "Add leakguard security config"`);
      run(`git -C "${cloneTmp}" push`, { stdio: "pipe" });
      ok("Pushed leakguard config to -dist repo.");
      gap();
    } else {
      info("-dist repo already has leakguard config.");
      gap();
    }
  } catch (e) {
    warn(`Could not bootstrap -dist repo: ${e.message}`);
    const proceed = await confirm({ message: "Continue without bootstrap?", default: false });
    if (!proceed) process.exit(1);
  } finally {
    rmSync(cloneTmp, { recursive: true, force: true });
  }
}
