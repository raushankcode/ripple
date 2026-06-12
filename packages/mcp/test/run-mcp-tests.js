const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const {
  MCP_PROTOCOL_VERSION,
  RIPPLE_MCP_TOOLS,
  RippleMcpJsonRpcServer,
  createRippleMcpToolHost,
} = require("../dist");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `mcp-regression-${Date.now()}`
);
const serverPath = path.join(repoRoot, "packages", "mcp", "dist", "server.js");
const localDevConfigPath = path.join(
  repoRoot,
  "packages",
  "mcp",
  "examples",
  "local-dev.config.json"
);

function writeFile(relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writeFileIn(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function setupFixture() {
  writeFile("package.json", JSON.stringify({ name: "mcp-regression-fixture" }, null, 2));
  writeFile(
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  return value.trim();",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "src/index.ts",
    [
      "import { trimName } from './util';",
      "",
      "export function label(value: string): string {",
      "  return trimName(value);",
      "}",
      "",
    ].join("\n")
  );
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
}

function stageFixtureFiles() {
  execFileSync("git", ["init"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSync("git", ["add", "src/auth.ts", "package.json"], {
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

function allPlanFiles(plan) {
  return [...plan.readFirst, ...plan.readIfNeeded];
}

function findPlanFile(plan, file) {
  return allPlanFiles(plan).find((item) => item.file === file);
}

function assertIntelligentPlanContract(plan) {
  assert.strictEqual(plan.targetFile, "src/auth.ts");
  assert(Array.isArray(plan.readFirst), "plan should include readFirst");
  assert(Array.isArray(plan.readIfNeeded), "plan should include readIfNeeded");
  assert(Array.isArray(plan.symbolFocus), "plan should include symbolFocus");
  assert(Array.isArray(plan.planningSignals), "plan should include planningSignals");
  assert(Array.isArray(plan.doNotReadFirst), "plan should include doNotReadFirst");
  assert.strictEqual(plan.adapterSupport.primaryAdapter.id, "builtin-js-ts");
  assert.strictEqual(plan.adapterSupport.supportLevel, "deep");
  assert(
    plan.adapterSupport.primaryAdapter.agentPolicy.canTrust.some((item) =>
      item.includes("static imports")
    ),
    "plan should expose adapter trust guidance over MCP"
  );
  assert(
    plan.adapterSupport.primaryAdapter.capabilityProfile.some(
      (capability) =>
        capability.capability === "call-edges" &&
        capability.status === "partial" &&
        capability.agentUse === "verify"
    ),
    "plan should expose partial adapter capabilities over MCP"
  );
  assert(
    plan.planningSignals.some((signal) => signal.includes("Adapter ranking")),
    "plan should explain adapter-weighted ranking over MCP"
  );

  const targetFile = plan.readFirst.find((item) => item.file === "src/auth.ts");
  assert(targetFile, "plan should put target file in readFirst");
  assert.strictEqual(targetFile.role, "target");
  assert.strictEqual(typeof targetFile.score, "number");
  assert(targetFile.signals.includes("target"), "target file should include target signal");
  assert(
    targetFile.adapterSignals.some(
      (signal) => signal.capability === "files" && signal.agentUse === "trust"
    ),
    "target file should include trusted adapter signal"
  );

  const tokenStore = findPlanFile(plan, "src/tokenStore.ts");
  const sessionPolicy = findPlanFile(plan, "src/sessionPolicy.ts");
  assert(tokenStore, "plan should include task-relevant tokenStore dependency");
  assert(sessionPolicy, "plan should include structurally similar sessionPolicy dependency");
  assert.strictEqual(tokenStore.role, "dependency");
  assert.strictEqual(typeof tokenStore.score, "number");
  assert(tokenStore.signals.includes("direct-dependency"));
  assert(tokenStore.signals.includes("task-match"));
  assert(tokenStore.reason.includes("Matches task terms"));
  assert(
    tokenStore.score > sessionPolicy.score,
    "task-matched dependency should outrank structurally similar dependency"
  );

  const authTest = findPlanFile(plan, "tests/auth.test.ts");
  assert(authTest, "plan should include direct auth test");
  assert.strictEqual(authTest.role, "test");
  assert(authTest.signals.includes("direct-test"));
  assert(
    authTest.adapterSignals.some(
      (signal) => signal.capability === "tests" && signal.agentUse === "verify"
    ),
    "direct test should include verify-only adapter signal"
  );

  const authenticateSymbol = plan.symbolFocus.find(
    (symbol) => symbol.symbol === "src/auth.ts::authenticate"
  );
  assert(authenticateSymbol, "symbolFocus should include target authenticate symbol");
  assert(authenticateSymbol.signals.includes("target-file"));
  assert(authenticateSymbol.signals.includes("calls-task-matched-file"));

  const refreshTokenSymbol = plan.symbolFocus.find(
    (symbol) => symbol.symbol === "src/tokenStore.ts::refreshToken"
  );
  assert(refreshTokenSymbol, "symbolFocus should include task-matched refreshToken symbol");
  assert(refreshTokenSymbol.signals.includes("task-match"));
  assert.strictEqual(typeof refreshTokenSymbol.score, "number");

  assert(
    plan.planningSignals.some((signal) => signal.includes("task-matched")),
    "planningSignals should report task-matched files"
  );
  assert(
    plan.planningSignals.some((signal) => signal.includes("symbol focus")),
    "planningSignals should report symbol focus"
  );
  assert(
    plan.doNotReadFirst.some((item) => item.includes("Unrelated tests")),
    "plan should tell agents what not to read first"
  );
  assert(plan.verificationTargets.includes("tests/auth.test.ts"));
}

async function proveMcpVerificationEvidenceGate() {
  const root = path.join(repoRoot, "test", ".tmp", `mcp-verification-${Date.now()}`);
  writeFileIn(
    root,
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  return value.trim();",
      "}",
      "",
    ].join("\n")
  );
  writeFileIn(
    root,
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

  execFileSync("git", ["init"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSync("git", ["add", "src/util.ts"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
  });

  const host = createRippleMcpToolHost({ workspaceRoot: root });
  try {
    const plan = await host.callTool("ripple_plan_context", {
      task: "tighten trim behavior",
      filePath: "src/util.ts",
      mode: "file",
      saveIntent: true,
    });
    assert.strictEqual(plan.tool, "ripple_plan_context");
    assert.strictEqual(plan.data.changeIntent.controlMode, "file");

    const evidence = await host.callTool("ripple_record_verification", {
      intentPath: "latest",
      command: "npm test -- tests/util.test.ts",
      status: "failed",
      note: "regression proof",
    });
    assert.strictEqual(evidence.tool, "ripple_record_verification");
    assert.strictEqual(evidence.data.protocol, "ripple-verification-evidence");
    assert.strictEqual(evidence.data.evidence.status, "failed");
    assert.strictEqual(evidence.data.evidence.command, "npm test -- tests/util.test.ts");
    assert.strictEqual(evidence.data.totalEvidence, 1);

    const gate = await host.callTool("ripple_gate", {
      intentPath: "latest",
    });
    assert.strictEqual(gate.tool, "ripple_gate");
    assert.strictEqual(gate.data.status, "closed");
    assert.strictEqual(gate.data.decision, "repair");
    assert.strictEqual(gate.data.canContinue, false);
    assert.strictEqual(gate.data.mustStop, true);
    assert.strictEqual(gate.data.auditStatus, "repair-required");
    assert.strictEqual(gate.data.reviewPacket.verification.status, "failed");
    assert.strictEqual(gate.data.reviewPacket.verification.decision, "repair");
    assert(
      gate.data.fixNow.some((fix) =>
        fix.includes("Fix the failing verification") &&
        fix.includes("npm test -- tests/util.test.ts")
      ),
      "MCP gate should tell the agent how to repair failed verification evidence"
    );
  } finally {
    host.dispose();
  }
}

function assertStdioServerProtocol() {
  const messages = [
    {
      jsonrpc: "2.0",
      id: 10,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "stdio-test-client",
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
      id: 11,
      method: "tools/list",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "ripple_get_agent_workflow",
        arguments: {},
      },
    },
    {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "ripple_plan_context",
        arguments: {
          task: "change token refresh behavior",
          filePath: "src/auth.ts",
          tokenBudget: 2600,
          saveIntent: true,
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: {
        name: "ripple_check_staged",
        arguments: {
          tokenBudget: 2600,
          intentPath: "latest",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: {
        name: "ripple_get_focus",
        arguments: {
          filePath: "src/util.ts",
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
  assert.strictEqual(responses.length, 6, "stdio server should skip notification response");
  assert.strictEqual(responses[0].id, 10);
  assert.strictEqual(responses[0].result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.strictEqual(responses[1].id, 11);
  assert(
    responses[1].result.tools.some((tool) => tool.name === "ripple_get_focus"),
    "stdio tools/list should expose ripple_get_focus"
  );
  assert.strictEqual(responses[2].id, 12);
  assert.strictEqual(responses[2].result.isError, false);
  assert.strictEqual(
    responses[2].result.structuredContent.protocol,
    "ripple-agent-workflow"
  );
  assert.strictEqual(responses[3].id, 13);
  assert.strictEqual(responses[3].result.isError, false);
  assert.strictEqual(responses[3].result.structuredContent.changeIntent.protocol, "ripple-change-intent");
  assert(
    responses[3].result.structuredContent.changeIntent.readinessSnapshot,
    "stdio saved intent should include readiness snapshot"
  );
  assert.strictEqual(
    responses[3].result.structuredContent.changeIntent.readinessSnapshot.canDetectDrift,
    true,
    "stdio saved intent should remember drift-check readiness"
  );
  assert.deepStrictEqual(
    responses[3].result.structuredContent.changeIntent.editableFiles,
    ["src/auth.ts"]
  );
  assert(
    responses[3].result.structuredContent.changeIntent.contextFiles.includes("tests/auth.test.ts"),
    "stdio saved intent should keep tests as context-only files"
  );
  assert.strictEqual(responses[3].result.structuredContent.changeIntentPath, ".ripple/intents/latest.json");
  assert.strictEqual(responses[4].id, 14);
  assert.strictEqual(responses[4].result.isError, false);
  assert.strictEqual(responses[4].result.structuredContent.mode, "staged");
  assert.strictEqual(responses[4].result.structuredContent.stagedFiles, 1);
  assert.strictEqual(
    responses[4].result.structuredContent.intentValidation.verdict,
    "matched"
  );
  assert.strictEqual(
    responses[4].result.structuredContent.intentValidation.readinessDrift.status,
    "unchanged"
  );
  assert.strictEqual(
    responses[4].result.structuredContent.intentValidation.handoff.protocol,
    "ripple-agent-handoff"
  );
  assert.strictEqual(
    responses[4].result.structuredContent.intentValidation.handoff.decision,
    "human-review"
  );
  assert(
    responses[4].result.structuredContent.intentValidation.handoff.commands.approve.some(
      (command) => command.includes("ripple approve")
    ),
    "stdio staged check handoff should include approval command for human-gated files"
  );
  assert(
    responses[4].result.structuredContent.intentValidation.recommendedAction.includes("Proceed"),
    "stdio staged check should include intent action guidance"
  );
  assert(
    responses[4].result.structuredContent.changedSymbols.some(
      (symbol) => symbol.symbol === "src/auth.ts::authenticate"
    ),
    "stdio staged check should include changed authenticate symbol"
  );
  assert.strictEqual(responses[5].id, 15);
  assert.strictEqual(responses[5].result.isError, false);
  assert.strictEqual(responses[5].result.structuredContent.projectPath, "src/util.ts");
}

function assertDocumentedLocalDevConfigShape() {
  const config = JSON.parse(fs.readFileSync(localDevConfigPath, "utf8"));
  const rippleServer = config.mcpServers.ripple;
  assert.strictEqual(rippleServer.command, "node");
  assert.deepStrictEqual(rippleServer.args, [
    "/absolute/path/to/ripple/packages/mcp/dist/server.js",
    "--workspace",
    "/absolute/path/to/your/repo",
  ]);

  const args = rippleServer.args.map((value) => {
    if (value === "/absolute/path/to/ripple/packages/mcp/dist/server.js") {
      return serverPath;
    }
    if (value === "/absolute/path/to/your/repo") {
      return workspaceRoot;
    }
    return value;
  });

  const messages = [
    {
      jsonrpc: "2.0",
      id: 20,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "documented-config-test-client",
          version: "1.0.0",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/list",
      params: {},
    },
  ];

  const result = spawnSync(
    rippleServer.command,
    args,
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
  assert.strictEqual(responses.length, 2);
  assert.strictEqual(responses[0].result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert(
    responses[1].result.tools.some((tool) => tool.name === "ripple_plan_context"),
    "documented local-dev config should expose ripple_plan_context"
  );
}

async function main() {
  setupFixture();
  stageFixtureFiles();
  assertStdioServerProtocol();

  const host = createRippleMcpToolHost({ workspaceRoot });
  try {
    const toolNames = RIPPLE_MCP_TOOLS.map((tool) => tool.name).sort();
    assert.deepStrictEqual(toolNames, [
      "ripple_audit_change",
      "ripple_check_changed",
      "ripple_check_staged",
      "ripple_doctor",
      "ripple_explain_policy",
      "ripple_gate",
      "ripple_get_agent_workflow",
      "ripple_get_approval_status",
      "ripple_get_blast_radius",
      "ripple_get_focus",
      "ripple_get_recent_changes",
      "ripple_plan_context",
      "ripple_record_verification",
      "ripple_repair_intent_drift",
    ]);

    await proveMcpVerificationEvidenceGate();

    const workflow = await host.callTool("ripple_get_agent_workflow", {});
    assert.strictEqual(workflow.tool, "ripple_get_agent_workflow");
    assert.strictEqual(workflow.data.protocol, "ripple-agent-workflow");
    assert.deepStrictEqual(workflow.data.loop, [
      "choose_boundary",
      "plan",
      "approve_if_required",
      "edit",
      "stage",
      "check",
      "record_verification",
      "repair_if_needed",
    ]);
    assert.strictEqual(workflow.data.commands.initializeRepo, "ripple init");
    assert.strictEqual(workflow.data.commands.checkReadiness, "ripple doctor --agent --strict");
    assert.strictEqual(workflow.data.commands.installCi, "ripple init-ci");
    assert(
      workflow.data.policyWorkflow.defaultAgentPath.includes("policyExplanation"),
      "workflow should tell agents that ripple_plan_context includes policyExplanation"
    );
    assert(
      workflow.data.policyWorkflow.policyOnlyPath.includes("without a plan"),
      "workflow should tell agents when to use ripple_explain_policy"
    );
    assert(
      workflow.data.policyWorkflow.policyDriftPath.includes("policyDrift.status=changed"),
      "workflow should tell agents how to respond to policy drift"
    );
    assert.strictEqual(
      workflow.data.commands.planBeforeEditing,
      "ripple plan --file <file> --task \"<task>\" --mode file --agent --save"
    );
    assert.strictEqual(
      workflow.data.commands.checkAfterStaging,
      "ripple check --staged --agent --intent latest"
    );
    assert.strictEqual(
      workflow.data.commands.auditCurrentChange,
      "ripple audit --agent --intent latest"
    );
    assert.strictEqual(
      workflow.data.commands.gateCurrentChange,
      "ripple gate --agent --intent latest"
    );
    assert.strictEqual(
      workflow.data.commands.recordVerification,
      "ripple verify --run \"<command>\" --intent latest"
    );
    assert.strictEqual(
      workflow.data.commands.checkApproval,
      "ripple approval --intent latest --agent"
    );
    assert.strictEqual(
      workflow.data.commands.approveHumanGate,
      "ripple approve --intent latest --gate before-risky-edit --reason \"human reviewed and approved this boundary\""
    );
    assert.strictEqual(workflow.data.mcpTools.planBeforeEditing, "ripple_plan_context");
    assert.strictEqual(workflow.data.mcpTools.checkAfterStaging, "ripple_check_staged");
    assert.strictEqual(workflow.data.mcpTools.auditCurrentChange, "ripple_audit_change");
    assert.strictEqual(workflow.data.mcpTools.gateCurrentChange, "ripple_gate");
    assert.strictEqual(workflow.data.mcpTools.recordVerification, "ripple_record_verification");
    assert.strictEqual(
      workflow.data.mcpTools.checkApproval,
      "ripple_get_approval_status"
    );
    assert.strictEqual(
      workflow.data.mcpTools.checkReadiness,
      "ripple_doctor"
    );
    assert.strictEqual(
      workflow.data.mcpTools.explainPolicy,
      "ripple_explain_policy"
    );
    assert.strictEqual(
      workflow.data.mcpTools.checkChangedAgainstBase,
      "ripple_check_changed"
    );
    assert.strictEqual(
      workflow.data.mcpTools.repairIntentDrift,
      "ripple_repair_intent_drift"
    );
    assert.strictEqual(
      workflow.data.outputContracts.doctorHeader,
      "RIPPLE_DOCTOR"
    );
    assert(
      workflow.data.outputContracts.doctorSections.includes("enforcement_level"),
      "workflow should expose doctor enforcement sections"
    );
    assert(
      workflow.data.outputContracts.doctorSections.includes("can_block_in_ci"),
      "workflow should expose doctor CI blocking section"
    );
    assert.strictEqual(
      workflow.data.outputContracts.planHeader,
      "RIPPLE_AGENT_CONTEXT"
    );
    assert(
      workflow.data.outputContracts.planSections.includes("enforcement_level"),
      "workflow should expose plan-time enforcement section"
    );
    assert(
      workflow.data.outputContracts.planSections.includes("readiness_gaps"),
      "workflow should expose plan-time readiness gaps section"
    );
    assert.strictEqual(
      workflow.data.outputContracts.stagedCheckHeader,
      "RIPPLE_STAGED_CHECK"
    );
    assert.strictEqual(
      workflow.data.outputContracts.auditHeader,
      "RIPPLE_AUDIT"
    );
    assert.strictEqual(
      workflow.data.outputContracts.gateHeader,
      "RIPPLE_GATE"
    );
    assert.strictEqual(
      workflow.data.outputContracts.approvalHeader,
      "RIPPLE_APPROVAL"
    );
    assert.strictEqual(
      workflow.data.outputContracts.approvalStatusHeader,
      "RIPPLE_APPROVAL_STATUS"
    );
    assert(
      workflow.data.outputContracts.stagedCheckSections.includes("policy_drift"),
      "workflow should expose policy_drift staged check section"
    );
    assert(
      workflow.data.outputContracts.stagedCheckSections.includes("readiness_drift"),
      "workflow should expose readiness_drift staged check section"
    );
    assert(
      workflow.data.outputContracts.stagedCheckSections.includes("handoff"),
      "workflow should expose staged check handoff section"
    );
    assert(
      workflow.data.outputContracts.stagedCheckSections.includes("next_required_phase"),
      "workflow should expose staged check next_required_phase section"
    );
    assert(
      workflow.data.outputContracts.repairSections.includes("policy_drift"),
      "workflow should expose policy_drift repair section"
    );
    assert(
      workflow.data.outputContracts.repairSections.includes("readiness_drift"),
      "workflow should expose readiness_drift repair section"
    );
    assert(
      workflow.data.outputContracts.repairSections.includes("handoff"),
      "workflow should expose repair handoff section"
    );
    assert(
      workflow.data.outputContracts.auditSections.includes("can_proceed"),
      "workflow should expose audit output sections"
    );
    assert(
      workflow.data.outputContracts.auditSections.includes("next_required_phase"),
      "workflow should expose audit next_required_phase section"
    );
    assert(
      workflow.data.outputContracts.auditSections.includes("approval_status"),
      "workflow should expose audit approval sections"
    );
    assert(
      workflow.data.outputContracts.auditSections.includes("readiness_drift"),
      "workflow should expose readiness_drift audit section"
    );
    assert(
      workflow.data.outputContracts.auditSections.includes("handoff"),
      "workflow should expose audit handoff section"
    );
    assert(
      workflow.data.outputContracts.gateSections.includes("can_continue"),
      "workflow should expose gate continue section"
    );
    assert(
      workflow.data.outputContracts.gateSections.includes("commands_approve"),
      "workflow should expose gate approval commands section"
    );
    assert.strictEqual(
      workflow.data.runtimeContract.protocol,
      "ripple-agent-runtime-contract"
    );
    assert(
      workflow.data.runtimeContract.compatibleRuntimes.includes("MCP coding agents"),
      "workflow should expose MCP-compatible runtime contract"
    );
    assert.deepStrictEqual(
      workflow.data.runtimeContract.phases.map((phase) => phase.id),
      [
        "discover_contract",
        "plan_before_edit",
        "approval_gate",
        "edit_inside_boundary",
        "audit_after_change",
        "record_verification",
        "repair_or_handoff",
      ]
    );
    assert.strictEqual(
      workflow.data.runtimeContract.phases[1].mcpTool,
      "ripple_plan_context"
    );
    assert.strictEqual(
      workflow.data.runtimeContract.phases[4].mcpTool,
      "ripple_gate"
    );
    assert.strictEqual(
      workflow.data.runtimeContract.phases[5].mcpTool,
      "ripple_record_verification"
    );
    assert(
      workflow.data.runtimeContract.stopConditions.some((condition) =>
        condition.includes("audit.canProceed is false")
      ),
      "workflow should expose audit hard-stop condition"
    );
    assert(
      workflow.data.runtimeContract.proceedConditions.some((condition) =>
        condition.includes("Recorded verification evidence")
      ),
      "workflow should expose verification proceed condition"
    );

    const policyExplanation = await host.callTool("ripple_explain_policy", {
      filePath: "src/auth.ts",
    });
    assert.strictEqual(policyExplanation.tool, "ripple_explain_policy");
    assert.strictEqual(policyExplanation.data.protocol, "ripple-policy-explanation");
    assert.strictEqual(policyExplanation.data.targetFile, "src/auth.ts");
    assert.strictEqual(policyExplanation.data.policySource, ".ripple/policy.json");
    assert.strictEqual(policyExplanation.data.effectiveMode, "file");
    assert.strictEqual(policyExplanation.data.policyRisk, "critical");
    assert.strictEqual(policyExplanation.data.humanGate, "required-before-edit");
    assert(
      policyExplanation.data.matchedRules.includes("riskRules[0] paths=src/auth.ts risk=critical"),
      "ripple_explain_policy should return matched repo policy rules"
    );

    const readiness = await host.callTool("ripple_doctor", {});
    assert.strictEqual(readiness.tool, "ripple_doctor");
    assert(
      readiness.data.status === "ready" || readiness.data.status === "needs_setup",
      "ripple_doctor should return readiness status"
    );
    assert(
      readiness.data.decision === "continue" || readiness.data.decision === "setup-required",
      "ripple_doctor should return the agent readiness decision"
    );
    assert.strictEqual(typeof readiness.data.canContinue, "boolean");
    assert.strictEqual(typeof readiness.data.mustStop, "boolean");
    assert.strictEqual(typeof readiness.data.nextRequiredAction, "string");
    assert(Array.isArray(readiness.data.why));
    assert(Array.isArray(readiness.data.fixNow));
    assert.strictEqual(readiness.data.checks.graph.ok, true);
    assert.strictEqual(readiness.data.checks.git.ok, true);
    assert.strictEqual(typeof readiness.data.checks.gitIgnore.ok, "boolean");
    assert.strictEqual(typeof readiness.data.checks.latestIntent.ok, "boolean");
    assert(
      ["advisory", "drift-check-ready", "ci-gate-ready"].includes(
        readiness.data.enforcement.level
      ),
      "ripple_doctor should expose enforcement readiness level"
    );
    assert.strictEqual(typeof readiness.data.enforcement.canBlockInCi, "boolean");
    assert(Array.isArray(readiness.data.nextSteps));

    // The stdio protocol proof above saves latest.json. Clear it here so this
    // host-level section can still prove the first-save path before proving
    // MCP rejects overwrite and second-boundary attempts.
    fs.rmSync(path.join(workspaceRoot, ".ripple", "intents", "latest.json"), {
      force: true,
    });

    // MCP callers get the same saved control-boundary intent as CLI callers.
    const planWithIntent = await host.callTool("ripple_plan_context", {
      task: "change token refresh behavior",
      filePath: "src/auth.ts",
      tokenBudget: 2600,
      saveIntent: true,
    });
    assert.strictEqual(planWithIntent.tool, "ripple_plan_context");
    assertIntelligentPlanContract(planWithIntent.data);
    assert.strictEqual(planWithIntent.data.changeIntent.protocol, "ripple-change-intent");
    assert.strictEqual(planWithIntent.data.changeIntent.targetFile, "src/auth.ts");
    assert.strictEqual(planWithIntent.data.changeIntent.controlMode, "file");
    assert.strictEqual(planWithIntent.data.changeIntent.humanGate, "required-before-edit");
    assert(
      planWithIntent.data.changeIntent.readinessSnapshot,
      "MCP saved intent should include readiness snapshot"
    );
    assert.strictEqual(
      planWithIntent.data.changeIntent.readinessSnapshot.canDetectDrift,
      true,
      "MCP saved intent should remember local drift-check readiness"
    );
    assert.strictEqual(
      planWithIntent.data.changeIntent.readinessSnapshot.latestIntentOk,
      true,
      "MCP saved intent should snapshot latest-intent readiness after saving"
    );
    assert.strictEqual(
      planWithIntent.data.changeIntent.policyExplanation.protocol,
      "ripple-policy-explanation"
    );
    assert.strictEqual(planWithIntent.data.changeIntent.policyExplanation.effectiveMode, "file");
    assert.strictEqual(planWithIntent.data.changeIntent.policyExplanation.policyRisk, "critical");
    assert.strictEqual(
      planWithIntent.data.policyExplanation.protocol,
      "ripple-policy-explanation"
    );
    assert.strictEqual(planWithIntent.data.policyExplanation.targetFile, "src/auth.ts");
    assert.strictEqual(planWithIntent.data.policyExplanation.policyRisk, "critical");
    assert.strictEqual(planWithIntent.data.policyExplanation.humanGate, "required-before-edit");
    assert(
      planWithIntent.data.policyExplanation.matchedRules.includes(
        "riskRules[0] paths=src/auth.ts risk=critical"
      ),
      "ripple_plan_context should include policy explanation with matched rules"
    );

    await assert.rejects(
      () =>
        host.callTool("ripple_plan_context", {
          task: "secretly widen auth scope",
          filePath: "src/sessionPolicy.ts",
          saveIntent: true,
        }),
      /MCP agents cannot overwrite their own boundary/,
      "MCP agents should not overwrite an active saved intent"
    );
    await assert.rejects(
      () =>
        host.callTool("ripple_plan_context", {
          task: "secretly create alternate auth scope",
          filePath: "src/sessionPolicy.ts",
          intentPath: "alternate-auth-intent",
          saveIntent: true,
        }),
      /MCP agents cannot create a second saved boundary/,
      "MCP agents should not create a second saved intent while latest is active"
    );

    const overridePlan = await host.callTool("ripple_plan_context", {
      task: "brainstorm token refresh behavior",
      filePath: "src/auth.ts",
      mode: "brainstorm",
    });
    assert.strictEqual(
      overridePlan.data.policyExplanation.effectiveMode,
      "brainstorm",
      "ripple_plan_context policyExplanation should reflect requested mode overrides"
    );
    assert(
      overridePlan.data.policyExplanation.why.some((reason) =>
        reason.includes("Requested control mode overrides policy default: brainstorm.")
      ),
      "ripple_plan_context policyExplanation should explain requested mode overrides"
    );

    assert.deepStrictEqual(planWithIntent.data.changeIntent.editableFiles, ["src/auth.ts"]);
    assert(
      planWithIntent.data.changeIntent.contextFiles.includes("tests/auth.test.ts"),
      "MCP saved intent should keep tests as context-only files"
    );
    assert.strictEqual(planWithIntent.data.changeIntentPath, ".ripple/intents/latest.json");
    assert(
      fs.existsSync(path.join(workspaceRoot, planWithIntent.data.changeIntentPath)),
      "ripple_plan_context saveIntent should write the intent file"
    );

    const readyAfterIntent = await host.callTool("ripple_doctor", {});
    assert.strictEqual(readyAfterIntent.data.checks.latestIntent.ok, true);
    assert.strictEqual(
      readyAfterIntent.data.decision,
      readyAfterIntent.data.status === "ready" ? "continue" : "setup-required"
    );
    assert.strictEqual(readyAfterIntent.data.canContinue, readyAfterIntent.data.status === "ready");
    assert.strictEqual(readyAfterIntent.data.mustStop, readyAfterIntent.data.status !== "ready");
    assert(
      readyAfterIntent.data.enforcement.level === "drift-check-ready" ||
        readyAfterIntent.data.enforcement.level === "ci-gate-ready",
      "doctor should report drift or CI readiness after a saved intent exists"
    );

    const stagedCheck = await host.callTool("ripple_check_staged", {
      tokenBudget: 2600,
      intentPath: "latest",
    });
    assert.strictEqual(stagedCheck.tool, "ripple_check_staged");
    assert.strictEqual(stagedCheck.data.mode, "staged");
    assert.strictEqual(stagedCheck.data.stagedFiles, 1);
    assert.strictEqual(stagedCheck.data.adapterSupport.primaryAdapter.id, "builtin-js-ts");
    assert(
      stagedCheck.data.agentActions.trustedFindings.some((item) =>
        item.includes("src/auth.ts::authenticate")
      ),
      "staged check should expose trusted findings"
    );
    assert(
      stagedCheck.data.agentActions.verifyBeforeCommit.some((item) =>
        item.includes("tests/auth.test.ts")
      ),
      "staged check should expose verify-before-commit actions"
    );
    assert(
      stagedCheck.data.agentActions.manualReviewRequired.some((item) =>
        item.includes("src/auth.ts::authenticate")
      ),
      "staged check should expose manual review actions"
    );
    assert.strictEqual(stagedCheck.data.intentValidation.verdict, "matched");
    assert.strictEqual(stagedCheck.data.intentValidation.nextRequiredPhase, "audit_after_change");
    assert.strictEqual(stagedCheck.data.nextRequiredPhase, "audit_after_change");
    assert.strictEqual(stagedCheck.data.intentValidation.boundaryVerdict.status, "pass");
    assert.strictEqual(stagedCheck.data.intentValidation.controlMode, "file");
    assert.strictEqual(
      stagedCheck.data.intentValidation.policyExplanation.policyRisk,
      "critical",
      "staged checks should carry the saved policy explanation snapshot"
    );
    assert.strictEqual(
      stagedCheck.data.intentValidation.policyDrift.status,
      "unchanged",
      "staged checks should compare saved policy snapshot with current policy"
    );
    assert.strictEqual(
      stagedCheck.data.intentValidation.readinessDrift.status,
      "unchanged",
      "staged checks should compare saved readiness snapshot with current readiness"
    );
    assert.strictEqual(
      stagedCheck.data.intentValidation.handoff.protocol,
      "ripple-agent-handoff",
      "staged checks should include compact handoff"
    );
    assert.strictEqual(stagedCheck.data.intentValidation.handoff.decision, "human-review");
    assert(
      stagedCheck.data.intentValidation.handoff.commands.audit.includes("ripple audit --agent --intent latest"),
      "staged handoff should include audit command"
    );
    assert(
      stagedCheck.data.intentValidation.handoff.commands.approve.some((command) =>
        command.includes("ripple approve")
      ),
      "staged handoff should include approval command for human-gated files"
    );
    assert.strictEqual(stagedCheck.data.intentValidation.plannedScope, "matched");
    assert(
      stagedCheck.data.intentValidation.recommendedAction.includes("Proceed"),
      "MCP staged check should include recommended action"
    );
    assert(Array.isArray(stagedCheck.data.intentValidation.blockingReasons));
    assert(Array.isArray(stagedCheck.data.intentValidation.nextSteps));
    assert.strictEqual(stagedCheck.data.skippedFiles.length, 1);
    assert(
      stagedCheck.data.files.some((file) => file.file === "src/auth.ts"),
      "staged check should include staged auth file"
    );
    const authStagedFile = stagedCheck.data.files.find((file) => file.file === "src/auth.ts");
    assert(authStagedFile, "staged check should summarize src/auth.ts");
    assert(
      authStagedFile.adapterSignals.some(
        (signal) => signal.capability === "symbols" && signal.agentUse === "trust"
      ),
      "staged check should include file-level adapter confidence"
    );
    assert(
      authStagedFile.symbolFocus.includes("src/auth.ts::authenticate"),
      "staged check should include auth symbol focus"
    );
    assert(
      authStagedFile.changedSymbols.some(
        (symbol) => symbol.symbol === "src/auth.ts::authenticate"
      ),
      "staged check should include changed authenticate symbol"
    );
    const authenticateChangedSymbol = authStagedFile.changedSymbols.find(
      (symbol) => symbol.symbol === "src/auth.ts::authenticate"
    );
    assert.strictEqual(
      authenticateChangedSymbol.changeKind,
      "signature-or-contract",
      "authenticate should identify declaration/signature changes"
    );
    assert.strictEqual(
      authenticateChangedSymbol.symbolStatus,
      "created",
      "initial staged fixture should mark authenticate as created"
    );
    assert.strictEqual(
      authenticateChangedSymbol.signatureChanged,
      false,
      "new staged symbol should not claim an old signature changed"
    );
    assert.strictEqual(
      authenticateChangedSymbol.contractChanged,
      true,
      "new exported staged symbol should introduce a contract"
    );
    assert(
      authenticateChangedSymbol.contractRisk !== "none",
      "exported authenticate should carry contract review risk"
    );
    assert(
      authenticateChangedSymbol.adapterSignals.some(
        (signal) => signal.capability === "symbols" && signal.agentUse === "trust"
      ),
      "changed authenticate should include trusted symbol adapter confidence"
    );
    assert(
      stagedCheck.data.contractRisks.some(
        (risk) => risk.symbol === "src/auth.ts::authenticate"
      ),
      "staged check should aggregate contract risk"
    );
    const authenticateContractRisk = stagedCheck.data.contractRisks.find(
      (risk) => risk.symbol === "src/auth.ts::authenticate"
    );
    assert(authenticateContractRisk, "staged check should include authenticate contract risk details");
    assert(
      authenticateContractRisk.adapterSignals.some(
        (signal) => signal.capability === "tests" && signal.agentUse === "verify"
      ),
      "contract risk should expose verify-only test confidence"
    );
    assert(
      authStagedFile.verificationTargets.includes("tests/auth.test.ts"),
      "staged check should include direct auth test verification target"
    );

    const matchedRepair = await host.callTool("ripple_repair_intent_drift", {
      tokenBudget: 2600,
      intentPath: "latest",
    });
    assert.strictEqual(matchedRepair.tool, "ripple_repair_intent_drift");
    assert.strictEqual(matchedRepair.data.protocol, "ripple-intent-drift-repair");
    assert.strictEqual(matchedRepair.data.verdict, "matched");
    assert.strictEqual(matchedRepair.data.status, "no-repair-needed");
    assert.strictEqual(
      matchedRepair.data.policyExplanation.policyRisk,
      "critical",
      "repair plans should carry the saved policy explanation snapshot"
    );
    assert.strictEqual(
      matchedRepair.data.policyDrift.status,
      "unchanged",
      "repair plans should carry policy drift status"
    );
    assert.strictEqual(
      matchedRepair.data.readinessDrift.status,
      "unchanged",
      "repair plans should carry readiness drift status"
    );
    assert.strictEqual(
      matchedRepair.data.handoff.decision,
      "audit",
      "matched repair handoff should point to audit"
    );
    assert.strictEqual(matchedRepair.data.unstageFiles.length, 0);
    assert(
      matchedRepair.data.verificationTargets.includes("tests/auth.test.ts"),
      "matched repair plan should preserve verification targets"
    );
    assert(
      matchedRepair.data.agentActions.trustedFindings.some((item) =>
        item.includes("src/auth.ts::authenticate")
      ),
      "matched repair plan should preserve trusted findings"
    );
    assert(
      matchedRepair.data.agentActions.verifyBeforeCommit.some((item) =>
        item.includes("tests/auth.test.ts")
      ),
      "matched repair plan should preserve verify-before-commit actions"
    );

    const audit = await host.callTool("ripple_audit_change", {
      tokenBudget: 2600,
      intentPath: "latest",
    });
    assert.strictEqual(audit.tool, "ripple_audit_change");
    assert.strictEqual(audit.data.protocol, "ripple-audit");
    assert.strictEqual(audit.data.mode, "staged");
    assert.strictEqual(audit.data.intent.targetFile, "src/auth.ts");
    assert.strictEqual(audit.data.intent.controlMode, "file");
    assert.strictEqual(audit.data.stagedCheck.intentValidation.verdict, "matched");
    assert.strictEqual(audit.data.repairPlan.status, "no-repair-needed");
    assert.strictEqual(audit.data.stagedCheck.intentValidation.policyDrift.status, "unchanged");
    assert.strictEqual(audit.data.stagedCheck.intentValidation.readinessDrift.status, "unchanged");
    assert.strictEqual(
      audit.data.handoff.decision,
      "human-review",
      "critical missing approval audit should produce human-review handoff"
    );
    assert.strictEqual(audit.data.handoff.canContinue, false);
    assert(
      audit.data.handoff.commands.approve.some((command) => command.includes("ripple approve")),
      "human-review audit handoff should include approval command"
    );
    assert.strictEqual(
      audit.data.status,
      "human-review-required",
      "critical human-gated files should keep audit in human-review-required"
    );
    assert.strictEqual(audit.data.decision, "human-review");
    assert.strictEqual(audit.data.canProceed, false);
    assert.strictEqual(audit.data.nextRequiredPhase, "approval_gate");
    assert(
      audit.data.nextRequiredAction.includes("ripple approve"),
      "MCP audit should tell agents the human approval phase is next"
    );
    assert.strictEqual(audit.data.approvalStatus.status, "missing");
    assert.strictEqual(audit.data.approvalStatus.required, true);
    assert.strictEqual(audit.data.approvalStatus.approved, false);
    assert(
      audit.data.recommendedAction.includes("approval"),
      "MCP audit should explain the missing human approval gate"
    );
    assert(
      audit.data.verificationTargets.includes("tests/auth.test.ts"),
      "MCP audit should preserve verification targets"
    );

    const gate = await host.callTool("ripple_gate", {
      tokenBudget: 2600,
      intentPath: "latest",
    });
    assert.strictEqual(gate.tool, "ripple_gate");
    assert.strictEqual(gate.data.protocol, "ripple-gate");
    assert.strictEqual(gate.data.status, "closed");
    assert.strictEqual(gate.data.decision, "human-review");
    assert.strictEqual(gate.data.canContinue, false);
    assert.strictEqual(gate.data.mustStop, true);
    assert.strictEqual(gate.data.needsHuman, true);
    assert.strictEqual(gate.data.auditStatus, "human-review-required");
    assert.strictEqual(gate.data.approvalStatus, "missing");
    assert.strictEqual(gate.data.nextRequiredPhase, "approval_gate");
    assert.strictEqual(gate.data.audit, undefined, "MCP gate should stay compact");
    assert(
      gate.data.commands.approve.some((command) => command.includes("ripple approve")),
      "MCP gate should include approval command for human-gated files"
    );
    assert(
      gate.data.verificationTargets.includes("tests/auth.test.ts"),
      "MCP gate should preserve verification targets"
    );

    const approvalStatus = await host.callTool("ripple_get_approval_status", {
      intentPath: "latest",
    });
    assert.strictEqual(approvalStatus.tool, "ripple_get_approval_status");
    assert.strictEqual(approvalStatus.data.protocol, "ripple-approval-status");
    assert.strictEqual(approvalStatus.data.status, "missing");
    assert.strictEqual(approvalStatus.data.required, true);
    assert.strictEqual(approvalStatus.data.approved, false);
    assert.strictEqual(approvalStatus.data.intent.targetFile, "src/auth.ts");
    assert.strictEqual(approvalStatus.data.intent.humanGate, "required-before-edit");

    execFileSync("git", ["add", "src/util.ts"], {
      cwd: workspaceRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const driftRepair = await host.callTool("ripple_repair_intent_drift", {
      tokenBudget: 2600,
      intentPath: "latest",
    });
    assert.strictEqual(driftRepair.data.verdict, "drifted");
    assert.strictEqual(driftRepair.data.status, "human-review-required");
    assert.strictEqual(driftRepair.data.boundaryVerdict.status, "danger");
    assert(
      driftRepair.data.unstageFiles.includes("src/util.ts"),
      "drift repair plan should list the unplanned staged file"
    );
    assert(
      driftRepair.data.commands.unstage.includes("git restore --staged -- src/util.ts"),
      "drift repair plan should include an unstage command"
    );
    assert(
      Array.isArray(driftRepair.data.agentActions.manualReviewRequired),
      "drift repair plan should expose agent action buckets"
    );
    execFileSync("git", ["rm", "--cached", "src/util.ts"], {
      cwd: workspaceRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });

    const focus = await host.callTool("ripple_get_focus", { filePath: "src/util.ts" });
    assert.strictEqual(focus.tool, "ripple_get_focus");
    assert.strictEqual(focus.data.projectPath, "src/util.ts");
    assert(
      focus.data.importedBy.some((item) => item.file === "src/index.ts"),
      "focus should include direct importer"
    );
    assert(
      fs.existsSync(path.join(workspaceRoot, focus.data.focusPath)),
      "ripple_get_focus should write only the requested focus file on demand"
    );
    assert(
      !fs.existsSync(path.join(workspaceRoot, ".ripple", ".cache", "context.json")),
      "ripple_get_focus should not write the full context bundle"
    );
    assert(
      !fs.existsSync(path.join(workspaceRoot, ".ripple", "WORKFLOW.md")),
      "ripple_get_focus should not write WORKFLOW.md"
    );

    const blast = await host.callTool("ripple_get_blast_radius", { filePath: "src/util.ts" });
    assert.strictEqual(blast.data.affectedCount, 1);
    assert.strictEqual(blast.data.directImporters[0].file, "src/index.ts");

    const plan = await host.callTool("ripple_plan_context", {
      task: "change token refresh behavior",
      filePath: "src/auth.ts",
      tokenBudget: 2600,
    });
    assert.strictEqual(plan.tool, "ripple_plan_context");
    assertIntelligentPlanContract(plan.data);
    assert.strictEqual(
      plan.data.policyExplanation.protocol,
      "ripple-policy-explanation",
      "ripple_plan_context should include policy explanation even when saveIntent is false"
    );
    assert.strictEqual(plan.data.policyExplanation.policyRisk, "critical");
    assert.strictEqual(plan.data.policyExplanation.humanGate, "required-before-edit");

    const history = await host.callTool("ripple_get_recent_changes", { limit: 1 });
    assert.strictEqual(history.tool, "ripple_get_recent_changes");
    assert(history.data.returnedGroups >= 1, "history should return at least one group");

    const server = new RippleMcpJsonRpcServer(host, "test-version");

    const initialize = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      },
    });
    assert.strictEqual(initialize.result.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.deepStrictEqual(initialize.result.capabilities, {
      tools: {
        listChanged: false,
      },
    });

    const initialized = await server.handleMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    assert.strictEqual(initialized, null);

    const toolsList = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    assert(
      toolsList.result.tools.some((tool) => tool.name === "ripple_doctor"),
      "tools/list should expose ripple_doctor"
    );
    assert(
      toolsList.result.tools.some((tool) => tool.name === "ripple_plan_context"),
      "tools/list should expose ripple_plan_context"
    );
    assert(
      toolsList.result.tools.some((tool) => tool.name === "ripple_get_agent_workflow"),
      "tools/list should expose ripple_get_agent_workflow"
    );
    assert(
      toolsList.result.tools.some((tool) => tool.name === "ripple_explain_policy"),
      "tools/list should expose ripple_explain_policy"
    );
    assert(
      toolsList.result.tools.some((tool) => tool.name === "ripple_check_staged"),
      "tools/list should expose ripple_check_staged"
    );
    assert(
      toolsList.result.tools.some((tool) => tool.name === "ripple_check_changed"),
      "tools/list should expose ripple_check_changed"
    );
    assert(
      toolsList.result.tools.some((tool) => tool.name === "ripple_audit_change"),
      "tools/list should expose ripple_audit_change"
    );
    assert(
      toolsList.result.tools.some((tool) => tool.name === "ripple_gate"),
      "tools/list should expose ripple_gate"
    );
    assert(
      toolsList.result.tools.some((tool) => tool.name === "ripple_get_approval_status"),
      "tools/list should expose ripple_get_approval_status"
    );
    assert(
      toolsList.result.tools.some((tool) => tool.name === "ripple_repair_intent_drift"),
      "tools/list should expose ripple_repair_intent_drift"
    );
    const planToolDefinition = toolsList.result.tools.find(
      (tool) => tool.name === "ripple_plan_context"
    );
    assert(
      planToolDefinition.inputSchema.properties.saveIntent,
      "ripple_plan_context schema should expose saveIntent"
    );
    assert(
      planToolDefinition.inputSchema.properties.mode,
      "ripple_plan_context schema should expose control boundary mode"
    );
    assert(
      planToolDefinition.inputSchema.properties.allowedSymbols,
      "ripple_plan_context schema should expose allowed symbol boundaries"
    );
    const policyToolDefinition = toolsList.result.tools.find(
      (tool) => tool.name === "ripple_explain_policy"
    );
    assert(
      policyToolDefinition.inputSchema.properties.filePath,
      "ripple_explain_policy schema should expose filePath"
    );
    const auditToolDefinition = toolsList.result.tools.find(
      (tool) => tool.name === "ripple_audit_change"
    );
    assert(
      auditToolDefinition.inputSchema.properties.mode,
      "ripple_audit_change schema should expose audit mode"
    );
    assert(
      auditToolDefinition.inputSchema.properties.intentPath,
      "ripple_audit_change schema should expose intentPath"
    );
    const gateToolDefinition = toolsList.result.tools.find(
      (tool) => tool.name === "ripple_gate"
    );
    assert(
      gateToolDefinition.inputSchema.properties.mode,
      "ripple_gate schema should expose gate mode"
    );
    assert(
      gateToolDefinition.inputSchema.properties.intentPath,
      "ripple_gate schema should expose intentPath"
    );
    const recordVerificationToolDefinition = toolsList.result.tools.find(
      (tool) => tool.name === "ripple_record_verification"
    );
    assert(
      recordVerificationToolDefinition.inputSchema.properties.command,
      "ripple_record_verification schema should expose command"
    );
    assert(
      recordVerificationToolDefinition.inputSchema.properties.status,
      "ripple_record_verification schema should expose status"
    );
    const approvalStatusToolDefinition = toolsList.result.tools.find(
      (tool) => tool.name === "ripple_get_approval_status"
    );
    assert(
      approvalStatusToolDefinition.inputSchema.properties.intentPath,
      "ripple_get_approval_status schema should expose intentPath"
    );
    assert(
      approvalStatusToolDefinition.inputSchema.properties.gate,
      "ripple_get_approval_status schema should expose gate"
    );

    const workflowToolCall = await server.handleMessage({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: "ripple_get_agent_workflow",
        arguments: {},
      },
    });
    assert.strictEqual(workflowToolCall.result.isError, false);
    assert.strictEqual(
      workflowToolCall.result.structuredContent.protocol,
      "ripple-agent-workflow"
    );
    assert.strictEqual(
      workflowToolCall.result.structuredContent.mcpTools.checkReadiness,
      "ripple_doctor"
    );
    assert.strictEqual(
      workflowToolCall.result.structuredContent.mcpTools.explainPolicy,
      "ripple_explain_policy"
    );
    assert(
      workflowToolCall.result.structuredContent.policyWorkflow.defaultAgentPath.includes(
        "policyExplanation"
      )
    );
    assert.strictEqual(
      workflowToolCall.result.structuredContent.mcpTools.checkAfterStaging,
      "ripple_check_staged"
    );
    assert.strictEqual(
      workflowToolCall.result.structuredContent.mcpTools.auditCurrentChange,
      "ripple_audit_change"
    );
    assert.strictEqual(
      workflowToolCall.result.structuredContent.mcpTools.gateCurrentChange,
      "ripple_gate"
    );
    assert.strictEqual(
      workflowToolCall.result.structuredContent.mcpTools.recordVerification,
      "ripple_record_verification"
    );
    assert.strictEqual(
      workflowToolCall.result.structuredContent.mcpTools.checkApproval,
      "ripple_get_approval_status"
    );
    assert.strictEqual(
      workflowToolCall.result.structuredContent.mcpTools.checkChangedAgainstBase,
      "ripple_check_changed"
    );

    const policyToolCall = await server.handleMessage({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "ripple_explain_policy",
        arguments: {
          filePath: "src/auth.ts",
        },
      },
    });
    assert.strictEqual(policyToolCall.result.isError, false);
    assert.strictEqual(
      policyToolCall.result.structuredContent.protocol,
      "ripple-policy-explanation"
    );
    assert.strictEqual(
      policyToolCall.result.structuredContent.policyRisk,
      "critical"
    );
    assert(policyToolCall.result.content[0].text.includes("ripple-policy-explanation"));
    assert.strictEqual(
      workflowToolCall.result.structuredContent.mcpTools.repairIntentDrift,
      "ripple_repair_intent_drift"
    );
    assert(workflowToolCall.result.content[0].text.includes("planBeforeEditing"));
    assert(workflowToolCall.result.content[0].text.includes("initializeRepo"));
    assert(workflowToolCall.result.content[0].text.includes("checkReadiness"));
    assert(workflowToolCall.result.content[0].text.includes("checkChangedAgainstBase"));
    assert(workflowToolCall.result.content[0].text.includes("auditCurrentChange"));
    assert(workflowToolCall.result.content[0].text.includes("repairIntentDrift"));

    const readinessToolCall = await server.handleMessage({
      jsonrpc: "2.0",
      id: 305,
      method: "tools/call",
      params: {
        name: "ripple_doctor",
        arguments: {},
      },
    });
    assert.strictEqual(readinessToolCall.result.isError, false);
    assert.strictEqual(readinessToolCall.result.structuredContent.checks.graph.ok, true);
    assert(readinessToolCall.result.content[0].text.includes("\"status\""));

    const stagedToolCall = await server.handleMessage({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "ripple_check_staged",
        arguments: {
          tokenBudget: 2600,
          intentPath: "latest",
        },
      },
    });
    assert.strictEqual(stagedToolCall.result.isError, false);
    assert.strictEqual(stagedToolCall.result.structuredContent.mode, "staged");
    assert.strictEqual(stagedToolCall.result.structuredContent.stagedFiles, 1);
    assert.strictEqual(
      stagedToolCall.result.structuredContent.intentValidation.verdict,
      "matched"
    );
    assert(
      stagedToolCall.result.structuredContent.intentValidation.recommendedAction.includes("Proceed"),
      "JSON-RPC staged check should include recommended action"
    );
    assert(stagedToolCall.result.content[0].text.includes("symbolFocus"));
    assert(stagedToolCall.result.content[0].text.includes("changedSymbols"));
    assert(stagedToolCall.result.content[0].text.includes("contractRisks"));
    assert(stagedToolCall.result.content[0].text.includes("intentValidation"));
    assert(stagedToolCall.result.content[0].text.includes("recommendedAction"));

    const repairToolCall = await server.handleMessage({
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "ripple_repair_intent_drift",
        arguments: {
          tokenBudget: 2600,
          intentPath: "latest",
        },
      },
    });
    assert.strictEqual(repairToolCall.result.isError, false);
    assert.strictEqual(
      repairToolCall.result.structuredContent.protocol,
      "ripple-intent-drift-repair"
    );
    assert.strictEqual(repairToolCall.result.structuredContent.status, "no-repair-needed");
    assert(
      repairToolCall.result.structuredContent.agentActions.trustedFindings.some((item) =>
        item.includes("src/auth.ts::authenticate")
      ),
      "JSON-RPC repair should preserve trusted findings"
    );
    assert(repairToolCall.result.content[0].text.includes("verificationTargets"));
    assert(repairToolCall.result.content[0].text.includes("agentActions"));

    const auditToolCall = await server.handleMessage({
      jsonrpc: "2.0",
      id: 321,
      method: "tools/call",
      params: {
        name: "ripple_audit_change",
        arguments: {
          tokenBudget: 2600,
          intentPath: "latest",
        },
      },
    });
    assert.strictEqual(auditToolCall.result.isError, false);
    assert.strictEqual(auditToolCall.result.structuredContent.protocol, "ripple-audit");
    assert.strictEqual(auditToolCall.result.structuredContent.mode, "staged");
    assert.strictEqual(auditToolCall.result.structuredContent.intent.targetFile, "src/auth.ts");
    assert.strictEqual(
      auditToolCall.result.structuredContent.stagedCheck.intentValidation.policyDrift.status,
      "unchanged"
    );
    assert.strictEqual(
      auditToolCall.result.structuredContent.repairPlan.status,
      "no-repair-needed"
    );
    assert(auditToolCall.result.content[0].text.includes("recommendedAction"));
    assert(auditToolCall.result.content[0].text.includes("currentPolicyExplanation"));

    const gateToolCall = await server.handleMessage({
      jsonrpc: "2.0",
      id: 322,
      method: "tools/call",
      params: {
        name: "ripple_gate",
        arguments: {
          tokenBudget: 2600,
          intentPath: "latest",
        },
      },
    });
    assert.strictEqual(gateToolCall.result.isError, false);
    assert.strictEqual(gateToolCall.result.structuredContent.protocol, "ripple-gate");
    assert.strictEqual(gateToolCall.result.structuredContent.status, "closed");
    assert.strictEqual(gateToolCall.result.structuredContent.decision, "human-review");
    assert.strictEqual(gateToolCall.result.structuredContent.canContinue, false);
    assert.strictEqual(gateToolCall.result.structuredContent.auditStatus, "human-review-required");
    assert.strictEqual(gateToolCall.result.structuredContent.approvalStatus, "missing");
    assert.strictEqual(gateToolCall.result.structuredContent.audit, undefined);
    assert(gateToolCall.result.content[0].text.includes("ripple-gate"));

    const approvalStatusToolCall = await server.handleMessage({
      jsonrpc: "2.0",
      id: 323,
      method: "tools/call",
      params: {
        name: "ripple_get_approval_status",
        arguments: {
          intentPath: "latest",
        },
      },
    });
    assert.strictEqual(approvalStatusToolCall.result.isError, false);
    assert.strictEqual(
      approvalStatusToolCall.result.structuredContent.protocol,
      "ripple-approval-status"
    );
    assert.strictEqual(approvalStatusToolCall.result.structuredContent.status, "missing");
    assert.strictEqual(
      approvalStatusToolCall.result.structuredContent.intent.targetFile,
      "src/auth.ts"
    );
    assert(approvalStatusToolCall.result.content[0].text.includes("approvalPath"));

    execFileSync("git", ["add", "package.json", "src", "tests"], {
      cwd: workspaceRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Ripple Test",
        "-c",
        "user.email=ripple@example.com",
        "commit",
        "-m",
        "baseline",
      ],
      {
        cwd: workspaceRoot,
        stdio: ["ignore", "ignore", "pipe"],
      }
    );
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

    const changedToolCall = await server.handleMessage({
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: {
        name: "ripple_check_changed",
        arguments: {
          baseRef: "HEAD",
          tokenBudget: 2600,
          intentPath: "latest",
        },
      },
    });
    assert.strictEqual(changedToolCall.result.isError, false);
    assert.strictEqual(changedToolCall.result.structuredContent.mode, "changed");
    assert.strictEqual(changedToolCall.result.structuredContent.baseRef, "HEAD");
    assert.strictEqual(changedToolCall.result.structuredContent.stagedFiles, 1);
    assert.strictEqual(
      changedToolCall.result.structuredContent.intentValidation.verdict,
      "matched"
    );
    assert(
      changedToolCall.result.structuredContent.files.some((file) => file.file === "src/auth.ts"),
      "JSON-RPC changed check should include changed auth file"
    );
    assert(changedToolCall.result.content[0].text.includes("\"mode\": \"changed\""));
    assert(changedToolCall.result.content[0].text.includes("\"baseRef\": \"HEAD\""));

    const toolCall = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "ripple_plan_context",
        arguments: {
          task: "change token refresh behavior",
          filePath: "src/auth.ts",
          tokenBudget: 2600,
        },
      },
    });
    assert.strictEqual(toolCall.result.isError, false);
    assertIntelligentPlanContract(toolCall.result.structuredContent);
    assert.strictEqual(
      toolCall.result.structuredContent.changeIntent,
      undefined,
      "JSON-RPC plan-only calls should not overwrite the active saved intent"
    );
    assert.strictEqual(
      toolCall.result.structuredContent.policyExplanation.protocol,
      "ripple-policy-explanation"
    );
    assert.strictEqual(
      toolCall.result.structuredContent.policyExplanation.policyRisk,
      "critical"
    );
    assert.strictEqual(toolCall.result.content[0].type, "text");
    assert(toolCall.result.content[0].text.includes("symbolFocus"));
    assert(toolCall.result.content[0].text.includes("policyExplanation"));
    assert(toolCall.result.content[0].text.includes("src/auth.ts::authenticate"));

    const unknownMethod = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "unknown/method",
    });
    assert.strictEqual(unknownMethod.error.code, -32601);
  } finally {
    host.dispose();
  }

  assertDocumentedLocalDevConfigShape();

  console.log("Ripple MCP tool handler tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
