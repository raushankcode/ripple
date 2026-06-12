const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const rootPackage = readJson(path.join(repoRoot, "package.json"));
const version = rootPackage.version;
const live = process.argv.includes("--live");
const proofRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `external-install-smoke-${live ? "live" : "packed"}-${Date.now()}`,
);
const packRoot = path.join(proofRoot, "packs");
const consumerRoot = path.join(proofRoot, "consumer");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFile(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function runNpm(args, cwd) {
  const runnable = npmRunnable(args);
  return execFileSync(runnable.command, runnable.args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
  });
}

function npmRunnable(args) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath && fs.existsSync(npmExecPath)
    ? process.execPath
    : process.platform === "win32"
      ? "npm.cmd"
      : "npm";
  const argsWithRunner = npmExecPath && fs.existsSync(npmExecPath)
    ? [npmExecPath, ...args]
    : args;
  return { command, args: argsWithRunner };
}

function runGit(args) {
  execFileSync("git", args, {
    cwd: consumerRoot,
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 30000,
  });
}

function packPackage(packageDir, expectedFiles) {
  fs.mkdirSync(packRoot, { recursive: true });
  const output = runNpm(["pack", "--json", "--pack-destination", packRoot], packageDir);
  const [packed] = JSON.parse(output);
  assert.strictEqual(packed.version, version, `${packed.name} packed version`);
  const tarballPath = path.join(packRoot, packed.filename);
  assert(fs.existsSync(tarballPath), `Packed tarball should exist: ${tarballPath}`);

  for (const expectedFile of expectedFiles) {
    assert(
      packed.files.some((file) => file.path === expectedFile),
      `${packed.name} tarball should include ${expectedFile}`,
    );
  }

  return tarballPath;
}

function packageSpecs() {
  if (live) {
    return [
      `@getripple/core@${version}`,
      `@getripple/cli@${version}`,
      `@getripple/mcp@${version}`,
    ];
  }

  return [
    packPackage(path.join(repoRoot, "packages", "core"), ["dist/index.js"]),
    packPackage(path.join(repoRoot, "packages", "cli"), ["dist/index.js"]),
    packPackage(path.join(repoRoot, "packages", "mcp"), ["dist/index.js", "dist/server.js"]),
  ];
}

function setupConsumerRepo() {
  writeFile(
    consumerRoot,
    "package.json",
    JSON.stringify({ name: "ripple-external-install-consumer", private: true }, null, 2),
  );
  writeFile(consumerRoot, ".gitignore", ["node_modules/", ".ripple/.cache/", ""].join("\n"));
  writeFile(
    consumerRoot,
    "src/auth.ts",
    [
      "export function refreshToken(attempts = 1): string {",
      "  if (attempts > 1) {",
      "    return 'retry-token';",
      "  }",
      "",
      "  return 'token';",
      "}",
      "",
      "export function login(user: string): string {",
      "  return `session:${user}`;",
      "}",
      "",
    ].join("\n"),
  );
  writeFile(
    consumerRoot,
    "test/auth.test.ts",
    [
      "import { login, refreshToken } from '../src/auth';",
      "",
      "export function authSmoke(): string {",
      "  return `${login('ada')}:${refreshToken()}`;",
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
    "user.name=Ripple External Smoke",
    "commit",
    "-m",
    "baseline",
  ]);
}

function installPackages() {
  runNpm(
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      ...packageSpecs(),
    ],
    consumerRoot,
  );

  const coreEntry = path.join(consumerRoot, "node_modules", "@getripple", "core", "dist", "index.js");
  const cliEntry = path.join(consumerRoot, "node_modules", "@getripple", "cli", "dist", "index.js");
  const mcpEntry = path.join(consumerRoot, "node_modules", "@getripple", "mcp", "dist", "index.js");
  const mcpServer = path.join(consumerRoot, "node_modules", "@getripple", "mcp", "dist", "server.js");
  const rippleBin = path.join(
    consumerRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "ripple.cmd" : "ripple",
  );
  const mcpBin = path.join(
    consumerRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "ripple-mcp.cmd" : "ripple-mcp",
  );

  assert(fs.existsSync(coreEntry), "external install should include @getripple/core dist/index.js");
  assert(fs.existsSync(cliEntry), "external install should include @getripple/cli dist/index.js");
  assert(fs.existsSync(mcpEntry), "external install should include @getripple/mcp dist/index.js");
  assert(fs.existsSync(mcpServer), "external install should include @getripple/mcp dist/server.js");
  assert(fs.existsSync(rippleBin), "external install should expose ripple binary");
  assert(fs.existsSync(mcpBin), "external install should expose ripple-mcp binary");

  return { rippleBin, mcpServer };
}

function runRipple(_binPath, args, options = {}) {
  const runnable = npmRunnable(["exec", "--", "ripple", ...args]);
  const result = spawnSync(runnable.command, runnable.args, {
    cwd: consumerRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
  });
  if (result.error) {
    throw result.error;
  }
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `ripple ${args.join(" ")} failed\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
    );
  }
  if (options.expectFailure) {
    assert.notStrictEqual(result.status, 0, `ripple ${args.join(" ")} should fail closed`);
  }
  return result.stdout;
}

function runRippleJson(binPath, args, options = {}) {
  const output = runRipple(binPath, [...args, "--json"], options);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Expected JSON from ripple ${args.join(" ")}:\n${output}`);
  }
}

