# GitHub Security Hardening Project

## What This Is
An npm package (`leakguard`) for hardening GitHub org security using free tooling: client-side pre-commit hooks + GitHub Actions as server-side safety net. Installable via `npm install -g` or `npx`.

## Project Structure
```
bin/leakguard.js                # CLI entry point (subcommand dispatch)
scripts/
  setup.js                      # Interactive TUI setup (Node.js, ESM)
  encrypt-keywords.js           # Keyword management (encrypt/decrypt/merge/remove)
  scan-history.js               # One-time full-history audit
  deploy.js                     # Scan, archive, push to -dist repo
  setup-dist.js                 # Create and bootstrap the -dist repo
  create-zip.js                 # Quick encrypted .7z wrapper
  reassemble.js                 # Reverse chunked deploy (reassemble chunks)
  hooks/pre-commit              # Pre-commit hook template (bash)
  hooks/pre-commit-dist         # Pre-commit hook for -dist repos
  lib/
    rc.js                       # Shared helpers (run, readRc, writeRc, paths)
    crypto.js                   # Keyword encryption/decryption (openssl wrapper)
    deploy-config.js            # Deploy config defaults, prompts, validation
    installer.js                # Platform-specific tool install commands
tests/                          # Automated tests (node:test)
.gitleaks.toml                  # Shared gitleaks secret scanning config
.security-filetypes.default     # Default file type blocklist template
workflows/secret-scan.yml       # GitHub Actions workflow (deployed to repos)
.github/workflows/publish.yml   # Automated npm publish on GitHub release
eslint.config.js                # ESLint flat config
```

## CLI Commands
- `leakguard` / `leakguard init` -- Interactive TUI setup
- `leakguard blacklist <keywords>` -- Add/merge keywords into encrypted blocklist
- `leakguard blacklist --override <keywords>` -- Replace entire keyword list
- `leakguard blacklist -l` / `--list` -- Show current keywords
- `leakguard blacklist -r` / `--remove <keywords>` -- Remove specific keywords
- `leakguard scan-history [repo...]` -- One-time history audit
- `leakguard zip <files...>` -- Create encrypted .7z archive
- `leakguard deploy [path]` -- Scan, archive, push to -dist repo
- `leakguard deploy --chunked` -- Deploy as encrypted text chunks (DLP-friendly)
- `leakguard deploy --7z` -- Deploy as single encrypted .7z archive
- `leakguard deploy --config` -- Interactive deploy configuration
- `leakguard deploy --config key=value` -- Set deploy config directly
- `leakguard deploy --dry-run` -- Scan and archive without pushing
- `leakguard setup-dist` -- Set up the public -dist distribution repo
- `leakguard completion` -- Output shell completion script
- `leakguard --help` / `leakguard --version`

## Key Design Decisions
- **gitleaks** over trufflehog/detect-secrets: single Go binary, MIT license, 150+ patterns
- **openssl AES-256-CBC** for keyword encryption: zero extra deps, available everywhere
- **Dual detection** for file types: extension check + MIME type via `file --mime-type` (catches renamed files)
- **Encrypted .7z** as the only approved binary archive format (AES-256)
- **ESM modules** (`"type": "module"`) throughout
- **Dynamic import()** in CLI entry point so `@inquirer/prompts` only loads for `init`
- **Published to npm** (`registry.npmjs.org`) as a public scoped package
- **spawnSync with array args** for keyword scanning (prevents shell injection)
- **-F (fixed-string) grep** in all keyword matching (keywords are literals, not regex)
- **Gitleaks version** centralized in `package.json` under `leakguard.gitleaksVersion`

## Conventions
- The pre-commit hook has 3 sequential scans: file types, keywords, gitleaks
- `.security-key` is always gitignored (never committed)
- Only `security-keywords.enc` gets committed
- `PROJECT_ROOT = resolve(__dirname, "..")` resolves to the package root whether local or in `node_modules/`
- Crypto params in `lib/crypto.js` must stay in sync with the bash pre-commit hook
- Temp directories use `randomBytes(8)` for uniqueness, not `Date.now()`

## Development
- `npm test` -- Run automated tests (node:test, 20 tests across 4 suites)
- `npm run lint` -- Run ESLint
- Manual smoke tests:
  - Stage a `.exe` file and try to commit -- should block (file type)
  - Stage a file with a keyword from the encrypted list -- should block (keyword)
  - Stage a fake AWS key `AKIA1234567890ABCDEF` -- should block (gitleaks)
