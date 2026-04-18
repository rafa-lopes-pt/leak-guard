# LeakGuard -- GitHub Security Hardening Toolkit

**LeakGuard** is a comprehensive security scanning toolkit for GitHub organizations on the **free plan**. Prevents credential leaks and enforces security policies using client-side pre-commit hooks and GitHub Actions as a server-side safety net.

---

## Table of Contents

1. [GitHub Organization Security Overview](#1-github-organization-security-overview)
2. [Security Features by GitHub Plan](#2-security-features-by-github-plan)
3. [Secret and Credential Management](#3-secret-and-credential-management)
4. [How This Project Works](#4-how-this-project-works)
5. [Setup Guide](#5-setup-guide)
6. [Handling Cases](#6-handling-cases)
7. [2FA and Access Control](#7-2fa-and-access-control)
8. [Maintenance](#8-maintenance)

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

1. Keywords are written to `security-keywords.txt` (local, gitignored)
2. The file is encrypted with `openssl enc -aes-256-cbc -pbkdf2` using a shared passphrase
3. Only `security-keywords.enc` is committed to the repo
4. The pre-commit hook decrypts it at scan time and greps staged changes
5. GitHub Actions decrypts it using the `SECURITY_KEY` org secret

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
| `security-keywords.txt` | Plaintext keywords | No (gitignored) |
| `.github/workflows/secret-scan.yml` | CI workflow | Yes |
| `.git/hooks/pre-commit` | Local pre-commit hook | No (per-machine) |

---

## 5. Setup Guide

### Prerequisites

- Git
- Node.js 18+
- A terminal (bash, zsh, or Git Bash on Windows)

### Install

```bash
npm install -g @rafa-lopes-pt/leakguard
```

Or use directly with `npx`:

```bash
npx @rafa-lopes-pt/leakguard
```

### For New Developers Joining the Org

1. **Get the encryption key** from a teammate via a secure channel (Signal, 1Password, in person -- never Slack/email/GitHub).

2. **Run setup on each repo** you work with:
   ```bash
   cd /path/to/your-repo
   leakguard init
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

1. Edit `security-keywords.txt` (one keyword per line, `#` for comments)
2. Encrypt:
   ```bash
   leakguard encrypt-keywords
   ```
3. Commit `security-keywords.enc` (not the `.txt`)

### One-Time History Audit

Scan existing repos for previously committed secrets:

```bash
# Scan specific repos
leakguard scan-history /path/to/repo1 /path/to/repo2

# Scan all git repos in current directory
leakguard scan-history
```

Reports are saved to `./reports/`.

### Creating Encrypted Archives

Binary files that need to be in the repo must be packaged in an encrypted `.7z` archive:

```bash
# Single file
leakguard zip myfile.bin

# Multiple files or directories
leakguard zip assets/ config.dat
```

You will be prompted for a password. The archive is created in the current directory.

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
3. If the keyword is no longer sensitive: remove it from `security-keywords.txt` and re-encrypt

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

1. Edit `security-keywords.txt`
2. Run `leakguard encrypt-keywords`
3. Commit `security-keywords.enc`
4. Other devs pull and get the updated encrypted list automatically
5. Ensure the CI `SECURITY_KEY` org secret is still current

### Adding New Repos

1. `cd` into the new repo
2. Run `leakguard init`
3. Commit the generated files
4. The CI workflow and pre-commit hook are ready

### Monitoring

- Check GitHub Actions results after each push/PR
- Run `leakguard scan-history` quarterly (or when new repos are added)
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
