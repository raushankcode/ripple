const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
7;

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-approval-control-proof-${Date.now()}`,
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

function runCliJson(args) {
  const output = runCli([...args, "--json"]);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Expected JSON for ripple ${args.join(" ")}:\n${output}`);
  }
}

function runCliResult(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
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

function setupFixture() {
  if (!fs.existsSync(cliPath)) {
    throw new Error(
      "CLI build output is missing. Run npm run build:cli first.",
    );
  }

  writeFile(
    "package.json",
    JSON.stringify({ name: "ripple-approval-proof" }, null, 2),
  );
  writeFile(
    "src/payments.ts",
    [
      "export function calculateFee(amount: number): number {",
      "  return Math.round(amount * 0.02);",
      "}",
      "",
    ].join("\n"),
  );
  writeFile(
    "tests/payments.test.ts",
    [
      "import { calculateFee } from '../src/payments';",
      "",
      "export function testCalculateFee(): number {",
      "  return calculateFee(100);",
      "}",
      "",
    ].join("\n"),
  );
  writeFile(
    ".ripple/policy.json",
    JSON.stringify(
      {
        protocol: "ripple-policy",
        version: 1,
        defaultMode: "file",
        riskRules: [
          {
            paths: ["src/payments.ts"],
            risk: "critical",
            requireHumanBeforeEdit: true,
          },
        ],
      },
      null,
      2,
    ),
  );

  commitBaseline();
}

function stagePlannedPaymentEdit() {
  writeFile(
    "src/payments.ts",
    [
      "export function calculateFee(amount: number): number {",
      "  const fee = amount * 0.025;",
      "  return Math.round(fee);",
      "}",
      "",
    ].join("\n"),
  );
  runGit(["add", "src/payments.ts"]);
}

function tamperSavedIntentTask() {
  const intentPath = path.join(
    workspaceRoot,
    ".ripple",
    "intents",
    "latest.json",
  );
  const intent = JSON.parse(fs.readFileSync(intentPath, "utf8"));
  intent.task = "different task after human approval";
  fs.writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`, "utf8");
}

function main() {
  setupFixture();

  const plan = runCli([
    "plan",
    "--file",
    "src/payments.ts",
    "--task",
    "adjust payment fee rounding",
    "--mode",
    "file",
    "--agent",
    "--save",
  ]);
  assert(plan.startsWith("RIPPLE_AGENT_CONTEXT"));
  assert(plan.includes("human_gate: required-before-edit"));
  assert(plan.includes("boundary_risk: critical"));
  assert(plan.includes("policy_risk: critical"));

  stagePlannedPaymentEdit();

  const auditBeforeApproval = runCliJson(["audit", "--intent", "latest"]);
  assert.strictEqual(auditBeforeApproval.protocol, "ripple-audit");
  assert.strictEqual(auditBeforeApproval.status, "human-review-required");
  assert.strictEqual(auditBeforeApproval.approvalStatus.status, "missing");
  assert.strictEqual(auditBeforeApproval.approvalStatus.approved, false);
  assert(
    auditBeforeApproval.blockingReasons.some((reason) =>
      reason.includes("Human approval missing"),
    ),
    "audit should block before the human approval is recorded",
  );

  const lazyApproval = runCliResult([
    "approve",
    "--intent",
    "latest",
    "--gate",
    "before-risky-edit",
  ]);
  assert.notStrictEqual(
    lazyApproval.status,
    0,
    "approval without a reason should fail instead of becoming a rubber stamp",
  );
  assert(
    lazyApproval.stderr.includes("Approval requires --reason"),
    "approval failure should tell the human to provide a reason",
  );

  const approval = runCliJson([
    "approve",
    "--intent",
    "latest",
    "--gate",
    "before-risky-edit",
    "--approved-by",
    "Ripple Tester",
    "--reason",
    "reviewed payment fee plan",
  ]);
  assert.strictEqual(approval.protocol, "ripple-approval");
  assert.strictEqual(approval.gate, "before-risky-edit");
  assert.strictEqual(approval.targetFile, "src/payments.ts");
  assert.strictEqual(approval.approvedBy, "Ripple Tester");

  const auditAfterApproval = runCliJson(["audit", "--intent", "latest"]);
  assert.strictEqual(auditAfterApproval.status, "pass");
  assert.strictEqual(auditAfterApproval.canProceed, true);
  assert.strictEqual(auditAfterApproval.approvalStatus.status, "approved");
  assert.strictEqual(auditAfterApproval.approvalStatus.approved, true);

  const ciAfterApproval = runCliJson([
    "ci",
    "--base",
    "HEAD",
    "--intent",
    "latest",
  ]);
  assert.strictEqual(ciAfterApproval.status, "pass");
  assert.strictEqual(ciAfterApproval.approvalStatus.status, "approved");

  tamperSavedIntentTask();
  const auditAfterIntentChange = runCliJson(["audit", "--intent", "latest"]);
  assert.strictEqual(auditAfterIntentChange.status, "human-review-required");
  assert.strictEqual(auditAfterIntentChange.approvalStatus.status, "stale");
  assert.strictEqual(auditAfterIntentChange.approvalStatus.approved, false);
  assert(
    auditAfterIntentChange.approvalStatus.why.some((reason) =>
      reason.includes("Saved intent changed"),
    ),
    "approval should become stale when the saved intent changes",
  );

  console.log("Ripple golden approval-control proof passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("Gate: before-risky-edit");
  console.log("Before approval: human-review-required / missing");
  console.log("After approval: pass / approved");
  console.log("After intent change: human-review-required / stale");
}

main();
