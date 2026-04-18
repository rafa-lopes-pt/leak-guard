#!/usr/bin/env node
// CLI entry point for GitHub Security Toolkit (gst).
// Dispatches subcommands via process.argv -- no extra deps.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");

function printVersion() {
  const pkg = JSON.parse(readFileSync(resolve(PKG_ROOT, "package.json"), "utf-8"));
  console.log(pkg.version);
}

function printHelp() {
  console.log(`
GitHub Security Toolkit (gst)

Usage:
  gst [command] [options]

Commands:
  init                Interactive TUI setup (default)
  encrypt-keywords    Encrypt security-keywords.txt
  scan-history [dir]  One-time full-history audit
  zip <files...>      Create encrypted .7z archive

Options:
  --help, -h          Show this help message
  --version, -v       Print version
`);
}

const args = process.argv.slice(2);
const command = args[0] || "init";

switch (command) {
  case "--help":
  case "-h":
    printHelp();
    break;

  case "--version":
  case "-v":
    printVersion();
    break;

  case "init": {
    const { main } = await import("../scripts/setup.js");
    await main();
    break;
  }

  case "encrypt-keywords": {
    const { encryptKeywords } = await import("../scripts/encrypt-keywords.js");
    await encryptKeywords();
    break;
  }

  case "scan-history": {
    const repoPaths = args.slice(1);
    const { scanHistory } = await import("../scripts/scan-history.js");
    await scanHistory(repoPaths);
    break;
  }

  case "zip": {
    const { createZip } = await import("../scripts/create-zip.js");
    await createZip(args.slice(1));
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
