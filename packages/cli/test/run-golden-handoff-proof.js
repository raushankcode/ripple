const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const proofRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-handoff-proof-${Date.now()}`,
);

function workspacePath(name) {
  return path.join(proofRoot, name);
}

function writeFile(workspaceRoot, relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function runCli(workspaceRoot, args) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCliJson(workspaceRoot, args) {
  const output = runCli(workspaceRoot, [...args, "--json"]);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Expected JSON for ripple ${args.join(" ")}:\n${output}`);
  }
}

function runCliResult(workspaceRoot, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGit(workspaceRoot, args) {
  execFileSync("git", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function commitBaseline(workspaceRoot) {
  runGit(workspaceRoot, ["init"]);
  runGit(workspaceRoot, ["add", "."]);
  runGit(workspaceRoot, [
    "-c",
    "user.email=ripple@test.local",
    "-c",
    "user.name=Ripple Test",
    "commit",
    "-m",
    "baseline",
  ]);
}

function assertHandoff(handoff, expected, label) {
  assert(handoff, `${label} should include handoff`);
  assert.strictEqual(handoff.protocol, "ripple-agent-handoff", `${label} protocol`);
  assert.strictEqual(handoff.decision, expected.decision, `${label} decision`);
  assert.strictEqual(handoff.canContinue, expected.canContinue, `${label} canContinue`);
  assert.strictEqual(handoff.mustStop, expected.mustStop, `${label} mustStop`);
  assert.strictEqual(handoff.needsHuman, expected.needsHuman, `${label} needsHuman`);
  assert(Array.isArray(handoff.why), `${label} why should be an array`);
  assert(Array.isArray(handoff.fixNow), `${label} fixNow should be an array`);
  assert(Array.isArray(handoff.askHuman), `${label} askHuman should be an array`);
}

function setupCleanWorkflowFixture() {
  const workspaceRoot = workspacePath("clean-workflow");
  writeFile(
    workspaceRoot,
    "package.json",
    JSON.stringify({ name: "ripple-handoff-clean-proof" }, null, 2),
  );
  writeFile(
    workspaceRoot,
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  return value.trim();",
      "}",
      "",
    ].join("\n"),
  );
  writeFile(
    workspaceRoot,
    "tests/util.test.ts",
    [
      "import { trimName } from '../src/util';",
      "",
      "export function testTrimName(): string {",
      "  return trimName(' Ada ');",
      "}",
      "",
    ].join("\n"),
  );
  writeFile(workspaceRoot, ".gitignore", ".ripple/.cache/\n");
  runCli(workspaceRoot, ["init-ci"]);
  commitBaseline(workspaceRoot);
  return workspaceRoot;
}

function stageCleanPlannedEdit(workspaceRoot) {
  writeFile(
    workspaceRoot,
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  return value.trim().replace(/\\s+/g, ' ');",
      "}",
      "",
    ].join("\n"),
  );
  runGit(workspaceRoot, ["add", "src/util.ts"]);
}

function setupHumanGateFixture() {
  const workspaceRoot = workspacePath("human-gate");
  writeFile(
    workspaceRoot,
    "package.json",
    JSON.stringify({ name: "ripple-handoff-human-proof" }, null, 2),
  );
  writeFile(
    workspaceRoot,
    "src/payments.ts",
    [
      "export function calculateFee(amount: number): number {",
      "  return Math.round(amount * 0.02);",
      "}",
      "",
    ].join("\n"),
  );
  writeFile(
    workspaceRoot,
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
    workspaceRoot,
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
  commitBaseline(workspaceRoot);
  return workspaceRoot;
}

function stageHumanGatedEdit(workspaceRoot) {
  writeFile(
    workspaceRoot,
    "src/payments.ts",
    [
      "export function calculateFee(amount: number): number {",
      "  const fee = amount * 0.025;",
      "  return Math.round(fee);",
      "}",
      "",
    ].join("\n"),
  );
  runGit(workspaceRoot, ["add", "src/payments.ts"]);
}

function proveCleanAuditCanContinue() {
  const workspaceRoot = setupCleanWorkflowFixture();
  const plan = runCliJson(workspaceRoot, [
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "normalize whitespace in display names",
    "--mode",
    "file",
    "--save",
  ]);
  assert.strictEqual(
    plan.changeIntent.readinessSnapshot.canBlockInCi,
    true,
    "saved plan should snapshot CI gate readiness before edit",
  );

  stageCleanPlannedEdit(workspaceRoot);

  const audit = runCliJson(workspaceRoot, ["audit", "--intent", "latest"]);
  assert.strictEqual(audit.status, "pass");
  assert.strictEqual(audit.canProceed, true);
  assertHandoff(
    audit.handoff,
    {
      decision: "continue",
      canContinue: true,
      mustStop: false,
      needsHuman: false,
    },
    "clean audit",
  );
  assert.strictEqual(audit.handoff.nextRequiredPhase, "done");
  assert(
    audit.handoff.commands.verify.includes("tests/util.test.ts"),
    "clean audit handoff should preserve verification commands",
  );

  const gate = runCliJson(workspaceRoot, ["gate", "--intent", "latest"]);
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.status, "open");
  assert.strictEqual(gate.decision, "continue");
  assert.strictEqual(gate.canContinue, true);
  assert.strictEqual(gate.mustStop, false);
  assert.strictEqual(gate.needsHuman, false);
  assert.strictEqual(gate.nextRequiredPhase, "done");
  assert.strictEqual(gate.auditStatus, "pass");
  assert.strictEqual(gate.approvalStatus, "not-required");
  assert(
    gate.commands.verify.includes("tests/util.test.ts"),
    "clean gate should preserve verification commands",
  );
  assert.strictEqual(gate.audit, undefined, "gate JSON should stay compact");

  const agentGate = runCli(workspaceRoot, ["gate", "--agent", "--intent", "latest"]);
  assert(agentGate.startsWith("RIPPLE_GATE"));
  assert(agentGate.includes("status: open"));
  assert(agentGate.includes("decision: continue"));
  assert(agentGate.includes("can_continue: true"));

  const strictGate = runCliResult(workspaceRoot, ["gate", "--intent", "latest", "--strict"]);
  assert.strictEqual(strictGate.status, 0, "clean strict gate should pass");

  return workspaceRoot;
}

function proveReadinessRegressionStopsAgent(workspaceRoot) {
  const workflowPath = path.join(workspaceRoot, ".github", "workflows", "ripple.yml");
  assert(fs.existsSync(workflowPath), "readiness proof needs the generated CI workflow");
  fs.unlinkSync(workflowPath);

  const check = runCliJson(workspaceRoot, ["check", "--staged", "--intent", "latest"]);
  assert.strictEqual(check.intentValidation.readinessDrift.status, "weakened");
  assert(
    check.intentValidation.readinessDrift.weakenedFields.includes("canBlockInCi"),
    "readiness handoff should identify weakened CI blocking",
  );
  assertHandoff(
    check.intentValidation.handoff,
    {
      decision: "restore-readiness",
      canContinue: false,
      mustStop: true,
      needsHuman: true,
    },
    "readiness regression check",
  );
  assert(
    check.intentValidation.handoff.commands.doctor.includes("ripple doctor --agent --strict"),
    "readiness handoff should tell the agent to run doctor",
  );

  const gate = runCliJson(workspaceRoot, ["gate", "--intent", "latest"]);
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.status, "closed");
  assert.strictEqual(gate.decision, "restore-readiness");
  assert.strictEqual(gate.canContinue, false);
  assert.strictEqual(gate.mustStop, true);
  assert.strictEqual(gate.needsHuman, true);
  assert.strictEqual(gate.auditStatus, "human-review-required");
  assert(
    gate.commands.doctor.includes("ripple doctor --agent --strict"),
    "readiness gate should tell the agent to run doctor",
  );

  const strictGate = runCliResult(workspaceRoot, ["gate", "--intent", "latest", "--strict"]);
  assert.strictEqual(strictGate.status, 1, "readiness strict gate should fail");
}

