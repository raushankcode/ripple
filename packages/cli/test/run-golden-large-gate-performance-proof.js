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
  `golden-large-gate-performance-proof-${Date.now()}`
);

const FEATURE_COUNT = Number(process.env.RIPPLE_LARGE_GATE_FILES ?? 420);
const MAX_GATE_MS = Number(process.env.RIPPLE_LARGE_GATE_MAX_MS ?? 8000);

function writeFile(relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function runCli(args) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCliJson(args) {
  const output = runCli([...args, "--json"]);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Expected JSON for ripple ${args.join(" ")}:\n${output}`);
  }
}

function runGit(args) {
  execFileSync("git", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function featureName(index) {
  return `feature${String(index).padStart(3, "0")}`;
}

function setupLargeFixture() {
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  writeFile(
    "package.json",
    JSON.stringify({ name: "ripple-large-gate-performance-proof" }, null, 2)
  );
  writeFile(
    "src/core/shared.ts",
    [
      "export function approvedFormat(value: string): string {",
      "  return value.trim();",
      "}",
      "",
      "export function riskyNormalize(value: string): string {",
      "  return value.toLowerCase();",
      "}",
      "",
    ].join("\n")
  );

  for (let index = 0; index < FEATURE_COUNT; index++) {
    const name = featureName(index);
    writeFile(
      `src/features/${name}.ts`,
      [
        "import { approvedFormat, riskyNormalize } from '../core/shared';",
        "",
        `export function ${name}(value: string): string {`,
        "  return riskyNormalize(approvedFormat(value));",
        "}",
        "",
      ].join("\n")
    );
  }

  for (let index = 0; index < FEATURE_COUNT; index += 20) {
    const name = featureName(index);
    writeFile(
      `tests/${name}.test.ts`,
      [
        `import { ${name} } from '../src/features/${name}';`,
        "",
        `export function test${name}(): string {`,
        `  return ${name}(' Ripple ');`,
        "}",
        "",
      ].join("\n")
    );
  }

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

function createApprovedFunctionIntent() {
  const plan = runCliJson([
    "plan",
    "--file",
    "src/core/shared.ts",
    "--symbol",
    "approvedFormat",
    "--task",
    "tighten shared formatting behavior",
    "--mode",
    "function",
    "--save",
  ]);
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.controlMode, "function");
  assert.deepStrictEqual(plan.changeIntent.allowedSymbols, [
    "src/core/shared.ts::approvedFormat",
  ]);

  runCli([
    "approve",
    "--intent",
    "latest",
    "--gate",
    "before-risky-edit",
    "--reason",
    "large gate performance proof approval",
  ]);
}

function removeGeneratedContextBundle() {
  [
    path.join(workspaceRoot, ".ripple", ".cache", "context.json"),
    path.join(workspaceRoot, ".ripple", ".cache", "context.files.json"),
    path.join(workspaceRoot, ".ripple", ".cache", "context.symbols.json"),
    path.join(workspaceRoot, ".ripple", "WORKFLOW.md"),
  ].forEach((filePath) => fs.rmSync(filePath, { force: true }));

  fs.rmSync(path.join(workspaceRoot, ".ripple", ".cache", "focus"), {
    recursive: true,
    force: true,
  });
}

function assertGeneratedContextBundleWasNotRecreated() {
  [
    path.join(workspaceRoot, ".ripple", ".cache", "context.json"),
    path.join(workspaceRoot, ".ripple", ".cache", "context.files.json"),
    path.join(workspaceRoot, ".ripple", ".cache", "context.symbols.json"),
    path.join(workspaceRoot, ".ripple", "WORKFLOW.md"),
    path.join(workspaceRoot, ".ripple", ".cache", "focus"),
  ].forEach((generatedPath) => {
    assert(
      !fs.existsSync(generatedPath),
      `large gate should not regenerate ${path.relative(workspaceRoot, generatedPath)}`
    );
  });
}

function crossFunctionBoundary() {
  writeFile(
    "src/core/shared.ts",
    [
      "export function approvedFormat(value: string): string {",
      "  return value.trim();",
      "}",
      "",
      "export function riskyNormalize(value: string): string {",
      "  const normalized = value.trim();",
      "  return normalized.toLowerCase();",
      "}",
      "",
    ].join("\n")
  );
  runGit(["add", "src/core/shared.ts"]);
}

function runMeasuredGate() {
  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    [cliPath, "gate", "--intent", "latest", "--json"],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: Math.max(30000, MAX_GATE_MS * 4),
    }
  );
  const elapsedMs = Date.now() - startedAt;

  if (result.error) {
    throw result.error;
  }
  assert.strictEqual(result.status, 0, result.stderr);

  try {
    return {
      elapsedMs,
      gate: JSON.parse(result.stdout),
    };
  } catch {
    throw new Error(`Expected JSON from measured ripple gate:\n${result.stdout}`);
  }
}

function main() {
  setupLargeFixture();
  createApprovedFunctionIntent();
  removeGeneratedContextBundle();
  crossFunctionBoundary();

  const { elapsedMs, gate } = runMeasuredGate();

  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.status, "closed");
  assert.strictEqual(gate.canContinue, false);
  assert.strictEqual(gate.mustStop, true);
  assert.deepStrictEqual(gate.allowedSymbols, ["src/core/shared.ts::approvedFormat"]);
  assert(
    gate.changedOutsideBoundarySymbols.includes("src/core/shared.ts::riskyNormalize"),
    "large gate should identify the unapproved changed symbol"
  );
  assert(
    gate.why.some((reason) =>
      reason.includes("Changed symbol outside function boundary: src/core/shared.ts::riskyNormalize")
    ),
    "large gate should explain the crossed function boundary"
  );
  assert(
    elapsedMs < MAX_GATE_MS,
    `large gate should finish under ${MAX_GATE_MS}ms; took ${elapsedMs}ms`
  );
  assertGeneratedContextBundleWasNotRecreated();

  console.log("Ripple golden large gate performance proof passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Source files: ${FEATURE_COUNT + Math.ceil(FEATURE_COUNT / 20) + 1}`);
  console.log(`Gate elapsed: ${elapsedMs}ms`);
  console.log("Gate decision: closed for crossed function boundary");
}

main();
