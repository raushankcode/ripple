const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const proofRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-mcp-package-install-proof-${Date.now()}`,
);
const packRoot = path.join(proofRoot, "packs");
const consumerRoot = path.join(proofRoot, "consumer");

function writeFile(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function runNpm(args, cwd) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return execFileSync(process.execPath, [npmExecPath, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  return execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGit(args) {
  execFileSync("git", args, {
    cwd: consumerRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function packPackage(packageDir, expectedFiles) {
  fs.mkdirSync(packRoot, { recursive: true });
  const output = runNpm(["pack", "--json", "--pack-destination", packRoot], packageDir);
  const [packed] = JSON.parse(output);
  assert(packed.filename, `npm pack output should include filename for ${packageDir}`);
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

function setupConsumerRepo() {
  writeFile(
    consumerRoot,
    "package.json",
    JSON.stringify({ name: "ripple-mcp-package-consumer", private: true }, null, 2),
  );
  writeFile(
    consumerRoot,
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
    consumerRoot,
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
  writeFile(
    consumerRoot,
    ".ripple/policy.json",
    JSON.stringify(
      {
        protocol: "ripple-policy",
        version: 1,
        defaultMode: "file",
        riskRules: [
          {
            paths: ["src/**"],
            risk: "medium",
          },
        ],
      },
      null,
      2,
    ),
  );
  writeFile(
    consumerRoot,
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

function installPackedMcp(coreTarball, mcpTarball) {
  runNpm(
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      coreTarball,
      mcpTarball,
    ],
    consumerRoot,
  );

  const coreEntry = path.join(
    consumerRoot,
    "node_modules",
    "@getripple",
    "core",
    "dist",
    "index.js",
  );
  const mcpEntry = path.join(
    consumerRoot,
    "node_modules",
    "@getripple",
    "mcp",
    "dist",
    "index.js",
  );
  const mcpServer = path.join(
    consumerRoot,
    "node_modules",
    "@getripple",
    "mcp",
    "dist",
    "server.js",
  );
  const binPath = path.join(
    consumerRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "ripple-mcp.cmd" : "ripple-mcp",
  );

  assert(fs.existsSync(coreEntry), "Installed @getripple/core should include dist/index.js");
  assert(fs.existsSync(mcpEntry), "Installed @getripple/mcp should include dist/index.js");
  assert(fs.existsSync(mcpServer), "Installed @getripple/mcp should include dist/server.js");
  assert(fs.existsSync(binPath), "Installed package should expose the ripple-mcp binary");
  return mcpServer;
}

function parseJsonLines(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function callInstalledStdioTool(serverPath, tool, args = {}) {
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "golden-mcp-package-install-proof",
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
    [serverPath, "--workspace", consumerRoot],
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
  assert.strictEqual(responses.length, 2, "installed stdio server should return initialize + tool call");
  assert.strictEqual(responses[0].id, 1);
  assert.strictEqual(responses[0].result.serverInfo.name, "ripple-mcp");
  assert.strictEqual(responses[0].result.serverInfo.version, "1.0.4");
  assert.strictEqual(responses[1].id, 2);
  assert.strictEqual(responses[1].result.isError, false, responses[1].result.content?.[0]?.text);
  assert.strictEqual(responses[1].result.content[0].type, "text");
  assert(
    responses[1].result.content[0].text.includes('"protocol"') ||
      responses[1].result.content[0].text.includes('"status"'),
    "installed MCP text response should contain serialized structured data",
  );
  return responses[1].result.structuredContent;
}

function changeUtilityInsidePlan() {
  writeFile(
    consumerRoot,
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
  runGit(["add", "src/util.ts"]);
}

function proveInstalledMcpWorks(serverPath) {
  const workflow = callInstalledStdioTool(serverPath, "ripple_get_agent_workflow");
  assert.strictEqual(workflow.protocol, "ripple-agent-workflow");
  assert.strictEqual(workflow.commands.initializeRepo, "ripple init");

  const beforePlanDoctor = callInstalledStdioTool(serverPath, "ripple_doctor");
  assert.strictEqual(beforePlanDoctor.status, "needs_setup");
  assert.strictEqual(beforePlanDoctor.enforcement.level, "advisory");
  assert.strictEqual(beforePlanDoctor.enforcement.canGuideAgents, true);
  assert.strictEqual(beforePlanDoctor.enforcement.canDetectDrift, false);
  assert.strictEqual(beforePlanDoctor.enforcement.canBlockInCi, false);
  assert(
    beforePlanDoctor.nextSteps.some((step) => step.includes("ripple plan")),
    "installed MCP doctor should tell agents a saved plan is required",
  );

  const plan = callInstalledStdioTool(serverPath, "ripple_plan_context", {
    task: "normalize display name whitespace",
    filePath: "src/util.ts",
    tokenBudget: 2600,
    mode: "file",
    saveIntent: true,
  });
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.targetFile, "src/util.ts");
  assert.strictEqual(plan.changeIntent.controlMode, "file");
  assert.strictEqual(plan.changeIntent.readinessSnapshot.canBlockInCi, true);
  assert.strictEqual(plan.changeIntentPath, ".ripple/intents/latest.json");

  const afterPlanDoctor = callInstalledStdioTool(serverPath, "ripple_doctor");
  assert.strictEqual(afterPlanDoctor.status, "ready");
  assert.strictEqual(afterPlanDoctor.enforcement.level, "ci-gate-ready");
  assert.strictEqual(afterPlanDoctor.enforcement.canGuideAgents, true);
  assert.strictEqual(afterPlanDoctor.enforcement.canDetectDrift, true);
  assert.strictEqual(afterPlanDoctor.enforcement.canBlockInCi, true);

  changeUtilityInsidePlan();

  const gate = callInstalledStdioTool(serverPath, "ripple_gate", {
    tokenBudget: 2600,
    intentPath: "latest",
  });
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.status, "open");
  assert.strictEqual(gate.decision, "continue");
  assert.strictEqual(gate.canContinue, true);
  assert.strictEqual(gate.mustStop, false);
  assert.strictEqual(gate.needsHuman, false);
  assert.strictEqual(gate.nextRequiredPhase, "done");
  assert.strictEqual(gate.auditStatus, "pass");
}

function main() {
  const coreTarball = packPackage(path.join(repoRoot, "packages", "core"), [
    "dist/index.js",
  ]);
  const mcpTarball = packPackage(path.join(repoRoot, "packages", "mcp"), [
    "dist/index.js",
    "dist/server.js",
  ]);

  setupConsumerRepo();
  const mcpServer = installPackedMcp(coreTarball, mcpTarball);
  proveInstalledMcpWorks(mcpServer);

  console.log("Ripple golden MCP package install proof passed");
  console.log(`Workspace: ${consumerRoot}`);
  console.log("Packed packages: @getripple/core, @getripple/mcp");
  console.log("Installed MCP stdio: workflow -> doctor advisory -> plan -> doctor ci-gate-ready -> gate open");
}

main();
