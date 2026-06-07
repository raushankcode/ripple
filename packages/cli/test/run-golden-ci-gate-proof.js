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
  `golden-ci-gate-proof-${Date.now()}`,
);

function writeFile(relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function runCli(args, env = {}) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCliJson(args, env = {}) {
  const output = runCli([...args, "--json"], env);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Expected JSON for ripple ${args.join(" ")}:\n${output}`);
  }
}

function parseJsonOutput(result, args) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Expected JSON for ripple ${args.join(" ")}:\n${result.stdout}`);
  }
}

function runCliResult(args, env = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGit(args) {
  execFileSync("git", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function commitBaseline(message) {
  runGit(["add", "."]);
  runGit([
    "-c",
    "user.email=ripple@test.local",
    "-c",
    "user.name=Ripple Test",
    "commit",
    "-m",
    message,
  ]);
}

function setupFixture() {
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  writeFile(
    "package.json",
    JSON.stringify({ name: "ripple-ci-gate-proof" }, null, 2),
  );
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
  commitBaseline("baseline");
}

function createSavedPlan() {
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
}

function changeInsidePlan() {
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
    ].join("\n"),
  );
}

function addUnplannedFile() {
  writeFile(
    "src/other.ts",
    [
      "export function other(): string {",
      "  return 'outside plan';",
      "}",
      "",
    ].join("\n"),
  );
}

function assertSummaryHasGate(summaryPath, expected) {
  const summary = fs.readFileSync(summaryPath, "utf8");
  assert(summary.includes("## Ripple architecture gate"));
  assert(
    summary.includes(`Gate status: ${expected.status}`),
    `summary should include Gate status: ${expected.status}\n\n${summary}`,
  );
  assert(
    summary.includes(`Gate decision: ${expected.decision}`),
    `summary should include Gate decision: ${expected.decision}\n\n${summary}`,
  );
  assert(
    summary.includes(`Can continue: ${expected.canContinue}`),
    `summary should include Can continue: ${expected.canContinue}\n\n${summary}`,
  );
  assert(summary.includes("### Gate handoff"));
  assert(summary.includes("#### Gate commands"));
  return summary;
}

function assertFullContextBundleAbsent(label) {
  [
    path.join(workspaceRoot, ".ripple", ".cache", "context.json"),
    path.join(workspaceRoot, ".ripple", ".cache", "context.files.json"),
    path.join(workspaceRoot, ".ripple", ".cache", "context.symbols.json"),
    path.join(workspaceRoot, ".ripple", "WORKFLOW.md"),
    path.join(workspaceRoot, ".ripple", ".cache", "focus"),
  ].forEach((generatedPath) => {
    assert(
      !fs.existsSync(generatedPath),
      `${label} should not generate ${path.relative(workspaceRoot, generatedPath)}`,
    );
  });
}

function proveMatchedCiGateOpens() {
  const summaryPath = path.join(workspaceRoot, "matched-ci-summary.md");
  const result = runCliResult(["ci", "--base", "HEAD", "--intent", "latest"], {
    GITHUB_STEP_SUMMARY: summaryPath,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert(result.stdout.includes("Ripple audit"));
  assert(result.stdout.includes("Gate:"));
  assert(result.stdout.includes("  status: open"));
  assert(result.stdout.includes("  decision: continue"));

  const json = runCliJson(["ci", "--base", "HEAD", "--intent", "latest"]);
  assert.strictEqual(json.protocol, "ripple-audit");
  assert.strictEqual(json.status, "pass");
  assert.strictEqual(json.gate.protocol, "ripple-gate");
  assert.strictEqual(json.gate.status, "open");
  assert.strictEqual(json.gate.decision, "continue");
  assert.strictEqual(json.gate.canContinue, true);
  assert.strictEqual(json.gate.mustStop, false);
  assert.strictEqual(json.gate.needsHuman, false);

  const summary = assertSummaryHasGate(summaryPath, {
    status: "open",
    decision: "continue",
    canContinue: true,
  });
  assert(summary.includes("Audit status: pass"));
  assert(summary.includes("Next required phase: done"));
  assertFullContextBundleAbsent("matched CI gate");
}

function proveDriftedCiGateCloses() {
  addUnplannedFile();
  const summaryPath = path.join(workspaceRoot, "drift-ci-summary.md");
  const result = runCliResult(
    ["ci", "--base", "HEAD", "--intent", "latest", "--github-annotations"],
    {
      GITHUB_STEP_SUMMARY: summaryPath,
    },
  );
  assert.strictEqual(result.status, 1, "drifted CI gate should fail");
  assert(result.stdout.includes("Ripple audit"));
  assert(result.stdout.includes("Gate:"));
  assert(result.stdout.includes("  status: closed"));
  assert(result.stdout.includes("  decision: repair"));
  assert(result.stdout.includes("::error"));
  assert(
    result.stdout.includes("title=Ripple gate closed"),
    "CI annotations should use gate language",
  );
  assert(
    result.stdout.includes("Unplanned file changed: src/other.ts"),
    "CI annotations should name the drifted file",
  );

  const jsonResult = runCliResult([
    "ci",
    "--base",
    "HEAD",
    "--intent",
    "latest",
    "--json",
  ]);
  assert.strictEqual(jsonResult.status, 1, "closed CI gate JSON should fail CI");
  const json = parseJsonOutput(jsonResult, [
    "ci",
    "--base",
    "HEAD",
    "--intent",
    "latest",
  ]);
  assert.strictEqual(json.gate.protocol, "ripple-gate");
  assert.strictEqual(json.gate.status, "closed");
  assert.strictEqual(json.gate.decision, "repair");
  assert.strictEqual(json.gate.canContinue, false);
  assert.strictEqual(json.gate.mustStop, true);
  assert.strictEqual(json.gate.needsHuman, false);
  assert.strictEqual(json.gate.nextRequiredPhase, "repair_or_handoff");
  assert(
    json.gate.commands.repair.includes("ripple repair --agent --intent latest"),
    "closed CI gate should tell the agent how to repair",
  );

  const summary = assertSummaryHasGate(summaryPath, {
    status: "closed",
    decision: "repair",
    canContinue: false,
  });
  assert(summary.includes("Audit status: repair-required"));
  assert(summary.includes("Unplanned file changed: src/other.ts"));
  assert(summary.includes("ripple repair --agent --intent latest"));
  assertFullContextBundleAbsent("drifted CI gate");
}

function main() {
  setupFixture();
  createSavedPlan();
  assertFullContextBundleAbsent("saved CI plan");
  commitBaseline("saved ripple intent");
  changeInsidePlan();
  proveMatchedCiGateOpens();
  proveDriftedCiGateCloses();

  console.log("Ripple golden CI gate proof passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("Matched CI gate: open / continue");
  console.log("Drifted CI gate: closed / repair");
}

main();
