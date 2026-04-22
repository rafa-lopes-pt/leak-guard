#!/usr/bin/env node
// One-time full-history audit for already-committed secrets and keyword matches.
// Replaces scan-existing-history.sh with pure Node.js (no python3 dependency).
//
// Usage:
//   leakguard scan-history [repo_path ...]
//
// If no arguments given, scans all git repos in the current directory.
// Outputs JSON reports to ./reports/

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, basename, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { commandExists } from "./lib/rc.js";
import { decryptKeywords } from "./lib/crypto.js";
import { banner, header, ok, info, warn, error, skip, filePath } from "./lib/ui.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");

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
    error("gitleaks is not installed.");
    info("Install it: https://github.com/gitleaks/gitleaks#installing");
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
    error("No git repositories found. Pass repo paths as arguments or run from a directory containing repos.");
    process.exit(1);
  }

  let foundIssues = false;

  const cwd = process.cwd();
  for (const repo of repos) {
    const repoPath = resolve(repo);
    if (!repoPath.startsWith(cwd)) {
      warn(`${repo} is outside the working directory, skipping.`);
      continue;
    }
    if (!existsSync(join(repoPath, ".git"))) {
      warn(`${repo} is not a git repository, skipping.`);
      continue;
    }

    const repoName = basename(repoPath);
    header(repoName);

    // Scan 1: Full git history for secrets (gitleaks)
    const reportFile = join(reportsDir, `${repoName}_secrets_${ts}.json`);
    info("[1/2] Scanning full git history for secrets...");

    try {
      execSync(
        `gitleaks detect --source "${repoPath}" --config "${gitleaksConfig}" --report-format json --report-path "${reportFile}"`,
        { stdio: "pipe" },
      );
      ok("No secrets found in history.");
      // Clean up empty report
      try { unlinkSync(reportFile); } catch {}
    } catch {
      // gitleaks exits non-zero when findings exist
      let findingCount = "unknown";
      try {
        const findings = JSON.parse(readFileSync(reportFile, "utf-8"));
        findingCount = findings.length;
      } catch {}
      warn(`FOUND ${findingCount} potential secret(s). Report: ${filePath(reportFile)}`);
      foundIssues = true;
    }

    // Scan 2: Keyword check on current HEAD
    const keyFile = join(repoPath, ".security-key");
    const encFile = join(repoPath, "security-keywords.enc");

    if (existsSync(encFile) && existsSync(keyFile)) {
      info("[2/2] Scanning current files for keyword matches...");
      const keywordReport = join(reportsDir, `${repoName}_keywords_${ts}.txt`);

      const keywords = decryptKeywords(keyFile, encFile);
      if (!keywords) {
        warn("Could not decrypt keyword list (wrong key?). Skipping keyword scan.");
      } else {
        // Write keywords to temp file for single-pass git grep -f
        const tempPatternFile = join(tmpdir(), `leakguard-patterns-${randomBytes(8).toString("hex")}.txt`);
        writeFileSync(tempPatternFile, keywords.join("\n") + "\n");

        // Single-pass: check if any keywords match at all
        const quickCheck = spawnSync("git", ["-C", repoPath, "grep", "-ilFf", tempPatternFile, "HEAD", "--"],
          { encoding: "utf-8", stdio: "pipe" });

        if (quickCheck.status === 0 && quickCheck.stdout?.trim()) {
          // Matches found -- fall back to per-keyword search for detailed reporting
          let matches = 0;
          const matchLines = [];

          for (const keyword of keywords) {
            const result = spawnSync("git", ["-C", repoPath, "grep", "-ilF", keyword, "HEAD", "--"],
              { encoding: "utf-8", stdio: "pipe" });
            if (result.status === 0 && result.stdout) {
              const files = result.stdout.trim().split("\n").slice(0, 20);
              matchLines.push(...files.map((f) => `${keyword}: ${f}`));
              matches++;
            }
          }

          if (matches > 0) {
            writeFileSync(keywordReport, matchLines.join("\n") + "\n");
            warn(`FOUND keyword matches. Report: ${filePath(keywordReport)}`);
            foundIssues = true;
          }
        } else {
          ok("No keyword matches found.");
        }

        try { unlinkSync(tempPatternFile); } catch {}
      }
    } else {
      skip("[2/2] No encrypted keyword list or key found in repo, skipping keyword scan.");
    }
  }

  banner("Scan Complete");
  if (foundIssues) {
    warn(`Issues found. Review reports in: ${filePath(reportsDir + "/")}`);
    error("Any real secrets must be rotated IMMEDIATELY.");
    process.exit(1);
  } else {
    ok("No issues found across all scanned repositories.");
  }
}
