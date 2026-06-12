const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-hook-runner-proof-${Date.now()}`,
);

function writeFile(relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");
}

function runCli(args) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGit(args) {
  execFileSync("git", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function runGitResult(args, extraEnv = {}) {
  return spawnSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
  });
}

function writeFailingPathCommand(binDir, name, markerName, exitCode) {
  const markerPath = path.join(workspaceRoot, markerName).split(path.sep).join("/");
  const shellPath = path.join(binDir, name);
  fs.writeFileSync(
    shellPath,
    [
      "#!/bin/sh",
      `echo called > ${JSON.stringify(markerPath)}`,
      `echo "fake ${name} should not run" >&2`,
      `exit ${exitCode}`,
      "",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(shellPath, 0o755);

  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(binDir, `${name}.cmd`),
      [
        "@echo off",
        `echo called > "${path.join(workspaceRoot, markerName)}"`,
        `echo fake ${name} should not run 1>&2`,
        `exit /b ${exitCode}`,
        "",
      ].join("\r\n"),
      "utf8",
    );
  }
}

function writeFailingPathTools() {
  const binDir = path.join(workspaceRoot, ".ripple-test-bin");
  fs.mkdirSync(binDir, { recursive: true });
  writeFailingPathCommand(binDir, "ripple", ".fake-ripple-called", 98);
  writeFailingPathCommand(binDir, "npx", ".fake-npx-called", 97);
  return binDir;
}

function setupFixture() {
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  writeFile("package.json", JSON.stringify({ name: "ripple-hook-runner-proof" }, null, 2));
  writeFile(".gitignore", ".ripple/.cache/\n");
  writeFile(
    "src/util.ts",
    [
      "export function trimName(value) {",
      "  return value.trim();",
      "}",
      "",
    ].join("\n"),
  );

  runGit(["init"]);
  runGit(["add", "."]);
  runGit([
    "-c",
    "user.email=ripple@test.local",
    "-c",
    "user.name=Ripple Test",
    "commit",
    "-m",
    "baseline",
  ]);
}

function proveHookEmbedsDirectRunnerBeforeFallbacks() {
  const printedHook = runCli(["hook", "install", "--print"]);
  assert(
    printedHook.includes("ripple_direct_node="),
    "printed hook should include direct Node runner path",
  );
  assert(
    printedHook.includes("ripple_direct_cli="),
    "printed hook should include direct CLI runner path",
  );
  assert(
    printedHook.includes('"$ripple_direct_node" "$ripple_direct_cli" "$@"'),
    "printed hook should execute the direct CLI runner",
  );

  const directIndex = printedHook.indexOf('"$ripple_direct_node" "$ripple_direct_cli" "$@"');
  const globalRippleIndex = printedHook.indexOf("command -v ripple");
  const npxIndex = printedHook.indexOf("npx -y @getripple/cli");
  assert(directIndex !== -1, "direct runner should be present");
  assert(globalRippleIndex !== -1, "global ripple fallback should be present");
  assert(npxIndex !== -1, "npx fallback should be present");
  assert(
    directIndex < globalRippleIndex && globalRippleIndex < npxIndex,
    "direct runner should run before global ripple and npx fallbacks",
  );
}

function proveNoIntentCommitDoesNotFallThroughToPathFallbacks() {
  runCli(["hook", "install"]);

  writeFile(
    "README.md",
    [
      "# Hook runner proof",
      "",
      "This doc-only commit proves the no-intent hook path stays fast.",
      "",
    ].join("\n"),
  );
  runGit(["add", "README.md"]);

  const fakeBin = writeFailingPathTools();
  const result = runGitResult(
    [
      "-c",
      "user.email=ripple@test.local",
      "-c",
      "user.name=Ripple Test",
      "commit",
      "-m",
      "doc update without active intent",
    ],
    { PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  assert.strictEqual(
    result.status,
    0,
    `no-intent hook commit should succeed through the direct runner:\n${output}`,
  );
  assert(
    output.includes("[Ripple] No active local intent found."),
    `hook should run the no-intent awareness path:\n${output}`,
  );
  assert(
    !fs.existsSync(path.join(workspaceRoot, ".fake-ripple-called")),
    "hook should not fall through to a PATH ripple command",
  );
  assert(
    !fs.existsSync(path.join(workspaceRoot, ".fake-npx-called")),
    "hook should not fall through to npx",
  );
}

function main() {
  setupFixture();
  proveHookEmbedsDirectRunnerBeforeFallbacks();
  proveNoIntentCommitDoesNotFallThroughToPathFallbacks();

  console.log("Ripple golden hook runner proof passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("Hook runner: direct installer CLI before global ripple before npx");
  console.log("No-intent commit: did not call PATH ripple or npx");
}

main();
