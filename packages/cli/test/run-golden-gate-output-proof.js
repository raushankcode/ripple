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
  `golden-gate-output-proof-${Date.now()}`
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

function runGit(args) {
  execFileSync("git", args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function assertIncludes(output, expected, label) {
  assert(
    output.includes(expected),
    `${label} should include ${expected}\n\nOutput:\n${output}`
  );
}

function setupFixture() {
  if (!fs.existsSync(cliPath)) {
    throw new Error("CLI build output is missing. Run npm run build:cli first.");
  }

  writeFile(
    "package.json",
    JSON.stringify({ name: "ripple-gate-output-proof" }, null, 2)
  );
  writeFile(
    "src/auth.ts",
    [
      "export function refreshToken(value: string): string {",
      "  return value.trim();",
      "}",
      "",
      "export function login(value: string): string {",
      "  if (!value) {",
      "    return 'anonymous';",
      "  }",
      "  return value;",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "tests/auth.test.ts",
    [
      "import { refreshToken } from '../src/auth';",
      "",
      "export function testRefreshToken(): string {",
      "  return refreshToken(' abc ');",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "src/auth-consumer.ts",
    [
      "import { refreshToken } from './auth';",
      "",
      "export function consumeAuthToken(value: string): string {",
      "  return refreshToken(value);",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    "src/admin-session.ts",
    [
      "import { login } from './auth';",
      "",
      "export function startAdminSession(value: string): string {",
      "  return login(value);",
      "}",
      "",
    ].join("\n")
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

function createApprovedFunctionIntent() {
  runCli([
    "plan",
    "--file",
    "src/auth.ts",
    "--symbol",
    "refreshToken",
    "--task",
    "fix refresh token retry behavior",
    "--mode",
    "function",
    "--save",
  ]);
  runCli([
    "approve",
    "--intent",
    "latest",
    "--gate",
    "before-risky-edit",
    "--reason",
    "golden gate output approval",
  ]);
}

function removeGeneratedContextBundle() {
  [
    path.join(workspaceRoot, ".ripple", ".cache", "context.json"),
    path.join(workspaceRoot, ".ripple", ".cache", "context.files.json"),
    path.join(workspaceRoot, ".ripple", ".cache", "context.symbols.json"),
    path.join(workspaceRoot, ".ripple", "WORKFLOW.md"),
  ].forEach((filePath) => fs.rmSync(filePath, { force: true }));

  fs.rmSync(path.join(workspaceRoot, ".ripple", ".cache", "focus"), {
    recursive: true,
    force: true,
  });
}

function assertGeneratedContextBundleWasNotRecreated() {
  [
    path.join(workspaceRoot, ".ripple", ".cache", "context.json"),
    path.join(workspaceRoot, ".ripple", ".cache", "context.files.json"),
    path.join(workspaceRoot, ".ripple", ".cache", "context.symbols.json"),
    path.join(workspaceRoot, ".ripple", "WORKFLOW.md"),
    path.join(workspaceRoot, ".ripple", ".cache", "focus"),
  ].forEach((generatedPath) => {
    assert(
      !fs.existsSync(generatedPath),
      `gate should not regenerate ${path.relative(workspaceRoot, generatedPath)}`
    );
  });
}

function crossFunctionBoundary() {
  writeFile(
    "src/auth.ts",
    [
      "export function refreshToken(value: string): string {",
      "  return value.trim();",
      "}",
      "",
      "export function login(value: string): string {",
      "  const normalized = value.trim();",
      "  if (!normalized) {",
      "    return 'anonymous';",
      "  }",
      "  return normalized;",
      "}",
      "",
    ].join("\n")
  );
  runGit(["add", "src/auth.ts"]);
}

function main() {
  setupFixture();
  createApprovedFunctionIntent();
  removeGeneratedContextBundle();
  crossFunctionBoundary();

  const output = runCli(["gate", "--intent", "latest"]);
  assertGeneratedContextBundleWasNotRecreated();

  [
    "Ripple gate: STOP",
    "Agent must stop and ask the human before continuing.",
    "Decision: human-review",
    "Can continue: no",
    "Must stop: yes",
    "Risk:",
    "Risk summary:",
    "Why this is risky:",
    "HIGH boundary-crossed: Agent changed symbols outside the approved Ripple boundary.",
    "MEDIUM public-contract: Changed exported/public symbols may affect callers or external contracts.",
    "MEDIUM blast-radius:",
    "Evidence:",
    "allowed symbol: src/auth.ts::refreshToken",
    "changed outside boundary: src/auth.ts::login",
    "Required:",
    "Undo the outside-boundary change or create a wider human-approved intent.",
    "Review public contract changes before keeping this edit.",
    "Intent:",
    "Boundary: function",
    "Allowed:",
    "src/auth.ts::refreshToken",
    "Changed outside boundary:",
    "symbol: src/auth.ts::login",
    "Commands:",
    "ripple repair --agent --intent latest",
  ].forEach((expected) => assertIncludes(output, expected, "golden gate output"));

  const json = JSON.parse(runCli(["gate", "--intent", "latest", "--json"]));
  assert(
    ["high", "critical"].includes(json.risk.level),
    `risk level should be high or critical; got ${json.risk.level}`
  );
  assert(json.risk.score >= 51, `risk score should be high or critical; got ${json.risk.score}`);
  assert(
    json.risk.reasons.some((reason) => reason.kind === "boundary-crossed"),
    "risk should include boundary-crossed reason"
  );
  assert(
    json.risk.reasons.some((reason) =>
      reason.evidence.includes("changed outside boundary: src/auth.ts::login")
    ),
    "risk evidence should include changed outside boundary symbol"
  );
  assert(
    json.risk.reasons.some((reason) => reason.kind === "blast-radius"),
    "risk should include blast-radius reason when changed file has downstream importers"
  );
  assert(
    json.risk.reasons.some((reason) =>
      reason.evidence.some((evidence) => evidence.includes("direct importers"))
    ),
    "risk evidence should include downstream importer count"
  );
  assert(
    json.risk.requiredActions.some((action) =>
      action.includes("Undo the outside-boundary change")
    ),
    "risk required actions should tell the agent to undo or replan"
  );

  console.log("Ripple golden gate output proof passed");
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("Gate output: compact STOP report");
}

main();
