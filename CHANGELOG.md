# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.0] - 2026-04-30

### Added

- Persisted deploy password: `leakguard deploy` remembers the archive password between runs (encrypted in gitignored `.deploy-password.enc`, keyed off `.security-key`)
- `leakguard deploy --reset-password` -- force prompt and re-save
- `leakguard deploy --no-save-password` -- prompt without offering to save
- `leakguard deploy --forget-password` -- delete the saved deploy password
- `setup-dist` prompts whether to track the dist folder in the source repo (default: track) -- enables source-mirror workflows where the dist contents are version-controlled
- `distFolderTracked` key persisted in `.leakguardrc` so re-running `setup-dist` defaults to the previous choice

### Changed

- `setup-dist` no longer auto-gitignores the local dist folder; the user chooses
- Deploy `.7z` mode now feeds the password via argv (`-p<pw>`) instead of an interactive 7z prompt, enabling reuse of the saved password (visible in `/proc/<pid>/cmdline` while 7z runs)

## [1.1.0] - 2026-04-26

### Added

- npm version, downloads, license, and node version badges to README
- npm install command at top of README
- Receiver: side-by-side layout (file list on left, preview on right)
- Receiver: search bar for filtering files by name
- Receiver: copy-to-clipboard button in the file viewer
- `leakguard lint` command for on-demand security scanning (all tracked files, specific paths, or `--staged`)
- `leakguard deploy --expires` for time-limited deployments (auto-expire deployed content)
- Deploy expiry config key (`expires=30m`) with duration, ISO date, and "never" support
- GitHub Actions expire workflow auto-generated in -dist repos (hourly check, content wipe or repo deletion)

### Changed

- Dist README checksums now use fenced code blocks (enables GitHub copy button)
- Dist README explains that only the first checksum is real in chunked mode
- Renamed reassemble.html to leakguard-receiver.html
- Receiver: wider max-width (1200px) to accommodate side-by-side layout
- Receiver: responsive stacked layout on narrow screens (< 768px)

### Removed

- Stale IMPROVEMENTS.md and TODO.md

## [1.0.1] - 2026-04-23

### Added

- Browser-based reassemble tool (reassemble.html) for decrypting deployed chunks without CLI
- `leakguard reassemble` CLI subcommand

### Fixed

- README inaccuracies

## [1.0.0] - 2026-04-23

### Added

- Interactive TUI setup (`leakguard init`)
- Encrypted keyword scanning with `leakguard blacklist`
- Pre-commit hooks for file type, keyword, and gitleaks scanning
- GitHub Actions workflow for CI secret scanning
- `leakguard deploy` with chunked and 7z encryption modes
- `leakguard setup-dist` for bootstrapping public -dist repos
- `leakguard scan-history` for full-history audits
- `leakguard zip` for encrypted .7z archives
- `leakguard deploy --dry-run` and `--yes` flags
- GitHub Release creation from deploy
- Shell completion support
- ESLint and automated tests (node:test)
- Husky pre-commit hooks for CI gates
