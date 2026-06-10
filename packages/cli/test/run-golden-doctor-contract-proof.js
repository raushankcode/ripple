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
  `golden-doctor-contract-proof-${Date.now()}`
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
    JSON.stringify({ name: "ripple-doctor-contract-proof" }, null, 2)
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
      "      - run: ripple ci --base origin/main --github-annotations",
      "",
    ].join("\n")
  );
  writeFile(".gitignore", [".ripple/.cache/", ""].join("\n"));

  runGit(["init"]);
}

function assertContractHeader(output, expected) {
  const lines = output.trimEnd().split(/\r?\n/);
  assert.deepStrictEqual(
    lines.slice(0, expected.length),
    expected,
    `doctor --agent contract header changed:\n${output}`
  );
}

function assertAgentSectionContains(output, section, expectedItem) {
  assert(
    output.includes(`${section}:\n- ${expectedItem}`),
    `Expected ${section} to include ${expectedItem}:\n${output}`
  );
}

function assertAgentSectionNone(output, section) {
  assert(
    output.includes(`${section}:\n- none`),
    `Expected ${section} to be empty:\n${output}`
  );
}

function proveDoctorIsReadyBeforeSavedIntent() {
  const doctor = runCliJson(["doctor"]);
  assert.strictEqual(doctor.status, "ready");
  assert.strictEqual(doctor.decision, "continue");
  assert.strictEqual(doctor.canContinue, true);
  assert.strictEqual(doctor.mustStop, false);
  assert.strictEqual(
    doctor.nextRequiredAction,
    "Continue with the saved-intent workflow and keep the Ripple CI gate enabled."
  );
  assert.deepStrictEqual(doctor.fixNow, []);
  assert.strictEqual(doctor.checks.latestIntent.ok, false);
  assert(
    doctor.why.some((reason) => reason.includes("detect drift, and fail CI")),
    "doctor JSON should explain policy-audit readiness"
  );

  const agent = runCli(["doctor", "--agent"]);
  assertContractHeader(agent, [
    "RIPPLE_DOCTOR",
    "status: ready",
    "decision: continue",
    "can_continue: true",
    "must_stop: false",
    "next_required_action: Continue with the saved-intent workflow and keep the Ripple CI gate enabled.",
  ]);
  assertAgentSectionContains(
    agent,
    "why",
    "Ripple can guide agents, detect drift, and fail CI when the saved intent or boundary is violated."
  );
  assertAgentSectionNone(agent, "fix_now");
}

function saveIntent() {
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
  assert.strictEqual(plan.changeIntent.readinessSnapshot.status, "ready");
  assert.strictEqual(plan.changeIntent.readinessSnapshot.canBlockInCi, true);
}

function proveDoctorAllowsAfterSavedIntent() {
  const doctor = runCliJson(["doctor"]);
  assert.strictEqual(doctor.status, "ready");
  assert.strictEqual(doctor.decision, "continue");
  assert.strictEqual(doctor.canContinue, true);
  assert.strictEqual(doctor.mustStop, false);
  assert.strictEqual(
    doctor.nextRequiredAction,
    "Continue with the saved-intent workflow and keep the Ripple CI gate enabled."
  );
  assert.deepStrictEqual(doctor.fixNow, []);
  assert(
    doctor.why.some((reason) => reason.includes("detect drift, and fail CI")),
    "ready doctor JSON should explain CI gate readiness"
  );

  const agent = runCli(["doctor", "--agent"]);
  assertContractHeader(agent, [
    "RIPPLE_DOCTOR",
    "status: ready",
    "decision: continue",
    "can_continue: true",
    "must_stop: false",
    "next_required_action: Continue with the saved-intent workflow and keep the Ripple CI gate enabled.",
  ]);
  assertAgentSectionContains(
    agent,
    "why",
    "Ripple can guide agents, detect drift, and fail CI when the saved intent or boundary is violated."
  );
  assertAgentSectionNone(agent, "fix_now");
}

function main() {
  setupFixture();
  proveDoctorIsReadyBeforeSavedIntent();
  saveIntent();
  proveDoctorAllowsAfterSavedIntent();

  console.log("Ripple golden doctor contract proof passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("Before saved intent: ready / can_continue");
  console.log("After saved intent: continue / can_continue");
}

main();
