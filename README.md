<p align="center">
  <img src="banner.png" alt="LeakGuard Banner" />
</p>

# LeakGuard -- GitHub Security Hardening Toolkit

**LeakGuard** is a comprehensive security scanning toolkit for GitHub organizations on the **free plan**. Prevents credential leaks and enforces security policies using client-side pre-commit hooks and GitHub Actions as a server-side safety net.

It is designed to provide a **practical layer of protection** where none exists by default -- catching accidental leaks before they happen. This is also why it encourages a **private source repo + encrypted public `-dist` repo** workflow: sensitive work stays in a private repo, and only curated, scanned, and encrypted content is published to the public one.

> **No security tool is bulletproof -- LeakGuard is no exception.**
> Every git hook can be bypassed with `--no-verify`, and free-tier GitHub cannot enforce status checks on private repos. Think of LeakGuard as a seatbelt, not an armored vault.

---

## Table of Contents

- [LeakGuard -- GitHub Security Hardening Toolkit](#leakguard----github-security-hardening-toolkit)
  - [Table of Contents](#table-of-contents)
  - [1. GitHub Organization Security Overview](#1-github-organization-security-overview)
    - [Why Org-Level Security Matters](#why-org-level-security-matters)
    - [Shared Responsibility Model](#shared-responsibility-model)
  - [2. Security Features by GitHub Plan](#2-security-features-by-github-plan)
    - [What This Means for Free Plan Users](#what-this-means-for-free-plan-users)
    - [Upgrade Path](#upgrade-path)
  - [3. Secret and Credential Management](#3-secret-and-credential-management)
    - [Why Secrets Leak](#why-secrets-leak)
    - [Types of Secrets to Watch For](#types-of-secrets-to-watch-for)
    - [Best Practices](#best-practices)
  - [4. How This Project Works](#4-how-this-project-works)
    - [Architecture](#architecture)
    - [Tool Choice: gitleaks](#tool-choice-gitleaks)
    - [Encrypted Keyword Scanning](#encrypted-keyword-scanning)
    - [File Type Blocking](#file-type-blocking)
    - [Files Reference](#files-reference)
  - [5. Setup Guide](#5-setup-guide)
    - [Prerequisites](#prerequisites)
    - [Install](#install)
    - [CLI Reference](#cli-reference)
    - [For New Developers Joining the Org](#for-new-developers-joining-the-org)
    - [Adding or Updating Keywords](#adding-or-updating-keywords)
    - [One-Time History Audit](#one-time-history-audit)
    - [Creating Encrypted Archives](#creating-encrypted-archives)
    - [Public Distribution (Private Repo to Public -dist Repo)](#public-distribution-private-repo-to-public--dist-repo)
    - [Customizing File Type Blocking](#customizing-file-type-blocking)
  - [6. Handling Cases](#6-handling-cases)
    - [A File Type Is Blocked](#a-file-type-is-blocked)
    - [A Secret Is Detected (Pre-Commit Blocked)](#a-secret-is-detected-pre-commit-blocked)
    - [A Secret Has Already Been Committed](#a-secret-has-already-been-committed)
    - [A Keyword Match Is Found](#a-keyword-match-is-found)
    - [CI Workflow Fails](#ci-workflow-fails)
    - [Emergency Bypass](#emergency-bypass)
  - [7. 2FA and Access Control](#7-2fa-and-access-control)
    - [Two-Factor Authentication](#two-factor-authentication)
    - [Access Control Best Practices](#access-control-best-practices)
    - [CODEOWNERS](#codeowners)
  - [8. Maintenance](#8-maintenance)
    - [Updating Gitleaks](#updating-gitleaks)
    - [Updating the Keyword List](#updating-the-keyword-list)
    - [Adding New Repos](#adding-new-repos)
    - [Monitoring](#monitoring)
    - [Additional Hardening](#additional-hardening)
  - [Limitations (Free Plan)](#limitations-free-plan)

---

## 1. GitHub Organization Security Overview

### Why Org-Level Security Matters

A single leaked API key or database credential can lead to unauthorized access, data breaches, and financial loss. GitHub repositories -- even private ones -- are a common source of accidental credential exposure.

Organization-level security creates consistent protection across all repositories rather than relying on individual developers to remember best practices for every commit.

### Shared Responsibility Model

| Layer | Responsibility | Examples |
|-------|---------------|----------|
| **GitHub Platform** | Infrastructure security, account protection, platform features | 2FA, audit logs, SAML SSO (paid) |
| **Org Admins** | Configuring org policies, enabling security features, managing access | Branch protection, secret scanning, member permissions |
| **Developers** | Following secure coding practices, using provided tooling | Not hardcoding secrets, running pre-commit hooks, using `.env` files |

This toolkit addresses the **org admin** and **developer** layers using free tooling.

---

## 2. Security Features by GitHub Plan

| Feature | Free | Team ($4/user/mo) | Enterprise |
|---------|------|--------------------|------------|
| Private repositories | Yes | Yes | Yes |
| 2FA enforcement | Yes | Yes | Yes |
| Dependabot alerts | Yes | Yes | Yes |
| Branch protection (public repos) | Yes | Yes | Yes |
| Branch protection (private repos) | No | Yes | Yes |
| Required status checks | No | Yes | Yes |
| Secret scanning (push protection) | No | No | Add-on ($19/user/mo) |
| SAML SSO | No | No | Yes |
| Audit log API | No | No | Yes |
| CODEOWNERS enforcement | No | Yes | Yes |
| Actions minutes (private repos) | 2,000/mo | 3,000/mo | 50,000/mo |

### What This Means for Free Plan Users

- **Cannot enforce branch protection** on private repos -- the CI workflow will show red/green status but cannot block merges
- **Cannot use GitHub-native secret scanning** -- this toolkit provides an equivalent using gitleaks
- **CODEOWNERS file works** for PR review suggestions but cannot be enforced as required reviewers
- **2,000 Actions minutes/month** is more than enough for security scans (~10-30 seconds per run)

### Upgrade Path

When the team grows, **GitHub Team** ($4/user/month) is the recommended upgrade:
- Branch protection on private repos makes the gitleaks CI scan a hard gate
- Required status checks prevent merging when scans fail
- CODEOWNERS enforcement guarantees review coverage

---

## 3. Secret and Credential Management

### Why Secrets Leak

| Cause | Example |
|-------|---------|
| Hardcoded credentials | `const API_KEY = "sk-live-abc123..."` |
| Copy-paste from docs | Pasting a real key into a code example |
| Debug leftovers | Temporarily adding a key for testing, forgetting to remove it |
| Config files | Committing `.env`, `credentials.json`, or `serviceAccountKey.json` |
| Connection strings | Database URLs with embedded passwords |

### Types of Secrets to Watch For

- **API keys**: AWS (`AKIA...`), GCP, Azure, OpenAI, Stripe, Twilio, SendGrid
- **Tokens**: GitHub PATs (`ghp_...`), npm tokens, OAuth tokens, JWTs
- **Passwords**: Database passwords, SMTP credentials, admin passwords
- **Private keys**: SSH keys, TLS/SSL certificates (`.pem`, `.key`), GPG keys
- **Connection strings**: Database URLs, Redis URLs, message queue URLs

### Best Practices

1. **Use environment variables** -- load secrets from `process.env`, never hardcode them
2. **Use `.env` files locally** -- and always gitignore them
3. **Provide `.env.example`** -- a template with placeholder values (committed to repo)
4. **Use a secret manager in production** -- GitHub Secrets for CI, cloud-native vaults for deployed apps
5. **Rotate secrets regularly** -- and immediately if any exposure is suspected
6. **Scope secrets narrowly** -- use the minimum permissions needed

---

## 4. How This Project Works

### Architecture

```
Developer workstation              GitHub
========================          ========================

 git commit                       push / PR
     |                                |
 pre-commit hook                  GitHub Actions workflow
     |                                |
 +---+---+---+                   +---+---+---+
 |   |   |   |                   |   |   |   |
 v   v   v   |                   v   v   v   |
 FT  KW  GL  |                   FT  KW  GL  |
 |   |   |   |                   |   |   |   |
 +---+---+---+                   +---+---+---+
     |                                |
 pass/fail                        pass/fail
```

**FT** = File type check (extension + MIME)
**KW** = Keyword scan (encrypted blocklist)
**GL** = Gitleaks (secret/credential patterns)

### Tool Choice: gitleaks

**gitleaks** was chosen over alternatives (trufflehog, detect-secrets) because:
- Single Go binary with no runtime dependencies
- Sub-second pre-commit scans on staged files
- 150+ built-in secret patterns covering all major cloud providers
- MIT license for the CLI (no AGPL concerns)
- Works both as a local hook and in GitHub Actions

### Encrypted Keyword Scanning

Some repos contain sensitive business terms (client names, project codenames, internal identifiers) that must never leak. A simple plaintext blocklist would itself be a leak, so:

1. Keywords are added via `leakguard blacklist` and encrypted with `openssl enc -aes-256-cbc -pbkdf2` using a shared passphrase
2. Only `security-keywords.enc` is committed to the repo -- no plaintext ever touches disk
4. The pre-commit hook decrypts it at scan time and greps staged changes
5. GitHub Actions decrypts it using the `LEAKGUARD_SECURITY_KEY` repo secret

### File Type Blocking

Two detection layers prevent dangerous or unscannable files:

1. **Extension check** -- blocks known dangerous extensions (`.exe`, `.env`, `.pem`, etc.)
2. **MIME type check** -- uses `file --mime-type` to read file magic bytes, catching renamed files (e.g., a `.png` renamed to `.txt` is still detected as `image/png`)

Unscannable binary files (images, videos, PDFs, etc.) must be shipped inside an **encrypted `.7z` archive** -- the only allowed archive format.

### Files Reference

| File | Purpose | Committed? |
|------|---------|------------|
| `.gitleaks.toml` | Secret scanning rules and allowlist | Yes |
| `.security-filetypes` | Extension + MIME type blocklist per repo | Yes |
| `security-keywords.enc` | Encrypted keyword blocklist | Yes |
| `.security-key` | Decryption passphrase | No (gitignored) |
| `.github/workflows/secret-scan.yml` | CI workflow | Yes |
| `.git/hooks/pre-commit` | Local pre-commit hook | No (per-machine) |
| `.leakguardrc` | Distribution config (distFolder, distRepo) | Yes |
| `.git/hooks/pre-commit-dist` | Pre-commit hook for `-dist` repos (allowlist only) | No (per-machine) |

---

## 5. Setup Guide

### Prerequisites

- **Git**
- **Node.js 18+**
- **openssl** -- used for AES-256-CBC encryption of keyword blocklists
- **[GitHub CLI (`gh`)](https://cli.github.com)** -- used during setup to sync the encryption key as a GitHub repo secret (`LEAKGUARD_SECURITY_KEY`) and to create/manage the public `-dist` repo. Also needed for org admin tasks (2FA audits, Dependabot setup, member reviews)
- A terminal (bash, zsh, or Git Bash on Windows)

### Install

Install globally:

```bash
npm install -g @rafa-lopes-pt/leakguard
```

Or run any command on-demand with `npx` (no global install needed):

```bash
npx @rafa-lopes-pt/leakguard [command] [options]
```

If installed globally, replace `npx @rafa-lopes-pt/leakguard` with just `leakguard` in all examples below.

### CLI Reference

| Command | Description |
|---------|-------------|
| `leakguard` / `leakguard init` | Interactive TUI setup (default) |
| `leakguard blacklist kw1 kw2` | Add/merge keywords into encrypted blocklist |
| `leakguard blacklist kw1 --override` | Replace entire keyword list |
| `leakguard blacklist -l` / `--list` | Show current keywords |
| `leakguard blacklist -r kw1 kw2` | Remove specific keywords |
| `leakguard scan-history [dir...]` | One-time full-history audit |
| `leakguard zip <files...>` | Create encrypted .7z archive |
| `leakguard deploy [path]` | Scan, zip, and push to the public `-dist` repo |
| `leakguard --help` | Show help |
| `leakguard --version` | Print version |

**Examples with npx:**

```bash
# Show help
npx @rafa-lopes-pt/leakguard --help

# Interactive setup (run from your repo root)
npx @rafa-lopes-pt/leakguard init

# Add keywords to the encrypted blocklist
npx @rafa-lopes-pt/leakguard blacklist "client name" project-codename internal-id

# List current keywords
npx @rafa-lopes-pt/leakguard blacklist --list

# Remove keywords
npx @rafa-lopes-pt/leakguard blacklist --remove "client name"

# Replace entire keyword list
npx @rafa-lopes-pt/leakguard blacklist kw1 kw2 --override

# Full-history audit on specific repos
npx @rafa-lopes-pt/leakguard scan-history /path/to/repo1 /path/to/repo2

# Package binary files into encrypted .7z
npx @rafa-lopes-pt/leakguard zip assets/ config.dat

# Deploy curated content to the public -dist repo
npx @rafa-lopes-pt/leakguard deploy
```

### For New Developers Joining the Org

1. **Get the encryption key** from a teammate via a secure channel (Signal, 1Password, in person -- never Slack/email/GitHub).

2. **Run setup on each repo** you work with:
   ```bash
   cd /path/to/your-repo
   npx @rafa-lopes-pt/leakguard init
   ```

3. The TUI will walk you through:
   - Installing gitleaks (if needed)
   - Entering the shared encryption key
   - Configuring file type blocking for this repo
   - Installing the pre-commit hook
   - Copying the CI workflow and gitleaks config

4. **Commit the new files** added to your repo:
   ```bash
   git add .gitignore .gitleaks.toml .security-filetypes .github/workflows/secret-scan.yml security-keywords.enc
   git commit -m "Add security scanning configuration"
   ```

### Adding or Updating Keywords

Add or merge keywords directly from the CLI (no plaintext file needed):

```bash
npx @rafa-lopes-pt/leakguard blacklist "client name" project-codename internal-id
```

To replace the entire list instead of merging:

```bash
npx @rafa-lopes-pt/leakguard blacklist kw1 kw2 kw3 --override
```

To view or remove keywords:

```bash
npx @rafa-lopes-pt/leakguard blacklist --list
npx @rafa-lopes-pt/leakguard blacklist --remove "client name" internal-id
```

After any change, commit `security-keywords.enc` (never the plaintext).

### One-Time History Audit

Scan existing repos for previously committed secrets:

```bash
# Scan specific repos
npx @rafa-lopes-pt/leakguard scan-history /path/to/repo1 /path/to/repo2

# Scan all git repos in current directory
npx @rafa-lopes-pt/leakguard scan-history
```

Reports are saved to `./reports/`.

### Creating Encrypted Archives

Binary files that need to be in the repo must be packaged in an encrypted `.7z` archive:

```bash
# Single file
npx @rafa-lopes-pt/leakguard zip myfile.bin

# Multiple files or directories
npx @rafa-lopes-pt/leakguard zip assets/ config.dat
```

You will be prompted for a password. The archive is created in the current directory.

### Public Distribution (Private Repo to Public `-dist` Repo)

Organizations often need to share curated content from a private repo publicly without exposing the full repo. LeakGuard supports this through a **distribution workflow**: a designated folder in your private repo is scanned for secrets, packaged into an encrypted `.7z` archive, and pushed to a companion public `-dist` repo.

**How it works:**

1. During `leakguard init`, you can enable public distribution. This will:
   - Create a public `<repo-name>-dist` repo on GitHub (via `gh`)
   - Bootstrap it with leakguard security config (gitleaks rules, file type blocking, a dist-specific pre-commit hook)
   - Save the config to `.leakguardrc` in your private repo
   - Create a distribution folder (default: `public-dist/`)

2. Place files you want to distribute in the distribution folder.

3. Run deploy:
   ```bash
   npx @rafa-lopes-pt/leakguard deploy
   ```

4. Deploy will:
   - Scan the folder with gitleaks and the keyword blocklist
   - Block the deploy if secrets or sensitive keywords are found
   - Create an encrypted `.7z` archive from the folder contents
   - Push the archive to the `-dist` repo

The `-dist` repo has its own pre-commit hook (`pre-commit-dist`) that only allows `.7z` archives and leakguard config files -- preventing accidental commits of unscanned content.

### Customizing File Type Blocking

Edit `.security-filetypes` in your repo:
- Add extensions to `[extensions]` to block by filename
- Add MIME prefixes to `[mime-types]` to block by content type
- Add exceptions to `[allowed-types]` for MIME types that should pass
- Add specific file paths to `[allowed-files]` to override all rules

---

## 6. Handling Cases

### A File Type Is Blocked

**Situation**: Your commit is rejected because of a blocked file type.

**Options**:
1. **Remove the file** if it doesn't belong in the repo
2. **Add to `.security-filetypes` `[allowed-files]`** if this specific file is needed:
   ```
   [allowed-files]
   assets/logo.png
   docs/architecture.pdf
   ```
3. **Package in encrypted .7z** if the binary must be in the repo:
   ```bash
   7z a -p -mhe=on archive.7z myfile.bin
   # Add archive.7z instead of myfile.bin
   ```

### A Secret Is Detected (Pre-Commit Blocked)

**Situation**: gitleaks found what looks like a credential in your staged changes.

**Steps**:
1. Check if it's a **real secret** or a **false positive**
2. If real: remove the secret, use an environment variable instead
3. If false positive: add an allowlist entry to `.gitleaks.toml`:
   ```toml
   [allowlist]
   paths = [
       # existing entries...
       '''path/to/false-positive-file\.js$''',
   ]
   ```
4. Alternatively, add an inline comment: `# gitleaks:allow`

### A Secret Has Already Been Committed

**Situation**: A secret was found in git history (via `leakguard scan-history` or CI).

**Steps**:
1. **Rotate the secret immediately** -- generate a new key/token and update wherever it's used
2. **Consider the old secret compromised** regardless of whether anyone else accessed the repo
3. **Clean history if needed** (optional, since private repos):
   ```bash
   # Using git-filter-repo (install: pip install git-filter-repo)
   git filter-repo --invert-paths --path path/to/secret-file
   ```
4. Add the file pattern to `.gitignore` to prevent recurrence

### A Keyword Match Is Found

**Situation**: The keyword scan blocked your commit because a sensitive term was found.

**Steps**:
1. Review the match -- is this term actually sensitive in this context?
2. If sensitive: rephrase or use a codename/abbreviation
3. If the keyword is no longer sensitive: remove it with `leakguard blacklist --remove <keyword>` and commit `security-keywords.enc`

### CI Workflow Fails

**Situation**: The GitHub Actions security scan failed on push or PR.

**Steps**:
1. Check the Actions log to see which scan failed (file type, keyword, or secret)
2. Fix the issue locally and push again
3. Note: On the free plan, a failed check cannot block a merge -- treat it as a strong warning

### Emergency Bypass

In genuine emergencies, you can skip the pre-commit hook:
```bash
git commit --no-verify -m "emergency: <reason>"
```

This skips ALL local checks. The CI workflow will still run on push. Use this sparingly -- every bypass should be reviewed afterward.

---

## 7. 2FA and Access Control

### Two-Factor Authentication

2FA is the single most impactful security measure for a GitHub org. It protects against:
- Credential stuffing (password reuse from data breaches)
- Phishing attacks
- Unauthorized access if a password is compromised

**Check current status**:
```bash
# List members without 2FA (should return empty)
gh api /orgs/<your-org>/members?filter=2fa_disabled
```

**Enable org-wide requirement**:
1. Go to org Settings > Authentication security
2. Check "Require two-factor authentication for everyone in the organization"
3. Coordinate with all members first -- anyone without 2FA will be removed from the org

### Access Control Best Practices

- **Principle of least privilege**: Give the minimum permissions needed
- **Use teams** for permission groups rather than individual access
- **Review access regularly**: Check who has access to what
- **Use deploy keys** for CI/CD rather than personal tokens
- **Audit the org periodically**:
  ```bash
  # List all org members
  gh api /orgs/<your-org>/members --jq '.[].login'

  # List outside collaborators
  gh api /orgs/<your-org>/outside_collaborators --jq '.[].login'
  ```

### CODEOWNERS

Add a `CODEOWNERS` file to each repo for review visibility:
```
# .github/CODEOWNERS
* @your-github-username
```

On the free plan this serves as a suggestion (not enforced). On GitHub Team it becomes a required review gate.

---

## 8. Maintenance

### Updating Gitleaks

Check for new versions periodically:
```bash
# Current version
gitleaks version

# Latest release
gh api /repos/gitleaks/gitleaks/releases/latest --jq '.tag_name'
```

Update on Linux:
```bash
VERSION="8.21.2"  # replace with latest
curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_x64.tar.gz" \
  | sudo tar -xz -C /usr/local/bin gitleaks
```

Also update the version in `workflows/secret-scan.yml`.

### Updating the Keyword List

1. Add, remove, or replace keywords:
   ```bash
   npx @rafa-lopes-pt/leakguard blacklist "new keyword"
   npx @rafa-lopes-pt/leakguard blacklist --remove "old keyword"
   ```
2. Commit `security-keywords.enc`
3. Other devs pull and get the updated encrypted list automatically
4. Ensure the CI `LEAKGUARD_SECURITY_KEY` repo secret is still current

### Adding New Repos

1. `cd` into the new repo
2. Run `npx @rafa-lopes-pt/leakguard init`
3. Commit the generated files
4. The CI workflow and pre-commit hook are ready

### Monitoring

- Check GitHub Actions results after each push/PR
- Run `npx @rafa-lopes-pt/leakguard scan-history` quarterly (or when new repos are added)
- Review `.gitleaks.toml` allowlist entries periodically -- remove any that are no longer relevant
- Verify all org members have 2FA enabled

### Additional Hardening

These are one-time steps for org admins:

**Enable Dependabot alerts** (all repos):
```bash
for repo in repo1 repo2 repo3; do
  gh api -X PUT "/repos/<your-org>/${repo}/vulnerability-alerts"
done
```

**Enable web commit signoff** (org-wide):
- Org Settings > Repository > Default branch > Require contributors to sign off on web-based commits

---

## Limitations (Free Plan)

- Cannot enforce branch protection rules on private repos
- Cannot require status checks to pass before merging
- No GitHub-native secret scanning or push protection
- No SAML SSO or audit log API
- CODEOWNERS is advisory only (not enforced as required reviewers)

The CI workflow and pre-commit hooks in this toolkit compensate for most of these limitations at the developer workflow level, but a determined developer can bypass them with `--no-verify` or by merging without review.

Upgrading to **GitHub Team** ($4/user/month) enables branch protection and required status checks, making the security scans a hard gate that cannot be bypassed through the normal workflow.
