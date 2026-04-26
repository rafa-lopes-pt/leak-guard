# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- npm version, downloads, license, and node version badges to README
- npm install command at top of README
- Receiver: side-by-side layout (file list on left, preview on right)
- Receiver: search bar for filtering files by name
- Receiver: copy-to-clipboard button in the file viewer
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
