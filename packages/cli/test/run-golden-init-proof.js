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
  `golden-init-proof-${Date.now()}`,
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

function runGit(args) {
  execFileSync("git", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function setupFixture() {
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  writeFile(
    "package.json",
    JSON.stringify({ name: "ripple-golden-init-proof" }, null, 2),
  );
  writeFile(
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  return value.trim();",
      "}",
      "",
    ].join("\n"),
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
    ].join("\n"),
  );

  runGit(["init"]);
}

function proveInitCreatesAgentControlSetup() {
  const summary = runCliJson(["init"]);
  assert.strictEqual(summary.protocol, "ripple-init");
  assert.strictEqual(summary.version, 1);
  assert.strictEqual(summary.workspace, workspaceRoot);
  assert(
    summary.files.some(
      (file) =>
        file.path === ".ripple/policy.json" &&
        file.status === "written" &&
        file.written === true,
    ),
    "ripple init should write the trust policy",
  );
  assert(
    summary.files.some(
      (file) =>
        file.path === ".github/workflows/ripple.yml" &&
        file.status === "written" &&
        file.written === true,
    ),
    "ripple init should write the CI gate workflow",
  );
  assert(
    fs.existsSync(path.join(workspaceRoot, ".ripple", "policy.json")),
    "policy file should exist after ripple init",
  );
  assert(
    fs.existsSync(path.join(workspaceRoot, ".github", "workflows", "ripple.yml")),
    "CI workflow should exist after ripple init",
  );
  assert.strictEqual(summary.readiness.checks.graph.ok, true);
  assert.strictEqual(summary.readiness.checks.git.ok, true);
  assert.strictEqual(summary.readiness.checks.ciWorkflow.ok, true);
  assert.strictEqual(summary.readiness.enforcement.explicitPolicy.ok, true);
  assert.strictEqual(summary.readiness.checks.latestIntent.ok, false);
  assert.strictEqual(summary.readiness.enforcement.canBlockInCi, false);
  assert(
    summary.nextSteps.some((step) => step.includes("ripple plan --file")),
    "ripple init should tell the user to save the first intent next",
  );
}

function proveInitIsSafeToRepeat() {
  const repeated = runCliJson(["init"]);
  assert(
    repeated.files.every(
      (file) =>
        file.status === "exists" &&
        file.written === false &&
        file.overwritten === false,
    ),
    "ripple init should leave existing setup files alone",
  );

  const forced = runCliJson(["init", "--force"]);
  assert(
    forced.files.every(
      (file) =>
        file.status === "overwritten" &&
        file.written === true &&
        file.overwritten === true,
    ),
    "ripple init --force should overwrite existing setup files",
  );
}

function proveSavedPlanMakesRepoCiGateReady() {
  const plan = runCliJson([
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "normalize display name whitespace",
    "--mode",
    "file",
    "--save",
  ]);
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.targetFile, "src/util.ts");
  assert.strictEqual(plan.changeIntent.controlMode, "file");
  assert.strictEqual(plan.changeIntent.policyExplanation.policyExists, true);
  assert.strictEqual(plan.changeIntent.readinessSnapshot.canDetectDrift, true);
  assert.strictEqual(plan.changeIntent.readinessSnapshot.canBlockInCi, true);

  const doctor = runCliJson(["doctor"]);
  assert.strictEqual(doctor.status, "ready");
  assert.strictEqual(doctor.checks.latestIntent.ok, true);
  assert.strictEqual(doctor.enforcement.level, "ci-gate-ready");
  assert.strictEqual(doctor.enforcement.canGuideAgents, true);
  assert.strictEqual(doctor.enforcement.canDetectDrift, true);
  assert.strictEqual(doctor.enforcement.canBlockInCi, true);
  assert.strictEqual(doctor.enforcement.explicitPolicy.ok, true);

  const gate = runCliJson(["gate", "--intent", "latest"]);
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.status, "open");
  assert.strictEqual(gate.decision, "continue");
  assert.strictEqual(gate.canContinue, true);
  assert.strictEqual(gate.mustStop, false);
}

function main() {
  setupFixture();
  proveInitCreatesAgentControlSetup();
  proveInitIsSafeToRepeat();
  proveSavedPlanMakesRepoCiGateReady();

  console.log("Ripple golden init proof passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("First run: ripple init");
  console.log("After saved plan: ci-gate-ready");
}

main();
