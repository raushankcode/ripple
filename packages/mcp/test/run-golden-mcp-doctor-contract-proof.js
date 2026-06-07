const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { MCP_PROTOCOL_VERSION, createRippleMcpToolHost } = require("../dist");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const serverPath = path.join(repoRoot, "packages", "mcp", "dist", "server.js");
const proofRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-mcp-doctor-contract-proof-${Date.now()}`
);

function workspacePath(name) {
  return path.join(proofRoot, name);
}

function writeFile(workspaceRoot, relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function runGit(workspaceRoot, args) {
  execFileSync("git", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function setupFixture(name) {
  const workspaceRoot = workspacePath(name);
  writeFile(
    workspaceRoot,
    "package.json",
    JSON.stringify({ name: `ripple-mcp-doctor-contract-${name}` }, null, 2)
  );
  writeFile(
    workspaceRoot,
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  return value.trim();",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    workspaceRoot,
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
    workspaceRoot,
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
    workspaceRoot,
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
  writeFile(workspaceRoot, ".gitignore", [".ripple/.cache/", ""].join("\n"));
  runGit(workspaceRoot, ["init"]);
  return workspaceRoot;
}

async function callMcpTool(workspaceRoot, tool, args = {}) {
  const host = createRippleMcpToolHost({ workspaceRoot });
  try {
    const result = await host.callTool(tool, args);
    assert.strictEqual(result.tool, tool);
    return result.data;
  } finally {
    host.dispose();
  }
}

function parseJsonLines(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function callStdioTool(workspaceRoot, tool, args = {}) {
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "golden-mcp-doctor-contract-proof",
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
    [serverPath, "--workspace", workspaceRoot],
    {
      input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    }
  );

  if (result.error) {
    throw new Error(
      `MCP stdio call timed out or failed for ${tool}: ${result.error.message}\n${result.stderr}`
    );
  }
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(
    result.stderr.trim(),
    "",
    `MCP stdio should not leak scan/cache logs to stderr for ${tool}`
  );

  const responses = parseJsonLines(result.stdout);
  assert.strictEqual(responses.length, 2, "stdio server should return initialize + tool call");
  assert.strictEqual(responses[0].id, 1);
  assert.strictEqual(responses[0].result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.strictEqual(responses[1].id, 2);
  assert.strictEqual(responses[1].result.isError, false, responses[1].result.content?.[0]?.text);
  assert.strictEqual(responses[1].result.content[0].type, "text");
  assert(
    responses[1].result.content[0].text.includes('"status"'),
    "stdio doctor response should contain serialized structured data"
  );
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
    `${label} nextRequiredAction`
  );
  assert(
    doctor.why.some((reason) => reason.includes("No latest saved intent exists")),
    `${label} should explain missing saved intent`
  );
  assert(
    doctor.fixNow.some((fix) => fix.includes("ripple plan --file")),
    `${label} should tell the agent how to create a saved intent`
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
    `${label} nextRequiredAction`
  );
  assert.deepStrictEqual(doctor.fixNow, [], `${label} fixNow`);
  assert(
    doctor.why.some((reason) => reason.includes("detect drift, and fail CI")),
    `${label} should explain CI gate readiness`
  );
}

async function proveHostDoctorContract() {
  const workspaceRoot = setupFixture("host");
  assertDoctorBlocks(await callMcpTool(workspaceRoot, "ripple_doctor"), "MCP host before plan");

  const plan = await callMcpTool(workspaceRoot, "ripple_plan_context", {
    task: "normalize display name whitespace",
    filePath: "src/util.ts",
    tokenBudget: 2600,
    mode: "file",
    saveIntent: true,
  });
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.readinessSnapshot.status, "ready");

  assertDoctorAllows(await callMcpTool(workspaceRoot, "ripple_doctor"), "MCP host after plan");
}

function proveStdioDoctorContract() {
  const workspaceRoot = setupFixture("stdio");
  assertDoctorBlocks(callStdioTool(workspaceRoot, "ripple_doctor"), "MCP stdio before plan");

  const plan = callStdioTool(workspaceRoot, "ripple_plan_context", {
    task: "normalize display name whitespace",
    filePath: "src/util.ts",
    tokenBudget: 2600,
    mode: "file",
    saveIntent: true,
  });
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.readinessSnapshot.status, "ready");

  assertDoctorAllows(callStdioTool(workspaceRoot, "ripple_doctor"), "MCP stdio after plan");
}

async function main() {
  await proveHostDoctorContract();
  proveStdioDoctorContract();

  console.log("Ripple golden MCP doctor contract proof passed");
  console.log(`Workspace root: ${proofRoot}`);
  console.log("MCP host: setup-required -> continue");
  console.log("MCP stdio: setup-required -> continue");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
