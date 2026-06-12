const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `agent-control-demo-${Date.now()}`,
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
    timeout: 30000,
  });
}

function runCliResult(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
  });
}

function runCliJson(args, options = {}) {
  const result = runCliResult([...args, "--json"]);
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `ripple ${args.join(" ")} failed\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
    );
  }
  if (options.expectFailure) {
    assert.notStrictEqual(
      result.status,
      0,
      `ripple ${args.join(" ")} should fail closed for this demo`,
    );
  }
  const output = result.stdout ?? "";
  try {
    return JSON.parse(output);
  } catch (err) {
    throw new Error(
      `Expected JSON from ripple ${args.join(" ")}\n\nstdout:\n${output}\n\nstderr:\n${result.stderr}`,
    );
  }
}

function setupFixture() {
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  writeFile("package.json", JSON.stringify({ name: "ripple-agent-control-demo" }, null, 2));
  writeFile(
    "src/auth.ts",
    [
      "export function refreshToken(attempts = 1): string {",
      "  if (attempts > 1) {",
      "    return 'retry-token';",
      "  }",
      "",
      "  return 'token';",
      "}",
      "",
      "export function login(user: string): string {",
      "  return `session:${user}`;",
      "}",
      "",
    ].join("\n"),
  );
  writeFile(
    "test/auth.test.ts",
    [
      "import { login, refreshToken } from '../src/auth';",
      "",
      "export function authSmoke(): string {",
      "  return `${login('ada')}:${refreshToken()}`;",
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
    "user.name=Ripple Demo",
    "commit",
    "-m",
    "baseline",
  ]);
}

function simulateAgentBoundaryCross() {
  writeFile(
    "src/auth.ts",
    [
      "export function refreshToken(attempts = 1): string {",
      "  const safeAttempts = Math.max(1, attempts);",
      "  if (safeAttempts > 1) {",
      "    return 'retry-token';",
      "  }",
      "",
      "  return 'token';",
      "}",
      "",
      "export function login(user: string): string {",
      "  return `session:${user.trim()}`;",
      "}",
      "",
    ].join("\n"),
  );
  runGit(["add", "src/auth.ts"]);
}

function firstUseful(items) {
  return Array.isArray(items) && items.length > 0 ? items[0] : undefined;
}

function main() {
  setupFixture();

  const init = runCliJson(["init"]);
  assert.strictEqual(init.protocol, "ripple-init");

  const plan = runCliJson([
    "plan",
    "--file",
    "src/auth.ts",
    "--task",
    "fix refresh token retry behavior",
    "--mode",
    "function",
    "--symbol",
    "refreshToken",
    "--save",
  ]);
  assert(plan.changeIntent, "demo should save a change intent");
  assert.strictEqual(plan.changeIntent.controlMode, "function");

  const approval = runCliJson([
    "approve",
    "--gate",
    "before-risky-edit",
    "--approved-by",
    "Ripple Demo",
    "--reason",
    "Demo approves only the refreshToken function boundary.",
  ]);
  assert.strictEqual(approval.protocol, "ripple-approval");

  simulateAgentBoundaryCross();

  const gate = runCliJson(["gate", "--intent", "latest", "--strict"], {
    allowFailure: true,
    expectFailure: true,
  });
  const gateText = JSON.stringify(gate);
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.canContinue, false);
  assert.strictEqual(gate.mustStop, true);
  assert(
    gateText.includes("src/auth.ts::login"),
    "gate should name the changed symbol outside the approved function boundary",
  );

  const repair = runCliJson(["repair", "--intent", "latest"]);
  const repairText = JSON.stringify(repair);
  assert.strictEqual(repair.protocol, "ripple-intent-drift-repair");
  assert(
    repairText.includes("src/auth.ts::login"),
    "repair plan should tell the agent what outside-boundary symbol to repair",
  );

  const outsideSymbol =
    firstUseful(gate.reviewPacket?.boundary?.changedOutsideBoundarySymbols) ??
    firstUseful(gate.reviewPacket?.drift?.changedOutsideBoundarySymbols) ??
    "src/auth.ts::login";
  const repairAction =
    firstUseful(
      repair.fixActions?.map((action) =>
        action.instruction ?? action.reason ?? action.message ?? action.type
      )
    ) ??
    firstUseful(repair.nextSteps) ??
    "Undo the unapproved symbol change or ask for a wider human-approved boundary.";

  console.log("");
  console.log("Ripple agent-control demo passed");
  console.log("");
  console.log("1. Init: local Ripple policy and hooks created");
  console.log("2. Plan: saved function boundary src/auth.ts::refreshToken");
  console.log("3. Approval: human approved that narrow boundary");
  console.log("4. Agent edit: changed refreshToken and also changed login");
  console.log(`5. Gate: STOP (${gate.decision})`);
  console.log(`6. Evidence: changed outside boundary ${outsideSymbol}`);
  console.log(`7. Repair: ${repairAction}`);
  console.log("");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("Result: HUMAN REVIEW REQUIRED before the agent may continue");
  console.log("");
}

main();
