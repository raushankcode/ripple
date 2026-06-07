const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createRippleMcpToolHost } = require("../dist");
const { recordRippleApproval } = require("../../core/dist");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-mcp-large-gate-performance-proof-${Date.now()}`
);

const FEATURE_COUNT = Number(process.env.RIPPLE_MCP_LARGE_GATE_FILES ?? 420);
const MAX_GATE_MS = Number(process.env.RIPPLE_MCP_LARGE_GATE_MAX_MS ?? 8000);

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

function featureName(index) {
  return `feature${String(index).padStart(3, "0")}`;
}

function setupLargeFixture() {
  writeFile(
    "package.json",
    JSON.stringify({ name: "ripple-mcp-large-gate-performance-proof" }, null, 2)
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

async function createApprovedFunctionIntent(host) {
  const plan = await callMcpTool(host, "ripple_plan_context", {
    task: "tighten shared formatting behavior",
    filePath: "src/core/shared.ts",
    tokenBudget: 2600,
    mode: "function",
    symbol: "approvedFormat",
    saveIntent: true,
  });
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.controlMode, "function");
  assert.deepStrictEqual(plan.changeIntent.allowedSymbols, [
    "src/core/shared.ts::approvedFormat",
  ]);

  recordRippleApproval(workspaceRoot, plan.changeIntent, {
    gate: "before-risky-edit",
    reason: "MCP large gate performance proof approval",
  });
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
      `MCP large gate should not regenerate ${path.relative(workspaceRoot, generatedPath)}`
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

async function runMeasuredMcpGate(host) {
  const startedAt = Date.now();
  const gate = await callMcpTool(host, "ripple_gate", {
    tokenBudget: 2600,
    intentPath: "latest",
  });
  return {
    elapsedMs: Date.now() - startedAt,
    gate,
  };
}

async function main() {
  setupLargeFixture();
  const host = createRippleMcpToolHost({ workspaceRoot });

  try {
    await createApprovedFunctionIntent(host);
    removeGeneratedContextBundle();
    crossFunctionBoundary();

    const { elapsedMs, gate } = await runMeasuredMcpGate(host);

    assert.strictEqual(gate.protocol, "ripple-gate");
    assert.strictEqual(gate.status, "closed");
    assert.strictEqual(gate.canContinue, false);
    assert.strictEqual(gate.mustStop, true);
    assert.deepStrictEqual(gate.allowedSymbols, ["src/core/shared.ts::approvedFormat"]);
    assert(
      gate.changedOutsideBoundarySymbols.includes("src/core/shared.ts::riskyNormalize"),
      "MCP large gate should identify the unapproved changed symbol"
    );
    assert(
      gate.why.some((reason) =>
        reason.includes("Changed symbol outside function boundary: src/core/shared.ts::riskyNormalize")
      ),
      "MCP large gate should explain the crossed function boundary"
    );
    assert(
      elapsedMs < MAX_GATE_MS,
      `MCP large gate should finish under ${MAX_GATE_MS}ms; took ${elapsedMs}ms`
    );
    assertGeneratedContextBundleWasNotRecreated();

    console.log("Ripple golden MCP large gate performance proof passed");
    console.log(`Workspace: ${workspaceRoot}`);
    console.log(`Source files: ${FEATURE_COUNT + Math.ceil(FEATURE_COUNT / 20) + 1}`);
    console.log(`MCP gate elapsed: ${elapsedMs}ms`);
    console.log("MCP gate decision: closed for crossed function boundary");
  } finally {
    host.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
