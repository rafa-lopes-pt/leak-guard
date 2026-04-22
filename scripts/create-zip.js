#!/usr/bin/env node
// Creates an encrypted .7z archive from files/directories.
// Wraps `7z a -p -mhe=on` so developers don't need to remember the flags.

import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";

import { commandExists } from "./lib/rc.js";
import { error, done, hint } from "./lib/ui.js";

export async function createZip(targets) {
  if (!targets || targets.length === 0) {
    error("Usage: leakguard zip <files...>");
    hint("Creates an encrypted .7z archive (AES-256) from the given files or directories.");
    process.exit(1);
  }

  if (!commandExists("7z")) {
    error("7z is not installed.");
    hint("Install it: sudo apt install p7zip-full (Debian/Ubuntu) or brew install p7zip (macOS)");
    process.exit(1);
  }

  for (const target of targets) {
    if (!existsSync(target)) {
      error(`"${target}" does not exist.`);
      process.exit(1);
    }
  }

  const defaultName = basename(targets[0]).replace(/\.[^.]+$/, "") + ".7z";

  const rl1 = createInterface({ input: process.stdin, output: process.stdout });
  const customName = await new Promise((resolve) =>
    rl1.question(`Archive name [${defaultName}]: `, resolve),
  );
  rl1.close();

  const output = customName.trim()
    ? (customName.trim().endsWith(".7z") ? customName.trim() : customName.trim() + ".7z")
    : defaultName;

  const outputPath = resolve(output);
  if (!outputPath.startsWith(process.cwd())) {
    error("Archive path must be within the current directory.");
    process.exit(1);
  }

  try {
    execSync(`7z a -p -mhe=on "${output}" ${targets.map((t) => `"${t}"`).join(" ")}`, {
      stdio: "inherit",
    });
  } catch {
    error("Archive creation failed.");
    process.exit(1);
  }

  done(`Created: ${output}`);
  hint(`Remember to git add ${output}`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question(`\nDelete original ${targets.length === 1 ? "file" : "files"}? [y/N] `, resolve),
  );
  rl.close();

  if (answer.trim().toLowerCase() === "y") {
    for (const target of targets) {
      rmSync(target, { recursive: true, force: true });
      done(`Deleted: ${target}`);
    }
  }
}
