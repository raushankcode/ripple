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
  `golden-gitignore-hygiene-proof-${Date.now()}`
);

function writeFile(relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");
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
    JSON.stringify({ name: "ripple-gitignore-hygiene-proof" }, null, 2)
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

  runGit(["init"]);
}

function proveMissingGitignoreIsNotReady() {
  const doctor = runCliJson(["doctor"]);
  assert.strictEqual(doctor.status, "needs_setup");
  assert.strictEqual(doctor.checks.gitIgnore.ok, false);
  assert(
    doctor.checks.gitIgnore.detail.includes("Missing .gitignore entry"),
    "doctor should explain missing Ripple cache gitignore hygiene"
  );
  assert(
    doctor.enforcement.gaps.some((gap) => gap.includes(".ripple/.cache/")),
    "doctor should include Ripple cache hygiene in readiness gaps"
  );
}

function proveInitMergesCacheIgnoreWithoutOverwritingUserRules() {
  writeFile(".gitignore", ["node_modules/", "dist/", ""].join("\n"));

  const init = runCliJson(["init"]);
  const gitignore = init.files.find((file) => file.path === ".gitignore");
  assert(gitignore, "ripple init should report .gitignore");
  assert.strictEqual(gitignore.status, "updated");
  assert.strictEqual(gitignore.written, true);
  assert.strictEqual(gitignore.overwritten, false);

  const contents = readFile(".gitignore");
  assert(contents.includes("node_modules/"), "init should keep existing user ignore rules");
  assert(contents.includes("dist/"), "init should keep existing build ignore rules");
  assert(contents.includes(".ripple/.cache/"), "init should add the Ripple cache ignore rule");
  assert.strictEqual(init.readiness.checks.gitIgnore.ok, true);
}

function proveSafeCacheIgnoreIsReady() {
  writeFile(".gitignore", [".ripple/.cache/**", ""].join("\n"));

  const doctor = runCliJson(["doctor"]);
  assert.strictEqual(doctor.checks.gitIgnore.ok, true);
  assert(
    doctor.checks.gitIgnore.detail.includes("audit files remain commit-able"),
    "safe cache-only ignore should keep Ripple audit files commit-able"
  );
}

function saveReadyIntent() {
  writeFile(".gitignore", [".ripple/.cache/", ""].join("\n"));
  runCliJson([
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "normalize display name whitespace",
    "--mode",
    "file",
    "--save",
  ]);
}

function proveOverbroadRippleIgnoreClosesGate() {
  saveReadyIntent();

  writeFile(".gitignore", [".ripple/", ".ripple/.cache/", ""].join("\n"));
  runGit(["add", ".gitignore"]);

  const doctor = runCliJson(["doctor"]);
  assert.strictEqual(doctor.checks.gitIgnore.ok, false);
  assert(
    doctor.checks.gitIgnore.detail.includes("Overbroad .ripple/ ignore"),
    "doctor should reject broad .ripple/ ignores"
  );

  const gate = runCliJson(["gate", "--intent", "latest"]);
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.status, "closed");
  assert.strictEqual(gate.decision, "restore-readiness");
  assert.strictEqual(gate.canContinue, false);
  assert.strictEqual(gate.mustStop, true);
  assert(
    gate.why.some((reason) => reason.includes("gitIgnoreOk")),
    "gate should explain that gitIgnoreOk readiness became weaker"
  );
  assert(
    gate.fixNow.some((fix) => fix.includes(".ripple/.cache/")),
    "gate should tell the agent to restore the cache-only ignore rule"
  );
  assert(
    gate.commands.doctor.includes("ripple doctor --agent --strict"),
    "gate should point the agent at doctor for readiness repair"
  );
}

function main() {
  setupFixture();
  proveMissingGitignoreIsNotReady();
  proveInitMergesCacheIgnoreWithoutOverwritingUserRules();
  proveSafeCacheIgnoreIsReady();
  proveOverbroadRippleIgnoreClosesGate();

  console.log("Ripple golden gitignore hygiene proof passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("Safe: .ripple/.cache/");
  console.log("Blocked: .ripple/");
}

main();
