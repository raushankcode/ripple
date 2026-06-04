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
  `golden-drift-control-proof-${Date.now()}`
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

function commitBaseline() {
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

function assertIncludes(output, expected, label) {
  assert(
    output.includes(expected),
    `${label} should include ${expected}\n\nOutput:\n${output}`
  );
}

function setupFixture() {
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  writeFile("package.json", JSON.stringify({ name: "ripple-drift-proof" }, null, 2));
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

  commitBaseline();
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

  const plan = runCli([
    "plan",
    "--file",
    "src/auth.ts",
    "--symbol",
    "refreshToken",
    "--task",
    "fix refresh token retry behavior",
    "--mode",
    "function",
    "--agent",
    "--save",
  ]);

  assert(plan.startsWith("RIPPLE_AGENT_CONTEXT"));
  assertIncludes(plan, "control_mode: function", "golden plan");
  assertIncludes(plan, "human_gate: required-before-edit", "golden plan");
  assertIncludes(plan, "boundary_risk: high", "golden plan");
  assertIncludes(plan, "allowed_symbols:", "golden plan");
  assertIncludes(plan, "- src/auth.ts::refreshToken", "golden plan");

  writeFile(
    ".ripple/policy.json",
    JSON.stringify(
      {
        protocol: "ripple-policy",
        version: 1,
        defaultMode: "file",
        riskRules: [
          {
            paths: ["src/auth.ts"],
            risk: "critical",
            requireHumanBeforeEdit: true,
          },
        ],
      },
      null,
      2
    )
  );

  crossFunctionBoundary();

  const stagedCheck = runCli(["check", "--staged", "--agent", "--intent", "latest"]);
  assert(stagedCheck.startsWith("RIPPLE_STAGED_CHECK"));
  assertIncludes(stagedCheck, "intent_verdict: matched", "golden staged check");
  assertIncludes(stagedCheck, "control_mode: function", "golden staged check");
  assertIncludes(stagedCheck, "boundary_verdict: DANGER", "golden staged check");
  assertIncludes(stagedCheck, "next_required_phase: repair_or_handoff", "golden staged check");
  assertIncludes(stagedCheck, "saved_policy_explanation:", "golden staged check");
  assertIncludes(stagedCheck, "effective_mode: function", "golden staged check");
  assertIncludes(stagedCheck, "policy_drift:", "golden staged check");
  assertIncludes(stagedCheck, "label: DRIFT", "golden staged check");
  assertIncludes(stagedCheck, "policy_risk saved=none current=critical", "golden staged check");
  assertIncludes(
    stagedCheck,
    "boundary_decision: stop-and-ask-human",
    "golden staged check"
  );
  assertIncludes(stagedCheck, "changed_outside_boundary_symbols:", "golden staged check");
  assertIncludes(stagedCheck, "- src/auth.ts::login", "golden staged check");
  assertIncludes(stagedCheck, "boundary_fix:", "golden staged check");
  assertIncludes(
    stagedCheck,
    "Undo or replan unapproved symbol: src/auth.ts::login",
    "golden staged check"
  );

  const repair = runCli(["repair", "--agent", "--intent", "latest"]);
  assert(repair.startsWith("RIPPLE_INTENT_DRIFT_REPAIR"));
  assertIncludes(repair, "verdict: matched", "golden repair");
  assertIncludes(repair, "status: human-review-required", "golden repair");
  assertIncludes(repair, "boundary_verdict: DANGER", "golden repair");
  assertIncludes(repair, "saved_policy_explanation:", "golden repair");
  assertIncludes(repair, "effective_mode: function", "golden repair");
  assertIncludes(repair, "policy_drift:", "golden repair");
  assertIncludes(repair, "label: DRIFT", "golden repair");
  assertIncludes(repair, "blocker review-policy target=src/auth.ts", "golden repair");
  assertIncludes(repair, "changed_outside_boundary_symbols:", "golden repair");
  assertIncludes(repair, "- src/auth.ts::login", "golden repair");
  assertIncludes(
    repair,
    "blocker review-symbol target=src/auth.ts::login",
    "golden repair"
  );
  assertIncludes(
    repair,
    "Undo the accidental change to src/auth.ts::login",
    "golden repair"
  );

  console.log("Ripple golden drift-control proof passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("Planned boundary: function src/auth.ts::refreshToken");
  console.log("Crossed symbol: src/auth.ts::login");
  console.log("Check verdict: boundary_verdict: DANGER");
  console.log("Repair status: human-review-required");
}

main();