function simulateBoundaryCross() {
  writeFile(
    consumerRoot,
    "src/auth.ts",
    [
      "export function refreshToken(attempts = 1): string {",
      "  const safeAttempts = Math.max(1, attempts);",
      "  if (safeAttempts > 1) {",
      "    return 'retry-token';",
      "  }",
      "",
      "  return 'token';",
      "}",
      "",
      "export function login(user: string): string {",
      "  return `session:${user.trim()}`;",
      "}",
      "",
    ].join("\n"),
  );
  runGit(["add", "src/auth.ts"]);
}

function parseJsonLines(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function callInstalledMcpTool(serverPath, tool, args = {}) {
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "ripple-external-install-smoke",
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

  const result = spawnSync(process.execPath, [serverPath, "--workspace", consumerRoot], {
    input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60000,
  });

  if (result.error) {
    throw new Error(`Installed MCP call failed for ${tool}: ${result.error.message}\n${result.stderr}`);
  }
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stderr.trim(), "", `MCP stdio should keep stderr clean for ${tool}`);

  const responses = parseJsonLines(result.stdout);
  assert.strictEqual(responses.length, 2, "MCP should return initialize + tool call responses");
  assert.strictEqual(responses[0].result.serverInfo.name, "ripple-mcp");
  assert.strictEqual(responses[0].result.serverInfo.version, version);
  assert.strictEqual(responses[1].result.isError, false, responses[1].result.content?.[0]?.text);
  return responses[1].result.structuredContent;
}

function proveInstalledCli(rippleBin) {
  assert.strictEqual(runRipple(rippleBin, ["--version"]).trim(), version);

  const init = runRippleJson(rippleBin, ["init"]);
  assert.strictEqual(init.protocol, "ripple-init");
  assert(
    init.files.some((file) => file.path === ".ripple/policy.json"),
    "installed CLI should initialize policy",
  );

  const plan = runRippleJson(rippleBin, [
    "plan",
    "--file",
    "src/auth.ts",
    "--symbol",
    "refreshToken",
    "--task",
    "external install smoke boundary",
    "--mode",
    "function",
    "--agent",
    "--save",
  ]);
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.targetFile, "src/auth.ts");
  assert.strictEqual(plan.changeIntent.controlMode, "function");

  const approval = runRippleJson(rippleBin, [
    "approve",
    "--intent",
    "latest",
    "--gate",
    "before-risky-edit",
    "--approved-by",
    "Ripple External Smoke",
    "--reason",
    "Approve only refreshToken for external install smoke.",
  ]);
  assert.strictEqual(approval.protocol, "ripple-approval");

  simulateBoundaryCross();

  const gate = runRippleJson(rippleBin, ["gate", "--intent", "latest", "--strict"], {
    allowFailure: true,
    expectFailure: true,
  });
  const gateText = JSON.stringify(gate);
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.decision, "human-review");
  assert.strictEqual(gate.canContinue, false);
  assert.strictEqual(gate.mustStop, true);
  assert.strictEqual(gate.needsHuman, true);
  assert(gateText.includes("src/auth.ts::login"), "installed CLI gate should name boundary drift");

  const repair = runRippleJson(rippleBin, ["repair", "--intent", "latest"]);
  assert.strictEqual(repair.protocol, "ripple-intent-drift-repair");
  assert(JSON.stringify(repair).includes("src/auth.ts::login"), "installed CLI repair should name what to fix");
}

function proveInstalledMcp(serverPath) {
  const workflow = callInstalledMcpTool(serverPath, "ripple_get_agent_workflow");
  assert.strictEqual(workflow.protocol, "ripple-agent-workflow");
  assert.strictEqual(workflow.commands.initializeRepo, "ripple init");

  const gate = callInstalledMcpTool(serverPath, "ripple_gate", {
    intentPath: "latest",
    tokenBudget: 2600,
  });
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.decision, "human-review");
  assert.strictEqual(gate.canContinue, false);
  assert.strictEqual(gate.mustStop, true);
  assert.strictEqual(gate.needsHuman, true);
  assert(JSON.stringify(gate).includes("src/auth.ts::login"), "installed MCP gate should name boundary drift");
}

function main() {
  fs.mkdirSync(consumerRoot, { recursive: true });
  setupConsumerRepo();
  const installed = installPackages();
  proveInstalledCli(installed.rippleBin);
  proveInstalledMcp(installed.mcpServer);

  console.log("Ripple external install smoke passed");
  console.log(`Mode: ${live ? "live npm registry" : "local packed npm tarballs"}`);
  console.log(`Workspace: ${consumerRoot}`);
  console.log("Installed: @getripple/core, @getripple/cli, @getripple/mcp");
  console.log("Verified: ripple binary, ripple-mcp server, CLI gate stop, MCP gate stop");
}

main();
