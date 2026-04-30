#!/usr/bin/env node
// Deploy curated content from a local folder to a public -dist repo.
// Scans for secrets, creates an encrypted .7z or chunked archive, pushes to the -dist repo.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createCipheriv, createHash, randomBytes, pbkdf2Sync } from "node:crypto";
import { confirm, password } from "@inquirer/prompts";

import { REPO_ROOT, ENC_FILE, KEY_FILE, commandExists, run, isGitRepo, readRc } from "./lib/rc.js";
import { resolveDeployConfig, promptDeployConfig, applyKeyValueConfig, parseChunkSize, parseExpiry } from "./lib/deploy-config.js";
import { decryptKeywords } from "./lib/crypto.js";
import { loadPassword, savePassword, clearPassword, hasSavedPassword } from "./lib/deploy-password.js";
import { header, ok, info, warn, error, done, skip, label, hint, filePath, gap } from "./lib/ui.js";

// ---------------------------------------------------------------------------
// Local helpers (deploy-specific, not shared)
// ---------------------------------------------------------------------------

function hasContent(dir) {
  const entries = readdirSync(dir);
  return entries.some((e) => e !== ".gitkeep");
}

function makeTmpDir(prefix) {
  const dir = join(tmpdir(), `leakguard-${prefix}-${randomBytes(8).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function deriveCloneUrl(distRepo) {
  try {
    const origin = run("git remote get-url origin");
    if (origin.startsWith("git@")) {
      const host = origin.split(":")[0];
      return `${host}:${distRepo}.git`;
    }
    const url = new URL(origin);
    return `${url.protocol}//${url.host}/${distRepo}.git`;
  } catch {
    return `https://github.com/${distRepo}.git`;
  }
}

function resolveArchiveName(template, folderName) {
  return template.replace(/\{folder\}/g, folderName);
}

function resolveCommitMessage(template, replacements) {
  let msg = template;
  for (const [key, value] of Object.entries(replacements)) {
    msg = msg.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return msg;
}

// ---------------------------------------------------------------------------
// Chunked deploy helpers
// ---------------------------------------------------------------------------

function encryptString(str, passphrase) {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(passphrase, salt, 100000, 32, "sha256");
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(str, "utf-8"), cipher.final()]);
  return Buffer.concat([salt, iv, encrypted]).toString("base64");
}

function generateSortableNames(count) {
  const seen = new Set();
  const names = [];
  for (let i = 0; i < count; i++) {
    let name;
    do { name = randomBytes(8).toString("hex"); } while (seen.has(name));
    seen.add(name);
    names.push(name);
  }
  names.sort();
  return names.map((n) => `${n}.nofbiz`);
}

function writeChecksumFile(buffer, chunkNames, outputDir) {
  const hash = createHash("sha256").update(buffer).digest("hex");
  let content = "# Checksums\n\n";

  if (chunkNames && chunkNames.length > 0) {
    content += "Only the first checksum is the real SHA-256 of the original archive.\n";
    content += "The remaining hashes are random decoys.\n\n";
    content += `${chunkNames[0]}:\n\`\`\`\n${hash}\n\`\`\`\n`;
    for (let i = 1; i < chunkNames.length; i++) {
      content += `${chunkNames[i]}: \`${randomBytes(32).toString("hex")}\`\n`;
    }
  } else {
    content += `SHA-256:\n\`\`\`\n${hash}\n\`\`\`\n`;
  }

  const fp = join(outputDir, "README.md");
  writeFileSync(fp, content);
  return { sourcePath: fp, destName: "README.md" };
}

function splitAndWrite(text, chunkSize, outputDir, names) {
  const files = [];
  for (let i = 0; i < names.length; i++) {
    const chunk = text.slice(i * chunkSize, (i + 1) * chunkSize);
    const fp = join(outputDir, names[i]);
    writeFileSync(fp, chunk);
    files.push({ sourcePath: fp, destName: names[i] });
  }
  return files;
}

