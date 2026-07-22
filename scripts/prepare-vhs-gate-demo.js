#!/usr/bin/env node
"use strict";

/**
 * Prepares the environment for recording docs/ripple-gate-demo.tape.
 *
 * The tape invokes a bare `ripple` command, so this script builds the CLI from
 * the current source and puts a `ripple` shim on PATH that points at the freshly
 * built dist. That guarantees the recording shows the code in this working tree,
 * not a globally installed or previously published version.
 *
 * Run directly with `npm run demo:vhs-setup`, or let `npm run demo:gif` call it.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const cliDist = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const binDir = path.join(repoRoot, "node_modules", ".vhs-bin");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function buildCli() {
  console.log("[vhs] building @getripple/core and @getripple/cli...");
  run("npm", ["run", "build"], { cwd: path.join(repoRoot, "packages", "core") });
  run("npm", ["run", "build"], { cwd: path.join(repoRoot, "packages", "cli") });
  if (!fs.existsSync(cliDist)) {
    throw new Error(`CLI build did not produce ${cliDist}`);
  }
}

/**
 * Writes a `ripple` shim so the tape can type a natural-looking command.
 * Both a POSIX shim and a .cmd shim are written so the tape works whichever
 * shell VHS ends up using.
 */
function writeRippleShim() {
  fs.mkdirSync(binDir, { recursive: true });

  const posixShim = path.join(binDir, "ripple");
  fs.writeFileSync(
    posixShim,
    `#!/bin/sh\nexec "${process.execPath.replace(/\\/g, "/")}" "${cliDist.replace(/\\/g, "/")}" "$@"\n`,
    "utf8"
  );
  try {
    fs.chmodSync(posixShim, 0o755);
  } catch {
    // chmod is best-effort on Windows.
  }

  fs.writeFileSync(
    path.join(binDir, "ripple.cmd"),
    `@echo off\r\n"${process.execPath}" "${cliDist}" %*\r\n`,
    "utf8"
  );

  return binDir;
}

function main() {
  buildCli();
  const dir = writeRippleShim();
  console.log(`[vhs] ripple shim ready at ${dir}`);
  return dir;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[vhs] setup failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

module.exports = { main, binDir, cliDist, repoRoot };
