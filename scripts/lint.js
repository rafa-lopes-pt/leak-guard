// On-demand security scanner -- runs the same 3 scans as the pre-commit hook
// (file types, keywords, gitleaks) without requiring a commit.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import { REPO_ROOT, KEY_FILE, ENC_FILE, commandExists, isGitRepo } from "./lib/rc.js";
import { decryptKeywords } from "./lib/crypto.js";
import { banner, header, ok, warn, error, skip, hint, gap, c } from "./lib/ui.js";

// ---------------------------------------------------------------------------
// File resolution
// ---------------------------------------------------------------------------

function resolveFiles(paths, staged) {
  if (staged) {
    const r = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
      cwd: REPO_ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    });
    return (r.stdout || "").split("\n").filter(Boolean);
  }

  if (paths.length > 0) {
    const r = spawnSync("git", ["ls-files", "--", ...paths], {
      cwd: REPO_ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    });
    return (r.stdout || "").split("\n").filter(Boolean);
  }

  const r = spawnSync("git", ["ls-files"], {
    cwd: REPO_ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
  });
  return (r.stdout || "").split("\n").filter(Boolean);
}

// ---------------------------------------------------------------------------
// Scan 1: File types (extension + MIME)
// ---------------------------------------------------------------------------

function parseFiletypesConfig(configPath) {
  const content = readFileSync(configPath, "utf-8");
  const sections = { extensions: [], "mime-types": [], "allowed-types": [], "allowed-files": [] };
  let current = "";

  for (const raw of content.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;

    const match = line.match(/^\[(.+)]$/);
    if (match) {
      current = match[1];
      continue;
    }
    if (sections[current]) sections[current].push(line);
  }
  return sections;
}

function scanFileTypes(files, repoRoot) {
  const configPath = join(repoRoot, ".security-filetypes");
  if (!existsSync(configPath)) {
    skip("No .security-filetypes config found, skipping file type check.");
    return { passed: true, skipped: true, violations: [] };
  }

  const cfg = parseFiletypesConfig(configPath);
  const hasFileCmd = commandExists("file");
  if (!hasFileCmd) {
    warn("'file' command not found -- MIME type checking will be skipped.");
  }

  const violations = [];
  for (const filepath of files) {
    const fullPath = join(repoRoot, filepath);
    if (!existsSync(fullPath)) continue;

    // allowed-files override everything
    if (cfg["allowed-files"].includes(filepath)) continue;

    // Extension check
    const filename = filepath.split("/").pop();
    let ext = "";
    if (filename.includes(".")) {
      ext = "." + filename.split(".").pop().toLowerCase();
    }
    if (ext && cfg.extensions.includes(ext)) {
      violations.push({ file: filepath, reason: `blocked extension (${ext})` });
      continue; // no need to also check MIME
    }

    // MIME type check
    if (!hasFileCmd) continue;
    const r = spawnSync("file", ["--mime-type", "-b", fullPath], {
      encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    });
    const mime = (r.stdout || "").trim();
    if (!mime || mime === "unknown") continue;

    // allowed MIME types
    if (cfg["allowed-types"].some((t) => mime === t)) continue;

    // blocked MIME prefixes
    const blockedMime = cfg["mime-types"].find((prefix) => mime.startsWith(prefix));
    if (blockedMime) {
      violations.push({ file: filepath, reason: `blocked MIME type (${mime})` });
    }
  }

  return { passed: violations.length === 0, skipped: false, violations };
}

// ---------------------------------------------------------------------------
// Scan 2: Keywords (encrypted blocklist)
// ---------------------------------------------------------------------------

