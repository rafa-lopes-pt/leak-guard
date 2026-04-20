# Improvement Notes

## Remove Hardcoded `files` in package.json

### Problem

The `files` array in `package.json` lists each script individually. Adding a new script to `scripts/` requires remembering to also add it to `files`, otherwise npm won't publish it. This already caused `setup-dist.js` to be missing from the registry.

### Solution

Replace individual script entries with a directory glob:

```json
"files": [
  "bin/",
  "scripts/",
  ".gitleaks.toml",
  ".security-filetypes.default",
  "workflows/",
  "security-keywords.txt.example",
  "LICENSE",
  "README.md"
]
```

Since every file under `scripts/` (including `hooks/`) is meant to be published, there's no reason to enumerate them. Using `"scripts/"` includes the entire directory recursively.

### Validation

After changing, always run `npm pack --dry-run` to confirm the tarball contents match expectations.
