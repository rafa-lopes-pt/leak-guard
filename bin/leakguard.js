#!/usr/bin/env node
// CLI entry point for LeakGuard.
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
LeakGuard -- GitHub Security Toolkit

Usage:
  leakguard [command] [options]

Commands:
  init                    Interactive TUI setup (default)
  blacklist <keywords>    Add keywords to the encrypted blocklist
  scan-history [dir]      One-time full-history audit
  zip <files...>          Create encrypted .7z archive
  deploy [path]           Scan, zip, and push a folder to the -dist repo
  setup-dist              Set up the public -dist distribution repo

Blacklist options:
  blacklist kw1 kw2       Add/merge keywords into existing list
  blacklist kw1 --override  Replace entire list with given keywords
  blacklist -l, --list    Show current keywords
  blacklist -r, --remove kw1 kw2  Remove specific keywords

Options:
  --help, -h          Show this help message
  --version, -v       Print version
`);
}

function printBlacklistHelp() {
  console.log(`
Usage: leakguard blacklist [options] [keywords...]

Manage the encrypted keyword blocklist.

Examples:
  leakguard blacklist foo bar "secret phrase"    Add/merge keywords
  leakguard blacklist foo bar --override         Replace entire list
  leakguard blacklist -l                         List current keywords
  leakguard blacklist --list                     List current keywords
  leakguard blacklist -r foo bar                 Remove specific keywords
  leakguard blacklist --remove foo bar           Remove specific keywords
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

  case "blacklist": {
    const subArgs = args.slice(1);
    const { encryptKeywords, listKeywords, removeKeywords } = await import(
      "../scripts/encrypt-keywords.js"
    );

    if (subArgs.includes("-l") || subArgs.includes("--list")) {
      listKeywords();
    } else if (subArgs.includes("-r") || subArgs.includes("--remove")) {
      const keywords = subArgs.filter((a) => a !== "-r" && a !== "--remove");
      if (keywords.length === 0) {
        console.error("ERROR: Specify keywords to remove.");
        printBlacklistHelp();
        process.exit(1);
      }
      removeKeywords({ keywords });
    } else {
      const override = subArgs.includes("--override");
      const keywords = subArgs.filter((a) => a !== "--override");
      if (keywords.length === 0) {
        printBlacklistHelp();
        break;
      }
      encryptKeywords({ keywords, override });
    }
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

  case "deploy": {
    const { deploy } = await import("../scripts/deploy.js");
    await deploy(args.slice(1));
    break;
  }

  case "setup-dist": {
    const { setupDist } = await import("../scripts/setup-dist.js");
    await setupDist();
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