function proveMissingHumanGateStopsAgent() {
  const workspaceRoot = setupHumanGateFixture();
  const plan = runCliJson(workspaceRoot, [
    "plan",
    "--file",
    "src/payments.ts",
    "--task",
    "adjust payment fee rounding",
    "--mode",
    "file",
    "--save",
  ]);
  assert.strictEqual(plan.changeIntent.humanGate, "required-before-edit");
  assert.strictEqual(plan.changeIntent.boundaryRisk, "critical");

  stageHumanGatedEdit(workspaceRoot);

  const audit = runCliJson(workspaceRoot, ["audit", "--intent", "latest"]);
  assert.strictEqual(audit.status, "human-review-required");
  assert.strictEqual(audit.canProceed, false);
  assert.strictEqual(audit.approvalStatus.status, "missing");
  assertHandoff(
    audit.handoff,
    {
      decision: "human-review",
      canContinue: false,
      mustStop: true,
      needsHuman: true,
    },
    "missing human gate audit",
  );
  assert(
    audit.handoff.commands.approve.some((command) =>
      command.includes("ripple approve --intent latest"),
    ),
    "human-review handoff should include the approval command",
  );

  const gate = runCliJson(workspaceRoot, ["gate", "--intent", "latest"]);
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.status, "closed");
  assert.strictEqual(gate.decision, "human-review");
  assert.strictEqual(gate.canContinue, false);
  assert.strictEqual(gate.mustStop, true);
  assert.strictEqual(gate.needsHuman, true);
  assert.strictEqual(gate.auditStatus, "human-review-required");
  assert.strictEqual(gate.approvalStatus, "missing");
  assert(
    gate.commands.approve.some((command) =>
      command.includes("ripple approve --intent latest"),
    ),
    "human-review gate should include the approval command",
  );

  const agentGate = runCli(workspaceRoot, ["gate", "--agent", "--intent", "latest"]);
  assert(agentGate.startsWith("RIPPLE_GATE"));
  assert(agentGate.includes("status: closed"));
  assert(agentGate.includes("decision: human-review"));
  assert(agentGate.includes("needs_human: true"));

  const strictGate = runCliResult(workspaceRoot, ["gate", "--intent", "latest", "--strict"]);
  assert.strictEqual(strictGate.status, 1, "human-review strict gate should fail");
}

function main() {
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  const cleanWorkspace = proveCleanAuditCanContinue();
  proveReadinessRegressionStopsAgent(cleanWorkspace);
  proveMissingHumanGateStopsAgent();

  console.log("Ripple golden agent-handoff proof passed");
  console.log(`Workspace root: ${proofRoot}`);
  console.log("Clean audit handoff: continue");
  console.log("Missing human gate handoff: human-review");
  console.log("Readiness regression handoff: restore-readiness");
  console.log("Ripple gate decisions: open / human-review / restore-readiness");
}

main();

