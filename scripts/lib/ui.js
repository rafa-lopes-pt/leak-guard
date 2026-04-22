// Shared CLI formatting helpers for consistent, readable output.
// Uses yoctocolors-cjs (transitive dep of @inquirer/prompts) -- zero new deps.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const c = require("yoctocolors-cjs");

export { c };

// -- Banners & headers --------------------------------------------------------

export function banner(title, subtitle) {
  const len = Math.max(title.length, subtitle ? subtitle.length : 0) + 4;
  const line = c.dim("=".repeat(len));
  console.log(`\n${line}`);
  console.log(`  ${c.bold(c.cyan(title))}`);
  if (subtitle) console.log(`  ${c.dim(subtitle)}`);
  console.log(`${line}\n`);
}

export function header(text, step, total) {
  const prefix = step != null && total != null
    ? c.bold(c.cyan(`[${step}/${total}]`)) + " "
    : "";
  console.log(`\n${prefix}${c.bold(text)}`);
}

// -- Status messages ----------------------------------------------------------

export function ok(msg)    { console.log(`  ${c.green("OK")}    ${msg}`); }
export function info(msg)  { console.log(`  ${c.blue("--")}    ${msg}`); }
export function warn(msg)  { console.log(`  ${c.yellow("WARN")}  ${msg}`); }
export function error(msg) { console.error(`  ${c.red("ERROR")} ${msg}`); }
export function done(msg)  { console.log(`  ${c.green("DONE")}  ${msg}`); }
export function skip(msg)  { console.log(`  ${c.dim("SKIP")}  ${msg}`); }

// -- Structural helpers -------------------------------------------------------

export function label(key, value) {
  console.log(`  ${c.dim(key + ":")}  ${value}`);
}

export function list(items, indent = 2) {
  const pad = " ".repeat(indent);
  for (const item of items) {
    console.log(`${pad}${c.dim("-")} ${item}`);
  }
}

export function numberedList(items, indent = 2) {
  const pad = " ".repeat(indent);
  const width = String(items.length).length;
  for (let i = 0; i < items.length; i++) {
    console.log(`${pad}${c.dim(String(i + 1).padStart(width) + ".")} ${items[i]}`);
  }
}

export function hint(msg) {
  console.log(`  ${c.dim(msg)}`);
}

export function cmd(str) {
  return c.bold(c.white(str));
}

export function filePath(str) {
  return c.cyan(str);
}

export function gap() {
  console.log();
}
