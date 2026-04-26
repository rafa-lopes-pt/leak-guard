// Deploy configuration: defaults, interactive prompts, key-value parsing.
// Used by `deploy --config` and the init wizard's deploy step.

import { select, input, confirm } from "@inquirer/prompts";
import { readRc, writeRc } from "./rc.js";
import { done, error, label } from "./ui.js";

// ---------------------------------------------------------------------------
// Chunk size parsing and validation
// ---------------------------------------------------------------------------

const UNIT_MULTIPLIERS = { kb: 1_000, mb: 1_000_000, gb: 1_000_000_000 };

/** Resolve a chunkSize value to bytes. Returns null for invalid input. */
export function parseChunkSize(value, totalSize) {
  if (typeof value === "number") return value;
  const str = String(value).toLowerCase().trim();
  // Count mode: "3n" -> split into N equal parts
  const countMatch = str.match(/^(\d+)n$/);
  if (countMatch) {
    const parts = Number(countMatch[1]);
    return Math.ceil(totalSize / parts);
  }
  // Unit mode: "0.5mb", ".5mb", "500kb", "1gb"
  const unitMatch = str.match(/^(\.\d+|\d+\.?\d*)(kb|mb|gb)$/);
  if (unitMatch) {
    return Math.round(Number(unitMatch[1]) * UNIT_MULTIPLIERS[unitMatch[2]]);
  }
  // Plain number as string
  const n = Number(str);
  if (!Number.isNaN(n) && str !== "") return n;
  return null;
}

// ---------------------------------------------------------------------------
// Expiry parsing and validation
// ---------------------------------------------------------------------------

const EXPIRY_UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** Resolve an expiry value to { ms, iso } or null for invalid input. ms:0 = never. */
export function parseExpiry(value) {
  if (value == null) return null;
  const str = String(value).trim().toLowerCase();
  if (str === "0" || str === "never") return { ms: 0, iso: null };

  // Duration: 30m, 8h, 1d, 7d, 2w
  const durMatch = str.match(/^(\d+)(m|h|d|w)$/);
  if (durMatch) {
    const ms = Number(durMatch[1]) * EXPIRY_UNITS[durMatch[2]];
    if (ms <= 0) return null;
    const iso = new Date(Date.now() + ms).toISOString();
    return { ms, iso };
  }

  // ISO date
  const date = new Date(String(value).trim());
  if (!Number.isNaN(date.getTime())) {
    if (date.getTime() <= Date.now()) return null; // past date
    return { ms: date.getTime() - Date.now(), iso: date.toISOString() };
  }

  return null;
}

function validateExpiry(value) {
  const str = String(value).trim().toLowerCase();
  if (str === "0" || str === "never") return true;
  const result = parseExpiry(value);
  if (result === null) return 'Invalid format. Use a duration (30m, 8h, 1d, 2w), ISO date, or "0" for never';
  return true;
}

function validateChunkSize(value) {
  const str = String(value).toLowerCase().trim();
  const countMatch = str.match(/^(\d+)n$/);
  if (countMatch) {
    return Number(countMatch[1]) >= 2 ? true : "Count mode requires at least 2 parts";
  }
  const resolved = parseChunkSize(str, Infinity);
  if (resolved === null) return "Invalid format. Use a number, or add kb/mb/gb suffix, or Nn for count";
  if (resolved < 10000) return "Must be >= 10000 bytes (10kb)";
  return true;
}

export const DEPLOY_DEFAULTS = {
  defaultMode: "chunked",
  chunkSize: 500000,
  archiveName: "{folder}",
  skipGitleaks: false,
  skipKeywords: false,
  commitMessage: "Update dist",
  keepArchive: false,
  createRelease: false,
  expires: "30m",
};

const DEPLOY_SCHEMA = {
  defaultMode: { type: "enum", values: ["chunked", "7z"] },
  chunkSize: { type: "chunk-size" },
  archiveName: { type: "string" },
  skipGitleaks: { type: "boolean" },
  skipKeywords: { type: "boolean" },
  commitMessage: { type: "string" },
  keepArchive: { type: "string-or-false" },
  createRelease: { type: "boolean" },
  expires: { type: "expiry" },
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
      { name: "chunked -- encrypted text chunks (stronger encryption)", value: "chunked" },
      { name: "7z -- single encrypted .7z archive", value: "7z" },
    ],
    default: current.defaultMode,
  });

  let chunkSize = current.chunkSize;
  if (defaultMode === "chunked") {
    const sizeStr = await input({
      message: "Chunk size (e.g. 500000, 500kb, 0.5mb, 3n):",
      default: String(current.chunkSize),
      validate: validateChunkSize,
    });
    // Store as number if purely numeric integer, otherwise raw string
    const n = Number(sizeStr);
    chunkSize = Number.isInteger(n) ? n : sizeStr.trim();
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

  const expires = await input({
    message: 'Deploy expiry (e.g. 30m, 8h, 7d, 2w, ISO date, or "0" for never):',
    default: current.expires,
    validate: validateExpiry,
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
    expires,
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

      case "chunk-size": {
        const valid = validateChunkSize(rawValue);
        if (valid !== true) {
          error(`"${key}": ${valid}`);
          process.exit(1);
        }
        const num = Number(rawValue);
        updates[key] = Number.isInteger(num) ? num : rawValue.trim();
        break;
      }

      case "string-or-false":
        updates[key] = rawValue === "false" ? false : rawValue;
        break;

      case "expiry": {
        const expiryValid = validateExpiry(rawValue);
        if (expiryValid !== true) {
          error(`"${key}": ${expiryValid}`);
          process.exit(1);
        }
        updates[key] = rawValue;
        break;
      }
    }
  }

  writeDeployConfig(updates);
  done("Deploy settings updated:");
  for (const [k, v] of Object.entries(updates)) {
    label(k, String(v));
  }
}
