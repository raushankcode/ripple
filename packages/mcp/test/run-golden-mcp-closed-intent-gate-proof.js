const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  createRippleMcpToolHost,
  RippleMcpJsonRpcServer,
} = require("../dist");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-mcp-closed-intent-gate-proof-${Date.now()}`,
);

function writeFile(relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function assertIncludes(output, expected, label) {
  assert(
    output.includes(expected),
    `${label} should include ${expected}\n\nOutput:\n${output}`,
  );
}

function assertNotIncludes(output, unexpected, label) {
  assert(
    !output.includes(unexpected),
    `${label} should not include ${unexpected}\n\nOutput:\n${output}`,
  );
}

function setupClosedIntentFixture() {
  writeFile(
    "package.json",
    JSON.stringify({ name: "ripple-mcp-closed-intent-gate-proof" }, null, 2),
  );
  writeFile(
    ".ripple/intents/latest.json",
    `${JSON.stringify(
      {
        protocol: "ripple-closed-intent",
        version: 1,
        closedAt: "2026-06-12T00:00:00.000Z",
        closedBy: "Ripple MCP Golden Proof",
        reason: "previous MCP boundary is complete",
        originalIntentPath: ".ripple/intents/latest.json",
        intent: {
          protocol: "ripple-change-intent",
          version: 1,
          id: "intent-golden-mcp-closed",
          createdAt: "2026-06-12T00:00:00.000Z",
          task: "change auth behavior",
          targetFile: "src/auth.ts",
          controlMode: "file",
          humanGate: "required-before-edit",
          boundaryRisk: "critical",
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function callJsonRpc(server, id, name, args = {}) {
  return server.handleMessage({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  });
}

async function main() {
  setupClosedIntentFixture();

  const host = createRippleMcpToolHost({ workspaceRoot });
  const server = new RippleMcpJsonRpcServer(host, "golden-closed-intent-proof");

  try {
    const statusResponse = await callJsonRpc(
      server,
      1,
      "ripple_get_intent_status",
      { intentPath: "latest" },
    );
    assert.strictEqual(statusResponse.result.isError, false);
    assert.strictEqual(statusResponse.result.structuredContent.state, "closed");
    assert.strictEqual(statusResponse.result.structuredContent.active, false);
    assert.strictEqual(statusResponse.result.structuredContent.canSaveNewIntent, true);

    const gateResponse = await callJsonRpc(server, 2, "ripple_gate", {
      intentPath: "latest",
    });

    assert.strictEqual(gateResponse.result.isError, false);
    assert.strictEqual(
      gateResponse.result.structuredContent.protocol,
      "ripple-gate-intent-block",
    );
    assert.strictEqual(gateResponse.result.structuredContent.intentState, "closed");
    assert.strictEqual(gateResponse.result.structuredContent.canContinue, false);
    assert.strictEqual(gateResponse.result.structuredContent.mustStop, true);
    assert.strictEqual(gateResponse.result.structuredContent.needsHuman, true);
    assert(
      gateResponse.result.structuredContent.commands.plan.includes(
        'ripple plan --file <file> --task "<task>" --agent --save',
      ),
      "closed intent MCP gate should return the new saved plan command as structured data",
    );

    const text = gateResponse.result.content[0].text;
    [
      "\"protocol\": \"ripple-gate-intent-block\"",
      "\"decision\": \"create-intent\"",
      "\"canContinue\": false",
      "\"mustStop\": true",
      "\"needsHuman\": true",
      "the saved boundary is closed",
      "Closed by: Ripple MCP Golden Proof.",
      "Reason: previous MCP boundary is complete",
      "Agents must not continue from a closed boundary.",
      "ripple intent status --intent latest --json",
      "create a new saved plan",
      'ripple plan --file <file> --task \\"<task>\\" --agent --save',
    ].forEach((expected) =>
      assertIncludes(text, expected, "golden MCP closed intent gate proof"),
    );

    [
      "git diff",
      "Git could not be started",
      "Could not read staged files",
    ].forEach((unexpected) =>
      assertNotIncludes(text, unexpected, "golden MCP closed intent gate proof"),
    );

    console.log("Ripple golden MCP closed intent gate proof passed");
    console.log(`Workspace: ${workspaceRoot}`);
    console.log("MCP gate: closed intent fails closed before git");
  } finally {
    server.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
