// Deploy configuration: defaults, interactive prompts, key-value parsing.
// Used by `deploy --config` and the init wizard's deploy step.

import { select, input, confirm } from "@inquirer/prompts";
import { readRc, writeRc } from "./rc.js";
import { done, error, label } from "./ui.js";

export const DEPLOY_DEFAULTS = {
  defaultMode: "chunked",
  chunkSize: 500000,
  archiveName: "{folder}",
  skipGitleaks: false,
  skipKeywords: false,
  commitMessage: "Update dist",
  keepArchive: false,
  createRelease: false,
};

const DEPLOY_SCHEMA = {
  defaultMode: { type: "enum", values: ["chunked", "7z"] },
  chunkSize: { type: "number", min: 10000 },
  archiveName: { type: "string" },
  skipGitleaks: { type: "boolean" },
  skipKeywords: { type: "boolean" },
  commitMessage: { type: "string" },
  keepArchive: { type: "string-or-false" },
  createRelease: { type: "boolean" },
};

export function resolveDeployConfig() {
  const rc = readRc();
  const saved = rc?.deploy || {};
  return { ...DEPLOY_DEFAULTS, ...saved };
}

export function writeDeployConfig(settings) {
  const rc = readRc() || {};
  const merged = { ...(rc.deploy || {}), ...settings };
  writeRc({ deploy: merged });
}

export async function promptDeployConfig() {
  const current = resolveDeployConfig();

  const defaultMode = await select({
    message: "Default deploy mode:",
    choices: [
      { name: "chunked -- encrypted text chunks (DLP-friendly)", value: "chunked" },
      { name: "7z -- single encrypted .7z archive", value: "7z" },
    ],
    default: current.defaultMode,
  });

  let chunkSize = current.chunkSize;
  if (defaultMode === "chunked") {
    const sizeStr = await input({
      message: "Chunk size (bytes, min 10000):",
      default: String(current.chunkSize),
      validate: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 10000) return "Must be an integer >= 10000";
        return true;
      },
    });
    chunkSize = Number(sizeStr);
  }

  const archiveName = await input({
    message: "Archive base name ({folder} = dist folder name):",
    default: current.archiveName,
  });

  const skipGitleaks = await confirm({
    message: "Skip gitleaks scan during deploy?",
    default: current.skipGitleaks,
  });

  const skipKeywords = await confirm({
    message: "Skip keyword scan during deploy?",
    default: current.skipKeywords,
  });

  const commitMessage = await input({
    message: "Commit message template ({archiveName}, {chunkCount} available):",
    default: current.commitMessage,
  });

  const wantKeep = await confirm({
    message: "Keep a local copy of the archive after deploy?",
    default: current.keepArchive !== false,
  });

  let keepArchive = false;
  if (wantKeep) {
    const keepPath = await input({
      message: "Path to save archive copy:",
      default: typeof current.keepArchive === "string" ? current.keepArchive : "./deploy-archive",
    });
    keepArchive = keepPath;
  }

  const createRelease = await confirm({
    message: "Create a GitHub Release after deploy? (requires gh CLI, skipped in chunked mode)",
    default: current.createRelease,
  });

  const settings = {
    defaultMode,
    chunkSize,
    archiveName,
    skipGitleaks,
    skipKeywords,
    commitMessage,
    keepArchive,
    createRelease,
  };

  writeDeployConfig(settings);
  console.log();
  done("Deploy settings saved to .leakguardrc");
  return settings;
}

export function applyKeyValueConfig(pairs) {
  const updates = {};

  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) {
      error(`Invalid format "${pair}". Use key=value.`);
      process.exit(1);
    }

    const key = pair.slice(0, eqIdx);
    const rawValue = pair.slice(eqIdx + 1);
    const schema = DEPLOY_SCHEMA[key];

    if (!schema) {
      error(`Unknown deploy config key "${key}".`);
      error(`Valid keys: ${Object.keys(DEPLOY_SCHEMA).join(", ")}`);
      process.exit(1);
    }

    switch (schema.type) {
      case "boolean":
        if (rawValue !== "true" && rawValue !== "false") {
          error(`"${key}" must be true or false.`);
          process.exit(1);
        }
        updates[key] = rawValue === "true";
        break;

      case "number": {
        const n = Number(rawValue);
        if (!Number.isInteger(n) || (schema.min && n < schema.min)) {
          error(`"${key}" must be an integer >= ${schema.min}.`);
          process.exit(1);
        }
        updates[key] = n;
        break;
      }

      case "enum":
        if (!schema.values.includes(rawValue)) {
          error(`"${key}" must be one of: ${schema.values.join(", ")}.`);
          process.exit(1);
        }
        updates[key] = rawValue;
        break;

      case "string":
        updates[key] = rawValue;
        break;

      case "string-or-false":
        updates[key] = rawValue === "false" ? false : rawValue;
        break;
    }
  }

  writeDeployConfig(updates);
  done("Deploy settings updated:");
  for (const [k, v] of Object.entries(updates)) {
    label(k, String(v));
  }
}
