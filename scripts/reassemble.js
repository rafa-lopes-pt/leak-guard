#!/usr/bin/env node
// Reassemble chunked deploy output (.nofbiz or .txt files) back into the original archive.
// Reverses the process from `leakguard deploy --chunked`.
//
// Usage: node reassemble.js <output-file> <chunk-directory> [--checksum <sha256>]
//
// Pure Node.js -- no external dependencies.

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { createInterface } from "node:readline";

// -- Helpers -----------------------------------------------------------------

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function promptPassword(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // Suppress echoed characters
    rl._writeToOutput = (s) => {
      if (s.includes(prompt)) rl.output.write(s);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      console.log(); // newline after hidden input
      resolve(answer);
    });
  });
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

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

// -- Main --------------------------------------------------------------------

export async function reassemble(args) {
  // Parse --checksum / -c flag
  let expectedChecksum = null;
  const filteredArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--checksum" || args[i] === "-c") {
      expectedChecksum = (args[++i] || "").trim().toLowerCase();
      if (!expectedChecksum) die("--checksum requires a SHA-256 hash value");
    } else {
      filteredArgs.push(args[i]);
    }
  }

  if (filteredArgs.length < 2 || args.includes("--help") || args.includes("-h")) {
    console.log("Usage: leakguard reassemble <output-file> <chunk-directory> [--checksum <sha256>]");
    console.log();
    console.log("  output-file       Path for the reassembled archive (e.g. output.zip)");
    console.log("  chunk-directory    Directory containing ordered .nofbiz / .txt chunks");
    console.log("  -c, --checksum    Optional expected SHA-256 hash to verify the output");
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const outputPath = resolve(filteredArgs[0].endsWith(".zip") ? filteredArgs[0] : filteredArgs[0] + ".zip");
  const chunkDir = resolve(filteredArgs[1]);

  if (!existsSync(chunkDir)) die(`Directory not found: ${chunkDir}`);

  // Collect and sort chunk files
  const chunkFiles = readdirSync(chunkDir)
    .filter((f) => f.endsWith(".nofbiz") || f.endsWith(".txt"))
    .sort();

  if (chunkFiles.length === 0) {
    die(`No chunk files found in ${chunkDir} (expected .nofbiz or .txt)`);
  }

  console.log(`Found ${chunkFiles.length} chunk(s) in ${chunkDir}`);

  // Concatenate chunks
  let encryptedText = "";
  for (const file of chunkFiles) {
    encryptedText += readFileSync(join(chunkDir, file), "utf-8").trim();
  }
  console.log(`Combined encrypted payload: ${encryptedText.length} chars`);

  // Get passphrase
  const passphrase = await promptPassword("Enter passphrase: ");
  if (!passphrase) die("Empty passphrase.");

  // Decrypt
  console.log("Decrypting (PBKDF2 key derivation, this may take a moment)...");
  let base64Zip;
  try {
    base64Zip = decryptString(encryptedText, passphrase);
  } catch (e) {
    die(`Decryption failed. Wrong passphrase?\n  ${e.message}`);
  }

  // Decode base64 to binary
  const zipBuffer = Buffer.from(base64Zip, "base64");
  console.log(`Decrypted archive size: ${zipBuffer.length} bytes`);

  // Verify checksum
  const actual = createHash("sha256").update(zipBuffer).digest("hex");
  console.log(`SHA-256: ${actual}`);

  // Use flag value, or ask interactively
  if (!expectedChecksum) {
    expectedChecksum = (await prompt("Paste expected SHA-256 to verify (Enter to skip): ")).toLowerCase();
  }

  if (expectedChecksum) {
    if (actual === expectedChecksum) {
      console.log("Checksum verified OK.");
    } else {
      console.error(`Checksum MISMATCH!`);
      console.error(`  Expected: ${expectedChecksum}`);
      console.error(`  Got:      ${actual}`);
      process.exit(1);
    }
  } else {
    console.log("Checksum verification skipped.");
  }

  // Write output
  writeFileSync(outputPath, zipBuffer);
  console.log(`Written to ${outputPath}`);
}
