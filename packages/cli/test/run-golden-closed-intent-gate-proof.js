const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const workspaceRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-closed-intent-gate-proof-${Date.now()}`,
);

function writeFile(relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function runCliResult(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  writeFile(
    "package.json",
    JSON.stringify({ name: "ripple-closed-intent-gate-proof" }, null, 2),
  );
  writeFile(
    ".ripple/intents/latest.json",
    `${JSON.stringify(
      {
        protocol: "ripple-closed-intent",
        version: 1,
        closedAt: "2026-06-12T00:00:00.000Z",
        closedBy: "Ripple Golden Proof",
        reason: "previous boundary is complete",
        originalIntentPath: ".ripple/intents/latest.json",
        intent: {
          protocol: "ripple-change-intent",
          version: 1,
          id: "intent-golden-closed",
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

function main() {
  setupClosedIntentFixture();

  const result = runCliResult(["gate", "--intent", "latest"]);
  if (result.error) {
    throw result.error;
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const output = `${stdout}\n${stderr}`;

  assert.notStrictEqual(
    result.status,
    0,
    "closed intent gate should stop instead of continuing",
  );
  assert.strictEqual(
    stdout,
    "",
    "closed intent gate should not print a successful gate report",
  );

  [
    "Ripple CLI error:",
    "No active Ripple change intent found",
    "the saved boundary is closed",
    "Closed by: Ripple Golden Proof.",
    "Reason: previous boundary is complete",
    "Agents must not continue from a closed boundary.",
    "Run ripple intent status",
    "create a new saved plan",
    "ripple plan --file <file> --task \"<task>\" --agent --save",
  ].forEach((expected) =>
    assertIncludes(output, expected, "golden closed intent gate proof"),
  );

  [
    "git diff",
    "Git could not be started",
    "Could not read staged files",
    "Ripple gate: CONTINUE",
  ].forEach((unexpected) =>
    assertNotIncludes(output, unexpected, "golden closed intent gate proof"),
  );

  console.log("Ripple golden closed intent gate proof passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("Gate: closed intent fails closed before git");
}

main();
