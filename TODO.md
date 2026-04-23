# Pre-Publish TODO

## Must Fix

- [ ] **Package name availability**: `leakguard` was unpublished on 2026-04-21. npm blocks re-use for 24h after unpublish. Verify the name is available again, or re-scope (e.g., `@rafa-lopes-pt/leakguard`).
- [x] **Remove `security-keywords.txt.example` from `files`**: listed in package.json `files` array but the file doesn't exist. Either create it or remove the entry.
- [x] **Set a real version**: currently `0.0.0-beta.0`. Pick a version (e.g., `1.0.0-beta.1` or `2.0.0`) before publishing.

## Should Verify

- [ ] **`NPM_TOKEN` GitHub secret**: confirm it's set on `rafa-lopes-pt/leak-guard` and has publish permissions for the (un)scoped package name.
- [x] **Add tests to publish workflow**: `.github/workflows/publish.yml` currently only runs `npm ci` + `npm publish`. Add `npm test` and `npm run lint` before the publish step.
- [x] **Review `scripts/` glob in `files`**: the broad glob is fine today (tarball is 21 files, 37 kB) but verify nothing unwanted leaks in after future additions.

## Nice to Have

- [x] **Add `prepublishOnly` script**: replaced with husky pre-commit hook + CI lint/test gates.
