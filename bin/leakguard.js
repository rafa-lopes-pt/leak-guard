#!/usr/bin/env node
// CLI entry point for LeakGuard.
// Dispatches subcommands via process.argv -- no extra deps.

import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");

const require = createRequire(import.meta.url);
const c = require("yoctocolors-cjs");

const COMPLETION_SCRIPT = `
# leakguard bash/zsh completion
# Enable: eval "$(leakguard completion)"

if [ -n "$ZSH_VERSION" ]; then
  autoload -Uz bashcompinit && bashcompinit
fi

_leakguard_completions() {
  local cur prev commands global_flags
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="init blacklist scan-history zip deploy setup-dist uninstall completion"
  global_flags="--help -h --version -v"

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands $global_flags" -- "$cur") )
    return
  fi

  case "\${COMP_WORDS[1]}" in
    blacklist)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--override -l --list -r --remove" -- "$cur") )
        return
      fi
      ;;
    deploy)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--yes -y --dry-run --chunked --7z --config" -- "$cur") )
        return
      fi
      ;;
    uninstall)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "--yes -y" -- "$cur") )
        return
      fi
      ;;
  esac
}

complete -o default -F _leakguard_completions leakguard
`.trim();

function printVersion() {
  const pkgPath = resolve(PKG_ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const date = statSync(pkgPath).mtime.toISOString().slice(0, 10);
  console.log(`${pkg.version} (${date})`);
}

function printHelp() {
  const h = (s) => c.bold(c.cyan(s));
  const cmd = (s) => c.bold(c.white(s));
  const dim = (s) => c.dim(s);

  console.log(`
${c.bold("LeakGuard")} ${dim("-- GitHub Security Toolkit")}

${h("Usage:")}
  ${cmd("leakguard")} ${dim("[command] [options]")}

${h("Commands:")}
  ${cmd("init")}                    ${dim("Interactive TUI setup (default)")}
  ${cmd("blacklist <keywords>")}    ${dim("Add keywords to the encrypted blocklist")}
  ${cmd("scan-history [dir]")}      ${dim("One-time full-history audit")}
  ${cmd("zip <files...>")}          ${dim("Create encrypted .7z archive")}
  ${cmd("deploy [path]")}           ${dim("Scan, encrypt, push to public -dist repo (layer 3)")}
  ${cmd("deploy --chunked")}        ${dim("Deploy as encrypted text chunks (stronger encryption)")}
  ${cmd("deploy --7z")}             ${dim("Deploy as single encrypted .7z archive")}
  ${cmd("deploy --config")}         ${dim("Interactive deploy configuration")}
  ${cmd("deploy --config k=v")}     ${dim("Set deploy config values directly")}
  ${cmd("deploy --dry-run")}        ${dim("Run scans and create archive, but don't push")}
  ${cmd("deploy -y, --yes")}        ${dim("Skip confirmation prompt")}
  ${cmd("setup-dist")}              ${dim("Set up the public -dist repo for secure distribution")}
  ${cmd("uninstall")}               ${dim("Remove LeakGuard artifacts from repo")}
  ${cmd("uninstall -y, --yes")}     ${dim("Remove all (keep .security-key and .gitleaks.toml)")}
  ${cmd("completion")}              ${dim("Output shell completion script")}

${h("Blacklist options:")}
  ${cmd("blacklist kw1 kw2")}       ${dim("Add/merge keywords into existing list")}
  ${cmd("blacklist kw1 --override")}  ${dim("Replace entire list with given keywords")}
  ${cmd("blacklist -l, --list")}    ${dim("Show current keywords")}
  ${cmd("blacklist -r, --remove kw1 kw2")}  ${dim("Remove specific keywords")}

${h("Deploy config keys:")}
  ${dim("defaultMode=chunked|7z    Default deploy mode")}
  ${dim("chunkSize=500kb           Chunk size (bytes, kb, mb, gb, or Nn for N parts)")}
  ${dim("archiveName={folder}      Archive name template ({folder} = dist folder)")}
  ${dim("skipGitleaks=true|false   Skip gitleaks scan")}
  ${dim("skipKeywords=true|false   Skip keyword scan")}
  ${dim("commitMessage=...         Commit message template ({archiveName}, {chunkCount})")}
  ${dim("keepArchive=false|path    Save archive copy before cleanup")}
  ${dim("createRelease=true|false  Create GitHub Release (7z mode only)")}

${h("Options:")}
  ${cmd("--help, -h")}          ${dim("Show this help message")}
  ${cmd("--version, -v")}       ${dim("Print version")}

${h("Shell completion:")}
  ${dim('eval "$(leakguard completion)"')}                   ${dim("Enable for current session")}
  ${dim('echo \'eval "$(leakguard completion)"\' >> ~/.bashrc')}   ${dim("Permanent (bash)")}
  ${dim('echo \'eval "$(leakguard completion)"\' >> ~/.zshrc')}    ${dim("Permanent (zsh)")}
`);
}

function printBlacklistHelp() {
  const h = (s) => c.bold(c.cyan(s));
  const cmd = (s) => c.bold(c.white(s));
  const dim = (s) => c.dim(s);

  console.log(`
${h("Usage:")} ${cmd("leakguard blacklist")} ${dim("[options] [keywords...]")}

${dim("Manage the encrypted keyword blocklist.")}

${h("Examples:")}
  ${cmd('leakguard blacklist foo bar "secret phrase"')}    ${dim("Add/merge keywords")}
  ${cmd("leakguard blacklist foo bar --override")}         ${dim("Replace entire list")}
  ${cmd("leakguard blacklist -l")}                         ${dim("List current keywords")}
  ${cmd("leakguard blacklist --list")}                     ${dim("List current keywords")}
  ${cmd("leakguard blacklist -r foo bar")}                 ${dim("Remove specific keywords")}
  ${cmd("leakguard blacklist --remove foo bar")}           ${dim("Remove specific keywords")}
`);
}

const args = process.argv.slice(2);
const command = args[0] || "--help";

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
        console.error(`  ${c.red("ERROR")} Specify keywords to remove.`);
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

  case "uninstall": {
    const { main } = await import("../scripts/uninstall.js");
    await main(args.slice(1));
    break;
  }

  case "completion":
    console.log(COMPLETION_SCRIPT);
    break;

  default:
    console.error(`  ${c.red("ERROR")} Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
