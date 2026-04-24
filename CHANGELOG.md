# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- npm version, downloads, license, and node version badges to README
- npm install command at top of README

### Changed

- Dist README checksums now use fenced code blocks (enables GitHub copy button)
- Dist README explains that only the first checksum is real in chunked mode
- Renamed reassemble.html to leakguard-receiver.html

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