function scanKeywords(files, repoRoot, staged) {
  if (!existsSync(ENC_FILE)) {
    return { passed: true, skipped: true, violations: [] };
  }

  if (!existsSync(KEY_FILE)) {
    warn("Encrypted keyword list found but .security-key is missing -- skipping keyword scan.");
    hint("Run 'leakguard init' to configure the encryption key.");
    return { passed: true, skipped: true, violations: [] };
  }

  const keywords = decryptKeywords();
  if (!keywords) {
    warn("Failed to decrypt keyword list (wrong key?) -- skipping keyword scan.");
    return { passed: true, skipped: true, violations: [] };
  }

  // Write clean pattern file (no blanks/comments -- decryptKeywords already filters)
  const patternFile = join(tmpdir(), `leakguard-kw-${randomBytes(8).toString("hex")}`);
  try {
    writeFileSync(patternFile, keywords.join("\n") + "\n");

    const violations = [];

    if (staged) {
      // Staged mode: grep on diff output (mirrors hook lines 176-209)
      const diff = spawnSync("git", ["diff", "--cached", "-U0"], {
        cwd: repoRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });
      const diffText = diff.stdout || "";

      // Find matched keywords in the full diff
      const matchR = spawnSync("grep", ["-ioFf", patternFile], {
        input: diffText, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });
      const matchedKeywords = [...new Set(
        (matchR.stdout || "").split("\n").filter(Boolean).map((k) => k.toLowerCase()),
      )];

      if (matchedKeywords.length > 0) {
        // Get staged file list and per-file diffs
        const stagedFiles = resolveFiles([], true);
        for (const kw of matchedKeywords) {
          for (const filepath of stagedFiles) {
            const fileDiff = spawnSync("git", ["diff", "--cached", "--", filepath], {
              cwd: repoRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
            });
            const r = spawnSync("grep", ["-iF", kw], {
              input: fileDiff.stdout || "", encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
            });
            if (r.status === 0) {
              violations.push({ file: filepath, keyword: kw });
            }
          }
        }
      }
    } else {
      // Non-staged mode: bulk grep across files
      if (files.length === 0) return { passed: true, skipped: false, violations: [] };

      const fullPaths = files.map((f) => join(repoRoot, f)).filter((p) => existsSync(p));
      if (fullPaths.length === 0) return { passed: true, skipped: false, violations: [] };

      // Quick check: which files match any keyword?
      const bulkR = spawnSync("grep", ["-rliFf", patternFile, "--", ...fullPaths], {
        encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });
      const matchedFiles = (bulkR.stdout || "").split("\n").filter(Boolean);

      // Detail pass: get line-level matches per file
      for (const absPath of matchedFiles) {
        const relPath = absPath.startsWith(repoRoot + "/")
          ? absPath.slice(repoRoot.length + 1)
          : absPath;
        const detailR = spawnSync("grep", ["-niFf", patternFile, "--", absPath], {
          encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
        });
        for (const line of (detailR.stdout || "").split("\n").filter(Boolean)) {
          const colonIdx = line.indexOf(":");
          const lineNo = line.slice(0, colonIdx);
          violations.push({ file: relPath, line: lineNo, match: line.slice(colonIdx + 1).trim() });
        }
      }
    }

    return { passed: violations.length === 0, skipped: false, violations };
  } finally {
    try { unlinkSync(patternFile); } catch { /* already cleaned up */ }
  }
}

// ---------------------------------------------------------------------------
// Scan 3: Gitleaks (secret/credential patterns)
// ---------------------------------------------------------------------------

function scanGitleaks(repoRoot, staged) {
  if (!commandExists("gitleaks")) {
    warn("gitleaks is not installed -- skipping secret scan.");
    hint("Install: https://github.com/gitleaks/gitleaks#installing");
    return { passed: true, skipped: true, output: "" };
  }

  const args = staged
    ? ["protect", "--staged", "--exit-code", "1"]
    : ["detect", "--source", repoRoot, "--exit-code", "1"];

  const configPath = join(repoRoot, ".gitleaks.toml");
  if (existsSync(configPath)) {
    args.push("--config", configPath);
  }

  const r = spawnSync("gitleaks", args, {
    cwd: repoRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
  });
  const output = ((r.stdout || "") + (r.stderr || "")).trim();

  return { passed: r.status === 0, skipped: false, output };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function lint(args) {
  const staged = args.includes("--staged");
  const paths = args.filter((a) => !a.startsWith("-"));

  if (!isGitRepo()) {
    error("Not a git repository.");
    process.exit(1);
  }

  banner("LeakGuard Lint", staged ? "Scanning staged changes" : paths.length ? `Scanning ${paths.length} path(s)` : "Scanning all tracked files");

  const files = resolveFiles(paths, staged);
  if (files.length === 0) {
    warn("No files to scan.");
    process.exit(0);
  }

  const total = 3;
  let allPassed = true;

  // Scan 1: File types
  header("File type check", 1, total);
  const ft = scanFileTypes(files, REPO_ROOT);
  if (ft.skipped) {
    // message already printed
  } else if (ft.passed) {
    ok(`${files.length} file(s) checked -- no blocked types found.`);
  } else {
    for (const v of ft.violations) {
      error(`${v.file} -- ${v.reason}`);
    }
    allPassed = false;
  }

  // Scan 2: Keywords
  header("Keyword check", 2, total);
  const kw = scanKeywords(files, REPO_ROOT, staged);
  if (kw.skipped) {
    if (!existsSync(ENC_FILE)) {
      skip("No keyword list configured.");
    }
    // other skip reasons already printed by scanKeywords
  } else if (kw.passed) {
    ok("No keyword matches found.");
  } else {
    if (staged) {
      for (const v of kw.violations) {
        error(`'${v.keyword}' in ${v.file}`);
      }
    } else {
      for (const v of kw.violations) {
        error(`${v.file}:${v.line} -- ${v.match}`);
      }
    }
    allPassed = false;
  }

  // Scan 3: Gitleaks
  header("Secret scan (gitleaks)", 3, total);
  const gl = scanGitleaks(REPO_ROOT, staged);
  if (gl.skipped) {
    // message already printed
  } else if (gl.passed) {
    ok("No secrets or credentials detected.");
  } else {
    if (gl.output) console.log(gl.output);
    error("Secrets/credentials detected by gitleaks.");
    allPassed = false;
  }

  // Summary
  gap();
  if (allPassed) {
    console.log(`  ${c.green(c.bold("All security checks passed."))}`);
  } else {
    console.log(`  ${c.red(c.bold("Security issues found."))}`);
    process.exit(1);
  }
}
