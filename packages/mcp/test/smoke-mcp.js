const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `mcp-smoke-${Date.now()}`
);
const serverPath = path.join(repoRoot, "packages", "mcp", "dist", "server.js");

function writeFile(relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function setupFixture() {
  writeFile("package.json", JSON.stringify({ name: "mcp-smoke-fixture" }, null, 2));
  writeFile("README.md", "# MCP smoke fixture\n");
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
    "src/index.ts",
    [
      "import { shout, trimName } from './util';",
      "",
      "export function label(value: string): string {",
      "  return shout(trimName(value));",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "tests/util.test.ts",
    [
      "import { trimName } from '../src/util';",
      "",
      "export function testTrimName(): void {",
      "  if (trimName(' ripple ') !== 'ripple') {",
      "    throw new Error('bad trim');",
      "  }",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "tests/index.spec.ts",
    [
      "import { label } from '../src/index';",
      "",
      "export function testLabel(): void {",
      "  if (label(' ripple ') !== 'RIPPLE') {",
      "    throw new Error('bad label');",
      "  }",
      "}",
      "",
    ].join("\n")
  );
}

function stageFixtureFiles() {
  execFileSync("git", ["init"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSync("git", ["add", "src/util.ts", "README.md"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function parseJsonLines(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function main() {
  setupFixture();
  stageFixtureFiles();

  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "ripple-smoke-agent",
          version: "1.0.0",
        },
      },
    },
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "ripple_get_agent_workflow",
        arguments: {},
      },
    },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "ripple_plan_context",
        arguments: {
          task: "change trim behavior",
          filePath: "src/util.ts",
          tokenBudget: 1200,
          saveIntent: true,
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "ripple_check_staged",
        arguments: {
          tokenBudget: 1200,
          intentPath: "latest",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "ripple_repair_intent_drift",
        arguments: {
          tokenBudget: 1200,
          intentPath: "latest",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "ripple_audit_change",
        arguments: {
          tokenBudget: 1200,
          intentPath: "latest",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "ripple_gate",
        arguments: {
          tokenBudget: 1200,
          intentPath: "latest",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "ripple_get_approval_status",
        arguments: {
          intentPath: "latest",
        },
      },
    },
  ];

  const result = spawnSync(
    process.execPath,
    [serverPath, "--workspace", workspaceRoot],
    {
      input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  if (result.error) {
    throw result.error;
  }
  assert.strictEqual(result.status, 0, result.stderr);

  const responses = parseJsonLines(result.stdout);
  assert.strictEqual(responses.length, 9);

  const initialize = responses[0].result;
  const tools = responses[1].result.tools;
  const workflowResult = responses[2].result;
  const planResult = responses[3].result;
  const stagedResult = responses[4].result;
  const repairResult = responses[5].result;
  const auditResult = responses[6].result;
  const gateResult = responses[7].result;
  const approvalStatusResult = responses[8].result;
  const workflow = workflowResult.structuredContent;
  const staged = stagedResult.structuredContent;
  const plan = planResult.structuredContent;
  const repair = repairResult.structuredContent;
  const audit = auditResult.structuredContent;
  const gate = gateResult.structuredContent;
  const approvalStatus = approvalStatusResult.structuredContent;

  // Smoke test keeps the end-to-end agent boundary contract visible.
  assert.strictEqual(initialize.protocolVersion, "2025-06-18");
  assert(tools.some((tool) => tool.name === "ripple_check_changed"));
  assert(tools.some((tool) => tool.name === "ripple_check_staged"));
  assert(tools.some((tool) => tool.name === "ripple_audit_change"));
  assert(tools.some((tool) => tool.name === "ripple_gate"));
  assert(tools.some((tool) => tool.name === "ripple_get_approval_status"));
  assert(tools.some((tool) => tool.name === "ripple_explain_policy"));
  assert(tools.some((tool) => tool.name === "ripple_get_agent_workflow"));
  assert(tools.some((tool) => tool.name === "ripple_plan_context"));
  assert(tools.some((tool) => tool.name === "ripple_record_verification"));
  assert(tools.some((tool) => tool.name === "ripple_repair_intent_drift"));
  assert.strictEqual(workflowResult.isError, false);
  assert.strictEqual(workflow.protocol, "ripple-agent-workflow");
  assert.deepStrictEqual(workflow.loop, [
    "choose_boundary",
    "plan",
    "approve_if_required",
    "edit",
    "stage",
    "check",
    "record_verification",
    "repair_if_needed",
  ]);
  assert.strictEqual(workflow.mcpTools.checkAfterStaging, "ripple_check_staged");
  assert.strictEqual(workflow.commands.auditCurrentChange, "ripple audit --agent --intent latest");
  assert.strictEqual(workflow.commands.gateCurrentChange, "ripple gate --agent --intent latest");
  assert.strictEqual(
    workflow.commands.recordVerification,
    "ripple verify --run \"<command>\" --intent latest"
  );
  assert.strictEqual(workflow.commands.checkApproval, "ripple approval --intent latest --agent");
  assert.strictEqual(workflow.mcpTools.checkApproval, "ripple_get_approval_status");
  assert.strictEqual(workflow.commands.approveHumanGate, "ripple approve --intent latest --gate before-risky-edit");
  assert.strictEqual(workflow.mcpTools.auditCurrentChange, "ripple_audit_change");
  assert.strictEqual(workflow.mcpTools.gateCurrentChange, "ripple_gate");
  assert.strictEqual(workflow.mcpTools.recordVerification, "ripple_record_verification");
  assert.strictEqual(workflow.mcpTools.explainPolicy, "ripple_explain_policy");
  assert.strictEqual(workflow.mcpTools.repairIntentDrift, "ripple_repair_intent_drift");
  assert(workflow.policyWorkflow.defaultAgentPath.includes("policyExplanation"));
  assert(workflow.policyWorkflow.policyOnlyPath.includes("without a plan"));
  assert(workflow.policyWorkflow.policyDriftPath.includes("policyDrift.status=changed"));
  assert.strictEqual(workflow.outputContracts.doctorHeader, "RIPPLE_DOCTOR");
  assert(workflow.outputContracts.doctorSections.includes("enforcement_level"));
  assert.strictEqual(workflow.outputContracts.planHeader, "RIPPLE_AGENT_CONTEXT");
  assert(workflow.outputContracts.planSections.includes("enforcement_level"));
  assert(workflow.outputContracts.planSections.includes("readiness_gaps"));
  assert.strictEqual(workflow.outputContracts.auditHeader, "RIPPLE_AUDIT");
  assert.strictEqual(workflow.outputContracts.gateHeader, "RIPPLE_GATE");
  assert.strictEqual(workflow.outputContracts.approvalHeader, "RIPPLE_APPROVAL");
  assert.strictEqual(workflow.outputContracts.approvalStatusHeader, "RIPPLE_APPROVAL_STATUS");
  assert(workflow.outputContracts.auditSections.includes("can_proceed"));
  assert(workflow.outputContracts.auditSections.includes("next_required_phase"));
  assert(workflow.outputContracts.auditSections.includes("approval_status"));
  assert(workflow.outputContracts.gateSections.includes("can_continue"));
  assert(workflow.outputContracts.gateSections.includes("commands_approve"));
  assert(workflow.outputContracts.stagedCheckSections.includes("policy_drift"));
  assert(workflow.outputContracts.stagedCheckSections.includes("readiness_drift"));
  assert(workflow.outputContracts.stagedCheckSections.includes("handoff"));
  assert(workflow.outputContracts.stagedCheckSections.includes("next_required_phase"));
  assert(workflow.outputContracts.repairSections.includes("policy_drift"));
  assert(workflow.outputContracts.repairSections.includes("readiness_drift"));
  assert(workflow.outputContracts.repairSections.includes("handoff"));
  assert(workflow.outputContracts.auditSections.includes("readiness_drift"));
  assert(workflow.outputContracts.auditSections.includes("handoff"));
  assert.strictEqual(workflow.runtimeContract.protocol, "ripple-agent-runtime-contract");
  assert(workflow.runtimeContract.compatibleRuntimes.includes("MCP coding agents"));
  assert.strictEqual(
    workflow.runtimeContract.phases.find((phase) => phase.id === "plan_before_edit").mcpTool,
    "ripple_plan_context"
  );
  assert.strictEqual(
    workflow.runtimeContract.phases.find((phase) => phase.id === "audit_after_change").mcpTool,
    "ripple_gate"
  );
  assert.strictEqual(
    workflow.runtimeContract.phases.find((phase) => phase.id === "record_verification").mcpTool,
    "ripple_record_verification"
  );
  assert(
    workflow.runtimeContract.stopConditions.some((condition) =>
      condition.includes("audit.canProceed is false")
    )
  );
  assert.strictEqual(stagedResult.isError, false);
  assert.strictEqual(staged.mode, "staged");
  assert.strictEqual(staged.stagedFiles, 1);
  assert.strictEqual(staged.intentValidation.verdict, "matched");
  assert.strictEqual(staged.intentValidation.nextRequiredPhase, "audit_after_change");
  assert.strictEqual(staged.nextRequiredPhase, "audit_after_change");
  assert.strictEqual(staged.intentValidation.boundaryVerdict.status, "pass");
  assert.strictEqual(staged.intentValidation.boundaryVerdict.controlMode, "file");
  assert.strictEqual(staged.intentValidation.readinessDrift.status, "unchanged");
  assert.strictEqual(staged.intentValidation.handoff.decision, "audit");
  assert.strictEqual(staged.intentValidation.plannedScope, "matched");
  assert(staged.intentValidation.recommendedAction.includes("Proceed"));
  assert(Array.isArray(staged.intentValidation.nextSteps));
  assert.strictEqual(repairResult.isError, false);
  assert.strictEqual(repair.protocol, "ripple-intent-drift-repair");
  assert.strictEqual(repair.verdict, "matched");
  assert.strictEqual(repair.status, "no-repair-needed");
  assert.strictEqual(repair.readinessDrift.status, "unchanged");
  assert.strictEqual(repair.handoff.decision, "audit");
  assert.strictEqual(repair.unstageFiles.length, 0);
  assert(repair.verificationTargets.includes("tests/util.test.ts"));
  assert(repairResult.content[0].text.includes("verificationTargets"));
  assert.strictEqual(auditResult.isError, false);
  assert.strictEqual(audit.protocol, "ripple-audit");
  assert.strictEqual(audit.mode, "staged");
  assert.strictEqual(audit.intent.targetFile, "src/util.ts");
  assert.strictEqual(audit.nextRequiredPhase, "done");
  assert.strictEqual(audit.approvalStatus.status, "not-required");
  assert.strictEqual(audit.stagedCheck.intentValidation.verdict, "matched");
  assert.strictEqual(audit.stagedCheck.intentValidation.readinessDrift.status, "unchanged");
  assert.strictEqual(audit.handoff.decision, "continue");
  assert.strictEqual(audit.handoff.canContinue, true);
  assert.strictEqual(audit.repairPlan.status, "no-repair-needed");
  assert(audit.verificationTargets.includes("tests/util.test.ts"));
  assert(auditResult.content[0].text.includes("recommendedAction"));
  assert.strictEqual(gateResult.isError, false);
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.status, "open");
  assert.strictEqual(gate.decision, "continue");
  assert.strictEqual(gate.canContinue, true);
  assert.strictEqual(gate.mustStop, false);
  assert.strictEqual(gate.needsHuman, false);
  assert.strictEqual(gate.auditStatus, "pass");
  assert.strictEqual(gate.approvalStatus, "not-required");
  assert.strictEqual(gate.audit, undefined);
  assert(gate.verificationTargets.includes("tests/util.test.ts"));
  assert(gateResult.content[0].text.includes("ripple-gate"));
  assert.strictEqual(approvalStatusResult.isError, false);
  assert.strictEqual(approvalStatus.protocol, "ripple-approval-status");
  assert.strictEqual(approvalStatus.status, "not-required");
  assert.strictEqual(approvalStatus.intent.targetFile, "src/util.ts");
  assert(approvalStatusResult.content[0].text.includes("ripple-approval-status"));
  assert.strictEqual(staged.skippedFiles.length, 1);
  assert(
    staged.files.some((file) => file.file === "src/util.ts"),
    "staged check should include staged util file"
  );
  assert(
    staged.files[0].symbolFocus.includes("src/util.ts::trimName"),
    "staged check should include trimName symbol focus"
  );
  assert(
    staged.changedSymbols.some((symbol) => symbol.symbol === "src/util.ts::trimName"),
    "staged check should include changed trimName symbol"
  );
  assert(
    staged.contractRisks.some((risk) => risk.symbol === "src/util.ts::trimName"),
    "staged check should include trimName contract risk"
  );
  assert.strictEqual(planResult.isError, false);
  assert.strictEqual(plan.targetFile, "src/util.ts");
  assert.strictEqual(plan.policyExplanation.protocol, "ripple-policy-explanation");
  assert.strictEqual(plan.policyExplanation.policySource, "built-in default");
  assert.strictEqual(plan.policyExplanation.effectiveMode, "file");
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.controlMode, "file");
  assert(plan.changeIntent.readinessSnapshot, "saved MCP intent should include readiness snapshot");
  assert.strictEqual(
    typeof plan.changeIntent.readinessSnapshot.canDetectDrift,
    "boolean",
    "saved MCP intent should expose drift readiness"
  );
  assert.strictEqual(plan.changeIntentPath, ".ripple/intents/latest.json");
  const targetFile = plan.readFirst.find((item) => item.file === "src/util.ts");
  assert(targetFile, "readFirst should include target file");
  assert.strictEqual(targetFile.role, "target");
  assert.strictEqual(typeof targetFile.score, "number");
  assert(targetFile.signals.includes("target"));

  const directTest = plan.readFirst.find((item) => item.file === "tests/util.test.ts");
  assert(directTest, "readFirst should include direct test file");
  assert.strictEqual(directTest.role, "test");
  assert(directTest.signals.includes("direct-test"));

  assert(Array.isArray(plan.symbolFocus), "plan should include symbolFocus");
  const trimNameSymbol = plan.symbolFocus.find(
    (symbol) => symbol.symbol === "src/util.ts::trimName"
  );
  assert(trimNameSymbol, "symbolFocus should include trimName");
  assert(trimNameSymbol.signals.includes("target-file"));
  assert(trimNameSymbol.signals.includes("task-match"));
  assert.strictEqual(typeof trimNameSymbol.score, "number");

  assert(
    plan.planningSignals.some((signal) => signal.includes("symbol focus")),
    "planningSignals should include symbol focus count"
  );
  assert(
    plan.planningSignals.some((signal) => signal.includes("task-matched")),
    "planningSignals should include task-matched file count"
  );
  assert(
    plan.doNotReadFirst.some((item) => item.includes("Unrelated tests")),
    "plan should include do-not-read-first guidance"
  );
  assert(planResult.content[0].text.includes("symbolFocus"));
  assert(planResult.content[0].text.includes("policyExplanation"));
  assert(planResult.content[0].text.includes("changeIntent"));
  assert(planResult.content[0].text.includes("src/util.ts::trimName"));

  assert(plan.verificationTargets.includes("tests/util.test.ts"));
  assert(plan.verificationTargets.includes("tests/index.spec.ts"));
  assert(plan.verificationTargets.includes("src/index.ts"));

  console.log("Ripple MCP smoke passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Tools exposed: ${tools.length}`);
  console.log(`Plan target: ${plan.targetFile}`);
  console.log(`Risk: ${plan.risk}`);
  console.log(`Target signals: ${targetFile.signals.join(", ")}`);
  console.log(`Read first: ${plan.readFirst.map((item) => item.file).join(", ")}`);
  console.log(`Symbol focus: ${plan.symbolFocus.map((symbol) => symbol.symbol).join(", ")}`);
  console.log(`Planning signals: ${plan.planningSignals.join(" | ")}`);
  console.log(`Verify: ${plan.verificationTargets.join(", ")}`);
}

main();
