const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createRippleMcpToolHost } = require("../dist");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-mcp-gitignore-hygiene-proof-${Date.now()}`
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
  });
}

async function callMcpTool(tool, args = {}) {
  const host = createRippleMcpToolHost({ workspaceRoot });
  try {
    const result = await host.callTool(tool, args);
    assert.strictEqual(result.tool, tool);
    return result.data;
  } finally {
    host.dispose();
  }
}

function setupFixture() {
  writeFile(
    "package.json",
    JSON.stringify({ name: "ripple-mcp-gitignore-hygiene-proof" }, null, 2)
  );
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
  writeFile(
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
    ].join("\n")
  );
  writeFile(
    ".ripple/policy.json",
    JSON.stringify(
      {
        protocol: "ripple-policy",
        version: 1,
        defaultMode: "file",
        riskRules: [],
      },
      null,
      2
    )
  );
  writeFile(".gitignore", [".ripple/.cache/", ""].join("\n"));

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

async function saveReadyIntentThroughMcp() {
  const plan = await callMcpTool("ripple_plan_context", {
    task: "normalize display name whitespace",
    filePath: "src/util.ts",
    tokenBudget: 2600,
    mode: "file",
    saveIntent: true,
  });

  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.targetFile, "src/util.ts");
  assert.strictEqual(plan.changeIntent.readinessSnapshot.status, "ready");
  assert.strictEqual(plan.changeIntent.readinessSnapshot.gitIgnoreOk, true);
  assert.strictEqual(plan.changeIntent.readinessSnapshot.canBlockInCi, true);
}

async function proveMcpDoctorSeesBroadRippleIgnore() {
  const doctor = await callMcpTool("ripple_doctor");

  assert.strictEqual(doctor.status, "needs_setup");
  assert.strictEqual(doctor.checks.gitIgnore.ok, false);
  assert(
    doctor.checks.gitIgnore.detail.includes("Overbroad .ripple/ ignore"),
    "MCP doctor should reject broad .ripple/ ignores"
  );
  assert(
    doctor.enforcement.gaps.some((gap) => gap.includes(".ripple/.cache/")),
    "MCP doctor should include Ripple cache hygiene in readiness gaps"
  );
}

async function proveMcpGateClosesForGitignoreReadinessDrift() {
  const gate = await callMcpTool("ripple_gate", {
    tokenBudget: 2600,
    intentPath: "latest",
  });

  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.status, "closed");
  assert.strictEqual(gate.decision, "restore-readiness");
  assert.strictEqual(gate.canContinue, false);
  assert.strictEqual(gate.mustStop, true);
  assert.strictEqual(gate.needsHuman, true);
  assert(
    gate.why.some((reason) => reason.includes("gitIgnoreOk")),
    "MCP gate should explain that gitIgnoreOk readiness became weaker"
  );
  assert(
    gate.fixNow.some((fix) => fix.includes(".ripple/.cache/")),
    "MCP gate should tell the agent to restore the cache-only ignore rule"
  );
  assert(
    gate.commands.doctor.includes("ripple doctor --agent --strict"),
    "MCP gate should point the agent at doctor for readiness repair"
  );
}

async function main() {
  setupFixture();
  await saveReadyIntentThroughMcp();

  writeFile(".gitignore", [".ripple/", ".ripple/.cache/", ""].join("\n"));
  runGit(["add", ".gitignore"]);

  await proveMcpDoctorSeesBroadRippleIgnore();
  await proveMcpGateClosesForGitignoreReadinessDrift();

  console.log("Ripple golden MCP gitignore hygiene proof passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("Safe: .ripple/.cache/");
  console.log("MCP gate blocked: .ripple/");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
