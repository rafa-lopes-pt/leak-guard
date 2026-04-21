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

## DLP Compatibility for -dist Repos

### Known Limitation

Corporate DLP (Data Loss Prevention) proxies may block downloads of `-dist` repos that contain encrypted `.7z` archives. This is not a leakguard bug -- it is an inherent tension between content encryption (for leak prevention) and corporate content inspection (for security policy enforcement).

### Why It Happens

LeakGuard's `-dist` repos use AES-256 encrypted `.7z` archives (`-mhe=on`) to distribute files without exposing source code. DLP proxies inspect downloaded content to enforce security policies, but encrypted archives are opaque to inspection. When a proxy cannot verify the contents, it blocks the download by policy.

### Observed Behavior

- **Individual `.7z` file downloads**: Silent HTTP 403 from GitHub raw/blob URLs
- **"Download ZIP" from GitHub UI**: Redirect to a corporate block page
- **Small encrypted archives** (< 1 KB): Generally pass through unblocked
- **Larger encrypted archives** (hundreds of KB+): Trigger DLP blocks
- **`git clone`**: Unaffected -- Git's transfer protocol is not subject to the same HTTP-level inspection

### Implemented Mitigation

**GitHub Releases**: `leakguard deploy` now creates a "latest" GitHub Release with the `.7z` archive as a release asset after pushing to the `-dist` repo. Release asset downloads use a different URL path (`github.com/<org>/<repo>/releases/download/...`) that may bypass DLP rules that only inspect repository blob/raw downloads.

The release is created using the `gh` CLI (already a dependency). If `gh` is not available, the deploy continues normally -- the release step is non-blocking.

### Further Solutions to Explore

1. **Archive hash / signing for IT whitelisting**: Output a SHA-256 hash of the archive after creation so IT admins can create targeted DLP exceptions based on known-good file hashes, rather than blanket URL rules.

2. **Provide a `leakguard deploy --format` option**: Support alternative archive formats for environments where encrypted `.7z` is restricted. This would need to maintain equivalent security guarantees.

3. **Document corporate environment guidance**: Add user-facing documentation advising `git clone` instead of ZIP download in environments with DLP infrastructure. This is the simplest immediate workaround since Git's transfer protocol bypasses HTTP content inspection.
