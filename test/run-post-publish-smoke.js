const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const rootPackage = readJson(path.join(repoRoot, "package.json"));
const version = rootPackage.version;
const cliPackage = `@getripple/cli@${version}`;
const mcpPackage = `@getripple/mcp@${version}`;
const proofRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `post-publish-smoke-${Date.now()}`,
);
const workspaceRoot = path.join(proofRoot, "consumer");

const live = process.argv.includes("--live");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFile(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function runGit(args) {
  execFileSync("git", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function npmCliArgs(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
    };
  }

  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args,
  };
}

function npmExecPackage(packageSpec, command, args, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  const execArgs = npmExecPath && fs.existsSync(npmExecPath)
    ? [
        "exec",
        "--yes",
        "--package",
        packageSpec,
        "--",
        command,
        ...args,
      ]
    : [
        "-y",
        "--package",
        packageSpec,
        command,
        ...args,
      ];
  const runnable = npmCliArgs(execArgs);
  return execFileSync(runnable.command, runnable.args, {
    cwd: options.cwd ?? workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function spawnNpmExecPackage(packageSpec, command, args, input, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  const execArgs = npmExecPath && fs.existsSync(npmExecPath)
    ? [
        "exec",
        "--yes",
        "--package",
        packageSpec,
        "--",
        command,
        ...args,
      ]
    : [
        "-y",
        "--package",
        packageSpec,
        command,
        ...args,
      ];
  const runnable = npmCliArgs(execArgs);
  return spawnSync(runnable.command, runnable.args, {
    cwd: options.cwd ?? workspaceRoot,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: options.timeout ?? 30000,
  });
}

function setupWorkspace() {
  writeFile(
    workspaceRoot,
    "package.json",
    JSON.stringify({ name: "ripple-post-publish-smoke", private: true }, null, 2),
  );
  writeFile(
    workspaceRoot,
    "src/index.ts",
    [
      "export function greet(name: string): string {",
      "  return `Hello, ${name.trim()}`;",
      "}",
      "",
    ].join("\n"),
  );
  writeFile(
    workspaceRoot,
    "tests/index.test.ts",
    [
      "import { greet } from '../src/index';",
      "",
      "export function testGreet(): string {",
      "  return greet(' Ada ');",
      "}",
      "",
    ].join("\n"),
  );

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

function runRipple(args) {
  return npmExecPackage(cliPackage, "ripple", args);
}

function runRippleJson(args) {
  const output = runRipple([...args, "--json"]);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Expected JSON from public ripple ${args.join(" ")}:\n${output}`);
  }
}

function parseJsonLines(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function callPublicMcpTool(tool, args = {}) {
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "ripple-post-publish-smoke",
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

  const result = spawnNpmExecPackage(
    mcpPackage,
    "ripple-mcp",
    ["--workspace", workspaceRoot],
    `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
  );

  if (result.error) {
    throw new Error(
      `Public MCP stdio call timed out or failed for ${tool}: ${result.error.message}\n${result.stderr}`,
    );
  }
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(
    result.stderr.trim(),
    "",
    `public MCP stdio should not leak scan/cache logs to stderr for ${tool}`,
  );

  const responses = parseJsonLines(result.stdout);
  assert.strictEqual(responses.length, 2, "MCP stdio should return initialize + tool call");
  assert.strictEqual(responses[0].result.serverInfo.name, "ripple-mcp");
  assert.strictEqual(responses[0].result.serverInfo.version, version);
  assert.strictEqual(responses[1].result.isError, false, responses[1].result.content?.[0]?.text);
  return responses[1].result.structuredContent;
}

function assertDoctorBlocks(doctor, label) {
  assert.strictEqual(doctor.status, "needs_setup", `${label} status`);
  assert.strictEqual(doctor.decision, "setup-required", `${label} decision`);
  assert.strictEqual(doctor.canContinue, false, `${label} canContinue`);
  assert.strictEqual(doctor.mustStop, true, `${label} mustStop`);
  assert.strictEqual(
    doctor.nextRequiredAction,
    "Stop autonomous agent work until Ripple readiness gaps are fixed.",
    `${label} nextRequiredAction`,
  );
  assert(Array.isArray(doctor.why), `${label} why`);
  assert(Array.isArray(doctor.fixNow), `${label} fixNow`);
  assert(doctor.why.length > 0, `${label} should explain why setup is required`);
  assert(
    doctor.fixNow.some((fix) => fix.includes("ripple init") || fix.includes("ripple plan")),
    `${label} should tell the user how to make Ripple ready`,
  );
}

function assertDoctorAllows(doctor, label) {
  assert.strictEqual(doctor.status, "ready", `${label} status`);
  assert.strictEqual(doctor.decision, "continue", `${label} decision`);
  assert.strictEqual(doctor.canContinue, true, `${label} canContinue`);
  assert.strictEqual(doctor.mustStop, false, `${label} mustStop`);
  assert.strictEqual(
    doctor.nextRequiredAction,
    "Continue with the saved-intent workflow and keep the Ripple CI gate enabled.",
    `${label} nextRequiredAction`,
  );
  assert.deepStrictEqual(doctor.fixNow, [], `${label} fixNow`);
  assert(
    doctor.why.some((reason) => reason.includes("detect drift, and fail CI")),
    `${label} should explain CI gate readiness`,
  );
}

function provePublicCli() {
  const publicVersion = runRipple(["--version"]).trim();
  assert.strictEqual(publicVersion, version);

  const init = runRippleJson(["init"]);
  assert.strictEqual(init.protocol, "ripple-init");
  assert(
    init.files.some((file) => file.path === ".ripple/policy.json"),
    "public CLI init should write policy",
  );
  assert(
    init.files.some((file) => file.path === ".github/workflows/ripple.yml"),
    "public CLI init should write CI workflow",
  );

  const plan = runRippleJson([
    "plan",
    "--file",
    "src/index.ts",
    "--task",
    "post-publish smoke test",
    "--mode",
    "file",
    "--save",
  ]);
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.targetFile, "src/index.ts");
  assert.strictEqual(plan.changeIntent.readinessSnapshot.canBlockInCi, true);

  const gate = runRippleJson(["gate", "--intent", "latest"]);
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.status, "open");
  assert.strictEqual(gate.decision, "continue");
}

function provePublicMcpBeforeSetup() {
  const workflow = callPublicMcpTool("ripple_get_agent_workflow");
  assert.strictEqual(workflow.protocol, "ripple-agent-workflow");
  assert.strictEqual(workflow.commands.initializeRepo, "ripple init");

  const doctor = callPublicMcpTool("ripple_doctor");
  assertDoctorBlocks(doctor, "public MCP doctor before setup");
}

function provePublicMcpAfterSetup() {
  const doctor = callPublicMcpTool("ripple_doctor");
  assertDoctorAllows(doctor, "public MCP doctor after setup");
  assert.strictEqual(doctor.enforcement.level, "ci-gate-ready");

  const plan = callPublicMcpTool("ripple_plan_context", {
    task: "post-publish MCP smoke test",
    filePath: "src/index.ts",
    tokenBudget: 2600,
    mode: "file",
    saveIntent: true,
  });
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.targetFile, "src/index.ts");

  const gate = callPublicMcpTool("ripple_gate", {
    intentPath: "latest",
    tokenBudget: 2600,
  });
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.status, "open");
  assert.strictEqual(gate.decision, "continue");
}

function printDryRunPlan() {
  console.log("Ripple post-publish smoke plan");
  console.log("");
  console.log("This script does not hit the network unless --live is passed.");
  console.log("");
  console.log("After publishing, run:");
  console.log("  npm run smoke:post-publish -- --live");
  console.log("");
  console.log("It will test:");
  console.log(`  ${cliPackage}: ripple --version, init, plan, gate`);
  console.log(`  ${mcpPackage}: ripple_get_agent_workflow, ripple_doctor, ripple_plan_context, ripple_gate`);
}

function main() {
  if (!live) {
    printDryRunPlan();
    return;
  }

  setupWorkspace();
  provePublicMcpBeforeSetup();
  provePublicCli();
  provePublicMcpAfterSetup();

  console.log("Ripple post-publish smoke passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Public CLI package: ${cliPackage}`);
  console.log(`Public MCP package: ${mcpPackage}`);
  console.log("Verified: CLI npx path and MCP stdio npx path");
}

main();
