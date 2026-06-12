const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createRippleMcpToolHost } = require("../dist");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const proofRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-mcp-gate-proof-${Date.now()}`,
);

function workspacePath(name) {
  return path.join(proofRoot, name);
}

function writeFile(workspaceRoot, relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function removeFile(workspaceRoot, relativePath) {
  fs.unlinkSync(path.join(workspaceRoot, relativePath));
}

function runGit(workspaceRoot, args) {
  execFileSync("git", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function commitBaseline(workspaceRoot, message = "baseline") {
  runGit(workspaceRoot, ["init"]);
  runGit(workspaceRoot, ["add", "."]);
  runGit(workspaceRoot, [
    "-c",
    "user.email=ripple@test.local",
    "-c",
    "user.name=Ripple Test",
    "commit",
    "-m",
    message,
  ]);
}

async function callMcpTool(workspaceRoot, tool, args = {}) {
  const host = createRippleMcpToolHost({ workspaceRoot });
  try {
    const result = await host.callTool(tool, args);
    assert.strictEqual(result.tool, tool);
    return result.data;
  } finally {
    host.dispose();
  }
}

function setupUtilityFixture(name, options = {}) {
  const workspaceRoot = workspacePath(name);
  writeFile(
    workspaceRoot,
    "package.json",
    JSON.stringify({ name: `ripple-mcp-${name}` }, null, 2),
  );
  writeFile(
    workspaceRoot,
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
  if (options.withCiWorkflow) {
    writeFile(
      workspaceRoot,
      ".github/workflows/ripple.yml",
      [
        "name: Ripple architecture gate",
        "on: [pull_request]",
        "jobs:",
        "  ripple:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: ripple ci --base origin/main --intent latest --github-annotations",
        "",
      ].join("\n"),
    );
    writeFile(workspaceRoot, ".gitignore", [".ripple/.cache/", ""].join("\n"));
  }
  commitBaseline(workspaceRoot);
  return workspaceRoot;
}

function setupHumanGateFixture() {
  const workspaceRoot = workspacePath("human-review");
  writeFile(
    workspaceRoot,
    "package.json",
    JSON.stringify({ name: "ripple-mcp-human-review" }, null, 2),
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

async function saveUtilityIntent(workspaceRoot) {
  const plan = await callMcpTool(workspaceRoot, "ripple_plan_context", {
    task: "normalize display name whitespace",
    filePath: "src/util.ts",
    tokenBudget: 2600,
    mode: "file",
    saveIntent: true,
  });
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.targetFile, "src/util.ts");
  assert.strictEqual(plan.changeIntent.controlMode, "file");
  assert.strictEqual(plan.changeIntentPath, ".ripple/intents/latest.json");
  return plan;
}

async function saveHumanGateIntent(workspaceRoot) {
  const plan = await callMcpTool(workspaceRoot, "ripple_plan_context", {
    task: "adjust payment fee rounding",
    filePath: "src/payments.ts",
    tokenBudget: 2600,
    mode: "file",
    saveIntent: true,
  });
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.targetFile, "src/payments.ts");
  assert.strictEqual(plan.changeIntent.humanGate, "required-before-edit");
  assert.strictEqual(plan.changeIntent.boundaryRisk, "critical");
  return plan;
}

function changeUtilityInsidePlan(workspaceRoot) {
  writeFile(
    workspaceRoot,
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  return value.trim().replace(/\\s+/g, ' ');",
      "}",
      "",
      "export function shout(value: string): string {",
      "  return value.toUpperCase();",
      "}",
      "",
    ].join("\n"),
  );
  runGit(workspaceRoot, ["add", "src/util.ts"]);
}

function addUnplannedFile(workspaceRoot) {
  writeFile(
    workspaceRoot,
    "src/other.ts",
    [
      "export function other(): string {",
      "  return 'outside plan';",
      "}",
      "",
    ].join("\n"),
  );
  runGit(workspaceRoot, ["add", "src/other.ts"]);
}

function changeHumanGatedFile(workspaceRoot) {
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

function assertGate(gate, expected, label) {
  assert.strictEqual(gate.protocol, "ripple-gate", `${label} protocol`);
  assert.strictEqual(gate.status, expected.status, `${label} status`);
  assert.strictEqual(gate.decision, expected.decision, `${label} decision`);
  assert.strictEqual(gate.canContinue, expected.canContinue, `${label} canContinue`);
  assert.strictEqual(gate.mustStop, expected.mustStop, `${label} mustStop`);
  assert.strictEqual(gate.needsHuman, expected.needsHuman, `${label} needsHuman`);
  assert.strictEqual(
    gate.nextRequiredPhase,
    expected.nextRequiredPhase,
    `${label} nextRequiredPhase`,
  );
  assert.strictEqual(gate.auditStatus, expected.auditStatus, `${label} auditStatus`);
  assert.strictEqual(
    gate.approvalStatus,
    expected.approvalStatus,
    `${label} approvalStatus`,
  );
  assert.strictEqual(gate.audit, undefined, `${label} gate should stay compact`);
  assert(Array.isArray(gate.why), `${label} why should be an array`);
  assert(Array.isArray(gate.fixNow), `${label} fixNow should be an array`);
  assert(Array.isArray(gate.askHuman), `${label} askHuman should be an array`);
}


function assertRiskContract(gate, label) {
  assert(gate.risk, `${label} should include risk summary`);
  assert.strictEqual(typeof gate.risk.level, "string", `${label} risk level`);
  assert.strictEqual(typeof gate.risk.score, "number", `${label} risk score`);
  assert(gate.risk.score >= 0 && gate.risk.score <= 100, `${label} risk score range`);
  assert.strictEqual(typeof gate.risk.summary, "string", `${label} risk summary`);
  assert(Array.isArray(gate.risk.reasons), `${label} risk reasons should be an array`);
  assert(Array.isArray(gate.risk.affectedFiles), `${label} affectedFiles should be an array`);
  assert(Array.isArray(gate.risk.affectedSymbols), `${label} affectedSymbols should be an array`);
  assert(Array.isArray(gate.risk.requiredActions), `${label} requiredActions should be an array`);
}

function assertAuditHandoffMatchesGate(audit, gate, label) {
  assert.strictEqual(audit.protocol, "ripple-audit", `${label} audit protocol`);
  assert.strictEqual(audit.handoff.protocol, "ripple-agent-handoff", `${label} handoff`);
  assert.strictEqual(audit.handoff.decision, gate.decision, `${label} handoff decision`);
  assert.strictEqual(
    audit.handoff.canContinue,
    gate.canContinue,
    `${label} handoff canContinue`,
  );
  assert.strictEqual(audit.handoff.mustStop, gate.mustStop, `${label} handoff mustStop`);
  assert.strictEqual(
    audit.handoff.needsHuman,
    gate.needsHuman,
    `${label} handoff needsHuman`,
  );
  assert.strictEqual(
    audit.handoff.nextRequiredPhase,
    gate.nextRequiredPhase,
    `${label} handoff nextRequiredPhase`,
  );
}

async function proveMcpGateContinues() {
  const workspaceRoot = setupUtilityFixture("continue");
  await saveUtilityIntent(workspaceRoot);
  changeUtilityInsidePlan(workspaceRoot);

  const audit = await callMcpTool(workspaceRoot, "ripple_audit_change", {
    tokenBudget: 2600,
    intentPath: "latest",
  });
  const gate = await callMcpTool(workspaceRoot, "ripple_gate", {
    tokenBudget: 2600,
    intentPath: "latest",
  });

  assertGate(
    gate,
    {
      status: "open",
      decision: "continue",
      canContinue: true,
      mustStop: false,
      needsHuman: false,
      nextRequiredPhase: "done",
      auditStatus: "pass",
      approvalStatus: "not-required",
    },
    "continue MCP gate",
  );
  assertRiskContract(gate, "continue MCP gate");
  assertAuditHandoffMatchesGate(audit, gate, "continue MCP gate");
  assert(
    gate.commands.verify.includes("tests/util.test.ts"),
    "continue gate should preserve verification commands",
  );
}

async function proveMcpGateRepairs() {
  const workspaceRoot = setupUtilityFixture("repair");
  await saveUtilityIntent(workspaceRoot);
  changeUtilityInsidePlan(workspaceRoot);
  addUnplannedFile(workspaceRoot);

  const audit = await callMcpTool(workspaceRoot, "ripple_audit_change", {
    tokenBudget: 2600,
    intentPath: "latest",
  });
  const gate = await callMcpTool(workspaceRoot, "ripple_gate", {
    tokenBudget: 2600,
    intentPath: "latest",
  });

  assertGate(
    gate,
    {
      status: "closed",
      decision: "repair",
      canContinue: false,
      mustStop: true,
      needsHuman: false,
      nextRequiredPhase: "repair_or_handoff",
      auditStatus: "repair-required",
      approvalStatus: "not-required",
    },
    "repair MCP gate",
  );
  assertRiskContract(gate, "repair MCP gate");
  assert(
    gate.risk.reasons.some((reason) => reason.kind === "intent-drift"),
    "repair MCP gate should include intent-drift risk reason",
  );
  assert(
    gate.risk.reasons.some((reason) =>
      reason.evidence.some((item) => item.includes("unplanned file: src/other.ts")),
    ),
    "repair MCP gate should include unplanned file risk evidence",
  );
  assert(
    gate.risk.requiredActions.length > 0,
    "repair MCP gate should include risk required actions",
  );
  assertAuditHandoffMatchesGate(audit, gate, "repair MCP gate");
  assert(
    gate.why.some((item) => item.includes("Unplanned file changed: src/other.ts")),
    "repair gate should explain the unplanned file",
  );
  assert(
    gate.commands.repair.includes("ripple repair --agent --intent latest"),
    "repair gate should tell the agent to run repair",
  );
}

async function proveMcpGateRequiresHuman() {
  const workspaceRoot = setupHumanGateFixture();
  await saveHumanGateIntent(workspaceRoot);
  changeHumanGatedFile(workspaceRoot);

  const audit = await callMcpTool(workspaceRoot, "ripple_audit_change", {
    tokenBudget: 2600,
    intentPath: "latest",
  });
  const gate = await callMcpTool(workspaceRoot, "ripple_gate", {
    tokenBudget: 2600,
    intentPath: "latest",
  });
  const approval = await callMcpTool(workspaceRoot, "ripple_get_approval_status", {
    intentPath: "latest",
  });

  assertGate(
    gate,
    {
      status: "closed",
      decision: "human-review",
      canContinue: false,
      mustStop: true,
      needsHuman: true,
      nextRequiredPhase: "approval_gate",
      auditStatus: "human-review-required",
      approvalStatus: "missing",
    },
    "human-review MCP gate",
  );
  assertRiskContract(gate, "human-review MCP gate");
  assert(
    ["high", "critical"].includes(gate.risk.level),
    "human-review MCP gate should surface high/critical risk",
  );
  assertAuditHandoffMatchesGate(audit, gate, "human-review MCP gate");
  assert.strictEqual(approval.status, "missing");
  assert.strictEqual(approval.required, true);
  assert(
    gate.commands.approve.some((command) =>
      command.includes("ripple approve --intent latest --gate before-risky-edit --reason"),
    ),
    "human-review gate should include the approval command",
  );
}

async function proveMcpGateRestoresReadiness() {
  const workspaceRoot = setupUtilityFixture("restore-readiness", {
    withCiWorkflow: true,
  });
  const plan = await saveUtilityIntent(workspaceRoot);
  assert.strictEqual(
    plan.changeIntent.readinessSnapshot.canBlockInCi,
    true,
    "saved MCP plan should snapshot CI gate readiness",
  );
  changeUtilityInsidePlan(workspaceRoot);
  removeFile(workspaceRoot, ".github/workflows/ripple.yml");

  const audit = await callMcpTool(workspaceRoot, "ripple_audit_change", {
    tokenBudget: 2600,
    intentPath: "latest",
  });
  const gate = await callMcpTool(workspaceRoot, "ripple_gate", {
    tokenBudget: 2600,
    intentPath: "latest",
  });

  assertGate(
    gate,
    {
      status: "closed",
      decision: "restore-readiness",
      canContinue: false,
      mustStop: true,
      needsHuman: true,
      nextRequiredPhase: "repair_or_handoff",
      auditStatus: "human-review-required",
      approvalStatus: "not-required",
    },
    "restore-readiness MCP gate",
  );
  assertRiskContract(gate, "restore-readiness MCP gate");
  assertAuditHandoffMatchesGate(audit, gate, "restore-readiness MCP gate");
  assert(
    gate.commands.doctor.includes("ripple doctor --agent --strict"),
    "restore-readiness gate should tell the agent to run doctor",
  );
}

async function main() {
  await proveMcpGateContinues();
  await proveMcpGateRepairs();
  await proveMcpGateRequiresHuman();
  await proveMcpGateRestoresReadiness();

  console.log("Ripple golden MCP gate proof passed");
  console.log(`Workspace root: ${proofRoot}`);
  console.log("MCP gate decisions: open/continue, closed/repair, closed/human-review, closed/restore-readiness");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
