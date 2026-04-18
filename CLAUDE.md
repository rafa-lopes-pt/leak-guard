# GitHub Security Hardening Project

## What This Is
An npm package (`@rafa-lopes-pt/leakguard`) for hardening GitHub org security using free tooling: client-side pre-commit hooks + GitHub Actions as server-side safety net. Installable via `npm install -g` or `npx`.

## Project Structure
```
bin/leakguard.js                # CLI entry point (subcommand dispatch)
scripts/
  setup.js                      # Interactive TUI setup (Node.js, ESM)
  encrypt-keywords.js            # Encrypts keyword list with openssl
  scan-history.js                # One-time full-history audit
  hooks/pre-commit               # Pre-commit hook template (bash)
.gitleaks.toml                  # Shared gitleaks secret scanning config
.security-filetypes.default     # Default file type blocklist template
security-keywords.txt.example   # Example keyword file format
workflows/secret-scan.yml       # GitHub Actions workflow (deployed to repos)
.github/workflows/publish.yml   # Automated npm publish on GitHub release
```

## CLI Commands
- `leakguard` / `leakguard init` -- Interactive TUI setup
- `leakguard encrypt-keywords` -- Encrypt keyword list
- `leakguard scan-history [repo...]` -- One-time history audit
- `leakguard --help` / `leakguard --version`

## Key Design Decisions
- **gitleaks** over trufflehog/detect-secrets: single Go binary, MIT license, 150+ patterns
- **openssl AES-256-CBC** for keyword encryption: zero extra deps, available everywhere
- **Dual detection** for file types: extension check + MIME type via `file --mime-type` (catches renamed files)
- **Encrypted .7z** as the only approved binary archive format (AES-256)
- **ESM modules** (`"type": "module"`) throughout
- **Dynamic import()** in CLI entry point so `@inquirer/prompts` only loads for `init`
- **Published to npm** (`registry.npmjs.org`) as a public scoped package

## Conventions
- The pre-commit hook has 3 sequential scans: file types, keywords, gitleaks
- `.security-key` and `security-keywords.txt` are always gitignored (never committed)
- Only `security-keywords.enc` gets committed
- `PROJECT_ROOT = resolve(__dirname, "..")` resolves to the package root whether local or in `node_modules/`

## Testing Locally
- Stage a `.exe` file and try to commit -- should block (file type)
- Stage a file with a keyword from the encrypted list -- should block (keyword)
- Stage a fake AWS key `AKIA1234567890ABCDEF` -- should block (gitleaks)
