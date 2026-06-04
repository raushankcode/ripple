const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { MCP_PROTOCOL_VERSION } = require("../dist");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const serverPath = path.join(repoRoot, "packages", "mcp", "dist", "server.js");
const proofRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-mcp-stdio-gate-proof-${Date.now()}`,
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

function parseJsonLines(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function callStdioTool(workspaceRoot, tool, args = {}) {
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "golden-stdio-gate-proof",
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
      method: "tools/call",
      params: {
        name: tool,
        arguments: args,
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
    },
  );

  if (result.error) {
    throw result.error;
  }
  assert.strictEqual(result.status, 0, result.stderr);

  const responses = parseJsonLines(result.stdout);
  assert.strictEqual(responses.length, 2, "stdio server should return initialize + tool call");
  assert.strictEqual(responses[0].id, 1);
  assert.strictEqual(responses[0].result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.strictEqual(responses[1].id, 2);
  assert.strictEqual(responses[1].result.isError, false, responses[1].result.content?.[0]?.text);
  assert.strictEqual(responses[1].result.content[0].type, "text");
  assert(
    responses[1].result.content[0].text.includes('"protocol"'),
    "stdio tool text response should contain serialized structured data",
  );
  return responses[1].result.structuredContent;
}

function setupUtilityFixture(name, options = {}) {
  const workspaceRoot = workspacePath(name);
  writeFile(
    workspaceRoot,
    "package.json",
    JSON.stringify({ name: `ripple-mcp-stdio-${name}` }, null, 2),
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
  }
  commitBaseline(workspaceRoot);
  return workspaceRoot;
}

function setupHumanGateFixture() {
  const workspaceRoot = workspacePath("human-review");
  writeFile(
    workspaceRoot,
    "package.json",
    JSON.stringify({ name: "ripple-mcp-stdio-human-review" }, null, 2),
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

function saveUtilityIntentOverStdio(workspaceRoot) {
  const plan = callStdioTool(workspaceRoot, "ripple_plan_context", {
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

function saveHumanGateIntentOverStdio(workspaceRoot) {
  const plan = callStdioTool(workspaceRoot, "ripple_plan_context", {
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
  assert.strictEqual(gate.nextRequiredPhase, expected.nextRequiredPhase, `${label} phase`);
  assert.strictEqual(gate.auditStatus, expected.auditStatus, `${label} auditStatus`);
  assert.strictEqual(gate.approvalStatus, expected.approvalStatus, `${label} approvalStatus`);
  assert.strictEqual(gate.audit, undefined, `${label} gate should stay compact`);
  assert(Array.isArray(gate.why), `${label} why should be an array`);
  assert(Array.isArray(gate.fixNow), `${label} fixNow should be an array`);
  assert(Array.isArray(gate.askHuman), `${label} askHuman should be an array`);
  assert(gate.commands && typeof gate.commands === "object", `${label} commands`);
}

function proveStdioGateContinues() {
  const workspaceRoot = setupUtilityFixture("continue");
  saveUtilityIntentOverStdio(workspaceRoot);
  changeUtilityInsidePlan(workspaceRoot);

  const gate = callStdioTool(workspaceRoot, "ripple_gate", {
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
    "stdio continue gate",
  );
  assert(
    gate.commands.verify.includes("tests/util.test.ts"),
    "stdio continue gate should preserve verification commands",
  );
}

function proveStdioGateRepairs() {
  const workspaceRoot = setupUtilityFixture("repair");
  saveUtilityIntentOverStdio(workspaceRoot);
  changeUtilityInsidePlan(workspaceRoot);
  addUnplannedFile(workspaceRoot);

  const gate = callStdioTool(workspaceRoot, "ripple_gate", {
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
    "stdio repair gate",
  );
  assert(
    gate.why.some((item) => item.includes("Unplanned file changed: src/other.ts")),
    "stdio repair gate should explain the unplanned file",
  );
  assert(
    gate.commands.repair.includes("ripple repair --agent --intent latest"),
    "stdio repair gate should include repair command",
  );
}

function proveStdioGateRequiresHuman() {
  const workspaceRoot = setupHumanGateFixture();
  saveHumanGateIntentOverStdio(workspaceRoot);
  changeHumanGatedFile(workspaceRoot);

  const gate = callStdioTool(workspaceRoot, "ripple_gate", {
    tokenBudget: 2600,
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
    "stdio human-review gate",
  );
  assert(
    gate.commands.approve.some((command) =>
      command.includes("ripple approve --intent latest --gate before-risky-edit"),
    ),
    "stdio human-review gate should include approval command",
  );
}

function proveStdioGateRestoresReadiness() {
  const workspaceRoot = setupUtilityFixture("restore-readiness", {
    withCiWorkflow: true,
  });
  const plan = saveUtilityIntentOverStdio(workspaceRoot);
  assert.strictEqual(
    plan.changeIntent.readinessSnapshot.canBlockInCi,
    true,
    "stdio saved intent should snapshot CI gate readiness",
  );
  changeUtilityInsidePlan(workspaceRoot);
  removeFile(workspaceRoot, ".github/workflows/ripple.yml");

  const gate = callStdioTool(workspaceRoot, "ripple_gate", {
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
    "stdio restore-readiness gate",
  );
  assert(
    gate.commands.doctor.includes("ripple doctor --agent --strict"),
    "stdio restore-readiness gate should include doctor command",
  );
}

function main() {
  if (!fs.existsSync(serverPath)) {
    throw new Error("MCP server build output is missing. Run npm run build:mcp first.");
  }

  proveStdioGateContinues();
  proveStdioGateRepairs();
  proveStdioGateRequiresHuman();
  proveStdioGateRestoresReadiness();

  console.log("Ripple golden MCP stdio gate proof passed");
  console.log(`Workspace root: ${proofRoot}`);
  console.log("MCP stdio gate decisions: open/continue, closed/repair, closed/human-review, closed/restore-readiness");
}

main();
