const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createRippleMcpToolHost } = require("../dist");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-mcp-fast-gate-proof-${Date.now()}`
);

function writeFile(relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function runGit(args) {
  execFileSync("git", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

async function callMcpTool(host, tool, args = {}) {
  const result = await host.callTool(tool, args);
  assert.strictEqual(result.tool, tool);
  return result.data;
}

function setupFixture() {
  writeFile(
    "package.json",
    JSON.stringify({ name: "ripple-mcp-fast-gate-proof" }, null, 2)
  );
  writeFile(
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  return value.trim();",
      "}",
      "",
      "export function shout(value: string): string {",
      "  return value.toUpperCase();",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "tests/util.test.ts",
    [
      "import { trimName } from '../src/util';",
      "",
      "export function testTrimName(): string {",
      "  return trimName(' Ada ');",
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
      `MCP gate should not regenerate ${path.relative(workspaceRoot, generatedPath)}`
    );
  });
}

function crossFunctionBoundary() {
  writeFile(
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  return value.trim();",
      "}",
      "",
      "export function shout(value: string): string {",
      "  const normalized = value.trim();",
      "  return normalized.toUpperCase();",
      "}",
      "",
    ].join("\n")
  );
  runGit(["add", "src/util.ts"]);
}

async function main() {
  setupFixture();
  const host = createRippleMcpToolHost({ workspaceRoot });

  try {
    const plan = await callMcpTool(host, "ripple_plan_context", {
      task: "normalize utility display names",
      filePath: "src/util.ts",
      tokenBudget: 2600,
      mode: "function",
      symbol: "trimName",
      saveIntent: true,
    });
    assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
    assert.strictEqual(plan.changeIntent.controlMode, "function");
    assert.deepStrictEqual(plan.changeIntent.allowedSymbols, ["src/util.ts::trimName"]);

    removeGeneratedContextBundle();
    crossFunctionBoundary();

    const startedAt = Date.now();
    const gate = await callMcpTool(host, "ripple_gate", {
      tokenBudget: 2600,
      intentPath: "latest",
    });
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(gate.protocol, "ripple-gate");
    assert.strictEqual(gate.status, "closed");
    assert.strictEqual(gate.decision, "repair");
    assert.strictEqual(gate.canContinue, false);
    assert.strictEqual(gate.mustStop, true);
    assert.deepStrictEqual(gate.allowedSymbols, ["src/util.ts::trimName"]);
    assert(
      gate.changedOutsideBoundarySymbols.includes("src/util.ts::shout"),
      "MCP gate should identify the unapproved changed symbol"
    );
    assert(
      gate.why.some((reason) =>
        reason.includes("Changed symbol outside function boundary: src/util.ts::shout")
      ),
      "MCP gate should explain the crossed function boundary"
    );
    assert(elapsedMs < 5000, `MCP fast gate should run quickly; took ${elapsedMs}ms`);
    assertGeneratedContextBundleWasNotRecreated();

    console.log("Ripple golden MCP fast gate proof passed");
    console.log(`Workspace: ${workspaceRoot}`);
    console.log(`MCP gate elapsed: ${elapsedMs}ms`);
    console.log("MCP gate decision: closed/repair for crossed function boundary");
  } finally {
    host.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
