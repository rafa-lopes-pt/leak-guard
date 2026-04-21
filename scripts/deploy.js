#!/usr/bin/env node
// Deploy curated content from a local folder to a public -dist repo.
// Scans for secrets, creates an encrypted .7z, pushes to the -dist repo.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { confirm } from "@inquirer/prompts";

const REPO_ROOT = process.cwd();
const RC_FILE = join(REPO_ROOT, ".leakguardrc");
const KEY_FILE = join(REPO_ROOT, ".security-key");
const ENC_FILE = join(REPO_ROOT, "security-keywords.enc");
const IS_WINDOWS = process.platform === "win32";

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
  const result = execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts });
  return result == null ? "" : result.trim();
}

function isGitRepo() {
  try {
    run("git rev-parse --show-toplevel");
    return true;
  } catch {
    return false;
  }
}

function readRc() {
  if (!existsSync(RC_FILE)) return null;
  try {
    return JSON.parse(readFileSync(RC_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function hasContent(dir) {
  const entries = readdirSync(dir);
  return entries.some((e) => e !== ".gitkeep");
}

function makeTmpDir(prefix) {
  const dir = join(tmpdir(), `leakguard-${prefix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function deriveCloneUrl(distRepo) {
  try {
    const origin = run("git remote get-url origin");
    if (origin.startsWith("git@")) {
      // git@github.com:org/repo.git -> git@github.com:org/repo-dist.git
      const host = origin.split(":")[0];
      return `${host}:${distRepo}.git`;
    }
    // https://github.com/org/repo.git -> https://github.com/org/repo-dist.git
    const url = new URL(origin);
    return `${url.protocol}//${url.host}/${distRepo}.git`;
  } catch {
    return `https://github.com/${distRepo}.git`;
  }
}

// ---------------------------------------------------------------------------
// GitHub Release
// ---------------------------------------------------------------------------

function createRelease(distRepo, archivePath, archiveName) {
  if (!commandExists("gh")) {
    console.log("WARNING: gh CLI not found -- skipping GitHub Release creation.");
    return;
  }

  console.log("\nCreating GitHub Release...");
  try {
    // Try uploading to an existing "latest" release first
    run(`gh release upload latest "${archivePath}" --clobber --repo "${distRepo}"`);
    console.log("  Updated asset on existing 'latest' release.");
  } catch {
    // No existing release -- create one
    try {
      run(
        `gh release create latest "${archivePath}" --repo "${distRepo}" ` +
          `--title "Latest Distribution" --notes "Automated release created by leakguard deploy."`,
      );
      console.log("  Created new 'latest' release.");
    } catch (e) {
      console.log(`WARNING: Could not create GitHub Release. The archive was pushed to the repo.`);
      console.log(`  ${e.message}`);
      return;
    }
  }

  console.log(`  Release: https://github.com/${distRepo}/releases/tag/latest`);
  console.log(`  Direct:  https://github.com/${distRepo}/releases/download/latest/${archiveName}`);
}

// ---------------------------------------------------------------------------
// Security scans
// ---------------------------------------------------------------------------

function scanGitleaks(sourceDir) {
  const configPath = join(REPO_ROOT, ".gitleaks.toml");
  const configArg = existsSync(configPath) ? `--config "${configPath}"` : "";
  const result = spawnSync(
    "gitleaks",
    ["detect", "--no-git", "--source", sourceDir, ...(configArg ? ["--config", configPath] : [])],
    { encoding: "utf-8", stdio: "pipe" },
  );
  if (result.status !== 0 && result.status !== null) {
    console.error("\nERROR: gitleaks found secrets in the distribution folder:\n");
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    return false;
  }
  return true;
}

function scanKeywords(sourceDir) {
  if (!existsSync(ENC_FILE) || !existsSync(KEY_FILE)) return true;

  let keywords;
  try {
    const raw = execSync(
      `openssl enc -aes-256-cbc -pbkdf2 -d -in "${ENC_FILE}" -pass "file:${KEY_FILE}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    keywords = raw.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  } catch {
    console.error("WARNING: Could not decrypt keyword list. Skipping keyword scan.");
    return true;
  }

  if (keywords.length === 0) return true;

  const matches = [];
  for (const kw of keywords) {
    try {
      run(`grep -ril "${kw.replace(/"/g, '\\"')}" "${sourceDir}"`);
      matches.push(kw);
    } catch {
      // grep exits non-zero when no match -- that's fine
    }
  }

  if (matches.length > 0) {
    console.error(`\nERROR: Blocked keywords found in distribution folder:`);
    for (const m of matches) {
      console.error(`  - "${m}"`);
    }
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Main deploy flow
// ---------------------------------------------------------------------------

export async function deploy(args) {
  const flags = new Set((args || []).filter((a) => a.startsWith("--")));
  const noRelease = flags.has("--no-release");
  const skipConfirm = flags.has("--yes") || flags.has("-y") || (args || []).includes("-y");
  const dryRun = flags.has("--dry-run");
  const positional = (args || []).filter((a) => !a.startsWith("--") && a !== "-y");

  // 1. Resolve source path
  const rc = readRc();
  let sourceDir;

  if (positional.length > 0) {
    sourceDir = resolve(positional[0]);
  } else if (rc?.distFolder) {
    sourceDir = resolve(REPO_ROOT, rc.distFolder);
  } else if (rc) {
    sourceDir = resolve(REPO_ROOT, "public-dist");
  } else {
    console.error("ERROR: No .leakguardrc found. Run `leakguard setup-dist` first.");
    process.exit(1);
  }

  // Create folder if it doesn't exist
  if (!existsSync(sourceDir)) {
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, ".gitkeep"), "");
    console.log(`Created ${basename(sourceDir)}/. Add files to distribute, then run \`leakguard deploy\` again.`);
    return;
  }

  // 2. Validate
  if (!isGitRepo()) {
    console.error("ERROR: Not a git repository.");
    process.exit(1);
  }

  if (!hasContent(sourceDir)) {
    console.error(`ERROR: ${basename(sourceDir)}/ is empty. Add files before deploying.`);
    process.exit(1);
  }

  if (!commandExists("gitleaks")) {
    console.error("ERROR: gitleaks is not installed. Run `leakguard init` to install it.");
    process.exit(1);
  }

  if (!commandExists("7z")) {
    console.error("ERROR: 7z is not installed. Run `leakguard init` to install it.");
    process.exit(1);
  }

  // 3. Derive target repo
  const distRepo = rc?.distRepo;
  if (!distRepo) {
    console.error("ERROR: No distRepo configured in .leakguardrc. Run `leakguard setup-dist` first.");
    process.exit(1);
  }

  const cloneUrl = deriveCloneUrl(distRepo);
  const fileCount = readdirSync(sourceDir).filter((e) => e !== ".gitkeep").length;
  const archiveName = basename(sourceDir) + ".7z";

  // 4. Confirm
  console.log(`\nDeploy summary:`);
  console.log(`  Source:  ${sourceDir} (${fileCount} file(s))`);
  console.log(`  Target:  ${distRepo}`);
  console.log(`  Archive: ${archiveName}`);
  console.log(`  Release: ${noRelease ? "skipped (--no-release)" : "latest (GitHub Release)"}`);
  if (dryRun) console.log(`  Mode:    dry-run (will not push or create release)`);
  console.log();

  if (!skipConfirm) {
    const proceed = await confirm({ message: "Continue with deploy?", default: true });
    if (!proceed) {
      console.log("Deploy cancelled.");
      return;
    }
  }

  // 5. Security scans
  console.log("\nScanning for secrets...");

  const gitleaksOk = scanGitleaks(sourceDir);
  if (!gitleaksOk) {
    console.error("\nDeploy aborted. Fix the issues above before deploying.");
    process.exit(1);
  }
  console.log("  gitleaks: clean");

  const keywordsOk = scanKeywords(sourceDir);
  if (!keywordsOk) {
    console.error("\nDeploy aborted. Remove blocked keywords before deploying.");
    process.exit(1);
  }
  console.log("  keywords: clean");

  // 6. Create .7z
  const archiveTmp = makeTmpDir("archive");
  const archivePath = join(archiveTmp, archiveName);

  console.log(`\nCreating encrypted archive: ${archiveName}`);
  console.log("Enter a password for the archive:\n");

  const zipResult = spawnSync(
    "7z",
    ["a", "-p", "-mhe=on", archivePath, join(sourceDir, "*")],
    { stdio: "inherit" },
  );

  if (zipResult.status !== 0) {
    rmSync(archiveTmp, { recursive: true, force: true });
    console.error("\nERROR: Archive creation failed.");
    process.exit(1);
  }

  if (dryRun) {
    console.log(`\nDry run complete. Archive created at: ${archivePath}`);
    console.log("No changes were pushed.");
    rmSync(archiveTmp, { recursive: true, force: true });
    return;
  }

  // 7. Clone -dist repo, replace archive, push
  const cloneTmp = makeTmpDir("clone");
  try {
    console.log(`\nCloning ${distRepo}...`);
    try {
      run(`git clone --depth 1 "${cloneUrl}" "${cloneTmp}"`, { stdio: "pipe" });
    } catch (e) {
      console.error(`ERROR: Failed to clone ${distRepo}. Does the repo exist?`);
      console.error("Run `leakguard setup-dist` to create it.\n");
      console.error(e.message);
      process.exit(1);
    }

    // Remove only the matching archive (preserve other .7z files)
    const existingArchive = join(cloneTmp, archiveName);
    if (existsSync(existingArchive)) {
      rmSync(existingArchive);
    }

    // Copy new archive
    copyFileSync(archivePath, join(cloneTmp, archiveName));

    // Commit and push
    run(`git -C "${cloneTmp}" add "${archiveName}"`);

    const statusOutput = run(`git -C "${cloneTmp}" status --porcelain`);
    if (!statusOutput) {
      console.log("\nNo changes to deploy (archive is identical).");
      return;
    }

    run(`git -C "${cloneTmp}" commit -m "Update ${archiveName}"`);
    console.log("Pushing to remote...");
    run(`git -C "${cloneTmp}" push`, { stdio: "inherit" });

    console.log(`\nDeployed ${archiveName} to ${distRepo}.`);

    if (!noRelease) {
      createRelease(distRepo, archivePath, archiveName);
    }
  } finally {
    rmSync(archiveTmp, { recursive: true, force: true });
    rmSync(cloneTmp, { recursive: true, force: true });
  }
}
