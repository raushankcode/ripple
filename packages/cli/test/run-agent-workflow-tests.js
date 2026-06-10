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
  `agent-workflow-${Date.now()}`
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

function setupFixture() {
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  writeFile("package.json", JSON.stringify({ name: "agent-workflow-fixture" }, null, 2));
  writeFile(
    "src/sessionPolicy.ts",
    [
      "export function sessionWindow(): number {",
      "  return 30;",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "src/tokenStore.ts",
    [
      "export function refreshToken(value: string): string {",
      "  return `token:${value}`;",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "src/auth.ts",
    [
      "import { sessionWindow } from './sessionPolicy';",
      "import { refreshToken } from './tokenStore';",
      "",
      "export function authenticate(value: string): string {",
      "  if (sessionWindow() < 1) {",
      "    return 'expired';",
      "  }",
      "  return refreshToken(value);",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "src/server.ts",
    [
      "import { authenticate } from './auth';",
      "",
      "export function authorize(value: string): string {",
      "  return authenticate(value);",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "tests/auth.test.ts",
    [
      "import { authenticate } from '../src/auth';",
      "",
      "export function testAuthenticate(): string {",
      "  return authenticate('abc');",
      "}",
      "",
    ].join("\n")
  );
}

function stageAuthEdit() {
  writeFile(
    "src/auth.ts",
    [
      "import { sessionWindow } from './sessionPolicy';",
      "import { refreshToken } from './tokenStore';",
      "",
      "export function authenticate(value: string): string {",
      "  const normalized = value.trim();",
      "  if (sessionWindow() < 1) {",
      "    return 'expired';",
      "  }",
      "  return refreshToken(normalized);",
      "}",
      "",
    ].join("\n")
  );

  execFileSync("git", ["init"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSync("git", ["add", "src/auth.ts"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function stageUnplannedEdit() {
  writeFile(
    "src/server.ts",
    [
      "import { authenticate } from './auth';",
      "",
      "export function authorize(value: string): string {",
      "  const normalized = value.trim();",
      "  return authenticate(normalized);",
      "}",
      "",
    ].join("\n")
  );
  execFileSync("git", ["add", "src/server.ts"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function assertIncludes(output, expected, label) {
  assert(
    output.includes(expected),
    `${label} should include ${expected}\n\nOutput:\n${output}`
  );
}

function proveAgentSetupWritesMcpInstructions() {
  const setup = JSON.parse(runCli(["agent", "setup", "--json"]));
  assert.strictEqual(setup.protocol, "ripple-agent-setup");
  assert.strictEqual(setup.version, 1);
  assert.strictEqual(setup.workspace, workspaceRoot);
  assert.strictEqual(setup.mcp.serverName, "ripple");
  assert.strictEqual(setup.mcp.command, "npx");
  assert(setup.mcp.args.includes("@getripple/mcp"));
  assert(setup.mcp.args.includes("--workspace"));
  assert(setup.mcp.args.includes(workspaceRoot));
  assert(setup.files.some((file) => file.path === "AGENTS.md" && file.written === true));
  assert(setup.files.some((file) => file.path === "CLAUDE.md" && file.written === true));
  assert(setup.files.some((file) => file.path === ".cursorrules" && file.written === true));

  const agents = fs.readFileSync(path.join(workspaceRoot, "AGENTS.md"), "utf8");
  assertIncludes(agents, "ripple_plan_context", "AGENTS.md");
  assertIncludes(agents, "ripple_gate", "AGENTS.md");
  assertIncludes(agents, "Do not claim Ripple passed unless you actually called", "AGENTS.md");
  assertIncludes(agents, "@getripple/mcp", "AGENTS.md");

  const repeated = JSON.parse(runCli(["agent", "setup", "--json"]));
  assert(repeated.files.every((file) => file.status === "exists" && file.written === false));
}

function main() {
  setupFixture();
  proveAgentSetupWritesMcpInstructions();

  // Agent output must expose the saved control boundary before edits begin.
  const plan = runCli([
    "plan",
    "--file",
    "src/auth.ts",
    "--task",
    "change token refresh behavior",
    "--budget",
    "2600",
    "--agent",
    "--save",
  ]);

  assert(plan.startsWith("RIPPLE_AGENT_CONTEXT"));
  assertIncludes(plan, "intent_id:", "pre-edit plan");
  assertIncludes(plan, "intent_path:", "pre-edit plan");
  assertIncludes(plan, "control_mode: file", "pre-edit plan");
  assertIncludes(plan, "human_gate: required-before-edit", "pre-edit plan");
  assertIncludes(plan, "allowed_files:", "pre-edit plan");
  assertIncludes(plan, "editable_files:", "pre-edit plan");
  assertIncludes(plan, "context_files:", "pre-edit plan");
  assertIncludes(plan, "read_first:", "pre-edit plan");
  assertIncludes(plan, "- src/auth.ts", "pre-edit plan");
  assertIncludes(plan, "- tests/auth.test.ts", "pre-edit plan");
  assertIncludes(plan, "symbols_first:", "pre-edit plan");
  assertIncludes(plan, "- src/auth.ts::authenticate", "pre-edit plan");
  assertIncludes(plan, "- src/tokenStore.ts::refreshToken", "pre-edit plan");
  assertIncludes(plan, "verify:", "pre-edit plan");
  assertIncludes(plan, "- tests/auth.test.ts", "pre-edit plan");
  assertIncludes(plan, "avoid_first:", "pre-edit plan");
  assertIncludes(plan, "Unrelated tests", "pre-edit plan");

  stageAuthEdit();

  const stagedCheck = runCli(["check", "--staged", "--agent", "--intent", "latest"]);
  assert(stagedCheck.startsWith("RIPPLE_STAGED_CHECK"));
  assertIncludes(stagedCheck, "intent_verdict: matched", "staged check");
  assertIncludes(stagedCheck, "control_mode: file", "staged check");
  assertIncludes(stagedCheck, "boundary_verdict: PASS", "staged check");
  assertIncludes(stagedCheck, "boundary_fix:", "staged check");
  assertIncludes(stagedCheck, "human_required: true", "staged check");
  assertIncludes(stagedCheck, "drift_verdict: PASS", "staged check");
  assertIncludes(stagedCheck, "drift_decision: continue", "staged check");
  assertIncludes(stagedCheck, "drift_fix:", "staged check");
  assertIncludes(stagedCheck, "planned_scope: matched", "staged check");
  assertIncludes(stagedCheck, "editable_files:", "staged check");
  assertIncludes(stagedCheck, "context_files_changed:", "staged check");
  assertIncludes(stagedCheck, "changed_files:", "staged check");
  assertIncludes(stagedCheck, "- src/auth.ts", "staged check");
  assertIncludes(stagedCheck, "read_first:", "staged check");
  assertIncludes(stagedCheck, "symbols_first:", "staged check");
  assertIncludes(stagedCheck, "- src/auth.ts::authenticate", "staged check");
  assertIncludes(stagedCheck, "- src/tokenStore.ts::refreshToken", "staged check");
  assertIncludes(stagedCheck, "verify:", "staged check");
  assertIncludes(stagedCheck, "- tests/auth.test.ts", "staged check");
  assertIncludes(stagedCheck, "requires_attention:", "staged check");

  const repair = runCli(["repair", "--agent", "--intent", "latest"]);
  assert(repair.startsWith("RIPPLE_INTENT_DRIFT_REPAIR"));
  assertIncludes(repair, "verdict: matched", "repair");
  assertIncludes(repair, "drift_verdict: PASS", "repair");
  assertIncludes(repair, "drift_decision: continue", "repair");
  assertIncludes(repair, "boundary_verdict: PASS", "repair");
  assertIncludes(repair, "status: no-repair-needed", "repair");
  assertIncludes(repair, "unstage_files:", "repair");
  assertIncludes(repair, "fix_actions:", "repair");
  assertIncludes(repair, "required verify target=tests/auth.test.ts", "repair");
  assertIncludes(repair, "verify:", "repair");
  assertIncludes(repair, "- tests/auth.test.ts", "repair");

  stageUnplannedEdit();

  const driftRepair = runCli(["repair", "--agent", "--intent", "latest"]);
  assert(driftRepair.startsWith("RIPPLE_INTENT_DRIFT_REPAIR"));
  assertIncludes(driftRepair, "verdict: drifted", "drift repair");
  assertIncludes(driftRepair, "drift_verdict: DANGER", "drift repair");
  assertIncludes(driftRepair, "drift_decision: stop-and-ask-human", "drift repair");
  assertIncludes(driftRepair, "boundary_verdict: DANGER", "drift repair");
  assertIncludes(driftRepair, "status: human-review-required", "drift repair");
  assertIncludes(driftRepair, "fix_actions:", "drift repair");
  assertIncludes(
    driftRepair,
    "blocker unstage-file target=src/server.ts command=git restore --staged -- src/server.ts",
    "drift repair"
  );
  assertIncludes(driftRepair, "read or verification context", "drift repair");
  assertIncludes(driftRepair, "blocker replan", "drift repair");

  console.log("Ripple agent workflow tests passed");
}

main();
