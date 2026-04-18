#!/usr/bin/env node
// One-time full-history audit for already-committed secrets and keyword matches.
// Replaces scan-existing-history.sh with pure Node.js (no python3 dependency).
//
// Usage:
//   gst scan-history [repo_path ...]
//
// If no arguments given, scans all git repos in the current directory.
// Outputs JSON reports to ./reports/

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, basename, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts }).trim();
}

const IS_WINDOWS = process.platform === "win32";

function commandExists(cmd) {
  try {
    execSync(IS_WINDOWS ? `where ${cmd}` : `which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export async function scanHistory(repoPaths = []) {
  const reportsDir = join(process.cwd(), "reports");
  const gitleaksConfig = join(PKG_ROOT, ".gitleaks.toml");
  const ts = timestamp();

  mkdirSync(reportsDir, { recursive: true });

  if (!commandExists("gitleaks")) {
    console.error("ERROR: gitleaks is not installed.");
    console.error("Install it: https://github.com/gitleaks/gitleaks#installing");
    process.exit(1);
  }

  // Collect repo paths
  let repos = [...repoPaths];
  if (repos.length === 0) {
    // Find all git repos in current directory
    const entries = readdirSync(process.cwd(), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && existsSync(join(process.cwd(), entry.name, ".git"))) {
        repos.push(entry.name);
      }
    }
  }

  if (repos.length === 0) {
    console.error("No git repositories found. Pass repo paths as arguments or run from a directory containing repos.");
    process.exit(1);
  }

  let foundIssues = false;

  for (const repo of repos) {
    const repoPath = resolve(repo);
    if (!existsSync(join(repoPath, ".git"))) {
      console.log(`WARNING: ${repo} is not a git repository, skipping.`);
      continue;
    }

    const repoName = basename(repoPath);
    console.log(`\n=== Scanning: ${repoName} ===`);

    // Scan 1: Full git history for secrets (gitleaks)
    const reportFile = join(reportsDir, `${repoName}_secrets_${ts}.json`);
    console.log("  [1/2] Scanning full git history for secrets...");

    try {
      execSync(
        `gitleaks detect --source "${repoPath}" --config "${gitleaksConfig}" --report-format json --report-path "${reportFile}"`,
        { stdio: "pipe" },
      );
      console.log("  -> No secrets found in history.");
      // Clean up empty report
      try { unlinkSync(reportFile); } catch {}
    } catch {
      // gitleaks exits non-zero when findings exist
      let findingCount = "unknown";
      try {
        const findings = JSON.parse(readFileSync(reportFile, "utf-8"));
        findingCount = findings.length;
      } catch {}
      console.log(`  -> FOUND ${findingCount} potential secret(s). Report: ${reportFile}`);
      foundIssues = true;
    }

    // Scan 2: Keyword check on current HEAD
    const keyFile = join(repoPath, ".security-key");
    const encFile = join(repoPath, "security-keywords.enc");

    if (existsSync(encFile) && existsSync(keyFile)) {
      console.log("  [2/2] Scanning current files for keyword matches...");
      const keywordReport = join(reportsDir, `${repoName}_keywords_${ts}.txt`);
      const tempKeywords = join(tmpdir(), `gst-keywords-${Date.now()}.txt`);

      try {
        execSync(
          `openssl enc -d -aes-256-cbc -pbkdf2 -in "${encFile}" -pass "file:${keyFile}" -out "${tempKeywords}"`,
          { stdio: "pipe" },
        );

        const keywords = readFileSync(tempKeywords, "utf-8");
        let matches = 0;
        const matchLines = [];

        for (const rawLine of keywords.split("\n")) {
          const keyword = rawLine.trim();
          if (!keyword || keyword.startsWith("#")) continue;

          try {
            const result = run(`git -C "${repoPath}" grep -il "${keyword}" HEAD --`, { stdio: "pipe" });
            if (result) {
              const files = result.split("\n").slice(0, 20);
              matchLines.push(...files.map((f) => `${keyword}: ${f}`));
              matches++;
            }
          } catch {
            // No matches for this keyword
          }
        }

        if (matches > 0) {
          writeFileSync(keywordReport, matchLines.join("\n") + "\n");
          console.log(`  -> FOUND keyword matches. Report: ${keywordReport}`);
          foundIssues = true;
        } else {
          console.log("  -> No keyword matches found.");
        }
      } catch {
        console.log("  -> Could not decrypt keyword list (wrong key?). Skipping keyword scan.");
      } finally {
        try { unlinkSync(tempKeywords); } catch {}
      }
    } else {
      console.log("  [2/2] No encrypted keyword list or key found in repo, skipping keyword scan.");
    }
  }

  console.log("\n=== Scan Complete ===");
  if (foundIssues) {
    console.log(`Issues found. Review reports in: ${reportsDir}/`);
    console.log("Any real secrets must be rotated IMMEDIATELY.");
    process.exit(1);
  } else {
    console.log("No issues found across all scanned repositories.");
  }
}
