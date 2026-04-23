// Remove LeakGuard artifacts from the current repo.
// Interactive by default; --yes skips prompts (keeps .security-key and .gitleaks.toml).

import { confirm, checkbox } from "@inquirer/prompts";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, isGitRepo, removeGitignoreEntries } from "./lib/rc.js";
import { banner, ok, info, warn, error, done, hint, cmd, filePath, gap, list } from "./lib/ui.js";

const GITIGNORE_ENTRIES = [".security-key", "reports/"];

const ARTIFACTS = [
  { path: ".security-key",                     sensitive: true,  yesDefault: false },
  { path: ".security-filetypes",               sensitive: false, yesDefault: true },
  { path: ".leakguardrc",                      sensitive: false, yesDefault: true },
  { path: ".gitleaks.toml",                     sensitive: false, yesDefault: false },
  { path: "security-keywords.enc",             sensitive: false, yesDefault: true },
  { path: ".github/workflows/secret-scan.yml", sensitive: false, yesDefault: true },
  { path: ".git/hooks/pre-commit",             sensitive: false, yesDefault: true, hookCheck: true },
  { path: ".git/leakguard-audit.log",          sensitive: false, yesDefault: true },
];

function isLeakguardHook(hookPath) {
  if (!existsSync(hookPath)) return false;
  const content = readFileSync(hookPath, "utf-8");
  return content.includes("Installed by scripts/setup.js");
}

function findArtifacts() {
  const found = [];
  for (const artifact of ARTIFACTS) {
    const fullPath = join(REPO_ROOT, artifact.path);
    if (artifact.hookCheck) {
      if (isLeakguardHook(fullPath)) found.push(artifact);
    } else if (existsSync(fullPath)) {
      found.push(artifact);
    }
  }
  return found;
}

async function uninstall(argv = []) {
  const yesMode = argv.includes("--yes") || argv.includes("-y");

  if (!isGitRepo()) {
    error("Not a git repository. Run this from a repo root.");
    process.exit(1);
  }

  const found = findArtifacts();

  if (found.length === 0) {
    info("No LeakGuard artifacts found in this repo.");
    return;
  }

  let toRemove;
  let cleanGitignore;

  if (yesMode) {
    toRemove = found.filter((a) => a.yesDefault);
    cleanGitignore = true;
  } else {
    banner("LeakGuard Uninstall", "Remove LeakGuard artifacts from this repo");

    info("Found the following LeakGuard artifacts:");
    list(found.map((a) => filePath(a.path)));
    gap();

    if (found.some((a) => a.sensitive)) {
      warn(
        `${filePath(".security-key")} is your encryption key. ` +
          "Deleting it means you can no longer decrypt security-keywords.enc."
      );
      gap();
    }

    const selected = await checkbox({
      message: "Select files to remove:",
      choices: found.map((a) => ({
        name: a.path,
        value: a,
        checked: a.yesDefault,
      })),
    });

    if (selected.length === 0) {
      info("Nothing selected. Uninstall cancelled.");
      return;
    }

    if (selected.some((a) => a.sensitive)) {
      const confirmKey = await confirm({
        message: "Are you sure you want to delete .security-key? This cannot be undone.",
        default: false,
      });
      if (!confirmKey) {
        toRemove = selected.filter((a) => !a.sensitive);
        info("Keeping .security-key.");
      } else {
        toRemove = selected;
      }
    } else {
      toRemove = selected;
    }

    if (toRemove.length === 0) {
      info("Nothing to remove. Uninstall cancelled.");
      return;
    }

    cleanGitignore = await confirm({
      message: "Also clean LeakGuard entries from .gitignore?",
      default: true,
    });

    gap();
    info("Will remove:");
    list(toRemove.map((a) => filePath(a.path)));
    if (cleanGitignore) info(`Will clean .gitignore entries: ${GITIGNORE_ENTRIES.join(", ")}`);
    gap();

    const go = await confirm({ message: "Proceed?", default: true });
    if (!go) {
      info("Uninstall cancelled.");
      return;
    }
  }

  gap();
  for (const artifact of toRemove) {
    const fullPath = join(REPO_ROOT, artifact.path);
    try {
      unlinkSync(fullPath);
      ok(`Removed ${filePath(artifact.path)}`);
    } catch (e) {
      warn(`Could not remove ${filePath(artifact.path)}: ${e.message}`);
    }
  }

  if (cleanGitignore) {
    const changed = removeGitignoreEntries(GITIGNORE_ENTRIES);
    if (changed) {
      ok("Cleaned .gitignore entries");
    } else {
      info("No LeakGuard entries found in .gitignore");
    }
  }

  gap();
  const keptKey = !toRemove.some((a) => a.path === ".security-key") && found.some((a) => a.path === ".security-key");
  if (keptKey) {
    hint(".security-key was kept. Store it safely if you still need it.");
  }
  done("Uninstall complete.");
  hint(`Run ${cmd("git status")} to review changes.`);
}

async function main(argv) {
  try {
    await uninstall(argv);
  } catch (e) {
    if (e.name === "ExitPromptError") {
      console.log("\nUninstall cancelled.");
      process.exit(0);
    }
    throw e;
  }
}

export { main };
