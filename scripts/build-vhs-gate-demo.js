#!/usr/bin/env node
"use strict";

/**
 * Records docs/ripple-gate-demo.tape with VHS and publishes the result to both
 * places the GIF is referenced: resources/ (README) and docs/media/ (docs site).
 *
 * This replaces scripts/build-gate-demo-gif.ps1, which was a hand-drawn mock
 * renderer that painted fake terminal frames. Every frame produced here is real
 * `ripple demo` output.
 *
 * Requires the `vhs` binary: https://github.com/charmbracelet/vhs
 * Run with: npm run demo:gif
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const prepare = require("./prepare-vhs-gate-demo.js");

const repoRoot = prepare.repoRoot;
const tapePath = path.join(repoRoot, "docs", "ripple-gate-demo.tape");
const primaryOut = path.join(repoRoot, "resources", "ripple-gate-demo.gif");
const docsOut = path.join(repoRoot, "docs", "media", "ripple-gate-demo.gif");

function assertVhsAvailable() {
  const probe = spawnSync("vhs", ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (probe.status !== 0) {
    throw new Error(
      "vhs was not found on PATH. Install it from https://github.com/charmbracelet/vhs " +
        "(e.g. `winget install charmbracelet.vhs` or `brew install vhs`)."
    );
  }
  console.log(`[vhs] using ${probe.stdout.trim()}`);
}

function record(binDir) {
  if (!fs.existsSync(tapePath)) {
    throw new Error(`Tape not found: ${tapePath}`);
  }
  fs.mkdirSync(path.dirname(primaryOut), { recursive: true });

  // Put the ripple shim first on PATH so the tape's bare `ripple demo` resolves
  // to the build we just made.
  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    // Never publish to the cloud while recording a public asset.
    RIPPLE_API_KEY: "",
    RIPPLE_CLOUD_URL: "",
  };

  console.log("[vhs] recording (this takes ~40s of real demo runtime)...");
  // Pass a repo-relative path: an absolute path containing spaces gets split by
  // the shell on Windows ("accepts at most 1 arg(s), received 2").
  const tapeArg = path.relative(repoRoot, tapePath).split(path.sep).join("/");
  const result = spawnSync("vhs", [tapeArg], {
    cwd: repoRoot,
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`vhs exited with code ${result.status}`);
  }
  if (!fs.existsSync(primaryOut)) {
    throw new Error(`vhs did not produce ${primaryOut}`);
  }
}

function publish() {
  fs.mkdirSync(path.dirname(docsOut), { recursive: true });
  fs.copyFileSync(primaryOut, docsOut);
  const sizeMb = (fs.statSync(primaryOut).size / (1024 * 1024)).toFixed(1);
  console.log(`[vhs] wrote ${path.relative(repoRoot, primaryOut)} (${sizeMb} MB)`);
  console.log(`[vhs] wrote ${path.relative(repoRoot, docsOut)}`);
  if (Number(sizeMb) > 12) {
    console.warn(
      `[vhs] warning: ${sizeMb} MB is large for a README asset. ` +
        "Lower Framerate or Height in docs/ripple-gate-demo.tape to shrink it."
    );
  }
}

function main() {
  assertVhsAvailable();
  const binDir = prepare.main();
  record(binDir);
  publish();
}

try {
  main();
} catch (err) {
  console.error(`[vhs] build failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
