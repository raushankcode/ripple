const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const cliPackage = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "packages", "cli", "package.json"), "utf8")
);
const cliPackageSpec = `@getripple/cli@${cliPackage.version}`;
const COMMAND_TIMEOUT_MS = 30000;
const traceCommands = process.env.RIPPLE_TEST_TRACE === "1";
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `cli-regression-${Date.now()}`
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

function runCli(args, extraEnv = {}) {
  if (traceCommands) {
    console.error(`ripple ${args.join(" ")}`);
  }
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
  });
}

function runCliIn(root, args, extraEnv = {}) {
  if (traceCommands) {
    console.error(`${root}> ripple ${args.join(" ")}`);
  }
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
  });
}

function runCliResult(args, extraEnv = {}) {
  if (traceCommands) {
    console.error(`ripple ${args.join(" ")}`);
  }
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
  });
}

function runGitIn(root, args) {
  if (traceCommands) {
    console.error(`${root}> git ${args.join(" ")}`);
  }
  execFileSync("git", args, {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
  });
}

function runGitResultIn(root, args, extraEnv = {}) {
  if (traceCommands) {
    console.error(`${root}> git ${args.join(" ")}`);
  }
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
  });
}

function stageFixtureFiles() {
  if (traceCommands) {
    console.error("git init");
  }
  execFileSync("git", ["init"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (traceCommands) {
    console.error("git add src/util.ts README.md");
  }
  execFileSync("git", ["add", "src/util.ts", "README.md"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
  });
}

function runCliJson(args, extraEnv = {}) {
  const output = runCli([...args, "--json"], extraEnv);
  try {
    return JSON.parse(output);
  } catch (err) {
    throw new Error(`Expected JSON for ripple ${args.join(" ")}:\n${output}`);
  }
}

function runCliJsonIn(root, args, extraEnv = {}) {
  const output = runCliIn(root, [...args, "--json"], extraEnv);
  try {
    return JSON.parse(output);
  } catch (err) {
    throw new Error(`Expected JSON for ripple ${args.join(" ")}:\n${output}`);
  }
}

function setupFixture() {
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  writeFile("package.json", JSON.stringify({ name: "cli-regression-fixture" }, null, 2));
  writeFile("README.md", "# Fixture\n");
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
      "export function trimsInput(): string {",
      "  return trimName(' Ada ');",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "tests/index.spec.ts",
    [
      "import { label } from '../src/index';",
      "",
      "export function labelsInput(): string {",
      "  return label('Ada');",
      "}",
      "",
    ].join("\n")
  );
}

function writeFakeNpxForLocalRipple(root) {
  const fakeBin = path.join(root, ".ripple-test-bin");
  fs.mkdirSync(fakeBin, { recursive: true });
  const fakeRipplePath = path.join(fakeBin, "ripple");
  const fakeNpxPath = path.join(fakeBin, "npx");
  const shellCliPath = cliPath.split(path.sep).join("/");
  fs.writeFileSync(
    fakeRipplePath,
    [
      "#!/bin/sh",
      `exec node ${JSON.stringify(shellCliPath)} "$@"`,
      "",
    ].join("\n"),
    "utf8"
  );
  fs.chmodSync(fakeRipplePath, 0o755);
  fs.writeFileSync(
    fakeNpxPath,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"-y\" ]; then shift; fi",
      "case \"$1\" in @getripple/cli*) shift ;; esac",
      `exec node ${JSON.stringify(shellCliPath)} "$@"`,
      "",
    ].join("\n"),
    "utf8"
  );
  fs.chmodSync(fakeNpxPath, 0o755);
  if (process.platform === "win32") {
    const fakeRippleCmdPath = path.join(fakeBin, "ripple.cmd");
    const fakeNpxCmdPath = path.join(fakeBin, "npx.cmd");
    fs.writeFileSync(
      fakeRippleCmdPath,
      [
        "@echo off",
        `node "${cliPath}" %*`,
        "",
      ].join("\r\n"),
      "utf8"
    );
    fs.writeFileSync(
      fakeNpxCmdPath,
      [
        "@echo off",
        "if \"%1\"==\"-y\" shift",
        "echo %1 | findstr /b \"@getripple/cli\" >nul",
        "if not errorlevel 1 shift",
        `node "${cliPath}" %*`,
        "",
      ].join("\r\n"),
      "utf8"
    );
  }
  return fakeBin;
}

function setupInitFixture() {
  const root = path.join(
    repoRoot,
    "test",
    ".tmp",
    `cli-init-${Date.now()}`
  );
  writeFileIn(root, "package.json", JSON.stringify({ name: "cli-init-fixture" }, null, 2));
  writeFileIn(
    root,
    "src/util.ts",
    [
      "export function trimName(value) {",
      "  return value.trim();",
      "}",
      "",
    ].join("\n")
  );
  runGitIn(root, ["init"]);
  return root;
}


function setupHistoryScanFixture() {
  const root = path.join(
    repoRoot,
    "test",
    ".tmp",
    `cli-history-scan-${Date.now()}`
  );
  writeFileIn(root, "package.json", JSON.stringify({ name: "cli-history-scan-fixture" }, null, 2));
  writeFileIn(
    root,
    "src/history.ts",
    [
      "export function historyProbe(): string {",
      "  return 'before';",
      "}",
      "",
    ].join("\n")
  );
  runGitIn(root, ["init"]);
  runGitIn(root, ["add", "."]);
  runGitIn(root, [
    "-c",
    "user.email=ripple@test.local",
    "-c",
    "user.name=Ripple Test",
    "commit",
    "-m",
    "baseline",
  ]);
  return root;
}

function proveCachedScanRecordsHistory() {
  const root = setupHistoryScanFixture();

  runCliIn(root, ["init"]);
  runCliIn(root, ["scan", "."]);

  writeFileIn(
    root,
    "src/history.ts",
    [
      "export function historyProbe(): string {",
      "  return 'after';",
      "}",
      "",
    ].join("\n")
  );

  runCliIn(root, ["scan", "."]);

  const historyPath = path.join(root, ".ripple", "history.json");
  const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  assert(
    history.some((event) =>
      event.type === "symbol_modified" &&
      String(event.source).endsWith("src/history.ts::historyProbe")
    ),
    "cached scan should record symbol_modified in .ripple/history.json"
  );
}

function assertFileListed(items, expectedFile, label) {
  assert(
    items.some((item) => item.file === expectedFile),
    `${label} should include ${expectedFile}`
  );
}

