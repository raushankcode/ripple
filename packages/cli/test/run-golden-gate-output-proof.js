const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-gate-output-proof-${Date.now()}`
);

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

function runGit(args) {
  execFileSync("git", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function setupFixture() {
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  writeFile(
    "package.json",
    JSON.stringify({ name: "ripple-gate-output-proof" }, null, 2)
  );
  writeFile(
    "src/auth.ts",
    [
      "export function refreshToken(value: string): string {",
      "  return value.trim();",
      "}",
      "",
      "export function login(value: string): string {",
      "  if (!value) {",
      "    return 'anonymous';",
      "  }",
      "  return value;",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "tests/auth.test.ts",
    [
      "import { refreshToken } from '../src/auth';",
      "",
      "export function testRefreshToken(): string {",
      "  return refreshToken(' abc ');",
      "}",
      "",
    ].join("\n")
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

function createApprovedFunctionIntent() {
  runCli([
    "plan",
    "--file",
    "src/auth.ts",
    "--symbol",
    "refreshToken",
    "--task",
    "fix refresh token retry behavior",
    "--mode",
    "function",
    "--save",
  ]);
  runCli([
    "approve",
    "--intent",
    "latest",
    "--gate",
    "before-risky-edit",
    "--reason",
    "golden gate output approval",
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
      `gate should not regenerate ${path.relative(workspaceRoot, generatedPath)}`
    );
  });
}

function crossFunctionBoundary() {
  writeFile(
    "src/auth.ts",
    [
      "export function refreshToken(value: string): string {",
      "  return value.trim();",
      "}",
      "",
      "export function login(value: string): string {",
      "  const normalized = value.trim();",
      "  if (!normalized) {",
      "    return 'anonymous';",
      "  }",
      "  return normalized;",
      "}",
      "",
    ].join("\n")
  );
  runGit(["add", "src/auth.ts"]);
}

function main() {
  setupFixture();
  createApprovedFunctionIntent();
  removeGeneratedContextBundle();
  crossFunctionBoundary();

  const output = runCli(["gate", "--intent", "latest"]);
  assertGeneratedContextBundleWasNotRecreated();
  const expected = [
    "Ripple gate: STOP",
    "Agent must stop and ask the human before continuing.",
    "",
    "Decision: human-review",
    "Can continue: no",
    "Must stop: yes",
    "",
    "Intent:",
    "  Task: fix refresh token retry behavior",
    "  Boundary: function",
    "  Target: src/auth.ts",
    "  Human gate: required-before-edit",
    "  Approval: approved",
    "",
    "Allowed:",
    "  - src/auth.ts::refreshToken",
    "Changed outside boundary:",
    "  - symbol: src/auth.ts::login",
    "Why:",
    "  - Control mode 'function' allows edits to src/auth.ts.",
    "  - Allowed symbols: src/auth.ts::refreshToken.",
    "  - Changed symbol outside function boundary: src/auth.ts::login",
    "  - Target path is high risk for agent autonomy.",
    "Fix now:",
    "  - Undo the accidental change to src/auth.ts::login, or ask the human to approve a wider boundary.",
    "  - If the broader scope is intentional, create a new saved intent with the human-approved boundary and run the staged check again.",
    "  - Undo or replan unapproved symbol: src/auth.ts::login",
    "  - Ask the human to approve a wider boundary before keeping these changes.",
    "  - Run the narrowest verification target(s) from the staged check.",
    "  - Keep the staged set scoped to the saved change intent.",
    "Commands:",
    "  - ripple repair --agent --intent latest",
    "  - Run ripple_plan_context with saveIntent: true for the broader intended scope.",
    "",
  ].join("\n");

  assert.strictEqual(output, expected);
  console.log("Ripple golden gate output proof passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("Gate output: compact STOP report");
}

main();
