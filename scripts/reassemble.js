#!/usr/bin/env node
// Reassemble chunked deploy output (.nofbiz or .txt files) back into the original ZIP.
// Reverses the process from `leakguard deploy --chunked`.
//
// Usage: node reassemble.js [chunk-directory]

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { password, input } from "@inquirer/prompts";

import { ok, info, warn, error, done, hint, filePath } from "./lib/ui.js";

function decryptString(encryptedBase64, passphrase) {
  const raw = Buffer.from(encryptedBase64, "base64");
  if (raw.length < 33) {
    throw new Error("Encrypted data too short (expected at least salt + iv + 1 byte)");
  }
  const salt = raw.subarray(0, 16);
  const iv = raw.subarray(16, 32);
  const ciphertext = raw.subarray(32);

  const key = pbkdf2Sync(passphrase, salt, 100000, 32, "sha256");
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

function parseChecksum(checksumPath) {
  const content = readFileSync(checksumPath, "utf-8");
  // Handle both formats:
  //   SHA-256: `hash`          (non-chunked deploy)
  //   chunkname.nofbiz: `hash` (chunked deploy -- first entry is the real hash)
  const sha256Match = content.match(/SHA-256:\s*`([a-f0-9]{64})`/);
  if (sha256Match) return sha256Match[1];

  // Chunked format: first .nofbiz entry has the real hash
  const chunkedMatch = content.match(/\.nofbiz:\s*`([a-f0-9]{64})`/);
  if (chunkedMatch) return chunkedMatch[1];

  return null;
}

function verifyChecksum(expected, actual) {
  if (actual === expected) {
    ok("Checksum verified.");
    return true;
  }
  warn("Checksum mismatch!");
  error(`Expected: ${expected}`);
  error(`Got:      ${actual}`);
  return false;
}

async function main() {
  const chunkDir = resolve(process.argv[2] || ".");

  if (!existsSync(chunkDir)) {
    error(`Directory not found: ${chunkDir}`);
    process.exit(1);
  }

  // Read and sort .nofbiz files
  const chunkFiles = readdirSync(chunkDir)
    .filter((f) => f.endsWith(".nofbiz") || f.endsWith(".txt"))
    .sort();

  if (chunkFiles.length === 0) {
    error(`No chunk files found in ${chunkDir} (expected .nofbiz or .txt)`);
    process.exit(1);
  }

  // Validate chunk count against checksum file if available
  const checksumCandidates = ["README.md", "checksum.md"];
  let checksumPath = null;
  for (const name of checksumCandidates) {
    const candidate = join(chunkDir, name);
    if (existsSync(candidate)) {
      checksumPath = candidate;
      break;
    }
  }

  if (checksumPath) {
    const checksumContent = readFileSync(checksumPath, "utf-8");
    const expectedCount = (checksumContent.match(/\.nofbiz:/g) || []).length;
    if (expectedCount > 0 && chunkFiles.length !== expectedCount) {
      warn(`Expected ${expectedCount} chunk(s) but found ${chunkFiles.length}`);
    }
  }

  info(`Found ${chunkFiles.length} chunk(s) in ${filePath(chunkDir)}`);

  // Concatenate chunks
  let encryptedText = "";
  for (const file of chunkFiles) {
    encryptedText += readFileSync(join(chunkDir, file), "utf-8").trim();
  }
  info(`Combined encrypted payload: ${encryptedText.length} chars`);

  // Get passphrase
  const passphrase = await password({ message: "Enter passphrase:" });
  if (!passphrase) {
    error("Empty passphrase.");
    process.exit(1);
  }

  // Decrypt
  info("Decrypting (PBKDF2 key derivation, this may take a moment)...");
  let base64Zip;
  try {
    base64Zip = decryptString(encryptedText, passphrase);
  } catch (e) {
    error(`Decryption failed. Wrong passphrase?\n  ${e.message}`);
    process.exit(1);
  }

  // Decode base64 to ZIP binary
  const zipBuffer = Buffer.from(base64Zip, "base64");
  info(`Decrypted ZIP size: ${zipBuffer.length} bytes`);

  // Verify checksum
  const actual = createHash("sha256").update(zipBuffer).digest("hex");
  info(`SHA-256: ${actual}`);

  let verified = false;
  if (checksumPath) {
    const expected = parseChecksum(checksumPath);
    if (expected) {
      verified = verifyChecksum(expected, actual);
    } else {
      hint(`${checksumPath} found but could not parse SHA-256 hash.`);
    }
  }

  // If not verified via file, ask the user (skippable)
  if (!verified) {
    const expectedInput = await input({ message: "Paste expected SHA-256 to verify (Enter to skip):" });
    const expected = expectedInput.trim().toLowerCase();
    if (expected) {
      verifyChecksum(expected, actual);
    } else {
      hint("Checksum verification skipped.");
    }
  }

  // Write output ZIP
  const outputPath = resolve("output.zip");
  writeFileSync(outputPath, zipBuffer);
  done(`Written to ${filePath(outputPath)}`);
}

main();