function main() {
  setupFixture();
  proveCachedScanRecordsHistory();

  const help = runCli(["--help"]);
  assert(help.includes("ripple init [--force] [--json]"), "help should show init command");
  assert(help.includes("ripple doctor"), "help should show doctor command");
  assert(help.includes("ripple workflow"), "help should show workflow command");
  assert(help.includes("ripple check --staged"), "help should show check --staged");
  assert(help.includes("ripple check --worktree"), "help should show check --worktree");
  assert(help.includes("ripple check --changed --base <ref>"), "help should show changed mode");
  assert(help.includes("ripple repair"), "help should show repair command");
  assert(help.includes("ripple audit"), "help should show audit command");
  assert(help.includes("ripple approval"), "help should show approval status command");
  assert(help.includes("ripple approve"), "help should show approve command");
  assert(help.includes("ripple ci"), "help should show ci command");
  assert(help.includes("ripple init-ci"), "help should show init-ci command");
  assert(help.includes("--strict"), "help should show strict mode");
  assert(help.includes("--base REF"), "help should show base ref option");
  assert(help.includes("--print"), "help should show print option");
  assert(help.includes("--force"), "help should show force option");
  assert(help.includes("--mode MODE"), "help should show control mode option");
  assert(help.includes("--symbol NAME"), "help should show symbol boundary option");
  assert(help.includes("ripple agent"), "help should show agent command");
  assert(help.includes("ripple agent --json"), "help should show agent JSON command");
  assert(help.includes("--agent"), "help should show --agent");
  assert(
    help.includes("ripple plan --file src/auth.ts"),
    "help should show agent plan example"
  );
  assert(
    help.includes("--mode function"),
    "help should show function-mode boundary example"
  );
  assert(
    help.includes("ripple check --staged --agent --intent latest"),
    "help should show staged agent example with saved intent"
  );
  assert(
    help.includes("ripple audit --agent --intent latest"),
    "help should show audit agent example with saved intent"
  );
  assert(
    help.includes("ripple gate --agent --intent latest"),
    "help should show gate agent example with saved intent"
  );
  assert(
    help.includes("ripple approval --intent latest --agent"),
    "help should show approval status agent example with saved intent"
  );
  assert(
    help.includes("ripple approve --intent latest --gate before-risky-edit"),
    "help should show approval example with saved intent"
  );
  assert(
    help.includes("ripple repair --agent --intent latest"),
    "help should show repair agent example with saved intent"
  );
  assert(
    help.includes("ripple check --staged --intent latest --strict"),
    "help should show strict CI example"
  );
  assert(
    help.includes("ripple check --changed --base origin/main --strict"),
    "help should show changed CI example"
  );
  assert(
    help.includes("ripple ci --base origin/main --github-annotations"),
    "help should show ci command example"
  );
  assert(help.includes("ripple init"), "help should show init example");
  assert(help.includes("ripple workflow"), "help should show workflow example");
  assert(help.includes("ripple init-ci"), "help should show init-ci example");
  assert(help.includes("ripple hook install"), "help should show hook install example");

  const initWorkspace = setupInitFixture();
  const printedInit = runCliIn(initWorkspace, ["init", "--print"]);
  assert(printedInit.includes("# .ripple/policy.json"), "init --print should show policy path");
  assert(
    printedInit.includes("# .github/workflows/ripple.yml"),
    "init --print should show workflow path"
  );
  assert(printedInit.includes("# .gitignore"), "init --print should show gitignore path");
  assert(printedInit.includes("# .cursorrules"), "init --print should show the default agent setup target");
  assert(!printedInit.includes("# AGENTS.md"), "init --print should not spam every agent setup file when none exist");
  assert(printedInit.includes("# .git hooks"), "init --print should show hook setup scripts");
  assert(
    printedInit.includes(".ripple/.cache/"),
    "init --print should include the Ripple cache gitignore entry"
  );
  const printedInitJson = runCliJsonIn(initWorkspace, ["init", "--print"]);
  assert.strictEqual(printedInitJson.protocol, "ripple-init");
  assert.strictEqual(printedInitJson.files.length, 3);
  assert.strictEqual(printedInitJson.agentSetup.files.length, 1);
  assert.strictEqual(printedInitJson.agentSetup.files[0].path, ".cursorrules");
  assert.strictEqual(printedInitJson.hooks.status, "printed");
  assert(
    printedInitJson.files.every((file) => file.status === "printed" && file.written === false),
    "init --print --json should not write setup files"
  );

  const initJson = runCliJsonIn(initWorkspace, ["init"]);
  assert.strictEqual(initJson.protocol, "ripple-init");
  assert.strictEqual(initJson.files.length, 3);
  assert.strictEqual(initJson.agentSetup.files.length, 1, "init should include only the selected agent setup file result");
  assert.strictEqual(initJson.agentSetup.files[0].path, ".cursorrules", "init should default to .cursorrules when no agent files exist");
  assert.strictEqual(initJson.hooks.preCommitAction, "created", "init should install the pre-commit hook");
  assert.strictEqual(initJson.hooks.postCommitAction, "created", "init should install the post-commit hook");
  assert(
    initJson.files.some((file) => file.path === ".ripple/policy.json" && file.status === "written"),
    "init should write policy file"
  );
  assert(
    initJson.files.some((file) => file.path === ".github/workflows/ripple.yml" && file.status === "written"),
    "init should write CI workflow"
  );
  assert(
    initJson.files.some((file) => file.path === ".gitignore" && file.status === "written"),
    "init should write gitignore hygiene when .gitignore is missing"
  );
  assert(
    fs.existsSync(path.join(initWorkspace, ".ripple", "policy.json")),
    "init should create .ripple/policy.json"
  );
  assert(
    fs.existsSync(path.join(initWorkspace, ".github", "workflows", "ripple.yml")),
    "init should create .github/workflows/ripple.yml"
  );
  assert(
    fs.readFileSync(path.join(initWorkspace, ".gitignore"), "utf8").includes(".ripple/.cache/"),
    "init should add .ripple/.cache/ to .gitignore"
  );
  assert(!fs.existsSync(path.join(initWorkspace, "AGENTS.md")), "init should not create AGENTS.md when no agent files exist");
  assert(!fs.existsSync(path.join(initWorkspace, "CLAUDE.md")), "init should not create CLAUDE.md when no agent files exist");
  assert(fs.existsSync(path.join(initWorkspace, ".cursorrules")), "init should create only the default .cursorrules agent setup file");
  const defaultCursorRules = fs.readFileSync(path.join(initWorkspace, ".cursorrules"), "utf8");
  assert(defaultCursorRules.includes("# RIPPLE AGENT PROTOCOL"), "init should write dense Ripple agent instructions");
  assert(!defaultCursorRules.includes("MCP server config"), "init should keep injected agent rules token-dense");
  assert(fs.existsSync(path.join(initWorkspace, ".git", "hooks", "pre-commit")), "init should install pre-commit hook");
  assert(fs.existsSync(path.join(initWorkspace, ".git", "hooks", "post-commit")), "init should install post-commit hook");
  assert.strictEqual(initJson.readiness.checks.ciWorkflow.ok, true);
  assert.strictEqual(initJson.readiness.checks.gitIgnore.ok, true);
  assert.strictEqual(initJson.readiness.enforcement.explicitPolicy.ok, true);
  assert.strictEqual(initJson.readiness.checks.latestIntent.ok, false);
  assert(
    initJson.nextSteps.some((step) => step.includes("ripple ci --base origin/main --github-annotations")),
    "init should tell the user to run the policy-audit CI command next"
  );

  const cleanPolicySync = runCliJsonIn(initWorkspace, ["policy", "sync"]);
  assert.strictEqual(cleanPolicySync.protocol, "ripple-policy-sync");
  assert.strictEqual(
    cleanPolicySync.status,
    "up-to-date",
    "policy sync should pass when the committed policy matches current smart detections"
  );
  assert.strictEqual(cleanPolicySync.missingRules.length, 0);

  runGitIn(initWorkspace, ["add", "."]);
  runGitIn(initWorkspace, [
    "-c",
    "user.email=ripple@test.local",
    "-c",
    "user.name=Ripple Test",
    "commit",
    "-m",
    "init baseline",
  ]);

  writeFileIn(initWorkspace, "prisma/schema.prisma", "datasource db { provider = \"postgresql\" url = env(\"DATABASE_URL\") }\n");
  const packageJsonPath = path.join(initWorkspace, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  packageJson.dependencies = { ...(packageJson.dependencies || {}), prisma: "latest" };
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  const stalePolicySync = runCliJsonIn(initWorkspace, ["policy", "sync"]);
  assert.strictEqual(
    stalePolicySync.status,
    "update-available",
    "policy sync should detect new risky repo surfaces missing from policy"
  );
  assert(
    stalePolicySync.missingRules.some((rule) => rule.paths.includes("prisma/schema.prisma") && rule.risk === "critical"),
    "policy sync should suggest the missing Prisma critical rule"
  );
  assert(
    stalePolicySync.nextSteps.some((step) => step.includes("Review the suggested missing rules")),
    "policy sync should tell humans to review before changing policy"
  );

  const staleDoctorJson = runCliJsonIn(initWorkspace, ["doctor"]);
  assert.strictEqual(
    staleDoctorJson.policySync.status,
    "update-available",
    "doctor JSON should surface policy rot"
  );
  assert(
    staleDoctorJson.policySync.missingRules.some((rule) => rule.paths.includes("prisma/schema.prisma")),
    "doctor JSON should include missing policy coverage"
  );
  const staleDoctorText = runCliIn(initWorkspace, ["doctor"]);
  assert(staleDoctorText.includes("Policy sync:"), "doctor text should show policy sync status");
  assert(staleDoctorText.includes("update-available"), "doctor text should warn about policy rot");
  const staleDoctorAgent = runCliIn(initWorkspace, ["doctor", "--agent"]);
  assert(
    staleDoctorAgent.includes("policy_sync: update-available"),
    "doctor --agent should expose policy sync status"
  );

  const stalePolicyCiSummaryPath = path.join(initWorkspace, "policy-sync-ci-summary.md");
  const stalePolicyCi = runCliIn(initWorkspace, ["ci", "--base", "HEAD", "--github-annotations"], {
    GITHUB_STEP_SUMMARY: stalePolicyCiSummaryPath,
  });
  assert(stalePolicyCi.includes("Ripple CI policy audit"), "CI should still run policy-audit mode");
  assert(stalePolicyCi.includes("Policy sync: update-available"), "CI audit should surface policy rot");
  assert(
    stalePolicyCi.includes("::warning title=Ripple policy rot::"),
    "CI audit should annotate stale policy without failing"
  );
  const stalePolicyCiSummary = fs.readFileSync(stalePolicyCiSummaryPath, "utf8");
  assert(
    stalePolicyCiSummary.includes("### Policy sync") && stalePolicyCiSummary.includes("update-available"),
    "CI step summary should include policy sync status"
  );

  const duplicateInitJson = runCliJsonIn(initWorkspace, ["init"]);
  assert(
    duplicateInitJson.files.every((file) => file.status === "exists" && file.written === false),
    "init should be idempotent when setup files already exist"
  );
  assert(
    duplicateInitJson.agentSetup.files.every((file) => file.status === "exists" && file.written === false),
    "init should not overwrite existing agent setup files by default"
  );
  assert.strictEqual(
    duplicateInitJson.hooks.preCommitAction,
    "already-present",
    "init should not duplicate the pre-commit Ripple block"
  );
  assert.strictEqual(
    duplicateInitJson.hooks.postCommitAction,
    "already-present",
    "init should not duplicate the post-commit Ripple block"
  );

  const existingAgentWorkspace = setupInitFixture();
  writeFileIn(existingAgentWorkspace, "AGENTS.md", "# Team Agent Rules\n\nUse pnpm.\nDo not edit migrations without approval.");
  const existingAgentInitJson = runCliJsonIn(existingAgentWorkspace, ["init"]);
  const existingAgentSummary = existingAgentInitJson.agentSetup.files.find((file) => file.path === "AGENTS.md");
  assert.strictEqual(
    existingAgentSummary.status,
    "appended",
    "init should append Ripple rules into an existing AGENTS.md instead of skipping it"
  );
  const existingAgentContents = fs.readFileSync(path.join(existingAgentWorkspace, "AGENTS.md"), "utf8");
  assert(
    existingAgentContents.includes("Use pnpm."),
    "init should preserve existing AGENTS.md content"
  );
  assert(
    existingAgentContents.includes("<!-- RIPPLE:START -->") &&
      existingAgentContents.includes("<!-- RIPPLE:END -->"),
    "init should add a managed Ripple section to existing AGENTS.md"
  );
  assert(
    existingAgentContents.includes("ripple_plan_context"),
    "init should add Ripple MCP workflow rules to existing AGENTS.md"
  );
  assert(
    existingAgentContents.trimEnd().endsWith("<!-- RIPPLE:END -->"),
    "init should append Ripple rules at the bottom for LLM recency"
  );
  assert(
    !fs.existsSync(path.join(existingAgentWorkspace, "CLAUDE.md")) &&
      !fs.existsSync(path.join(existingAgentWorkspace, ".cursorrules")),
    "init should update existing agent files without creating extra root prompt files"
  );

  const secondExistingAgentInitJson = runCliJsonIn(existingAgentWorkspace, ["init"]);
  const secondExistingAgentSummary = secondExistingAgentInitJson.agentSetup.files.find((file) => file.path === "AGENTS.md");
  assert.strictEqual(
    secondExistingAgentSummary.status,
    "exists",
    "init should not duplicate the managed Ripple section in existing AGENTS.md"
  );
  const secondExistingAgentContents = fs.readFileSync(path.join(existingAgentWorkspace, "AGENTS.md"), "utf8");
  assert.strictEqual(
    (secondExistingAgentContents.match(/<!-- RIPPLE:START -->/g) || []).length,
    1,
    "init should keep exactly one Ripple managed section"
  );

  const staleAgentWorkspace = setupInitFixture();
  writeFileIn(
    staleAgentWorkspace,
    "CLAUDE.md",
    [
      "# Team Claude Rules",
      "",
      "Keep responses short.",
      "",
      "<!-- RIPPLE:START -->",
      "old ripple instructions",
      "<!-- RIPPLE:END -->",
      "",
    ].join("\n")
  );
  const staleAgentInitJson = runCliJsonIn(staleAgentWorkspace, ["init"]);
  const staleAgentSummary = staleAgentInitJson.agentSetup.files.find((file) => file.path === "CLAUDE.md");
  assert.strictEqual(
    staleAgentSummary.status,
    "updated",
    "init should update only the managed Ripple section when markers already exist"
  );
  const staleAgentContents = fs.readFileSync(path.join(staleAgentWorkspace, "CLAUDE.md"), "utf8");
  assert(staleAgentContents.includes("Keep responses short."), "init should preserve content outside Ripple markers");
  assert(!staleAgentContents.includes("old ripple instructions"), "init should replace stale Ripple marker content");
  assert(staleAgentContents.includes("ripple_plan_context"), "init should refresh Ripple marker content");
  assert(
    staleAgentContents.trimEnd().endsWith("<!-- RIPPLE:END -->"),
    "init should move refreshed Ripple marker content to the bottom"
  );

  const forcedInitJson = runCliJsonIn(initWorkspace, ["init", "--force"]);
  assert(
    forcedInitJson.files
      .filter((file) => file.path !== ".gitignore")
      .every((file) => file.status === "overwritten" && file.overwritten === true),
    "init --force should overwrite policy and CI setup files"
  );
  assert(
    forcedInitJson.files.some((file) => file.path === ".gitignore" && file.status === "exists"),
    "init --force should not overwrite an existing .gitignore"
  );
  assert(
    forcedInitJson.agentSetup.files.every((file) => file.status === "overwritten" && file.overwritten === true),
    "init --force should overwrite generated agent setup files"
  );

  const printedWorkflow = runCli(["init-ci", "--print"]);
  assert(printedWorkflow.includes("name: Ripple"), "init-ci --print should print workflow name");
  assert(
    printedWorkflow.includes("fetch-depth: 0"),
    "init-ci --print should include full git history checkout"
  );
  assert(
    printedWorkflow.includes(
      `npx -y ${cliPackageSpec} ci --base origin/\${{ github.base_ref }} --github-annotations`
    ),
    "init-ci --print should include the pinned policy-audit annotated Ripple CI command"
  );

  const printedHook = runCli(["hook", "install", "--print"]);
  assert(
    printedHook.includes("ripple_run gate --staged --intent latest --agent --strict"),
    "hook install --print should include active-intent gate command through the local runner"
  );
  assert(
    printedHook.includes("ripple_run check --staged --agent"),
    "hook install --print should include no-intent staged awareness command through the local runner"
  );
  assert(
    printedHook.includes(`npx -y ${cliPackageSpec} "$@"`),
    "hook install --print should pin the npx fallback to the current CLI version"
  );
  assert(
    printedHook.includes('./node_modules/.bin/ripple'),
    "hook install --print should prefer a repo-local Ripple binary before npx"
  );
  assert(
    printedHook.includes("git commit --no-verify"),
    "hook install --print should include the human escape hatch"
  );
  assert(
    printedHook.includes("--- ripple-post-commit ---"),
    "hook install --print should include the post-commit hook separator"
  );
  assert(
    printedHook.includes("Consumed and cleared local intent"),
    "hook install --print should include ghost-intent cleanup behavior"
  );

  const printedHookJson = runCliJson(["hook", "install", "--print"]);
  assert.strictEqual(printedHookJson.protocol, "ripple-hook-install");
  assert.strictEqual(printedHookJson.path, ".git/hooks/pre-commit");
  assert.strictEqual(printedHookJson.written, false);
  assert(
    printedHookJson.content.includes("[RIPPLE STOP]"),
    "hook install --print --json should expose agent-readable stop output"
  );
  assert.strictEqual(
    printedHookJson.postCommitPath,
    ".git/hooks/post-commit",
    "hook install --print --json should expose the post-commit hook path"
  );
  assert(
    printedHookJson.postCommitContent.includes("Consumed and cleared local intent"),
    "hook install --print --json should expose ghost-intent cleanup output"
  );

  const printedWorkflowJson = runCliJson(["init-ci", "--print"]);
  assert.strictEqual(
    printedWorkflowJson.path,
    ".github/workflows/ripple.yml",
    "init-ci --print --json should expose workflow path"
  );
  assert.strictEqual(printedWorkflowJson.written, false, "init-ci --print --json should not write");
  assert(
    printedWorkflowJson.workflow.includes("pull_request:"),
    "init-ci --print --json should expose workflow contents"
  );

  const initCi = runCli(["init-ci"]);
  const workflowPath = path.join(workspaceRoot, ".github", "workflows", "ripple.yml");
  assert(fs.existsSync(workflowPath), "init-ci should write the GitHub Actions workflow");
  assert(
    initCi.includes("Ripple CI workflow written"),
    "init-ci should confirm workflow creation"
  );
  assert(
    fs.readFileSync(workflowPath, "utf8").includes("pull_request:"),
    "init-ci should write a pull request workflow"
  );

  const hookWorkspace = setupInitFixture();
  const hookInstall = runCliIn(hookWorkspace, ["hook", "install"]);
  const preCommitHookPath = path.join(hookWorkspace, ".git", "hooks", "pre-commit");
  const postCommitHookPath = path.join(hookWorkspace, ".git", "hooks", "post-commit");
  assert(fs.existsSync(preCommitHookPath), "hook install should write .git/hooks/pre-commit");
  assert(fs.existsSync(postCommitHookPath), "hook install should write .git/hooks/post-commit");
  assert(
    hookInstall.includes("Ripple Git hooks integrated"),
    "hook install should confirm Git hook installation"
  );
  assert(
    fs.readFileSync(preCommitHookPath, "utf8").includes("[RIPPLE STOP]"),
    "hook install should write agent-readable stop instructions"
  );
  assert(
    fs.readFileSync(postCommitHookPath, "utf8").includes("Consumed and cleared local intent"),
    "hook install should write post-commit ghost-intent cleanup"
  );

  assert(
    fs.readFileSync(preCommitHookPath, "utf8").includes(">>> ripple pre-commit hook"),
    "hook install should write an idempotent pre-commit marker"
  );
  assert(
    fs.readFileSync(postCommitHookPath, "utf8").includes(">>> ripple post-commit hook"),
    "hook install should write an idempotent post-commit marker"
  );

  const hookInstallAgainJson = JSON.parse(runCliIn(hookWorkspace, ["hook", "install", "--json"]));
  assert.strictEqual(
    hookInstallAgainJson.preCommitAction,
    "already-present",
    "hook install should not duplicate an existing Ripple pre-commit block"
  );
  assert.strictEqual(
    hookInstallAgainJson.postCommitAction,
    "already-present",
    "hook install should not duplicate an existing Ripple post-commit block"
  );

  const hookBlockWorkspace = setupInitFixture();
  writeFileIn(
    hookBlockWorkspace,
    "src/util.ts",
    [
      "export function trimName(value) {",
      "  return value.trim();",
      "}",
      "",
      "export function shout(value) {",
      "  return value.toUpperCase();",
      "}",
      "",
    ].join("\n")
  );
  runGitIn(hookBlockWorkspace, ["add", "."]);
  runGitIn(hookBlockWorkspace, [
    "-c",
    "user.email=ripple@test.local",
    "-c",
    "user.name=Ripple Test",
    "commit",
    "-m",
    "baseline",
  ]);
  runCliIn(hookBlockWorkspace, ["hook", "install"]);
  runCliJsonIn(hookBlockWorkspace, [
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "tighten trim behavior only",
    "--mode",
    "function",
    "--symbol",
    "trimName",
    "--save",
  ]);
  writeFileIn(
    hookBlockWorkspace,
    "src/util.ts",
    [
      "export function trimName(value) {",
      "  return value.trim().replace(/\\s+/g, ' ');",
      "}",
      "",
      "export function shout(value) {",
      "  return value.trim().toUpperCase();",
      "}",
      "",
    ].join("\n")
  );
  runGitIn(hookBlockWorkspace, ["add", "src/util.ts"]);
  const fakeNpxPath = writeFakeNpxForLocalRipple(hookBlockWorkspace);
  const hookEnv = { PATH: `${fakeNpxPath}${path.delimiter}${process.env.PATH ?? ""}` };
  const blockedHookCommit = runGitResultIn(
    hookBlockWorkspace,
    [
      "-c",
      "user.email=ripple@test.local",
      "-c",
      "user.name=Ripple Test",
      "commit",
      "-m",
      "agent crossed boundary",
    ],
    hookEnv
  );
  assert.notStrictEqual(blockedHookCommit.status, 0, "pre-commit hook should block crossed function boundary");
  const blockedHookOutput = `${blockedHookCommit.stdout}\n${blockedHookCommit.stderr}`;
  assert(
    blockedHookOutput.includes("[RIPPLE STOP]"),
    "blocked pre-commit hook should print the Ripple stop banner"
  );
  assert(
    blockedHookOutput.includes("src/util.ts::shout"),
    "blocked pre-commit hook should name the changed outside-boundary symbol"
  );

  writeFileIn(
    hookBlockWorkspace,
    "src/util.ts",
    [
      "export function trimName(value) {",
      "  return value.trim().replace(/\\s+/g, ' ');",
      "}",
      "",
      "export function shout(value) {",
      "  return value.toUpperCase();",
      "}",
      "",
    ].join("\n")
  );
  runGitIn(hookBlockWorkspace, ["add", "src/util.ts"]);
  const allowedHookCommit = runGitResultIn(
    hookBlockWorkspace,
    [
      "-c",
      "user.email=ripple@test.local",
      "-c",
      "user.name=Ripple Test",
      "commit",
      "-m",
      "agent stayed inside boundary",
    ],
    hookEnv
  );
  assert.strictEqual(
    allowedHookCommit.status,
    0,
    `pre-commit hook should allow repaired in-boundary change:\n${allowedHookCommit.stdout}\n${allowedHookCommit.stderr}`
  );
  assert.strictEqual(
    fs.existsSync(path.join(hookBlockWorkspace, ".ripple", "intents", "latest.json")),
    false,
    "post-commit hook should clear the consumed local intent after a successful commit"
  );

  const existingHookWorkspace = setupInitFixture();
  const existingPreCommitPath = path.join(existingHookWorkspace, ".git", "hooks", "pre-commit");
  writeFileIn(
    existingHookWorkspace,
    ".git/hooks/pre-commit",
    [
      "#!/bin/sh",
      "echo existing lint hook",
      "",
    ].join("\n")
  );
  const existingHookInstallJson = JSON.parse(runCliIn(existingHookWorkspace, ["hook", "install", "--json"]));
  assert.strictEqual(
    existingHookInstallJson.preCommitAction,
    "appended",
    "hook install should append to an existing .git pre-commit hook"
  );
  const existingPreCommit = fs.readFileSync(existingPreCommitPath, "utf8");
  assert(
    existingPreCommit.includes("echo existing lint hook"),
    "hook install should preserve existing .git pre-commit contents"
  );
  assert(
    existingPreCommit.includes(">>> ripple pre-commit hook"),
    "hook install should append the Ripple pre-commit block to existing hooks"
  );
  assert(
    existingPreCommit.includes("ripple_previous_status=$?"),
    "hook install should preserve previous hook failures before running Ripple"
  );
  assert(
    !existingPreCommit.includes("\r"),
    "hook install should write Ripple hook content with LF line endings"
  );

  const noNewlineHookWorkspace = setupInitFixture();
  const noNewlinePreCommitPath = path.join(noNewlineHookWorkspace, ".git", "hooks", "pre-commit");
  writeFileIn(noNewlineHookWorkspace, ".git/hooks/pre-commit", "#!/bin/sh\nnpm run lint");
  runCliIn(noNewlineHookWorkspace, ["hook", "install"]);
  const noNewlinePreCommit = fs.readFileSync(noNewlinePreCommitPath, "utf8");
  assert(
    noNewlinePreCommit.includes("npm run lint\n\n# >>> ripple pre-commit hook"),
    "hook install should pad appended Ripple blocks with LF newlines"
  );

  const huskyDirectoryWorkspace = setupInitFixture();
  writeFileIn(
    huskyDirectoryWorkspace,
    ".husky/commit-msg",
    [
      "#!/bin/sh",
      "npx commitlint --edit $1",
      "",
    ].join("\n")
  );
  const huskyDirectoryInstallJson = JSON.parse(runCliIn(huskyDirectoryWorkspace, ["hook", "install", "--json"]));
  assert.strictEqual(
    huskyDirectoryInstallJson.path,
    ".husky/pre-commit",
    "hook install should target Husky pre-commit when the .husky directory exists"
  );
  assert.strictEqual(
    huskyDirectoryInstallJson.preCommitAction,
    "created",
    "hook install should create a missing Husky pre-commit hook"
  );
  assert.strictEqual(
    huskyDirectoryInstallJson.postCommitPath,
    ".husky/post-commit",
    "hook install should target Husky post-commit when the .husky directory exists"
  );
  const createdHuskyPreCommit = fs.readFileSync(path.join(huskyDirectoryWorkspace, ".husky", "pre-commit"), "utf8");
  assert(
    createdHuskyPreCommit.startsWith("#!/bin/sh\n"),
    "hook install should create missing Husky hooks with a shell shebang"
  );
  assert(
    !createdHuskyPreCommit.includes("\r"),
    "created Husky hooks should use LF line endings"
  );

  const huskyHookWorkspace = setupInitFixture();
  writeFileIn(
    huskyHookWorkspace,
    ".husky/pre-commit",
    [
      "#!/bin/sh",
      "npm test",
      "",
    ].join("\n")
  );
  const huskyInstallJson = JSON.parse(runCliIn(huskyHookWorkspace, ["hook", "install", "--json"]));
  assert.strictEqual(
    huskyInstallJson.path,
    ".husky/pre-commit",
    "hook install should prefer an existing Husky pre-commit hook"
  );
  assert.strictEqual(
    huskyInstallJson.preCommitAction,
    "appended",
    "hook install should append to an existing Husky pre-commit hook"
  );
  const huskyPreCommit = fs.readFileSync(path.join(huskyHookWorkspace, ".husky", "pre-commit"), "utf8");
  assert(
    huskyPreCommit.includes("npm test"),
    "hook install should preserve existing Husky hook contents"
  );
  assert(
    huskyPreCommit.includes(">>> ripple pre-commit hook"),
    "hook install should append the Ripple block to Husky hooks"
  );

  const duplicateInitCi = runCliResult(["init-ci"]);
  assert.strictEqual(duplicateInitCi.status, 1, "init-ci should refuse to overwrite by default");
  assert(
    duplicateInitCi.stderr.includes("already exists"),
    "init-ci should explain how to handle an existing workflow"
  );

  const forcedInitCi = runCli(["init-ci", "--force"]);
  assert(
    forcedInitCi.includes("Ripple CI workflow overwritten"),
    "init-ci --force should overwrite an existing workflow"
  );

  const doctorNeedsIntent = runCliJson(["doctor"]);
  assert.strictEqual(doctorNeedsIntent.status, "needs_setup", "doctor should still require permanent setup gaps to be fixed");
  assert.strictEqual(doctorNeedsIntent.decision, "setup-required", "doctor should expose setup-required decision");
  assert.strictEqual(doctorNeedsIntent.canContinue, false, "doctor should not allow continuing before setup is ready");
  assert.strictEqual(doctorNeedsIntent.mustStop, true, "doctor should require stop before setup is ready");
  assert(
    doctorNeedsIntent.nextRequiredAction.includes("Stop autonomous agent work"),
    "doctor should expose next required action for agents"
  );
  assert(
    doctorNeedsIntent.fixNow.some((step) => step.includes("initialize git") || step.includes(".ripple/.cache/")),
    "doctor should expose permanent setup fixes through fixNow"
  );
  assert.strictEqual(doctorNeedsIntent.checks.graph.ok, true, "doctor should validate graph scan");
  assert.strictEqual(
    doctorNeedsIntent.checks.ciWorkflow.ok,
    true,
    "doctor should detect the generated CI workflow"
  );
  assert.strictEqual(
    doctorNeedsIntent.checks.latestIntent.ok,
    false,
    "doctor should report missing local intent without making it a permanent setup requirement"
  );
  assert.strictEqual(
    doctorNeedsIntent.enforcement.level,
    "drift-check-ready",
    "doctor should keep drift-check readiness while permanent CI setup gaps remain"
  );
  assert.strictEqual(
    doctorNeedsIntent.enforcement.canBlockInCi,
    false,
    "doctor should not claim CI blocking while permanent setup gaps remain"
  );
  assert(
    !doctorNeedsIntent.enforcement.gaps.some((gap) => gap.includes("No latest saved intent")),
    "doctor should not treat missing local intent as an enforcement gap"
  );
  assert(
    doctorNeedsIntent.nextSteps.some((step) => step.includes("initialize git") || step.includes(".ripple/.cache/")),
    "doctor should explain how to fix permanent setup gaps"
  );
  const doctorNeedsIntentAgent = runCli(["doctor", "--agent"]);
  assert(
    doctorNeedsIntentAgent.startsWith("RIPPLE_DOCTOR"),
    "doctor --agent should have a stable header"
  );
  assert(
    doctorNeedsIntentAgent.includes("decision: setup-required"),
    "doctor --agent should tell agents setup is required"
  );
  assert(
    doctorNeedsIntentAgent.includes("can_continue: false"),
    "doctor --agent should tell agents not to continue before setup is ready"
  );
  assert(
    doctorNeedsIntentAgent.includes("must_stop: true"),
    "doctor --agent should tell agents to stop before setup is ready"
  );
  assert(
    doctorNeedsIntentAgent.includes("next_required_action: Stop autonomous agent work until Ripple readiness gaps are fixed."),
    "doctor --agent should include the next required action"
  );
  assert(
    doctorNeedsIntentAgent.includes("enforcement_level: drift-check-ready"),
    "doctor --agent should expose drift-check-ready enforcement while permanent setup gaps remain"
  );
  assert(
    doctorNeedsIntentAgent.includes("can_block_in_ci: false"),
    "doctor --agent should expose missing CI blocking readiness while permanent setup gaps remain"
  );
  assert(
    doctorNeedsIntentAgent.includes("why:"),
    "doctor --agent should expose readiness reasons"
  );
  assert(
    doctorNeedsIntentAgent.includes("fix_now:"),
    "doctor --agent should expose setup fixes"
  );

  const agentGuide = runCli(["agent"]);
  assert(
    agentGuide.includes("Ripple Agent Workflow"),
    "agent guide should show workflow title"
  );
  assert(agentGuide.includes("Setup readiness:"), "agent guide should show readiness step");
  assert(
    agentGuide.includes("ripple init"),
    "agent guide should show repo initialization command"
  );
  assert(
    agentGuide.includes("ripple doctor --agent --strict"),
    "agent guide should show doctor readiness command"
  );
  assert(
    agentGuide.includes("ripple init-ci"),
    "agent guide should show CI install command"
  );
  assert(agentGuide.includes("Before editing:"), "agent guide should show before editing step");
  assert(
    agentGuide.includes("ripple plan --file <file> --task \"<task>\" --mode file --agent --save"),
    "agent guide should show planning command"
  );
  assert(
    agentGuide.includes("ripple_plan_context first in MCP"),
    "agent guide should explain that MCP planning includes policy explanation"
  );
  assert(
    agentGuide.includes("use planBeforeEditing with --json"),
    "agent guide should explain CLI JSON planning policyExplanation"
  );
  assert(agentGuide.includes("Policy-only check:"), "agent guide should show policy-only section");
  assert(
    agentGuide.includes("ripple policy explain --file <file> --agent"),
    "agent guide should show policy explanation command"
  );
  assert(
    agentGuide.includes("only when you need the repo trust boundary without a plan"),
    "agent guide should explain when to use policy-only checks"
  );
  assert(agentGuide.includes("Policy drift:"), "agent guide should show policy drift section");
  assert(
    agentGuide.includes("policyDrift.status=changed"),
    "agent guide should tell agents how to react to policy drift"
  );
  assert(
    agentGuide.includes("After staging changes:"),
    "agent guide should show staged check step"
  );
  assert(
    agentGuide.includes("ripple check --staged --agent --intent latest"),
    "agent guide should show staged agent check"
  );
  assert(agentGuide.includes("Audit current change:"), "agent guide should show audit section");
  assert(
    agentGuide.includes("ripple audit --agent --intent latest"),
    "agent guide should show audit command"
  );
  assert(
    agentGuide.includes("ripple gate --agent --intent latest"),
    "agent guide should show gate command"
  );
  assert(
    agentGuide.includes("If human gate is required:"),
    "agent guide should show human approval step"
  );
  assert(
    agentGuide.includes("ripple approve --intent latest --gate before-risky-edit"),
    "agent guide should show approval command"
  );
  assert(
    agentGuide.includes("ripple approval --intent latest --agent"),
    "agent guide should show approval status command"
  );
  assert(
    agentGuide.includes("If staged changes drift:"),
    "agent guide should show repair step"
  );
  assert(
    agentGuide.includes("ripple repair --agent --intent latest"),
    "agent guide should show repair command"
  );
  assert(agentGuide.includes("CI gate:"), "agent guide should show CI gate section");
  assert(
    agentGuide.includes("ripple ci --base <ref> --github-annotations"),
    "agent guide should show CI gate command"
  );
  assert(
    agentGuide.includes(
      "choose_boundary -> plan -> approve_if_required -> edit -> stage -> check -> repair_if_needed"
    ),
    "agent guide should show the workflow loop"
  );
  assert(agentGuide.includes("Runtime contract:"), "agent guide should show runtime contract");
  assert(
    agentGuide.includes("plan_before_edit: Create a saved plan"),
    "agent guide should show plan-before-edit runtime phase"
  );
  assert(agentGuide.includes("Stop if:"), "agent guide should show stop conditions");
  assert(
    agentGuide.includes("audit.canProceed is false"),
    "agent guide should show audit stop condition"
  );

  const agentWorkflow = runCliJson(["agent"]);
  assert.strictEqual(
    agentWorkflow.protocol,
    "ripple-agent-workflow",
    "agent JSON should expose the workflow protocol"
  );
  assert.strictEqual(agentWorkflow.version, 1, "agent JSON should expose protocol version");
  assert.deepStrictEqual(
    agentWorkflow.loop,
    [
      "choose_boundary",
      "plan",
      "approve_if_required",
      "edit",
      "stage",
      "check",
      "repair_if_needed",
    ],
    "agent JSON should expose the workflow loop"
  );
  assert.strictEqual(
    agentWorkflow.commands.initializeRepo,
    "ripple init",
    "agent JSON should expose the repo initialization command"
  );
  assert.strictEqual(
    agentWorkflow.commands.checkReadiness,
    "ripple doctor --agent --strict",
    "agent JSON should expose the readiness command"
  );
  assert.strictEqual(
    agentWorkflow.commands.installCi,
    "ripple init-ci",
    "agent JSON should expose the CI install command"
  );
  assert.strictEqual(
    agentWorkflow.commands.explainPolicy,
    "ripple policy explain --file <file> --agent",
    "agent JSON should expose the policy explanation command"
  );
  assert(
    agentWorkflow.policyWorkflow.defaultAgentPath.includes("policyExplanation"),
    "agent JSON should explain planBeforeEditing includes policyExplanation"
  );
  assert(
    agentWorkflow.policyWorkflow.policyOnlyPath.includes("without a plan"),
    "agent JSON should explain when to use explainPolicy"
  );
  assert(
    agentWorkflow.policyWorkflow.policyDriftPath.includes("policyDrift.status=changed"),
    "agent JSON should explain policy drift handling"
  );
  assert.strictEqual(
    agentWorkflow.commands.planBeforeEditing,
    "ripple plan --file <file> --task \"<task>\" --mode file --agent --save",
    "agent JSON should expose the planning command"
  );
  assert.strictEqual(
    agentWorkflow.commands.checkAfterStaging,
    "ripple check --staged --agent --intent latest",
    "agent JSON should expose the staged check command"
  );
  assert.strictEqual(
    agentWorkflow.commands.auditCurrentChange,
    "ripple audit --agent --intent latest",
    "agent JSON should expose the audit command"
  );
  assert.strictEqual(
    agentWorkflow.commands.gateCurrentChange,
    "ripple gate --agent --intent latest",
    "agent JSON should expose the compact gate command"
  );
  assert.strictEqual(
    agentWorkflow.commands.checkApproval,
    "ripple approval --intent latest --agent",
    "agent JSON should expose the approval status command"
  );
  assert.strictEqual(
    agentWorkflow.commands.approveHumanGate,
    "ripple approve --intent latest --gate before-risky-edit",
    "agent JSON should expose the approval command"
  );
  assert.strictEqual(
    agentWorkflow.commands.repairIntentDrift,
    "ripple repair --agent --intent latest",
    "agent JSON should expose the repair command"
  );
  assert.strictEqual(
    agentWorkflow.commands.ciGate,
    "ripple ci --base <ref> --github-annotations",
    "agent JSON should expose the CI gate command"
  );
  assert.strictEqual(
    agentWorkflow.mcpTools.checkReadiness,
    "ripple_doctor",
    "agent JSON should expose the MCP readiness tool"
  );
  assert.strictEqual(
    agentWorkflow.mcpTools.explainPolicy,
    "ripple_explain_policy",
    "agent JSON should expose the MCP policy explanation tool"
  );
  assert.strictEqual(
    agentWorkflow.mcpTools.planBeforeEditing,
    "ripple_plan_context",
    "agent JSON should expose the MCP planning tool"
  );
  assert.strictEqual(
    agentWorkflow.mcpTools.checkAfterStaging,
    "ripple_check_staged",
    "agent JSON should expose the MCP staged check tool"
  );
  assert.strictEqual(
    agentWorkflow.mcpTools.auditCurrentChange,
    "ripple_audit_change",
    "agent JSON should expose the MCP audit tool"
  );
  assert.strictEqual(
    agentWorkflow.mcpTools.gateCurrentChange,
    "ripple_gate",
    "agent JSON should expose the MCP gate tool"
  );
  assert.strictEqual(
    agentWorkflow.mcpTools.checkApproval,
    "ripple_get_approval_status",
    "agent JSON should expose the MCP approval status tool"
  );
  assert.strictEqual(
    agentWorkflow.mcpTools.repairIntentDrift,
    "ripple_repair_intent_drift",
    "agent JSON should expose the MCP repair tool"
  );
  assert.strictEqual(
    agentWorkflow.outputContracts.doctorHeader,
    "RIPPLE_DOCTOR",
    "agent JSON should expose doctor output contract"
  );
  assert(
    agentWorkflow.outputContracts.doctorSections.includes("enforcement_level"),
    "agent JSON should expose doctor enforcement section"
  );
  assert(
    agentWorkflow.outputContracts.doctorSections.includes("can_block_in_ci"),
    "agent JSON should expose doctor CI blocking section"
  );
  assert.strictEqual(
    agentWorkflow.outputContracts.planHeader,
    "RIPPLE_AGENT_CONTEXT",
    "agent JSON should expose plan output contract"
  );
  assert.strictEqual(
    agentWorkflow.outputContracts.stagedCheckHeader,
    "RIPPLE_STAGED_CHECK",
    "agent JSON should expose staged check output contract"
  );
  assert.strictEqual(
    agentWorkflow.outputContracts.repairHeader,
    "RIPPLE_INTENT_DRIFT_REPAIR",
    "agent JSON should expose repair output contract"
  );
  assert.strictEqual(
    agentWorkflow.outputContracts.auditHeader,
    "RIPPLE_AUDIT",
    "agent JSON should expose audit output contract"
  );
  assert.strictEqual(
    agentWorkflow.outputContracts.gateHeader,
    "RIPPLE_GATE",
    "agent JSON should expose gate output contract"
  );
  assert.strictEqual(
    agentWorkflow.outputContracts.approvalHeader,
    "RIPPLE_APPROVAL",
    "agent JSON should expose approval output contract"
  );
  assert.strictEqual(
    agentWorkflow.outputContracts.approvalStatusHeader,
    "RIPPLE_APPROVAL_STATUS",
    "agent JSON should expose approval status output contract"
  );
  assert(
    agentWorkflow.outputContracts.planSections.includes("editable_files"),
    "agent JSON should expose editable_files section"
  );
  assert(
    agentWorkflow.outputContracts.planSections.includes("control_mode"),
    "agent JSON should expose control_mode section"
  );
  assert(
    agentWorkflow.outputContracts.planSections.includes("enforcement_level"),
    "agent JSON should expose plan-time enforcement section"
  );
  assert(
    agentWorkflow.outputContracts.planSections.includes("readiness_gaps"),
    "agent JSON should expose plan-time readiness gaps section"
  );
  assert(
    agentWorkflow.outputContracts.stagedCheckSections.includes("boundary_verdict"),
    "agent JSON should expose boundary_verdict section"
  );
  assert(
    agentWorkflow.outputContracts.stagedCheckSections.includes("next_required_phase"),
    "agent JSON should expose staged check next_required_phase section"
  );
  assert(
    agentWorkflow.outputContracts.stagedCheckSections.includes("policy_drift"),
    "agent JSON should expose policy_drift staged check section"
  );
  assert(
    agentWorkflow.outputContracts.stagedCheckSections.includes("readiness_drift"),
    "agent JSON should expose readiness_drift staged check section"
  );
  assert(
    agentWorkflow.outputContracts.stagedCheckSections.includes("handoff"),
    "agent JSON should expose staged check handoff section"
  );
  assert(
    agentWorkflow.outputContracts.planSections.includes("symbols_first"),
    "agent JSON should expose symbols_first section"
  );
  assert(
    agentWorkflow.rules.some((rule) => rule.includes("read_first")),
    "agent JSON should tell agents to read read_first"
  );
  assert(
    agentWorkflow.rules.some((rule) => rule.includes("policyExplanation")),
    "agent JSON should tell agents to use policyExplanation from planning"
  );
  assert(
    agentWorkflow.rules.some((rule) => rule.includes("policyDrift.status=changed")),
    "agent JSON should tell agents to stop on policy drift"
  );
  assert(
    agentWorkflow.rules.some((rule) => rule.includes("checkReadiness")),
    "agent JSON should tell agents to run readiness checks"
  );
  assert(
    agentWorkflow.rules.some((rule) => rule.includes("initializeRepo")),
    "agent JSON should tell agents to initialize the repo"
  );
  assert(
    agentWorkflow.outputContracts.repairSections.includes("unstage_files"),
    "agent JSON should expose repair sections"
  );
  assert(
    agentWorkflow.outputContracts.repairSections.includes("policy_drift"),
    "agent JSON should expose policy_drift repair section"
  );
  assert(
    agentWorkflow.outputContracts.repairSections.includes("readiness_drift"),
    "agent JSON should expose readiness_drift repair section"
  );
  assert(
    agentWorkflow.outputContracts.repairSections.includes("handoff"),
    "agent JSON should expose repair handoff section"
  );
  assert(
    agentWorkflow.outputContracts.auditSections.includes("can_proceed"),
    "agent JSON should expose audit sections"
  );
  assert(
    agentWorkflow.outputContracts.auditSections.includes("next_required_phase"),
    "agent JSON should expose audit next_required_phase section"
  );
  assert(
    agentWorkflow.outputContracts.auditSections.includes("approval_status"),
    "agent JSON should expose approval status in audit sections"
  );
  assert(
    agentWorkflow.outputContracts.auditSections.includes("readiness_drift"),
    "agent JSON should expose readiness_drift audit section"
  );
  assert(
    agentWorkflow.outputContracts.auditSections.includes("handoff"),
    "agent JSON should expose audit handoff section"
  );
  assert(
    agentWorkflow.outputContracts.gateSections.includes("can_continue"),
    "agent JSON should expose gate continue section"
  );
  assert(
    agentWorkflow.outputContracts.gateSections.includes("commands_approve"),
    "agent JSON should expose gate approval command section"
  );
  assert.strictEqual(
    agentWorkflow.runtimeContract.protocol,
    "ripple-agent-runtime-contract",
    "agent JSON should expose the runtime contract protocol"
  );
  assert(
    agentWorkflow.runtimeContract.invariant.includes("edit only after a saved Ripple plan"),
    "agent JSON should expose the runtime invariant"
  );
  assert(
    agentWorkflow.runtimeContract.compatibleRuntimes.includes("MCP coding agents"),
    "agent JSON should expose compatible runtimes"
  );
  assert(
    agentWorkflow.runtimeContract.sourceOfTruth.some((item) =>
      item.includes("ripple_audit_change")
    ),
    "agent JSON should tell runtimes the post-edit source of truth"
  );
  assert.deepStrictEqual(
    agentWorkflow.runtimeContract.phases.map((phase) => phase.id),
    [
      "discover_contract",
      "plan_before_edit",
      "approval_gate",
      "edit_inside_boundary",
      "audit_after_change",
      "repair_or_handoff",
    ],
    "agent JSON should expose ordered runtime phases"
  );
  assert.strictEqual(
    agentWorkflow.runtimeContract.phases[1].mcpTool,
    "ripple_plan_context",
    "agent runtime contract should map planning to the MCP tool"
  );
  assert.strictEqual(
    agentWorkflow.runtimeContract.phases[2].outputContract,
    "RIPPLE_APPROVAL_STATUS",
    "agent runtime contract should expose approval output contract"
  );
  assert(
    agentWorkflow.runtimeContract.phases[4].stopIf.some((condition) =>
      condition.includes("can_proceed=false")
    ),
    "agent runtime contract should stop when audit cannot proceed"
  );
  assert(
    agentWorkflow.runtimeContract.stopConditions.some((condition) =>
      condition.includes("policyDrift.status=changed")
    ),
    "agent runtime contract should expose policy drift stop condition"
  );
  assert(
    agentWorkflow.runtimeContract.proceedConditions.some((condition) =>
      condition.includes("approvalStatus.approved=true")
    ),
    "agent runtime contract should expose approval proceed condition"
  );
  assert(
    agentWorkflow.rules.some((rule) => rule.includes("auditCurrentChange")),
    "agent JSON should tell agents when to use audit"
  );
  assert(
    agentWorkflow.rules.some((rule) => rule.includes("gateCurrentChange")),
    "agent JSON should tell agents when to use gate"
  );
  assert(
    agentWorkflow.example.includes("ripple init"),
    "agent JSON should include the repo initialization example"
  );
  assert(
    agentWorkflow.example.includes("ripple doctor --agent --strict"),
    "agent JSON should include the doctor example"
  );
  assert(
    agentWorkflow.example.includes("ripple check --staged --agent --intent latest"),
    "agent JSON should include the staged workflow example"
  );
  assert(
    agentWorkflow.example.includes("ripple audit --agent --intent latest"),
    "agent JSON should include the audit workflow example"
  );
  assert(
    agentWorkflow.example.includes("ripple gate --agent --intent latest"),
    "agent JSON should include the gate workflow example"
  );
  assert(
    agentWorkflow.example.includes("ripple approve --intent latest --gate before-risky-edit"),
    "agent JSON should include the approval workflow example"
  );
  assert(
    agentWorkflow.example.includes("ripple approval --intent latest --agent"),
    "agent JSON should include the approval status workflow example"
  );
  assert(
    agentWorkflow.example.includes("ripple repair --agent --intent latest"),
    "agent JSON should include the repair workflow example"
  );
  assert(
    agentWorkflow.example.includes("ripple ci --base origin/main --github-annotations"),
    "agent JSON should include the CI gate example"
  );

  const scan = runCliJson(["scan", "."]);
  assert.strictEqual(scan.files, 4, "scan should find source and test files");
  assert(scan.symbols >= 3, "scan should find tracked symbols");
  assert.strictEqual(scan.contextMode, "lean", "scan should use lean context generation");
  assert(scan.cacheGenerated, "scan should generate the graph cache");
  assert.strictEqual(scan.contextGenerated, false, "scan should not generate the full Ripple context bundle");
  assert(
    fs.existsSync(path.join(workspaceRoot, ".ripple", ".cache", "graph.cache.json")),
    "lean scan should write the graph cache"
  );
  assert(
    !fs.existsSync(path.join(workspaceRoot, ".ripple", "WORKFLOW.md")),
    "lean scan should not write WORKFLOW.md"
  );

  const focus = runCliJson(["focus", "src/util.ts"]);
  assert.strictEqual(focus.projectPath, "src/util.ts");
  assertFileListed(focus.importedBy, "src/index.ts", "focus importedBy");
  assert(
    focus.symbols.some((symbol) => symbol.name === "trimName"),
    "focus should include trimName"
  );
  assert(
    fs.existsSync(path.join(workspaceRoot, focus.focusPath)),
    "focus should write only the requested focus file on demand"
  );
  assert(
    !fs.existsSync(path.join(workspaceRoot, ".ripple", ".cache", "context.json")),
    "focus should not write the full context bundle"
  );
  assert(
    !fs.existsSync(path.join(workspaceRoot, ".ripple", "WORKFLOW.md")),
    "focus should not write WORKFLOW.md"
  );

  const workflow = runCliJson(["workflow"]);
  assert.strictEqual(workflow.protocol, "ripple-workflow");
  assert.strictEqual(workflow.path, ".ripple/WORKFLOW.md");
  assert.strictEqual(workflow.written, true, "workflow should write WORKFLOW.md");
  assert.strictEqual(workflow.contextGenerated, true, "workflow should write the context bundle");
  assert(workflow.focusFileCount >= 1, "workflow should write focus files for file-based agents");
  assert(
    fs.existsSync(path.join(workspaceRoot, ".ripple", "WORKFLOW.md")),
    "workflow should create WORKFLOW.md"
  );
  assert(
    fs.existsSync(path.join(workspaceRoot, ".ripple", ".cache", "context.json")),
    "workflow should create context.json"
  );
  const workflowText = fs.readFileSync(path.join(workspaceRoot, ".ripple", "WORKFLOW.md"), "utf8");
  assert(workflowText.includes("Ripple"), "WORKFLOW.md should identify Ripple");

  const blast = runCliJson(["blast", "src/util.ts"]);
  assert.strictEqual(blast.affectedCount, 2);
  assertFileListed(blast.directImporters, "src/index.ts", "blast radius");

  const imports = runCliJson(["imports", "src/index.ts"]);
  assertFileListed(imports.imports, "src/util.ts", "imports");

  const importers = runCliJson(["importers", "src/util.ts"]);
  assertFileListed(importers.importers, "src/index.ts", "importers");

  const symbols = runCliJson(["symbols", "src/util.ts"]);
  assert(
    symbols.symbols.some((symbol) => symbol.projectSymbolId === "src/util.ts::trimName"),
    "symbols should include src/util.ts::trimName"
  );

  const callers = runCliJson(["callers", "src/util.ts::trimName"]);
  assert(
    callers.callers.some((caller) => caller.projectSymbolId === "src/index.ts::label"),
    "callers should include src/index.ts::label"
  );

  const plan = runCliJson([
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "change trim behavior",
    "--budget",
    "1200",
  ]);
  assert.strictEqual(plan.targetFile, "src/util.ts");
  assert.strictEqual(plan.adapterSupport.primaryAdapter.id, "builtin-js-ts");
  assert.strictEqual(plan.adapterSupport.supportLevel, "deep");
  assert(
    plan.adapterSupport.primaryAdapter.agentPolicy.canTrust.some((item) =>
      item.includes("static imports")
    ),
    "plan JSON should include adapter trust guidance"
  );
  assert(
    plan.adapterSupport.primaryAdapter.capabilityProfile.some(
      (capability) =>
        capability.capability === "call-edges" &&
        capability.status === "partial" &&
        capability.agentUse === "verify"
    ),
    "plan JSON should expose verify-only adapter capabilities"
  );
  assert(
    plan.planningSignals.some((signal) => signal.includes("Adapter ranking")),
    "plan JSON should explain adapter-weighted ranking"
  );
  const plannedFiles = [...plan.readFirst, ...plan.readIfNeeded];
  const targetPlanFile = plan.readFirst.find((item) => item.file === "src/util.ts");
  assert(targetPlanFile, "plan should include target file in readFirst");
  assert.strictEqual(targetPlanFile.role, "target");
  assert(targetPlanFile.signals.includes("target"), "target should include target signal");
  assert(
    targetPlanFile.adapterSignals.some(
      (signal) => signal.capability === "files" && signal.agentUse === "trust"
    ),
    "target plan file should include trusted adapter signal"
  );
  const directTestPlanFile = plannedFiles.find((item) => item.file === "tests/util.test.ts");
  assert(directTestPlanFile, "plan should include direct test file");
  assert.strictEqual(directTestPlanFile.role, "test");
  assert(
    directTestPlanFile.signals.includes("direct-test"),
    "direct test should include direct-test signal"
  );
  assert(
    directTestPlanFile.adapterSignals.some(
      (signal) => signal.capability === "tests" && signal.agentUse === "verify"
    ),
    "direct test should include verify-only adapter signal"
  );
  assert(
    plan.verificationTargets.includes("src/index.ts"),
    "plan should include direct importer as verification target"
  );
  assert(
    plan.verificationTargets.includes("tests/util.test.ts"),
    "plan should include direct test as verification target"
  );
  assert(
    plan.planningSignals.some((signal) => signal.includes("direct test")),
    "plan should explain direct test signal"
  );
  assert(
    plan.doNotReadFirst.some((item) => item.includes("Unrelated tests")),
    "plan should separate unrelated tests from first read"
  );
  const trimSymbolFocus = plan.symbolFocus.find(
    (symbol) => symbol.symbol === "src/util.ts::trimName"
  );
  assert(trimSymbolFocus, "plan should include symbol focus for trimName");
  assert(
    trimSymbolFocus.signals.includes("task-match"),
    "trimName symbol focus should include task-match"
  );
  assert(
    trimSymbolFocus.signals.includes("target-file"),
    "trimName symbol focus should include target-file"
  );

  const savedPlan = runCliJson([
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "change trim behavior",
    "--budget",
    "1200",
    "--save",
  ]);
  assert(savedPlan.changeIntent, "plan --save should return a saved change intent");
  assert.strictEqual(savedPlan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(savedPlan.changeIntent.targetFile, "src/util.ts");
  assert.strictEqual(savedPlan.changeIntent.controlMode, "file");
  assert.strictEqual(savedPlan.changeIntent.humanGate, "none");
  assert.strictEqual(
    savedPlan.changeIntent.policyExplanation.protocol,
    "ripple-policy-explanation",
    "saved change intent should include the policy explanation snapshot"
  );
  assert.strictEqual(savedPlan.changeIntent.policyExplanation.effectiveMode, "file");
  assert.strictEqual(savedPlan.changeIntent.policyExplanation.humanGate, "none");
  assert(savedPlan.changeIntent.readinessSnapshot, "saved change intent should include readiness snapshot");
  assert.strictEqual(
    savedPlan.changeIntent.readinessSnapshot.canDetectDrift,
    true,
    "saved change intent should remember local drift-check readiness"
  );
  assert.strictEqual(
    savedPlan.changeIntent.readinessSnapshot.latestIntentOk,
    true,
    "saved change intent should snapshot latest-intent readiness after saving"
  );
  assert.strictEqual(
    typeof savedPlan.changeIntent.readinessSnapshot.canBlockInCi,
    "boolean",
    "saved change intent should remember CI gate readiness as a boolean"
  );
  assert.deepStrictEqual(savedPlan.changeIntent.allowedSymbols, []);
  assert.deepStrictEqual(
    savedPlan.changeIntent.editableFiles,
    ["src/util.ts"],
    "saved change intent should restrict editable files to the target"
  );
  assert(
    savedPlan.changeIntent.contextFiles.includes("src/index.ts"),
    "saved change intent should keep importers as context-only files"
  );
  assert(
    savedPlan.changeIntent.contextFiles.includes("tests/util.test.ts"),
    "saved change intent should keep tests as context-only files"
  );
  assert.strictEqual(
    fs.existsSync(savedPlan.changeIntentPath),
    true,
    "plan --save should write the change intent file"
  );

  // Keep a CLI-level proof that function mode saves a symbol boundary.
  const functionBoundaryPlan = runCliJson([
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "change trim behavior",
    "--mode",
    "function",
    "--symbol",
    "trimName",
    "--save",
  ]);
  assert.strictEqual(
    functionBoundaryPlan.changeIntent.controlMode,
    "function",
    "plan --mode function should save a function boundary"
  );
  assert.deepStrictEqual(
    functionBoundaryPlan.changeIntent.allowedSymbols,
    ["src/util.ts::trimName"],
    "plan --symbol should normalize allowed symbols to project symbol ids"
  );

  writeFile(
    "src/auth.ts",
    [
      "export function refreshToken(value: string): string {",
      "  return value.trim();",
      "}",
      "",
      "export function login(username: string, password: string): boolean {",
      "  return username.length > 0 && password.length > 0;",
      "}",
      "",
    ].join("\n")
  );
  const riskyFunctionBoundaryPlan = runCliJson([
    "plan",
    "--file",
    "src/auth.ts",
    "--task",
    "normalize refresh token whitespace only",
    "--mode",
    "function",
    "--symbol",
    "refreshToken",
    "--save",
  ]);
  assert.strictEqual(
    riskyFunctionBoundaryPlan.changeIntent.humanGate,
    "required-before-edit",
    "high-risk function boundary should require human approval before edit"
  );
  assert.strictEqual(
    riskyFunctionBoundaryPlan.policyExplanation.humanGate,
    riskyFunctionBoundaryPlan.changeIntent.policyExplanation.humanGate,
    "plan --json top-level policyExplanation must match the saved intent human gate"
  );
  assert.strictEqual(
    riskyFunctionBoundaryPlan.policyExplanation.humanRequired,
    riskyFunctionBoundaryPlan.changeIntent.policyExplanation.humanRequired,
    "plan --json top-level policyExplanation must match saved intent human-required status"
  );
  assert(
    riskyFunctionBoundaryPlan.policyExplanation.nextSteps.some((step) =>
      step.includes("human approval before editing")
    ),
    "plan --json top-level policyExplanation should tell agents to get human approval"
  );
  fs.rmSync(path.join(workspaceRoot, "src", "auth.ts"), { force: true });
  runCliJson([
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "change trim behavior",
    "--budget",
    "1200",
    "--save",
  ]);

  const planText = runCli([
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "change trim behavior",
    "--budget",
    "1200",
  ]);
  assert(planText.includes("Adapter: JavaScript / TypeScript"), "plan text should show adapter");
  assert(planText.includes("Adapter trust:"), "plan text should show adapter trust policy");
  assert(planText.includes("Adapter verify:"), "plan text should show adapter verification policy");
  assert(planText.includes("adapter signals:"), "plan text should show per-file adapter signals");
  assert(planText.includes("[target,"), "plan text should show file role");
  assert(planText.includes("signals:"), "plan text should show ranking signals");
  assert(planText.includes("target"), "plan text should include the target signal");
  assert(planText.includes("Planning signals:"), "plan text should show planning signals");
  assert(planText.includes("Symbol focus:"), "plan text should show symbol focus");
  assert(planText.includes("src/util.ts::trimName"), "plan text should show focused symbol");
  assert(planText.includes("Do not read first:"), "plan text should show skip guidance");

  const agentPlan = runCli([
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "change trim behavior",
    "--budget",
    "1200",
    "--agent",
    "--save",
  ]);
  assert(agentPlan.startsWith("RIPPLE_AGENT_CONTEXT"), "agent plan should have stable header");
  assert(agentPlan.includes("intent_id:"), "agent plan should include saved intent id");
  assert(agentPlan.includes("intent_path:"), "agent plan should include saved intent path");
  assert(agentPlan.includes("task: change trim behavior"), "agent plan should include task");
  assert(agentPlan.includes("target: src/util.ts"), "agent plan should include target");
  assert(agentPlan.includes("risk: caution"), "agent plan should include risk");
  assert(agentPlan.includes("adapter: builtin-js-ts"), "agent plan should include adapter id");
  assert(agentPlan.includes("readiness_status:"), "agent plan should include readiness status");
  assert(agentPlan.includes("enforcement_level:"), "agent plan should include enforcement level");
  assert(agentPlan.includes("can_detect_drift:"), "agent plan should include drift readiness");
  assert(agentPlan.includes("can_block_in_ci:"), "agent plan should include CI gate readiness");
  assert(agentPlan.includes("readiness_gaps:"), "agent plan should include readiness gaps");
  assert(agentPlan.includes("readiness_next_steps:"), "agent plan should include readiness next steps");
  assert(agentPlan.includes("editable_files:"), "agent plan should include editable file scope");
  assert(agentPlan.includes("context_files:"), "agent plan should include context-only file scope");
  assert(agentPlan.includes("adapter_trust:"), "agent plan should include adapter trust");
  assert(agentPlan.includes("adapter_verify:"), "agent plan should include adapter verify guidance");
  assert(
    agentPlan.includes("adapter_manual_fallback:"),
    "agent plan should include adapter manual fallback guidance"
  );
  assert(agentPlan.includes("read_first:"), "agent plan should include read_first");
  assert(agentPlan.includes("- src/util.ts"), "agent plan should include target file");
  assert(agentPlan.includes("- tests/util.test.ts"), "agent plan should include direct test");
  assert(agentPlan.includes("symbols_first:"), "agent plan should include symbols_first");
  assert(
    agentPlan.includes("- src/util.ts::trimName"),
    "agent plan should include focused symbol"
  );
  assert(agentPlan.includes("verify:"), "agent plan should include verification targets");
  assert(
    agentPlan.includes("- tests/util.test.ts"),
    "agent plan should include test verification target"
  );
  assert(agentPlan.includes("avoid_first:"), "agent plan should include avoid_first");
  assert(
    agentPlan.includes("Unrelated tests"),
    "agent plan should include do-not-read-first guidance"
  );

  const history = runCliJson(["history", "--last", "1"]);
  assert(history.returnedGroups >= 1, "history should return at least one group");

  writeFile(".gitignore", ".ripple/.cache/\n");
  stageFixtureFiles();

  const doctorReady = runCliJson(["doctor"]);
  assert.strictEqual(doctorReady.status, "ready", "doctor should pass once setup is complete");
  assert.strictEqual(doctorReady.decision, "continue", "ready doctor should expose continue decision");
  assert.strictEqual(doctorReady.canContinue, true, "ready doctor should allow continuing");
  assert.strictEqual(doctorReady.mustStop, false, "ready doctor should not require stop");
  assert.strictEqual(doctorReady.fixNow.length, 0, "ready doctor should not expose setup fixes");
  assert.strictEqual(doctorReady.checks.git.ok, true, "doctor should detect git worktree");
  assert.strictEqual(doctorReady.checks.gitIgnore.ok, true, "doctor should detect Ripple cache gitignore hygiene");
  assert.strictEqual(doctorReady.checks.latestIntent.ok, true, "doctor should detect latest intent");
  assert.strictEqual(
    doctorReady.enforcement.level,
    "ci-gate-ready",
    "doctor should show CI gate enforcement when setup is complete"
  );
  assert.strictEqual(
    doctorReady.enforcement.canBlockInCi,
    true,
    "doctor should report that Ripple can block in CI"
  );
  assert.strictEqual(
    doctorReady.enforcement.explicitPolicy.ok,
    false,
    "doctor should show when the repo is using built-in policy defaults"
  );
  assert(
    doctorReady.nextSteps.some((step) => step.includes("ripple ci")),
    "ready doctor should suggest running Ripple CI"
  );
  const refreshedReadyPlan = runCliJson([
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "change trim behavior",
    "--budget",
    "1200",
    "--save",
  ]);
  assert.strictEqual(
    refreshedReadyPlan.changeIntent.readinessSnapshot.canBlockInCi,
    true,
    "refreshed saved intent should capture CI-ready enforcement after permanent setup is complete"
  );

  const doctorText = runCli(["doctor"]);
  assert(doctorText.includes("Ripple doctor"), "doctor text should include title");
  assert(doctorText.includes("Status: ready"), "doctor text should include ready status");
  assert(doctorText.includes("Enforcement:"), "doctor text should include enforcement section");
  assert(
    doctorText.includes("level: ci-gate-ready"),
    "doctor text should show enforcement level"
  );
  const doctorReadyAgent = runCli(["doctor", "--agent"]);
  assert(doctorReadyAgent.startsWith("RIPPLE_DOCTOR"), "ready doctor --agent should have header");
  assert(
    doctorReadyAgent.includes("decision: continue"),
    "ready doctor --agent should tell agents they can continue"
  );
  assert(
    doctorReadyAgent.includes("can_continue: true"),
    "ready doctor --agent should expose the continue flag"
  );
  assert(
    doctorReadyAgent.includes("must_stop: false"),
    "ready doctor --agent should expose the stop flag"
  );
  assert(
    doctorReadyAgent.includes("enforcement_level: ci-gate-ready"),
    "ready doctor --agent should expose CI gate readiness"
  );
  assert(
    doctorReadyAgent.includes("can_block_in_ci: true"),
    "ready doctor --agent should expose CI blocking"
  );
  const doctorStrict = runCliResult(["doctor", "--strict"]);
  assert.strictEqual(doctorStrict.status, 0, "doctor --strict should pass when setup is ready");

  const check = runCliJson(["check", "--staged"]);
  assert.strictEqual(check.mode, "staged");
  assert.strictEqual(check.stagedFiles, 1);
  assert.strictEqual(check.checkedFiles, 1);
  assert.strictEqual(check.skippedFiles.length, 1);
  assert.strictEqual(check.adapterSupport.primaryAdapter.id, "builtin-js-ts");
  assertFileListed(check.files, "src/util.ts", "staged check");
  const utilCheckFile = check.files.find((file) => file.file === "src/util.ts");
  assert(utilCheckFile, "staged check should include src/util.ts");
  assert(
    utilCheckFile.adapterSignals.some(
      (signal) => signal.capability === "symbols" && signal.agentUse === "trust"
    ),
    "staged check JSON should include file-level adapter confidence"
  );
  assert(
    check.agentActions.trustedFindings.some((item) =>
      item.includes("src/util.ts::trimName")
    ),
    "staged check JSON should include trusted findings"
  );
  assert(
    check.agentActions.verifyBeforeCommit.some((item) =>
      item.includes("tests/util.test.ts")
    ),
    "staged check JSON should include verify-before-commit actions"
  );
  assert(
    check.agentActions.manualReviewRequired.some((item) =>
      item.includes("src/util.ts::trimName")
    ),
    "staged check JSON should include manual review actions"
  );
  assert(
    utilCheckFile.symbolFocus.includes("src/util.ts::trimName"),
    "staged check JSON should include symbol focus"
  );
  assert(
    utilCheckFile.changedSymbols.some(
      (symbol) => symbol.symbol === "src/util.ts::trimName"
    ),
    "staged check JSON should include changed trimName symbol"
  );
  const trimChangedSymbol = utilCheckFile.changedSymbols.find(
    (symbol) => symbol.symbol === "src/util.ts::trimName"
  );
  assert.strictEqual(
    trimChangedSymbol.changeKind,
    "signature-or-contract",
    "changed trimName should identify declaration/signature changes"
  );
  assert.strictEqual(
    trimChangedSymbol.symbolStatus,
    "created",
    "initial staged fixture should mark trimName as a created staged symbol"
  );
  assert.strictEqual(
    trimChangedSymbol.signatureChanged,
    false,
    "new staged symbol should not claim an old signature changed"
  );
  assert.strictEqual(
    trimChangedSymbol.contractChanged,
    true,
    "new exported staged symbol should introduce a contract"
  );
  assert(
    trimChangedSymbol.contractRisk !== "none",
    "exported changed trimName should carry contract review risk"
  );
  assert(
    trimChangedSymbol.adapterSignals.some(
      (signal) => signal.capability === "symbols" && signal.agentUse === "trust"
    ),
    "changed symbol should include trusted symbol adapter confidence"
  );
  assert(
    check.contractRisks.some((risk) => risk.symbol === "src/util.ts::trimName"),
    "staged check JSON should aggregate contract risk"
  );
  const checkContractRisk = check.contractRisks.find(
    (risk) => risk.symbol === "src/util.ts::trimName"
  );
  assert(checkContractRisk, "staged check should include trimName contract risk details");
  assert(
    checkContractRisk.adapterSignals.some(
      (signal) => signal.capability === "tests" && signal.agentUse === "verify"
    ),
    "contract risk should expose verify-only test confidence"
  );

  const missingIntentStrictCheck = runCliResult(["check", "--staged", "--strict"]);
  assert.strictEqual(
    missingIntentStrictCheck.status,
    1,
    "strict check without intent should fail"
  );
  assert(
    missingIntentStrictCheck.stdout.includes("Ripple staged check"),
    "strict check should still print the staged check summary"
  );
  assert(
    missingIntentStrictCheck.stdout.includes("Adapter: JavaScript / TypeScript"),
    "staged check text should include adapter confidence"
  );
  assert(
    missingIntentStrictCheck.stdout.includes("adapter signals:"),
    "staged check text should include per-file adapter signals"
  );
  assert(
    missingIntentStrictCheck.stdout.includes("Agent actions:"),
    "staged check text should include agent action buckets"
  );
  assert(
    missingIntentStrictCheck.stdout.includes("verify before commit:"),
    "staged check text should include verification action bucket"
  );

  const intentCheck = runCliJson(["check", "--staged", "--intent", "latest"]);
  assert(intentCheck.intentValidation, "staged check should validate saved intent");
  assert.strictEqual(intentCheck.intentValidation.verdict, "matched");
  assert.strictEqual(intentCheck.intentValidation.driftVerdict.status, "pass");
  assert.strictEqual(intentCheck.intentValidation.driftVerdict.decision, "continue");
  assert.strictEqual(intentCheck.intentValidation.nextRequiredPhase, "audit_after_change");
  assert(
    intentCheck.intentValidation.nextRequiredAction.includes("ripple audit"),
    "intent validation JSON should tell agents the next required phase action"
  );
  assert.strictEqual(intentCheck.intentValidation.controlMode, "file");
  assert.strictEqual(intentCheck.intentValidation.boundaryVerdict.status, "pass");
  assert.strictEqual(intentCheck.intentValidation.boundaryVerdict.decision, "continue");
  assert.strictEqual(
    intentCheck.intentValidation.readinessDrift.status,
    "unchanged",
    "intent validation should pass when current readiness matches the saved snapshot"
  );
  assert.strictEqual(
    intentCheck.intentValidation.handoff.protocol,
    "ripple-agent-handoff",
    "intent validation should include the compact handoff object"
  );
  assert.strictEqual(
    intentCheck.intentValidation.handoff.canContinue,
    true,
    "matched staged check should allow the agent to continue to audit"
  );
  assert.strictEqual(
    intentCheck.intentValidation.handoff.decision,
    "audit",
    "matched staged check handoff should point the agent to audit"
  );
  assert(
    intentCheck.intentValidation.handoff.commands.audit.includes("ripple audit --agent --intent latest"),
    "matched staged check handoff should include the audit command"
  );
  assert.deepStrictEqual(intentCheck.intentValidation.allowedFiles, ["src/util.ts"]);
  assert(
    intentCheck.intentValidation.driftVerdict.fix.some((fix) =>
      fix.includes("tests/util.test.ts")
    ),
    "intent validation JSON should expose exact drift fix/verify guidance"
  );
  assert.strictEqual(intentCheck.intentValidation.plannedScope, "matched");
  assert.deepStrictEqual(intentCheck.intentValidation.editableFiles, ["src/util.ts"]);
  assert.strictEqual(intentCheck.intentValidation.contextFilesChanged.length, 0);
  assert.strictEqual(intentCheck.intentValidation.unplannedFiles.length, 0);

  const worktreeRoot = path.join(workspaceRoot, "worktree-gate");
  fs.mkdirSync(worktreeRoot, { recursive: true });
  writeFileIn(worktreeRoot, "package.json", JSON.stringify({ name: "worktree-gate-fixture" }, null, 2));
  writeFileIn(worktreeRoot, "src/util.ts", [
    "export function trimName(value: string): string {",
    "  return value.trim();",
    "}",
    "",
  ].join("\n"));
  writeFileIn(worktreeRoot, "src/other.ts", [
    "export function other(value: string): string {",
    "  return value;",
    "}",
    "",
  ].join("\n"));
  runGitIn(worktreeRoot, ["init"]);
  runGitIn(worktreeRoot, ["add", "."]);
  runGitIn(worktreeRoot, ["commit", "-m", "baseline"]);
  runCliJsonIn(worktreeRoot, [
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "normalize trim behavior",
    "--mode",
    "file",
    "--save",
  ]);
  writeFileIn(worktreeRoot, "src/util.ts", [
    "export function trimName(value: string): string {",
    "  return value.trim().toLowerCase();",
    "}",
    "",
  ].join("\n"));
  const worktreeCheck = runCliJsonIn(worktreeRoot, ["check", "--worktree", "--intent", "latest"]);
  assert.strictEqual(worktreeCheck.mode, "worktree", "worktree check should report worktree mode");
  assert.strictEqual(worktreeCheck.intentValidation.verdict, "matched", "planned worktree edit should match saved intent");
  writeFileIn(worktreeRoot, "src/other.ts", [
    "export function other(value: string): string {",
    "  return value.trim();",
    "}",
    "",
  ].join("\n"));
  const worktreeGate = runCliJsonIn(worktreeRoot, ["gate", "--worktree", "--intent", "latest"]);
  assert.strictEqual(worktreeGate.mode, "worktree", "worktree gate should report worktree mode");
  assert.strictEqual(worktreeGate.mustStop, true, "worktree gate should stop on unplanned worktree drift");
  assert(
    worktreeGate.changedOutsideBoundaryFiles.includes("src/other.ts"),
    "worktree gate should expose unplanned dirty worktree file"
  );
  assert(
    intentCheck.intentValidation.recommendedAction.includes("Proceed"),
    "intent validation JSON should include recommended action"
  );
  assert(Array.isArray(intentCheck.intentValidation.blockingReasons));
  assert(Array.isArray(intentCheck.intentValidation.nextSteps));

  const matchedStrictCheck = runCliResult([
    "check",
    "--staged",
    "--intent",
    "latest",
    "--strict",
  ]);
  assert.strictEqual(matchedStrictCheck.status, 0, "strict matched check should pass");
  assert(
    matchedStrictCheck.stdout.includes("Intent verdict: matched"),
    "strict matched check should print matched verdict"
  );
  assert(
    matchedStrictCheck.stdout.includes("Drift verdict: PASS"),
    "strict matched check should print the clear drift verdict"
  );

  const savedWorkflowContents = fs.readFileSync(workflowPath, "utf8");
  fs.unlinkSync(workflowPath);
  const readinessDriftCheck = runCliJson(["check", "--staged", "--intent", "latest"]);
  assert.strictEqual(
    readinessDriftCheck.intentValidation.readinessDrift.status,
    "weakened",
    "staged check should detect weakened readiness after CI workflow disappears"
  );
  assert.strictEqual(
    readinessDriftCheck.intentValidation.readinessDrift.label,
    "DRIFT",
    "readiness drift should have a stable DRIFT label"
  );
  assert(
    readinessDriftCheck.intentValidation.readinessDrift.weakenedFields.includes("canBlockInCi"),
    "readiness drift should explain that CI blocking weakened"
  );
  assert.strictEqual(
    readinessDriftCheck.intentValidation.driftVerdict.status,
    "drift",
    "weakened readiness should turn the staged check into drift"
  );
  assert.strictEqual(
    readinessDriftCheck.intentValidation.nextRequiredPhase,
    "repair_or_handoff",
    "weakened readiness should require repair or human handoff"
  );
  assert.strictEqual(
    readinessDriftCheck.intentValidation.handoff.mustStop,
    true,
    "weakened readiness handoff should stop the agent"
  );
  assert.strictEqual(
    readinessDriftCheck.intentValidation.handoff.decision,
    "restore-readiness",
    "weakened readiness handoff should tell the agent to restore readiness"
  );
  assert(
    readinessDriftCheck.intentValidation.handoff.commands.doctor.includes("ripple doctor --agent --strict"),
    "weakened readiness handoff should include the doctor command"
  );
  const readinessDriftAgent = runCli(["check", "--staged", "--intent", "latest", "--agent"]);
  assert(
    readinessDriftAgent.includes("readiness_drift:"),
    "agent staged check should print readiness drift detail"
  );
  assert(
    readinessDriftAgent.includes("handoff:"),
    "agent staged check should print compact handoff"
  );
  assert(
    readinessDriftAgent.includes("decision: restore-readiness"),
    "agent staged check handoff should show restore-readiness decision"
  );
  assert(
    readinessDriftAgent.includes("weakened_readiness_fields:"),
    "agent staged check should print weakened readiness fields"
  );
  const readinessDriftRepair = runCliJson(["repair", "--intent", "latest"]);
  assert.strictEqual(
    readinessDriftRepair.readinessDrift.status,
    "weakened",
    "repair plan should carry readiness drift"
  );
  assert.strictEqual(
    readinessDriftRepair.status,
    "human-review-required",
    "readiness drift should require human review or readiness restoration"
  );
  assert.strictEqual(
    readinessDriftRepair.handoff.decision,
    "restore-readiness",
    "readiness drift repair handoff should point to readiness restoration"
  );
  assert(
    readinessDriftRepair.fixActions.some((action) => action.type === "review-readiness"),
    "repair plan should include a concrete readiness repair action"
  );
  writeFile(".github/workflows/ripple.yml", savedWorkflowContents);

  const matchedRepair = runCliJson(["repair", "--intent", "latest"]);
  assert.strictEqual(matchedRepair.protocol, "ripple-intent-drift-repair");
  assert.strictEqual(matchedRepair.verdict, "matched");
  assert.strictEqual(matchedRepair.driftVerdict.status, "pass");
  assert.strictEqual(matchedRepair.driftVerdict.decision, "continue");
  assert.strictEqual(matchedRepair.status, "no-repair-needed");
  assert.strictEqual(
    matchedRepair.readinessDrift.status,
    "unchanged",
    "matched repair should carry passing readiness drift status"
  );
  assert.strictEqual(
    matchedRepair.handoff.canContinue,
    true,
    "matched repair handoff should allow audit"
  );
  assert.strictEqual(
    matchedRepair.handoff.decision,
    "audit",
    "matched repair handoff should point to audit"
  );
  assert.strictEqual(matchedRepair.unstageFiles.length, 0);
  assert(
    matchedRepair.verificationTargets.includes("tests/util.test.ts"),
    "matched repair should preserve verification targets"
  );
  assert(
    matchedRepair.fixActions.some(
      (action) => action.type === "verify" && action.target === "tests/util.test.ts"
    ),
    "matched repair should expose structured verification actions"
  );
  assert(
    matchedRepair.agentActions.trustedFindings.some((item) =>
      item.includes("src/util.ts::trimName")
    ),
    "matched repair should preserve trusted findings"
  );
  assert(
    matchedRepair.agentActions.verifyBeforeCommit.some((item) =>
      item.includes("tests/util.test.ts")
    ),
    "matched repair should preserve verify-before-commit actions"
  );

  const matchedAudit = runCliJson(["audit", "--intent", "latest"]);
  assert.strictEqual(matchedAudit.protocol, "ripple-audit");
  assert.strictEqual(matchedAudit.mode, "staged");
  assert.strictEqual(matchedAudit.status, "pass");
  assert.strictEqual(matchedAudit.decision, "continue");
  assert.strictEqual(matchedAudit.canProceed, true);
  assert.strictEqual(matchedAudit.nextRequiredPhase, "done");
  assert(
    matchedAudit.nextRequiredAction.includes("passed Ripple audit"),
    "audit JSON should tell agents the terminal next action"
  );
  assert.strictEqual(matchedAudit.intent.targetFile, "src/util.ts");
  assert.strictEqual(matchedAudit.stagedCheck.intentValidation.driftVerdict.status, "pass");
  assert.strictEqual(
    matchedAudit.stagedCheck.intentValidation.readinessDrift.status,
    "unchanged",
    "matched audit should carry passing readiness drift status"
  );
  assert.strictEqual(
    matchedAudit.handoff.canContinue,
    true,
    "passing audit handoff should allow final continuation"
  );
  assert.strictEqual(
    matchedAudit.handoff.mustStop,
    false,
    "passing audit handoff should not stop the agent"
  );
  assert.strictEqual(
    matchedAudit.handoff.decision,
    "continue",
    "passing audit handoff should be the final continue decision"
  );
  assert.strictEqual(matchedAudit.repairPlan.status, "no-repair-needed");
  assert(
    matchedAudit.verificationTargets.includes("tests/util.test.ts"),
    "audit should preserve verification targets"
  );

  const matchedAuditText = runCli(["audit", "--intent", "latest"]);
  assert(matchedAuditText.includes("Ripple audit"), "audit text should include title");
  assert(matchedAuditText.includes("Status: pass"), "audit text should show pass status");
  assert(
    matchedAuditText.includes("Next required phase: done"),
    "audit text should show next required phase"
  );
  assert(matchedAuditText.includes("Policy drift:"), "audit text should show policy drift verdict");
  assert(matchedAuditText.includes("Readiness drift:"), "audit text should show readiness drift verdict");

  const matchedAgentAudit = runCli(["audit", "--agent", "--intent", "latest"]);
  assert(matchedAgentAudit.startsWith("RIPPLE_AUDIT"), "agent audit should have stable header");
  assert(matchedAgentAudit.includes("status: pass"), "agent audit should show status");
  assert(matchedAgentAudit.includes("can_proceed: true"), "agent audit should show proceed flag");
  assert(
    matchedAgentAudit.includes("next_required_phase: done"),
    "agent audit should show terminal next required phase"
  );
  assert(matchedAgentAudit.includes("saved_policy_explanation:"), "agent audit should show saved policy");
  assert(matchedAgentAudit.includes("policy_drift_detail:"), "agent audit should show policy drift");
  assert(matchedAgentAudit.includes("handoff:"), "agent audit should show compact handoff");
  assert(
    matchedAgentAudit.includes("can_continue: true"),
    "agent audit handoff should show final continuation"
  );
  assert(
    matchedAgentAudit.includes("readiness_drift_detail:"),
    "agent audit should show readiness drift"
  );

  const matchedStrictAudit = runCliResult(["audit", "--intent", "latest", "--strict"]);
  assert.strictEqual(matchedStrictAudit.status, 0, "strict matched audit should pass");

  const matchedStrictRepair = runCliResult(["repair", "--intent", "latest", "--strict"]);
  assert.strictEqual(matchedStrictRepair.status, 0, "strict matched repair should pass");
  assert(
    matchedStrictRepair.stdout.includes("Status: no-repair-needed"),
    "strict matched repair should print no-repair-needed status"
  );
  assert(
    matchedStrictRepair.stdout.includes("Drift verdict: PASS"),
    "strict matched repair should print the clear drift verdict"
  );

  const agentCheck = runCli(["check", "--staged", "--agent", "--intent", "latest"]);
  assert(
    agentCheck.startsWith("RIPPLE_STAGED_CHECK"),
    "agent staged check should have stable header"
  );
  assert(agentCheck.includes("intent_verdict: matched"), "agent staged check should show intent verdict");
  assert(agentCheck.includes("control_mode: file"), "agent staged check should show control mode");
  assert(agentCheck.includes("boundary_verdict: PASS"), "agent staged check should show boundary verdict");
  assert(agentCheck.includes("boundary_decision: continue"), "agent staged check should show boundary decision");
  assert(agentCheck.includes("drift_verdict: PASS"), "agent staged check should show clear drift verdict");
  assert(agentCheck.includes("drift_decision: continue"), "agent staged check should show drift decision");
  assert(agentCheck.includes("drift_why:"), "agent staged check should show drift why");
  assert(agentCheck.includes("drift_fix:"), "agent staged check should show drift fixes");
  assert(agentCheck.includes("handoff:"), "agent staged check should show compact handoff");
  assert(
    agentCheck.includes("commands_audit:"),
    "agent staged check handoff should show audit command bucket"
  );
  assert(agentCheck.includes("readiness_drift:"), "agent staged check should show readiness drift");
  assert(agentCheck.includes("planned_scope: matched"), "agent staged check should show planned scope");
  assert(
    agentCheck.includes("next_required_phase: audit_after_change"),
    "agent staged check should tell agents to run audit next"
  );
  assert(agentCheck.includes("recommended_action:"), "agent staged check should show recommended action");
  assert(agentCheck.includes("blocking_reasons:"), "agent staged check should show blocking reasons");
  assert(agentCheck.includes("next_steps:"), "agent staged check should show next steps");
  assert(agentCheck.includes("editable_files:"), "agent staged check should show editable scope");
  assert(agentCheck.includes("allowed_files:"), "agent staged check should show allowed files");
  assert(agentCheck.includes("allowed_symbols:"), "agent staged check should show allowed symbols");
  assert(agentCheck.includes("boundary_why:"), "agent staged check should show boundary why");
  assert(agentCheck.includes("boundary_fix:"), "agent staged check should show boundary fix");
  assert(agentCheck.includes("changed_outside_boundary_files:"), "agent staged check should show boundary-crossing files");
  assert(
    agentCheck.includes("context_files_changed:"),
    "agent staged check should show context-only drift section"
  );
  assert(agentCheck.includes("unplanned_files:"), "agent staged check should include unplanned files");
  assert(agentCheck.includes("mode: staged"), "agent staged check should include mode");
  assert(agentCheck.includes("highest_risk:"), "agent staged check should include highest risk");
  assert(agentCheck.includes("requires_attention:"), "agent staged check should include attention flag");
  assert(agentCheck.includes("adapter: builtin-js-ts"), "agent staged check should include adapter id");
  assert(agentCheck.includes("symbols:trust"), "agent staged check should include adapter signals");
  assert(agentCheck.includes("trusted_findings:"), "agent staged check should include trusted findings");
  assert(
    agentCheck.includes("verify_before_commit:"),
    "agent staged check should include verify-before-commit actions"
  );
  assert(
    agentCheck.includes("manual_review_required:"),
    "agent staged check should include manual review actions"
  );
  assert(agentCheck.includes("changed_files:"), "agent staged check should include changed files");
  assert(agentCheck.includes("- src/util.ts"), "agent staged check should include staged util file");
  assert(agentCheck.includes("read_first:"), "agent staged check should include read_first");
  assert(agentCheck.includes("symbols_first:"), "agent staged check should include symbols_first");
  assert(agentCheck.includes("changed_symbols:"), "agent staged check should include changed symbols");
  assert(
    agentCheck.includes("signature_changed: false"),
    "agent staged check should expose signature comparison"
  );
  assert(agentCheck.includes("contract_risk:"), "agent staged check should include contract risk");
  assert(
    agentCheck.includes("- src/util.ts::trimName"),
    "agent staged check should include focused symbol"
  );
  assert(agentCheck.includes("verify:"), "agent staged check should include verification targets");
  assert(
    agentCheck.includes("- tests/util.test.ts"),
    "agent staged check should include direct test verification"
  );
  assert(agentCheck.includes("skipped:"), "agent staged check should include skipped files");
  assert(agentCheck.includes("- README.md"), "agent staged check should include skipped README");

  const agentRepair = runCli(["repair", "--agent", "--intent", "latest"]);
  assert(
    agentRepair.startsWith("RIPPLE_INTENT_DRIFT_REPAIR"),
    "agent repair should have stable header"
  );
  assert(agentRepair.includes("handoff:"), "agent repair should show compact handoff");
  assert(agentRepair.includes("decision: audit"), "agent repair handoff should point to audit");
  assert(agentRepair.includes("verdict: matched"), "agent repair should show verdict");
  assert(agentRepair.includes("drift_verdict: PASS"), "agent repair should show clear drift verdict");
  assert(agentRepair.includes("drift_decision: continue"), "agent repair should show drift decision");
  assert(agentRepair.includes("boundary_verdict: PASS"), "agent repair should show boundary verdict");
  assert(agentRepair.includes("boundary_decision: continue"), "agent repair should show boundary decision");
  assert(agentRepair.includes("status: no-repair-needed"), "agent repair should show status");
  assert(agentRepair.includes("unstage_files:"), "agent repair should include unstage files");
  assert(agentRepair.includes("review_contracts:"), "agent repair should include contract review list");
  assert(agentRepair.includes("fix_actions:"), "agent repair should include structured fix actions");
  assert(
    agentRepair.includes("required verify target=tests/util.test.ts"),
    "agent repair should tell agents the exact verification action"
  );
  assert(agentRepair.includes("trusted_findings:"), "agent repair should include trusted findings");
  assert(
    agentRepair.includes("verify_before_commit:"),
    "agent repair should include verify-before-commit actions"
  );
  assert(
    agentRepair.includes("manual_review_required:"),
    "agent repair should include manual review actions"
  );
  assert(agentRepair.includes("verify:"), "agent repair should include verification targets");
  assert(agentRepair.includes("- tests/util.test.ts"), "agent repair should include direct test");

  writeFile(
    "src/index.ts",
    [
      "import { shout, trimName } from './util';",
      "",
      "export function label(value: string): string {",
      "  const normalized = trimName(value);",
      "  return shout(normalized);",
      "}",
      "",
    ].join("\n")
  );
  if (traceCommands) {
    console.error("git add src/index.ts");
  }
  execFileSync("git", ["add", "src/index.ts"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
  });

  const driftRepair = runCliJson(["repair", "--intent", "latest"]);
  assert.strictEqual(driftRepair.verdict, "drifted");
  assert.strictEqual(driftRepair.driftVerdict.status, "drift");
  assert.strictEqual(driftRepair.driftVerdict.decision, "fix-before-commit");
  assert(
    driftRepair.driftVerdict.fix.includes("Unstage context-only file: src/index.ts"),
    "drift repair JSON should expose exact context-only file fix"
  );
  assert.strictEqual(driftRepair.status, "repair-required");
  assert(
    driftRepair.unstageFiles.includes("src/index.ts"),
    "drift repair should list the context-only staged file"
  );
  assert(
    driftRepair.commands.unstage.includes("git restore --staged -- src/index.ts"),
    "drift repair should include an unstage command"
  );
  assert(
    driftRepair.fixActions.some(
      (action) =>
        action.type === "unstage-file" &&
        action.target === "src/index.ts" &&
        action.reason.includes("read or verification context") &&
        action.command === "git restore --staged -- src/index.ts"
    ),
    "drift repair should expose structured context-only unstage actions"
  );
  assert(
    Array.isArray(driftRepair.agentActions.manualReviewRequired),
    "drift repair should expose agent action buckets"
  );

  const driftStrictCheck = runCliResult([
    "check",
    "--staged",
    "--intent",
    "latest",
    "--strict",
  ]);
  assert.strictEqual(driftStrictCheck.status, 1, "strict drifted check should fail");
  assert(
    driftStrictCheck.stdout.includes("Intent verdict: drifted"),
    "strict drifted check should print drifted verdict"
  );
  assert(
    driftStrictCheck.stdout.includes("Drift verdict: DRIFT"),
    "strict drifted check should print the clear drift verdict"
  );

  const driftStrictRepair = runCliResult(["repair", "--intent", "latest", "--strict"]);
  assert.strictEqual(driftStrictRepair.status, 1, "strict drifted repair should fail");
  assert(
    driftStrictRepair.stdout.includes("Status: repair-required"),
    "strict drifted repair should print repair status"
  );
  assert(
    driftStrictRepair.stdout.includes("Drift verdict: DRIFT"),
    "strict drifted repair should print the clear drift verdict"
  );

  if (traceCommands) {
    console.error("git add package.json src/index.ts tests/util.test.ts tests/index.spec.ts");
  }
  execFileSync(
    "git",
    ["add", "package.json", "src/index.ts", "tests/util.test.ts", "tests/index.spec.ts"],
    {
      cwd: workspaceRoot,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: COMMAND_TIMEOUT_MS,
    }
  );
  if (traceCommands) {
    console.error("git commit -m baseline");
  }
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
      timeout: COMMAND_TIMEOUT_MS,
    }
  );

  const latestIntentPath = path.join(workspaceRoot, ".ripple", "intents", "latest.json");
  const hiddenIntentPath = `${latestIntentPath}.bak`;
  fs.renameSync(latestIntentPath, hiddenIntentPath);
  try {
    const missingIntentSummaryPath = path.join(workspaceRoot, "missing-intent-summary.md");
    const missingIntentCi = runCliResult(["ci", "--base", "HEAD", "--github-annotations"], {
      GITHUB_STEP_SUMMARY: missingIntentSummaryPath,
    });
    assert.strictEqual(missingIntentCi.status, 0, "CI policy audit should not fail when local intent is missing");
    assert(
      missingIntentCi.stdout.includes("Ripple CI policy audit"),
      "CI should clearly run policy-audit mode without a committed local intent"
    );
    assert(
      missingIntentCi.stdout.includes("Blocking: false"),
      "CI policy audit should not hard-block by default"
    );
    assert(
      missingIntentCi.stdout.includes("Intent: none"),
      "CI policy audit should explain that local intents are not required"
    );
    assert(
      missingIntentCi.stdout.includes("::notice title=Ripple policy audit::") ||
        missingIntentCi.stdout.includes("::warning title=Ripple policy audit::"),
      "CI policy audit should annotate GitHub Actions visibly"
    );
    const missingIntentSummary = fs.readFileSync(missingIntentSummaryPath, "utf8");
    assert(
      missingIntentSummary.includes("## Ripple architecture gate"),
      "CI gate should write a GitHub step summary for missing intent"
    );
    assert(
      missingIntentSummary.includes("Status: audit"),
      "missing intent step summary should show audit status"
    );
    assert(
      missingIntentSummary.includes("Mode: policy-only"),
      "missing intent step summary should show policy-only mode"
    );
    assert(
      missingIntentSummary.includes("Blocking: false"),
      "missing intent step summary should not block continuation"
    );
    assert(
      missingIntentSummary.includes("Intent: none"),
      "missing intent step summary should explain that no local intent is required"
    );
  } finally {
    fs.renameSync(hiddenIntentPath, latestIntentPath);
  }

  writeFile(
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  return value.trim().toLowerCase();",
      "}",
      "",
      "export function shout(value: string): string {",
      "  return value.toUpperCase();",
      "}",
      "",
    ].join("\n")
  );
  writeFile("README.md", "# Fixture changed\n");

  const changedCheck = runCliJson([
    "check",
    "--changed",
    "--base",
    "HEAD",
    "--intent",
    "latest",
  ]);
  assert.strictEqual(changedCheck.mode, "changed");
  assert.strictEqual(changedCheck.baseRef, "HEAD");
  assert.strictEqual(changedCheck.stagedFiles, 1);
  assert.strictEqual(changedCheck.skippedFiles.length, 1);
  assertFileListed(changedCheck.files, "src/util.ts", "changed check");
  assert.strictEqual(changedCheck.intentValidation.verdict, "matched");

  const changedStrictCheck = runCliResult([
    "check",
    "--changed",
    "--base",
    "HEAD",
    "--intent",
    "latest",
    "--strict",
  ]);
  assert.strictEqual(changedStrictCheck.status, 0, "strict matched changed check should pass");
  assert(
    changedStrictCheck.stdout.includes("Ripple changed-files check"),
    "changed check should print changed-files summary"
  );
  assert(
    changedStrictCheck.stdout.includes("Base ref: HEAD"),
    "changed check should print base ref"
  );

  const ciCheck = runCliResult(["ci", "--base", "HEAD", "--intent", "latest"]);
  assert.strictEqual(ciCheck.status, 0, "matched CI gate should pass");
  assert(
    ciCheck.stdout.includes("Ripple audit"),
    "CI gate should use the shared audit report"
  );
  assert(
    ciCheck.stdout.includes("Status: pass"),
    "CI gate should print audit pass status"
  );
  assert(ciCheck.stdout.includes("Gate:"), "CI gate should print compact gate section");
  assert(
    ciCheck.stdout.includes("  status: open"),
    "CI gate should print open gate status when audit passes"
  );
  assert(
    ciCheck.stdout.includes("  decision: continue"),
    "CI gate should print continue decision when audit passes"
  );
  assert(ciCheck.stdout.includes("Base ref: HEAD"), "CI gate should print base ref");

  const ciJson = runCliJson(["ci", "--base", "HEAD", "--intent", "latest"]);
  assert.strictEqual(ciJson.protocol, "ripple-audit");
  assert.strictEqual(ciJson.gate.protocol, "ripple-gate");
  assert.strictEqual(ciJson.gate.status, "open");
  assert.strictEqual(ciJson.gate.decision, "continue");
  assert.strictEqual(ciJson.gate.canContinue, true);

  const matchedSummaryPath = path.join(workspaceRoot, "matched-ci-summary.md");
  const ciSummaryCheck = runCliResult(["ci", "--base", "HEAD", "--intent", "latest"], {
    GITHUB_STEP_SUMMARY: matchedSummaryPath,
  });
  assert.strictEqual(ciSummaryCheck.status, 0, "matched CI gate with step summary should pass");
  const matchedSummary = fs.readFileSync(matchedSummaryPath, "utf8");
  assert(
    matchedSummary.includes("Status: passed"),
    "matched CI step summary should show passed status"
  );
  assert(
    matchedSummary.includes("Gate status: open"),
    "matched CI step summary should show open gate status"
  );
  assert(
    matchedSummary.includes("Gate decision: continue"),
    "matched CI step summary should show continue gate decision"
  );
  assert(
    matchedSummary.includes("Can continue: true"),
    "matched CI step summary should allow continuation"
  );
  assert(
    matchedSummary.includes("Audit status: pass"),
    "matched CI step summary should show audit pass status"
  );
  assert(
    matchedSummary.includes("Next required phase: done"),
    "matched CI step summary should show the terminal phase"
  );
  assert(
    matchedSummary.includes("- Verdict: matched"),
    "matched CI step summary should show matched intent verdict"
  );
  assert(
    matchedSummary.includes("- src/util.ts"),
    "matched CI step summary should list changed files"
  );
  assert(
    matchedSummary.includes("### Agent actions"),
    "matched CI step summary should include agent action buckets"
  );
  assert(
    matchedSummary.includes("### Gate handoff"),
    "matched CI step summary should include compact gate handoff section"
  );
  assert(
    matchedSummary.includes("#### Gate commands"),
    "matched CI step summary should include gate command bucket"
  );
  assert(
    matchedSummary.includes("#### Trusted findings"),
    "matched CI step summary should include trusted findings"
  );
  assert(
    matchedSummary.includes("#### Verify before commit"),
    "matched CI step summary should include verification actions"
  );
  assert(
    matchedSummary.includes("#### Manual review required"),
    "matched CI step summary should include manual review actions"
  );
  assert(
    matchedSummary.includes("tests/util.test.ts"),
    "matched CI step summary should include verification target actions"
  );

  const matchedAnnotatedCiCheck = runCliResult([
    "ci",
    "--base",
    "HEAD",
    "--intent",
    "latest",
    "--github-annotations",
  ]);
  assert.strictEqual(matchedAnnotatedCiCheck.status, 0, "matched annotated CI gate should pass");
  assert(
    matchedAnnotatedCiCheck.stdout.includes("::notice") &&
      matchedAnnotatedCiCheck.stdout.includes("title=Ripple trusted finding"),
    "matched annotated CI gate should emit trusted finding notices"
  );
  assert(
    matchedAnnotatedCiCheck.stdout.includes("::warning") &&
      matchedAnnotatedCiCheck.stdout.includes("title=Ripple verify before commit"),
    "matched annotated CI gate should emit verify-before-commit warnings"
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

  const policyDriftSummaryPath = path.join(workspaceRoot, "policy-drift-ci-summary.md");
  const policyDriftCiCheck = runCliResult(
    ["ci", "--base", "HEAD", "--intent", "latest", "--github-annotations"],
    {
      GITHUB_STEP_SUMMARY: policyDriftSummaryPath,
    }
  );
  assert.strictEqual(policyDriftCiCheck.status, 0, "policy drift CI gate should audit-pass by default");
  assert(
    policyDriftCiCheck.stdout.includes(
      "::warning file=src/util.ts,title=Ripple policy drift::DRIFT: current repo policy differs from the policy snapshot saved with this intent."
    ),
    "policy drift CI gate should emit a target-file GitHub Actions error"
  );
  assert(
    policyDriftCiCheck.stdout.includes("policy_risk saved=none current=critical"),
    "policy drift CI gate should annotate changed policy fields"
  );
  assert(
    policyDriftCiCheck.stdout.includes("next=repair_or_handoff"),
    "policy drift CI gate should annotate the next required phase"
  );
  const policyDriftSummary = fs.readFileSync(policyDriftSummaryPath, "utf8");
  assert(
    policyDriftSummary.includes("Audit status: human-review-required"),
    "policy drift CI step summary should show audit human-review status"
  );
  assert(
    policyDriftSummary.includes("Gate status: closed"),
    "policy drift CI step summary should show closed gate status"
  );
  assert(
    policyDriftSummary.includes("Gate decision: human-review"),
    "policy drift CI step summary should show human-review gate decision"
  );
  assert(
    policyDriftSummary.includes("Can continue: false"),
    "policy drift CI step summary should block continuation"
  );
  assert(
    policyDriftSummary.includes("Next required phase: repair_or_handoff"),
    "policy drift CI step summary should show the next required phase"
  );
  assert(
    policyDriftSummary.includes("### Policy drift"),
    "policy drift CI step summary should include policy drift section"
  );
  assert(
    policyDriftSummary.includes("- Status: changed"),
    "policy drift CI step summary should show changed status"
  );
  assert(
    policyDriftSummary.includes("policy_risk saved=none current=critical"),
    "policy drift CI step summary should list changed policy fields"
  );

  writeFile(
    "src/changed-other.ts",
    [
      "export function changedOther(): number {",
      "  return 1;",
      "}",
      "",
    ].join("\n")
  );

  const driftChangedStrictCheck = runCliResult([
    "check",
    "--changed",
    "--base",
    "HEAD",
    "--intent",
    "latest",
    "--strict",
  ]);
  assert.strictEqual(driftChangedStrictCheck.status, 1, "strict drifted changed check should fail");
  assert(
    driftChangedStrictCheck.stdout.includes("Intent verdict: drifted"),
    "strict drifted changed check should print drifted verdict"
  );

  const driftCiCheck = runCliResult(["ci", "--base", "HEAD", "--intent", "latest"]);
  assert.strictEqual(driftCiCheck.status, 0, "drifted CI gate should audit-pass by default");
  assert(
    driftCiCheck.stdout.includes("Status: human-review-required"),
    "drifted CI gate should print audit human-review status"
  );
  assert(
    driftCiCheck.stdout.includes("Gate:") &&
      driftCiCheck.stdout.includes("  status: closed"),
    "drifted CI gate should print closed gate status"
  );
  assert(
    driftCiCheck.stdout.includes("drift: DANGER") || driftCiCheck.stdout.includes("drift: DRIFT"),
    "drifted CI gate should print drift verdict"
  );

  const driftAnnotatedCiCheck = runCliResult([
    "ci",
    "--base",
    "HEAD",
    "--intent",
    "latest",
    "--github-annotations",
  ]);
  assert.strictEqual(driftAnnotatedCiCheck.status, 0, "annotated drifted CI gate should audit-pass by default");
  assert(
    driftAnnotatedCiCheck.stdout.includes(
      "::warning file=src/changed-other.ts,title=Ripple intent drift::Unplanned file changed: src/changed-other.ts"
    ),
    "annotated CI gate should emit a file-level GitHub Actions error"
  );
  assert(
    driftAnnotatedCiCheck.stdout.includes("title=Ripple trusted finding"),
    "drifted annotated CI gate should also emit trusted finding annotations"
  );

  const driftSummaryPath = path.join(workspaceRoot, "drift-ci-summary.md");
  const driftGithubEnvCiCheck = runCliResult(["ci", "--base", "HEAD", "--intent", "latest"], {
    GITHUB_ACTIONS: "true",
    GITHUB_STEP_SUMMARY: driftSummaryPath,
  });
  assert.strictEqual(driftGithubEnvCiCheck.status, 0, "GitHub Actions drifted CI gate should audit-pass by default");
  assert(
    driftGithubEnvCiCheck.stdout.includes(
      "::warning file=src/changed-other.ts,title=Ripple intent drift::Unplanned file changed: src/changed-other.ts"
    ),
    "CI gate should auto-emit GitHub Actions errors when GITHUB_ACTIONS=true"
  );
  const driftSummary = fs.readFileSync(driftSummaryPath, "utf8");
  assert(
    driftSummary.includes("Status: failed"),
    "drifted CI step summary should show failed status"
  );
  assert(
    driftSummary.includes("Audit status: human-review-required"),
    "drifted CI step summary should show audit human-review status"
  );
  assert(
    driftSummary.includes("Gate status: closed"),
    "drifted CI step summary should show closed gate status"
  );
  assert(
    driftSummary.includes("Gate decision: human-review"),
    "drifted CI step summary should show human-review gate decision"
  );
  assert(
    driftSummary.includes("Can continue: false"),
    "drifted CI step summary should block continuation"
  );
  assert(
    driftSummary.includes("Next required phase: repair_or_handoff"),
    "drifted CI step summary should show next required phase"
  );
  assert(
    driftSummary.includes("Unplanned file changed: src/changed-other.ts"),
    "drifted CI step summary should list blocking reasons"
  );
  assert(
    driftSummary.includes("### Agent actions"),
    "drifted CI step summary should include agent action buckets"
  );

  console.log("Ripple CLI regression tests passed");
}

main();


