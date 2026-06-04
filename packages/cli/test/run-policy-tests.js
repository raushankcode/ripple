const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `cli-policy-${Date.now()}`
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

function runCliResult(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
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

function setupFixture() {
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  writeFile("package.json", JSON.stringify({ name: "cli-policy-fixture" }, null, 2));
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
}

function initializeGitBaseline() {
  execFileSync("git", ["init"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
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
}

function assertIncludes(output, expected, label) {
  assert(
    output.includes(expected),
    `${label} should include ${expected}\n\nOutput:\n${output}`
  );
}

function main() {
  setupFixture();
  initializeGitBaseline();

  const help = runCli(["--help"]);
  assertIncludes(help, "ripple policy init", "help");
  assertIncludes(help, "ripple policy explain --file <file>", "help");
  assertIncludes(help, "ripple approve", "help");

  const printedPolicy = runCli(["policy", "init", "--print"]);
  assertIncludes(printedPolicy, '"protocol": "ripple-policy"', "policy init --print");
  assertIncludes(printedPolicy, '"defaultMode": "file"', "policy init --print");
  assertIncludes(printedPolicy, '"riskRules"', "policy init --print");

  const printedPolicyJson = runCliJson(["policy", "init", "--print"]);
  assert.strictEqual(printedPolicyJson.path, ".ripple/policy.json");
  assert.strictEqual(printedPolicyJson.written, false);
  assert.strictEqual(printedPolicyJson.policy.defaultMode, "file");

  const initPolicy = runCli(["policy", "init"]);
  const policyPath = path.join(workspaceRoot, ".ripple", "policy.json");
  assert(fs.existsSync(policyPath), "policy init should write .ripple/policy.json");
  assertIncludes(initPolicy, "Ripple policy written", "policy init");
  assertIncludes(initPolicy, "Default mode: file", "policy init");

  const duplicateInit = runCliResult(["policy", "init"]);
  assert.strictEqual(duplicateInit.status, 1, "policy init should refuse overwrite");
  assertIncludes(duplicateInit.stderr, "already exists", "duplicate policy init");

  const forcedInit = runCli(["policy", "init", "--force"]);
  assertIncludes(forcedInit, "Ripple policy overwritten", "policy init --force");

  writeFile(
    ".ripple/policy.json",
    JSON.stringify(
      {
        protocol: "ripple-policy",
        version: 1,
        defaultMode: "brainstorm",
        riskRules: [
          {
            paths: ["src/util.ts"],
            risk: "critical",
            requireHumanBeforeEdit: true,
          },
        ],
      },
      null,
      2
    )
  );

  const policyPlan = runCli([
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "change trim behavior",
    "--agent",
    "--save",
  ]);
  assertIncludes(policyPlan, "control_mode: brainstorm", "policy-backed plan");
  assertIncludes(policyPlan, "human_gate: required-before-edit", "policy-backed plan");
  assertIncludes(policyPlan, "boundary_risk: critical", "policy-backed plan");
  assertIncludes(policyPlan, "policy_source: .ripple/policy.json", "policy-backed plan");
  assertIncludes(policyPlan, "policy_explanation:", "policy-backed plan");
  assertIncludes(policyPlan, "effective_mode: brainstorm", "policy-backed plan");
  assertIncludes(policyPlan, "policy_risk: critical", "policy-backed plan");
  assertIncludes(policyPlan, "human_required: true", "policy-backed plan");
  assertIncludes(policyPlan, "policy_matches:", "policy-backed plan");
  assertIncludes(policyPlan, "riskRules[0] paths=src/util.ts risk=critical", "policy-backed plan");
  assertIncludes(policyPlan, "editable_files:\n- none", "policy-backed plan");

  const policyPlanJson = runCliJson([
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "change trim behavior",
  ]);
  assert.strictEqual(
    policyPlanJson.policyExplanation.protocol,
    "ripple-policy-explanation",
    "plan --json should expose policyExplanation"
  );
  assert.strictEqual(policyPlanJson.policyExplanation.targetFile, "src/util.ts");
  assert.strictEqual(policyPlanJson.policyExplanation.policySource, ".ripple/policy.json");
  assert.strictEqual(policyPlanJson.policyExplanation.effectiveMode, "brainstorm");
  assert.strictEqual(policyPlanJson.policyExplanation.policyRisk, "critical");
  assert.strictEqual(policyPlanJson.policyExplanation.humanGate, "required-before-edit");
  assert.strictEqual(policyPlanJson.policyExplanation.humanRequired, true);
  assert.deepStrictEqual(
    policyPlanJson.policyExplanation.matchedRules,
    ["riskRules[0] paths=src/util.ts risk=critical"]
  );

  const policyExplain = runCli(["policy", "explain", "--file", "src/util.ts", "--agent"]);
  assert(policyExplain.startsWith("RIPPLE_POLICY_EXPLAIN"));
  assertIncludes(policyExplain, "target: src/util.ts", "policy explain");
  assertIncludes(policyExplain, "policy_source: .ripple/policy.json", "policy explain");
  assertIncludes(policyExplain, "policy_exists: true", "policy explain");
  assertIncludes(policyExplain, "effective_mode: brainstorm", "policy explain");
  assertIncludes(policyExplain, "policy_risk: critical", "policy explain");
  assertIncludes(policyExplain, "human_gate: required-before-edit", "policy explain");
  assertIncludes(policyExplain, "human_required: true", "policy explain");
  assertIncludes(policyExplain, "matched_rules:", "policy explain");
  assertIncludes(policyExplain, "- riskRules[0] paths=src/util.ts risk=critical", "policy explain");
  assertIncludes(policyExplain, "Ask the human to approve before the agent edits this file.", "policy explain");

  const policyExplainJson = runCliJson(["policy", "explain", "--file", "src/other.ts"]);
  assert.strictEqual(policyExplainJson.protocol, "ripple-policy-explanation");
  assert.strictEqual(policyExplainJson.targetFile, "src/other.ts");
  assert.strictEqual(policyExplainJson.policySource, ".ripple/policy.json");
  assert.strictEqual(policyExplainJson.effectiveMode, "brainstorm");
  assert.strictEqual(policyExplainJson.policyRisk, "none");
  assert.deepStrictEqual(policyExplainJson.matchedRules, []);
  assert(
    policyExplainJson.nextSteps.some((step) => step.includes("riskRules")),
    "unmatched policy explain should suggest adding a path rule"
  );

  const explicitModePlan = runCliJson([
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "change trim behavior",
    "--mode",
    "file",
    "--save",
  ]);
  assert.strictEqual(
    explicitModePlan.changeIntent.controlMode,
    "file",
    "--mode should override policy defaultMode"
  );
  assert.strictEqual(
    explicitModePlan.policyExplanation.effectiveMode,
    "file",
    "plan --json policyExplanation should reflect the requested control boundary"
  );
  assert.strictEqual(
    explicitModePlan.changeIntent.policyExplanation.effectiveMode,
    "file",
    "saved intent should carry the same policy explanation snapshot"
  );
  assert.strictEqual(explicitModePlan.changeIntent.policyExplanation.policyRisk, "critical");
  assert.strictEqual(
    explicitModePlan.changeIntent.policyExplanation.humanGate,
    "required-before-edit"
  );
  assert(
    explicitModePlan.policyExplanation.why.some((reason) =>
      reason.includes("Requested control mode overrides policy default: file.")
    ),
    "plan --json policyExplanation should explain explicit mode overrides"
  );
  assert.strictEqual(
    explicitModePlan.changeIntent.boundaryRisk,
    "critical",
    "matching policy risk should still apply when --mode overrides defaultMode"
  );
  assert.strictEqual(
    explicitModePlan.changeIntent.policySource,
    ".ripple/policy.json",
    "saved intent should expose policy source"
  );
  assert.deepStrictEqual(
    explicitModePlan.changeIntent.policyMatches,
    ["riskRules[0] paths=src/util.ts risk=critical"],
    "saved intent should expose matched policy rules"
  );

  writeFile(
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
    ].join("\n")
  );
  execFileSync("git", ["add", "src/util.ts"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });

  const auditBeforeApproval = runCliJson(["audit", "--intent", "latest"]);
  assert.strictEqual(
    auditBeforeApproval.status,
    "human-review-required",
    "audit should block a human-gated plan before approval is recorded"
  );
  assert.strictEqual(auditBeforeApproval.approvalStatus.status, "missing");
  assert.strictEqual(auditBeforeApproval.approvalStatus.required, true);
  assert.strictEqual(auditBeforeApproval.approvalStatus.approved, false);
  assert(
    auditBeforeApproval.blockingReasons.some((reason) =>
      reason.includes("Human approval missing")
    ),
    "audit should explain missing human approval"
  );
  const approvalStatusBefore = runCliJson(["approval", "--intent", "latest"]);
  assert.strictEqual(approvalStatusBefore.protocol, "ripple-approval-status");
  assert.strictEqual(approvalStatusBefore.status, "missing");
  assert.strictEqual(approvalStatusBefore.intent.targetFile, "src/util.ts");
  assert.strictEqual(approvalStatusBefore.required, true);
  assert.strictEqual(approvalStatusBefore.approved, false);

  const approval = runCliJson([
    "approve",
    "--intent",
    "latest",
    "--gate",
    "before-risky-edit",
    "--approved-by",
    "Ripple Tester",
    "--reason",
    "reviewed plan and target file",
  ]);
  assert.strictEqual(approval.protocol, "ripple-approval");
  assert.strictEqual(approval.gate, "before-risky-edit");
  assert.strictEqual(approval.intentId, explicitModePlan.changeIntent.id);
  assert.strictEqual(approval.approvedBy, "Ripple Tester");
  assert.strictEqual(approval.reason, "reviewed plan and target file");

  const approvalStatusAgent = runCli(["approval", "--intent", "latest", "--agent"]);
  assert(approvalStatusAgent.startsWith("RIPPLE_APPROVAL_STATUS"));
  assertIncludes(approvalStatusAgent, "status: approved", "approval status agent");
  assertIncludes(approvalStatusAgent, "approved: true", "approval status agent");
  assertIncludes(approvalStatusAgent, "approved_by: Ripple Tester", "approval status agent");

  const approvalStatusAfter = runCliJson(["approval", "--intent", "latest"]);
  assert.strictEqual(approvalStatusAfter.status, "approved");
  assert.strictEqual(approvalStatusAfter.approved, true);
  assert.strictEqual(approvalStatusAfter.approval.approvedBy, "Ripple Tester");

  const auditAfterApproval = runCliJson(["audit", "--intent", "latest"]);
  assert.strictEqual(
    auditAfterApproval.status,
    "pass",
    "audit should pass when the planned human gate has an approval and drift checks pass"
  );
  assert.strictEqual(auditAfterApproval.approvalStatus.status, "approved");
  assert.strictEqual(auditAfterApproval.approvalStatus.approved, true);
  assert.strictEqual(auditAfterApproval.canProceed, true);

  const approvedCi = runCliJson(["ci", "--base", "HEAD", "--intent", "latest"]);
  assert.strictEqual(approvedCi.protocol, "ripple-audit");
  assert.strictEqual(approvedCi.status, "pass");
  assert.strictEqual(approvedCi.approvalStatus.status, "approved");

  console.log("Ripple CLI policy tests passed");
}

main();