// ---------------------------------------------------------------------------
// Push to -dist repo
// ---------------------------------------------------------------------------

function pushToDist(cloneUrl, distRepo, files, commitMsg) {
  const cloneTmp = makeTmpDir("clone");
  try {
    info(`Cloning ${distRepo}...`);
    try {
      run(`git clone --depth 1 "${cloneUrl}" "${cloneTmp}"`, { stdio: "pipe" });
    } catch (e) {
      error(`Failed to clone ${distRepo}. Does the repo exist?`);
      hint("Run `leakguard setup-dist` to create it.");
      error(e.message);
      process.exit(1);
    }

    // Remove all existing files (except .git/)
    for (const entry of readdirSync(cloneTmp)) {
      if (entry === ".git") continue;
      rmSync(join(cloneTmp, entry), { recursive: true, force: true });
    }

    // Copy new files
    for (const { sourcePath, destName } of files) {
      const dest = join(cloneTmp, destName);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(sourcePath, dest);
    }

    // Stage all changes (additions + deletions from the wipe)
    run(`git -C "${cloneTmp}" add -A`);

    const statusOutput = run(`git -C "${cloneTmp}" status --porcelain`);
    if (!statusOutput) {
      info("No changes to deploy (content is identical).");
      return false;
    }

    const commitResult = spawnSync("git", ["-C", cloneTmp, "commit", "-m", commitMsg], { encoding: "utf-8", stdio: "pipe" });
    if (commitResult.status !== 0) {
      error("git commit failed.");
      if (commitResult.stderr) console.error(commitResult.stderr);
      process.exit(1);
    }
    info("Pushing to remote...");
    run(`git -C "${cloneTmp}" push`, { stdio: "inherit" });
    return true;
  } finally {
    rmSync(cloneTmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// GitHub Release
// ---------------------------------------------------------------------------

function createRelease(distRepo, archivePath, archiveName) {
  if (!commandExists("gh")) {
    warn("gh CLI not found -- skipping GitHub Release creation.");
    return;
  }

  info("Creating GitHub Release...");
  try {
    run(`gh release upload latest "${archivePath}" --clobber --repo "${distRepo}"`);
    ok("Updated asset on existing 'latest' release.");
  } catch {
    try {
      run(
        `gh release create latest "${archivePath}" --repo "${distRepo}" ` +
          `--title "Latest Distribution" --notes "Automated release created by leakguard deploy."`,
      );
      ok("Created new 'latest' release.");
    } catch (e) {
      warn("Could not create GitHub Release. The archive was pushed to the repo.");
      hint(e.message);
      return;
    }
  }

  info(`Release: https://github.com/${distRepo}/releases/tag/latest`);
  info(`Direct:  https://github.com/${distRepo}/releases/download/latest/${archiveName}`);
}

// ---------------------------------------------------------------------------
// Security scans
// ---------------------------------------------------------------------------

function scanGitleaks(sourceDir) {
  const configPath = join(REPO_ROOT, ".gitleaks.toml");
  const result = spawnSync(
    "gitleaks",
    ["detect", "--no-git", "--source", sourceDir, ...(existsSync(configPath) ? ["--config", configPath] : [])],
    { encoding: "utf-8", stdio: "pipe" },
  );
  if (result.status === null) {
    error(`gitleaks was killed by signal ${result.signal}`);
    return false;
  }
  if (result.status !== 0) {
    error("gitleaks found secrets in the distribution folder:");
    gap();
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    return false;
  }
  return true;
}

function scanKeywords(sourceDir) {
  if (!existsSync(ENC_FILE) || !existsSync(KEY_FILE)) return true;

  const keywords = decryptKeywords();
  if (!keywords) {
    error("Could not decrypt keyword list. Deploy blocked.");
    return false;
  }

  if (keywords.length === 0) return true;

  const matches = [];
  for (const kw of keywords) {
    const result = spawnSync("grep", ["-rilF", kw, sourceDir], { encoding: "utf-8", stdio: "pipe" });
    if (result.status === 0) matches.push(kw);
  }

  if (matches.length > 0) {
    error("Blocked keywords found in distribution folder:");
    for (const m of matches) {
      console.error(`    - "${m}"`);
    }
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Deploy expiration
// ---------------------------------------------------------------------------

function generateExpireWorkflow() {
  return `name: Check deploy expiry
on:
  schedule:
    - cron: "0 * * * *"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  check-expiry:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check expiry
        env:
          GH_TOKEN: \${{ secrets.LEAKGUARD_EXPIRE_TOKEN || '' }}
        run: |
          if [ ! -f .expiry ]; then
            echo "No .expiry file found, skipping."
            exit 0
          fi

          EXPIRY=$(cat .expiry | tr -d '[:space:]')
          NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

          if [[ "$NOW" < "$EXPIRY" ]]; then
            echo "Not expired yet. Expiry: $EXPIRY, Now: $NOW"
            exit 0
          fi

          echo "Content has expired ($EXPIRY). Cleaning up..."

          REPO="\${{ github.repository }}"
          if [ -n "$GH_TOKEN" ]; then
            echo "LEAKGUARD_EXPIRE_TOKEN found -- deleting repository."
            gh api -X DELETE "repos/$REPO" --silent || echo "Repo deletion failed (check token permissions)."
          else
            echo "No LEAKGUARD_EXPIRE_TOKEN -- wiping content."
            git checkout --orphan expired
            git rm -rf . 2>/dev/null || true
            echo "# Content Expired" > README.md
            echo "" >> README.md
            echo "This deployment expired on $EXPIRY and has been automatically removed." >> README.md
            git add README.md
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git commit -m "Content expired"
            git push --force origin expired:main
          fi
`;
}

function generateExpiryFiles(expiryIso, outputDir) {
  const files = [];

  const expiryPath = join(outputDir, ".expiry");
  writeFileSync(expiryPath, expiryIso);
  files.push({ sourcePath: expiryPath, destName: ".expiry" });

  const workflowDir = join(outputDir, ".github", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  const workflowPath = join(workflowDir, "expire.yml");
  writeFileSync(workflowPath, generateExpireWorkflow());
  files.push({ sourcePath: workflowPath, destName: ".github/workflows/expire.yml" });

  return files;
}

// ---------------------------------------------------------------------------
// Main deploy flow
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Password resolution: stored -> prompt; optional save
// ---------------------------------------------------------------------------

const MIN_PASSPHRASE_LENGTH = 12;

async function resolveDeployPassword({ resetPassword, noSavePassword }) {
  if (!resetPassword) {
    const stored = loadPassword();
    if (stored) {
      info("Using saved deploy password.");
      return stored;
    }
    if (hasSavedPassword()) {
      warn(".deploy-password.enc exists but could not be decrypted (wrong key or corrupt). Falling back to prompt.");
    }
  } else if (hasSavedPassword()) {
    info("--reset-password: clearing saved password.");
    clearPassword();
  }

  const passphrase = await password({ message: "Enter passphrase for encryption:" });
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    process.exit(1);
  }
  const passConfirm = await password({ message: "Confirm passphrase:" });
  if (passphrase !== passConfirm) {
    error("Passphrases do not match.");
    process.exit(1);
  }

  if (!noSavePassword) {
    if (!existsSync(KEY_FILE)) {
      hint(".security-key missing -- cannot offer to save the deploy password.");
    } else {
      const shouldSave = await confirm({
        message: "Save password to .deploy-password.enc (gitignored)?",
        default: true,
      });
      if (shouldSave) {
        try {
          savePassword(passphrase);
          ok("Saved encrypted deploy password.");
        } catch (e) {
          warn(`Could not save password: ${e.message}`);
        }
      }
    }
  }

  return passphrase;
}

export async function deploy(args) {
  const flags = new Set((args || []).filter((a) => a.startsWith("--")));
  const positional = (args || []).filter((a) => !a.startsWith("--") && a !== "-y");

  // --config handler: interactive or key=value mode
  if (flags.has("--config")) {
    const kvPairs = positional.filter((a) => a.includes("="));
    if (kvPairs.length > 0) {
      applyKeyValueConfig(kvPairs);
    } else {
      await promptDeployConfig();
    }
    return;
  }

  // --forget-password: remove any stored password and exit
  if (flags.has("--forget-password")) {
    if (hasSavedPassword()) {
      clearPassword();
      done("Removed .deploy-password.enc");
    } else {
      info("No saved deploy password to forget.");
    }
    return;
  }

  const resetPassword = flags.has("--reset-password");
  const noSavePassword = flags.has("--no-save-password");

  // Extract --expires <value> before flag/positional split
  let expiresArg = null;
  const rawArgs = args || [];
  const expiresIdx = rawArgs.indexOf("--expires");
  if (expiresIdx !== -1 && expiresIdx + 1 < rawArgs.length) {
    expiresArg = rawArgs[expiresIdx + 1];
  }

  const skipConfirm = flags.has("--yes") || flags.has("-y") || rawArgs.includes("-y");
  const dryRun = flags.has("--dry-run");

  // Load saved deploy config, backfill missing keys with defaults
  const deployConfig = resolveDeployConfig();

  // Resolve expiry: CLI --expires overrides config
  const expiryRaw = expiresArg ?? deployConfig.expires;
  const expiryResult = parseExpiry(expiryRaw);
  const hasExpiry = expiryResult != null && expiryResult.ms > 0;

  // CLI flags override config: --chunked / --7z always win
  const chunkedMode = flags.has("--chunked") || (!flags.has("--7z") && deployConfig.defaultMode === "chunked");

  // Filter out key=value pairs and --expires value from positional args
  const pathArgs = positional.filter((a) => !a.includes("=") && a !== expiresArg);

  // 1. Resolve source path
  const rc = readRc();
  let sourceDir;

  if (pathArgs.length > 0) {
    sourceDir = resolve(pathArgs[0]);
  } else if (rc?.distFolder) {
    sourceDir = resolve(REPO_ROOT, rc.distFolder);
  } else if (rc?.distRepo) {
    sourceDir = resolve(REPO_ROOT, "public-dist");
  } else {
    error("No .leakguardrc found. Run `leakguard setup-dist` first.");
    process.exit(1);
  }

  // Create folder if it doesn't exist
  if (!existsSync(sourceDir)) {
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, ".gitkeep"), "");
    info(`Created ${filePath(basename(sourceDir) + "/")}. Add files to distribute, then run \`leakguard deploy\` again.`);
    return;
  }

  // 2. Validate
  if (!isGitRepo()) {
    error("Not a git repository.");
    process.exit(1);
  }

  if (!hasContent(sourceDir)) {
    error(`${basename(sourceDir)}/ is empty. Add files before deploying.`);
    process.exit(1);
  }

  if (!deployConfig.skipGitleaks && !commandExists("gitleaks")) {
    error("gitleaks is not installed. Run `leakguard init` to install it.");
    process.exit(1);
  }

  if (!commandExists("7z")) {
    error("7z is not installed. Run `leakguard init` to install it.");
    process.exit(1);
  }

  // 3. Derive target repo
  const distRepo = rc?.distRepo;
  if (!distRepo) {
    error("No distRepo configured in .leakguardrc. Run `leakguard setup-dist` first.");
    process.exit(1);
  }

  const cloneUrl = deriveCloneUrl(distRepo);
  const fileCount = readdirSync(sourceDir).filter((e) => e !== ".gitkeep").length;
  const folderName = basename(sourceDir);
  const archiveBase = resolveArchiveName(deployConfig.archiveName, folderName);
  const archiveName = archiveBase + (chunkedMode ? ".zip" : ".7z");

  // 4. Confirm
  header("Deploy Summary");
  label("Source", `${filePath(sourceDir)} (${fileCount} file(s))`);
  label("Target", distRepo);
  label("Archive", `${archiveName}${chunkedMode ? " (encrypted, chunked)" : ""}`);
  label("Mode", `${chunkedMode ? "chunked" : "7z"}${dryRun ? " (dry-run)" : ""}`);
  if (chunkedMode) label("Chunk size", String(deployConfig.chunkSize));
  if (deployConfig.skipGitleaks) label("Gitleaks", "skipped");
  if (deployConfig.skipKeywords) label("Keywords", "skipped");
  if (deployConfig.keepArchive) label("Keep copy", String(deployConfig.keepArchive));
  if (deployConfig.createRelease) {
    if (chunkedMode) {
      label("Release", "skipped (not supported in chunked mode)");
    } else {
      label("Release", "latest (GitHub Release)");
    }
  }
  label("Expires", hasExpiry ? expiryResult.iso : "never");
  if (hasExpiry) {
    hint("Add LEAKGUARD_EXPIRE_TOKEN secret to the -dist repo for full repo deletion on expiry.");
  }
  gap();

  if (!skipConfirm) {
    const proceed = await confirm({ message: "Continue with deploy?", default: true });
    if (!proceed) {
      warn("Deploy cancelled.");
      return;
    }
  }

  // 5. Security scans
  header("Security Scans");

  if (!deployConfig.skipGitleaks) {
    info("Scanning with gitleaks...");
    const gitleaksOk = scanGitleaks(sourceDir);
    if (!gitleaksOk) {
      error("Deploy aborted. Fix the issues above before deploying.");
      process.exit(1);
    }
    ok("gitleaks: clean");
  } else {
    skip("gitleaks (config)");
  }

  if (!deployConfig.skipKeywords) {
    info("Scanning for keywords...");
    const keywordsOk = scanKeywords(sourceDir);
    if (!keywordsOk) {
      error("Deploy aborted. Remove blocked keywords before deploying.");
      process.exit(1);
    }
    ok("keywords: clean");
  } else {
    skip("keywords (config)");
  }

  // 6. Create archive
  const archiveTmp = makeTmpDir("archive");
  const archivePath = join(archiveTmp, archiveName);

  if (chunkedMode) {
    // -- Chunked mode: plain ZIP -> base64 -> AES encrypt -> split into text chunks --
    let passphrase;
    try {
      passphrase = await resolveDeployPassword({ resetPassword, noSavePassword });
    } catch (e) {
      rmSync(archiveTmp, { recursive: true, force: true });
      throw e;
    }

    info(`Creating plain ZIP: ${archiveName}`);
    const zipResult = spawnSync(
      "7z",
      ["a", "-tzip", archivePath, join(sourceDir, "*")],
      { stdio: "pipe" },
    );

    if (zipResult.status !== 0) {
      rmSync(archiveTmp, { recursive: true, force: true });
      error("ZIP creation failed.");
      if (zipResult.stderr) console.error(zipResult.stderr.toString());
      process.exit(1);
    }

    const zipBuffer = readFileSync(archivePath);
    const base64String = zipBuffer.toString("base64");
    info(`ZIP size: ${zipBuffer.length} bytes, base64 length: ${base64String.length}`);

    info("Encrypting...");
    const encryptedText = encryptString(base64String, passphrase);

    const chunkSize = parseChunkSize(deployConfig.chunkSize, encryptedText.length);
    const chunkCount = Math.ceil(encryptedText.length / chunkSize);
    const names = generateSortableNames(chunkCount);

    info(`Splitting into ${chunkCount} chunk(s)...`);
    const chunkDir = join(archiveTmp, "chunks");
    mkdirSync(chunkDir);
    const chunkFiles = splitAndWrite(encryptedText, chunkSize, chunkDir, names);
    chunkFiles.push(writeChecksumFile(zipBuffer, names, chunkDir));
    if (hasExpiry) chunkFiles.push(...generateExpiryFiles(expiryResult.iso, chunkDir));

    if (deployConfig.keepArchive) {
      const keepDir = resolve(REPO_ROOT, deployConfig.keepArchive);
      mkdirSync(keepDir, { recursive: true });
      copyFileSync(archivePath, join(keepDir, archiveName));
      ok(`Archive copy saved to: ${filePath(join(keepDir, archiveName))}`);
    }

    if (dryRun) {
      done(`Dry run complete. ${chunkCount} chunk(s) created at: ${filePath(chunkDir)}`);
      for (const { destName } of chunkFiles) info(destName);
      hint("No changes were pushed.");
      rmSync(archiveTmp, { recursive: true, force: true });
      return;
    }

    const commitMsg = resolveCommitMessage(deployConfig.commitMessage, {
      archiveName,
      chunkCount: String(chunkCount),
    });
    const pushed = pushToDist(cloneUrl, distRepo, chunkFiles, commitMsg);
    if (pushed) {
      done(`Deployed ${chunkCount} encrypted chunk(s) to ${distRepo}.`);
      hint("Browser-based decryption: https://github.com/rafa-lopes-pt/leakguard/blob/main/leakguard-receiver.html");
    }
  } else {
    // -- .7z mode --
    info(`Creating encrypted archive: ${archiveName}`);

    let archivePassword;
    try {
      archivePassword = await resolveDeployPassword({ resetPassword, noSavePassword });
    } catch (e) {
      rmSync(archiveTmp, { recursive: true, force: true });
      throw e;
    }

    // Password passed via -p<pw> argv. Visible in /proc/<pid>/cmdline for the
    // seconds 7z runs -- consistent with the encrypted-on-disk persistence
    // model the user has opted into.
    const zipResult = spawnSync(
      "7z",
      ["a", `-p${archivePassword}`, "-mhe=on", archivePath, join(sourceDir, "*")],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    if (zipResult.status !== 0) {
      rmSync(archiveTmp, { recursive: true, force: true });
      error("Archive creation failed.");
      if (zipResult.stderr) console.error(zipResult.stderr.toString());
      process.exit(1);
    }

    if (deployConfig.keepArchive) {
      const keepDir = resolve(REPO_ROOT, deployConfig.keepArchive);
      mkdirSync(keepDir, { recursive: true });
      copyFileSync(archivePath, join(keepDir, archiveName));
      ok(`Archive copy saved to: ${filePath(join(keepDir, archiveName))}`);
    }

    if (dryRun) {
      done(`Dry run complete. Archive created at: ${filePath(archivePath)}`);
      hint("No changes were pushed.");
      rmSync(archiveTmp, { recursive: true, force: true });
      return;
    }

    const archiveBuffer = readFileSync(archivePath);
    const files = [
      { sourcePath: archivePath, destName: archiveName },
      writeChecksumFile(archiveBuffer, null, archiveTmp),
    ];
    if (hasExpiry) files.push(...generateExpiryFiles(expiryResult.iso, archiveTmp));
    const commitMsg = resolveCommitMessage(deployConfig.commitMessage, {
      archiveName,
      chunkCount: "1",
    });
    const pushed = pushToDist(cloneUrl, distRepo, files, commitMsg);
    if (pushed) {
      done(`Deployed ${archiveName} to ${distRepo}.`);

      if (deployConfig.createRelease) {
        createRelease(distRepo, archivePath, archiveName);
      }
    }
  }

  rmSync(archiveTmp, { recursive: true, force: true });
}
