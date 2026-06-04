const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  GraphEngine,
  buildChangeIntent,
  buildIntentDriftRepairPlan,
  buildStagedCheckSummary,
  listGitStagedFiles,
  validateStagedCheckAgainstIntent,
} = require("../dist");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const workspaceBase = path.join(
  repoRoot,
  "test",
  ".tmp",
  `core-plan-quality-${Date.now()}`
);

function writeFile(workspaceRoot, relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function createWorkspace(name, files) {
  const workspaceRoot = path.join(workspaceBase, name);
  writeFile(
    workspaceRoot,
    "package.json",
    JSON.stringify({ name: `core-plan-${name}` }, null, 2)
  );

  Object.entries(files).forEach(([relativePath, contents]) => {
    writeFile(workspaceRoot, relativePath, contents);
  });

  return workspaceRoot;
}

async function withEngine(name, files, callback) {
  const workspaceRoot = createWorkspace(name, files);
  await withScannedEngine(workspaceRoot, callback);
}

async function withScannedEngine(workspaceRoot, callback) {
  const engine = new GraphEngine(workspaceRoot);

  try {
    const originalLog = console.log;
    console.log = () => {};
    try {
      await engine.initialScan();
    } finally {
      console.log = originalLog;
    }

    await callback(engine);
  } finally {
    engine.dispose();
  }
}

function allPlanFiles(plan) {
  return [...plan.readFirst, ...plan.readIfNeeded];
}

function findPlanFile(plan, file) {
  return allPlanFiles(plan).find((item) => item.file === file);
}

function assertPlannedFile(plan, file, role, signal) {
  const planned = findPlanFile(plan, file);
  assert(planned, `plan should include ${file}`);
  assert.strictEqual(planned.role, role, `${file} should be a ${role} file`);
  assert(
    planned.signals.includes(signal),
    `${file} should include ${signal} signal`
  );
  return planned;
}

function assertNotPlanned(plan, file) {
  assert(
    !findPlanFile(plan, file),
    `${file} should not be included in readFirst or readIfNeeded`
  );
}

function assertPlannedBefore(plan, firstFile, secondFile) {
  const files = allPlanFiles(plan).map((item) => item.file);
  const firstIndex = files.indexOf(firstFile);
  const secondIndex = files.indexOf(secondFile);
  assert(firstIndex !== -1, `plan should include ${firstFile}`);
  assert(secondIndex !== -1, `plan should include ${secondFile}`);
  assert(
    firstIndex < secondIndex,
    `${firstFile} should be planned before ${secondFile}`
  );
}

function stageFiles(workspaceRoot, files) {
  execFileSync("git", ["init"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSync("git", ["add", ...files], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function commitBaseline(workspaceRoot) {
  execFileSync("git", ["init"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSync("git", ["add", "."], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=ripple@test.local",
      "-c",
      "user.name=Ripple Test",
      "commit",
      "-m",
      "baseline",
    ],
    {
      cwd: workspaceRoot,
      stdio: ["ignore", "ignore", "pipe"],
    }
  );
}

function sharedUtilityFiles() {
  return {
    "src/util.ts": [
      "export function trimName(value) {",
      "  return value.trim();",
      "}",
      "",
      "export function shout(value) {",
      "  return value.toUpperCase();",
      "}",
      "",
    ].join("\n"),
    "src/index.ts": [
      "import { shout, trimName } from './util';",
      "",
      "export function label(value) {",
      "  return shout(trimName(value));",
      "}",
      "",
    ].join("\n"),
    "src/app/page.ts": [
      "import { label } from '../index';",
      "",
      "export function pageTitle() {",
      "  return label(' ripple ');",
      "}",
      "",
    ].join("\n"),
    "src/other.ts": [
      "export function unrelated(value) {",
      "  return value;",
      "}",
      "",
    ].join("\n"),
    "tests/util.test.ts": [
      "import { trimName } from '../src/util';",
      "",
      "export function testTrimName() {",
      "  if (trimName(' ripple ') !== 'ripple') {",
      "    throw new Error('bad trim');",
      "  }",
      "}",
      "",
    ].join("\n"),
    "tests/index.spec.ts": [
      "import { label } from '../src/index';",
      "",
      "export function testLabel() {",
      "  if (label(' ripple ') !== 'RIPPLE') {",
      "    throw new Error('bad label');",
      "  }",
      "}",
      "",
    ].join("\n"),
    "tests/unrelated.test.ts": [
      "import { unrelated } from '../src/other';",
      "",
      "export function testUnrelated() {",
      "  return unrelated('noise');",
      "}",
      "",
    ].join("\n"),
    "docs/usage.ts": [
      "export const ignoredExample = 'not connected to util';",
      "",
    ].join("\n"),
  };
}

function pythonServiceFiles() {
  return {
    "pyproject.toml": "[project]\nname = \"python-service\"\n",
    "src/utils.py": [
      "def normalize_token(token):",
      "    return token.strip().lower()",
      "",
    ].join("\n"),
    "src/auth.py": [
      "from .utils import normalize_token",
      "",
      "",
      "def authenticate(token):",
      "    normalized = normalize_token(token)",
      "    return normalized == 'valid'",
      "",
    ].join("\n"),
    "src/api.py": [
      "from .auth import authenticate",
      "",
      "",
      "def handle_request(token):",
      "    return authenticate(token)",
      "",
    ].join("\n"),
    "tests/test_auth.py": [
      "from src.auth import authenticate",
      "",
      "",
      "def test_authenticate():",
      "    assert authenticate(' valid ')",
      "",
    ].join("\n"),
  };
}

async function testStagedCheckDetectsChangedSymbolsAndContractRisk() {
  await withEngine("staged-symbol-diff", sharedUtilityFiles(), async (engine) => {
    stageFiles(engine.workspaceRoot, ["src/util.ts", "package.json"]);

    const summary = buildStagedCheckSummary(engine, {
      workspaceRoot: engine.workspaceRoot,
      stagedFiles: listGitStagedFiles(engine.workspaceRoot),
      tokenBudget: 1800,
    });

    assert.strictEqual(summary.mode, "staged");
    assert.strictEqual(summary.stagedFiles, 1);
    assert.strictEqual(summary.skippedFiles.length, 1);
    assert.strictEqual(summary.checkedFiles, 1);
    assert.strictEqual(summary.changedSymbols.length >= 2, true);
    assert.strictEqual(summary.adapterSupport.primaryAdapter.id, "builtin-js-ts");

    const trimName = summary.changedSymbols.find(
      (symbol) => symbol.symbol === "src/util.ts::trimName"
    );
    assert(trimName, "staged check should detect changed trimName symbol");
    assert.strictEqual(trimName.exported, true);
    assert.strictEqual(trimName.symbolStatus, "created");
    assert.strictEqual(trimName.signatureChanged, false);
    assert.strictEqual(trimName.contractChanged, true);
    assert.strictEqual(trimName.changeKind, "signature-or-contract");
    assert(
      trimName.contractRisk !== "none",
      "exported changed trimName should carry contract review risk"
    );
    assert(
      trimName.adapterSignals.some(
        (signal) => signal.capability === "symbols" && signal.agentUse === "trust"
      ),
      "changed symbol should include trusted symbol adapter confidence"
    );
    assert(
      summary.contractRisks.some((risk) => risk.symbol === "src/util.ts::trimName"),
      "staged check should aggregate symbol contract risk"
    );
    const trimNameContractRisk = summary.contractRisks.find(
      (risk) => risk.symbol === "src/util.ts::trimName"
    );
    assert(trimNameContractRisk, "staged check should include trimName contract risk details");
    assert(
      trimNameContractRisk.adapterSignals.some(
        (signal) => signal.capability === "tests" && signal.agentUse === "verify"
      ),
      "contract risk should include verify-only test confidence when tests are verification targets"
    );
    assert(
      summary.files[0].changedLineRanges.length > 0,
      "staged check should include diff line ranges"
    );
    assert(
      summary.files[0].adapterSignals.some(
        (signal) => signal.capability === "symbols" && signal.agentUse === "trust"
      ),
      "file check should aggregate adapter confidence signals"
    );
    assert(
      summary.files[0].verificationTargets.includes("tests/util.test.ts"),
      "staged check should preserve verification targets"
    );
    assert(
      summary.agentActions.trustedFindings.some((item) =>
        item.includes("src/util.ts::trimName")
      ),
      "staged check should summarize trusted symbol findings"
    );
    assert(
      summary.agentActions.verifyBeforeCommit.some((item) =>
        item.includes("tests/util.test.ts")
      ),
      "staged check should summarize verification actions"
    );
    assert(
      summary.agentActions.manualReviewRequired.some((item) =>
        item.includes("src/util.ts::trimName")
      ),
      "staged check should summarize manual contract review actions"
    );
  });
}

async function testStagedCheckSeparatesImplementationFromSignatureChange() {
  const baseFiles = {
    "src/util.ts": [
      "export function trimName(value: string): string {",
      "  const normalized = value.trim();",
      "  return normalized;",
      "}",
      "",
    ].join("\n"),
    "src/index.ts": [
      "import { trimName } from './util';",
      "",
      "export function label(value: string): string {",
      "  return trimName(value);",
      "}",
      "",
    ].join("\n"),
  };

  const implementationWorkspace = createWorkspace(
    "staged-implementation-only",
    baseFiles
  );
  commitBaseline(implementationWorkspace);
  writeFile(
    implementationWorkspace,
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  const normalized = value.trim().toLowerCase();",
      "  return normalized;",
      "}",
      "",
    ].join("\n")
  );
  execFileSync("git", ["add", "src/util.ts"], {
    cwd: implementationWorkspace,
    stdio: ["ignore", "ignore", "pipe"],
  });

  await withScannedEngine(implementationWorkspace, async (engine) => {
    const summary = buildStagedCheckSummary(engine, {
      workspaceRoot: implementationWorkspace,
      stagedFiles: listGitStagedFiles(implementationWorkspace),
      tokenBudget: 1800,
    });
    const trimName = summary.changedSymbols.find(
      (symbol) => symbol.symbol === "src/util.ts::trimName"
    );

    assert(trimName, "implementation-only change should detect trimName");
    assert.strictEqual(trimName.symbolStatus, "modified");
    assert.strictEqual(trimName.signatureTouched, false);
    assert.strictEqual(trimName.signatureChanged, false);
    assert.strictEqual(trimName.contractChanged, false);
    assert.strictEqual(trimName.returnLineChanged, false);
    assert.strictEqual(trimName.changeKind, "implementation");
    assert.strictEqual(trimName.contractRisk, "none");
    assert.strictEqual(summary.contractRisks.length, 0);
  });

  const signatureWorkspace = createWorkspace("staged-signature-change", baseFiles);
  commitBaseline(signatureWorkspace);
  writeFile(
    signatureWorkspace,
    "src/util.ts",
    [
      "export function trimName(value: string, fallback = ''): string {",
      "  const normalized = value.trim();",
      "  return normalized || fallback;",
      "}",
      "",
    ].join("\n")
  );
  execFileSync("git", ["add", "src/util.ts"], {
    cwd: signatureWorkspace,
    stdio: ["ignore", "ignore", "pipe"],
  });

  await withScannedEngine(signatureWorkspace, async (engine) => {
    const summary = buildStagedCheckSummary(engine, {
      workspaceRoot: signatureWorkspace,
      stagedFiles: listGitStagedFiles(signatureWorkspace),
      tokenBudget: 1800,
    });
    const trimName = summary.changedSymbols.find(
      (symbol) => symbol.symbol === "src/util.ts::trimName"
    );

    assert(trimName, "signature change should detect trimName");
    assert.strictEqual(trimName.symbolStatus, "modified");
    assert.strictEqual(trimName.signatureTouched, true);
    assert.strictEqual(trimName.signatureChanged, true);
    assert.strictEqual(trimName.contractChanged, true);
    assert.strictEqual(trimName.changeKind, "signature-or-contract");
    assert.strictEqual(trimName.contractRisk, "high");
    assert(
      summary.contractRisks.some((risk) => risk.symbol === "src/util.ts::trimName"),
      "signature change should aggregate contract risk"
    );
  });
}

async function testChangeIntentValidatesPlannedScope() {
  await withEngine("intent-matched-scope", sharedUtilityFiles(), async (engine) => {
    const plan = engine.planContext("change trim behavior", "src/util.ts", 1800);
    assert(plan, "planContext should return a plan");
    const intent = buildChangeIntent(plan);
    assert.deepStrictEqual(
      intent.editableFiles,
      ["src/util.ts"],
      "change intent should restrict editable files to the target file"
    );
    assert(
      intent.contextFiles.includes("tests/util.test.ts"),
      "change intent should keep direct tests as context-only files"
    );
    assert(
      intent.contextFiles.includes("src/index.ts"),
      "change intent should keep direct importers as context-only files"
    );

    stageFiles(engine.workspaceRoot, ["src/util.ts", "package.json"]);
    const staged = buildStagedCheckSummary(engine, {
      workspaceRoot: engine.workspaceRoot,
      stagedFiles: listGitStagedFiles(engine.workspaceRoot),
      tokenBudget: 1800,
    });
    const checked = validateStagedCheckAgainstIntent(staged, intent);

    assert(checked.intentValidation, "intent validation should be attached");
    assert.strictEqual(checked.intentValidation.verdict, "matched");
    assert.strictEqual(checked.intentValidation.driftVerdict.status, "pass");
    assert.strictEqual(checked.intentValidation.driftVerdict.decision, "continue");
    assert(
      checked.intentValidation.driftVerdict.fix.some((fix) =>
        fix.includes("tests/util.test.ts")
      ),
      "matched drift verdict should tell agents what to verify"
    );
    assert.strictEqual(checked.intentValidation.plannedScope, "matched");
    assert.strictEqual(checked.intentValidation.unplannedFiles.length, 0);
    assert(
      checked.intentValidation.recommendedAction.includes("Proceed"),
      "matched intent should provide a proceed action"
    );
    assert.strictEqual(checked.intentValidation.blockingReasons.length, 0);
    assert(
      checked.intentValidation.nextSteps.some((step) => step.includes("verification")),
      "matched intent should recommend verification"
    );
    const repairPlan = buildIntentDriftRepairPlan(checked);
    assert.strictEqual(repairPlan.verdict, "matched");
    assert.strictEqual(repairPlan.driftVerdict.status, "pass");
    assert.strictEqual(repairPlan.driftVerdict.decision, "continue");
    assert.strictEqual(repairPlan.status, "no-repair-needed");
    assert.strictEqual(repairPlan.unstageFiles.length, 0);
    assert(
      repairPlan.verificationTargets.includes("tests/util.test.ts"),
      "matched repair plan should preserve verification targets"
    );
    assert(
      repairPlan.fixActions.some(
        (action) =>
          action.type === "verify" &&
          action.priority === "required" &&
          action.target === "tests/util.test.ts"
      ),
      "matched repair plan should tell agents to verify the direct test"
    );
    assert(
      repairPlan.agentActions.trustedFindings.some((item) =>
        item.includes("src/util.ts::trimName")
      ),
      "matched repair plan should preserve trusted findings"
    );
    assert(
      repairPlan.agentActions.verifyBeforeCommit.some((item) =>
        item.includes("tests/util.test.ts")
      ),
      "matched repair plan should preserve verify-before-commit actions"
    );
    assert(
      checked.intentValidation.plannedFilesChanged.includes("src/util.ts"),
      "planned scope should include changed target file"
    );
  });

  await withEngine("intent-context-only-drift", sharedUtilityFiles(), async (engine) => {
    const plan = engine.planContext("change trim behavior", "src/util.ts", 1800);
    assert(plan, "planContext should return a plan");
    const intent = buildChangeIntent(plan);

    stageFiles(engine.workspaceRoot, ["src/index.ts"]);
    const staged = buildStagedCheckSummary(engine, {
      workspaceRoot: engine.workspaceRoot,
      stagedFiles: listGitStagedFiles(engine.workspaceRoot),
      tokenBudget: 1800,
    });
    const checked = validateStagedCheckAgainstIntent(staged, intent);

    assert(checked.intentValidation, "intent validation should be attached");
    assert.strictEqual(checked.intentValidation.verdict, "drifted");
    assert.strictEqual(checked.intentValidation.driftVerdict.status, "drift");
    assert.strictEqual(
      checked.intentValidation.driftVerdict.decision,
      "fix-before-commit"
    );
    assert(
      checked.intentValidation.driftVerdict.fix.includes(
        "Unstage context-only file: src/index.ts"
      ),
      "context-only drift verdict should name the exact context file fix"
    );
    assert.strictEqual(checked.intentValidation.plannedScope, "violated");
    assert.deepStrictEqual(checked.intentValidation.plannedFilesChanged, []);
    assert(
      checked.intentValidation.contextFilesChanged.includes("src/index.ts"),
      "context-only importer edits should be reported separately"
    );
    assert(
      checked.intentValidation.unplannedFiles.includes("src/index.ts"),
      "context-only importer edits should violate edit scope"
    );
    assert(
      checked.intentValidation.blockingReasons.includes("Context-only file changed: src/index.ts"),
      "context-only drift should explain that read context was edited"
    );

    const repairPlan = buildIntentDriftRepairPlan(checked);
    assert.strictEqual(repairPlan.verdict, "drifted");
    assert.strictEqual(repairPlan.driftVerdict.status, "drift");
    assert.deepStrictEqual(repairPlan.unstageFiles, ["src/index.ts"]);
    assert(
      repairPlan.fixActions.some(
        (action) =>
          action.type === "unstage-file" &&
          action.target === "src/index.ts" &&
          action.reason.includes("read or verification context")
      ),
      "context-only drift repair should tell agents to unstage the context file"
    );
  });

  await withEngine("intent-drifted-scope", sharedUtilityFiles(), async (engine) => {
    const plan = engine.planContext("change trim behavior", "src/util.ts", 1800);
    assert(plan, "planContext should return a plan");
    const intent = buildChangeIntent(plan);

    stageFiles(engine.workspaceRoot, ["src/util.ts", "src/other.ts"]);
    const staged = buildStagedCheckSummary(engine, {
      workspaceRoot: engine.workspaceRoot,
      stagedFiles: listGitStagedFiles(engine.workspaceRoot),
      tokenBudget: 1800,
    });
    const checked = validateStagedCheckAgainstIntent(staged, intent);

    assert(checked.intentValidation, "intent validation should be attached");
    assert.strictEqual(checked.intentValidation.verdict, "drifted");
    assert.strictEqual(checked.intentValidation.driftVerdict.status, "drift");
    assert(
      checked.intentValidation.driftVerdict.why.includes(
        "Unplanned file changed: src/other.ts"
      ),
      "drift verdict should explain the exact unplanned file"
    );
    assert.strictEqual(checked.intentValidation.plannedScope, "violated");
    assert(
      checked.intentValidation.unplannedFiles.includes("src/other.ts"),
      "unplanned staged file should violate the saved intent"
    );
    assert(
      checked.intentValidation.recommendedAction.includes("Unstage"),
      "drifted intent should tell agents to unstage or replan"
    );
    assert(
      checked.intentValidation.blockingReasons.includes("Unplanned file changed: src/other.ts"),
      "drifted intent should name the unplanned file as a blocking reason"
    );
    const repairPlan = buildIntentDriftRepairPlan(checked);
    assert.strictEqual(repairPlan.verdict, "drifted");
    assert.strictEqual(repairPlan.driftVerdict.decision, "fix-before-commit");
    assert.strictEqual(repairPlan.status, "repair-required");
    assert.deepStrictEqual(repairPlan.unstageFiles, ["src/other.ts"]);
    assert(
      repairPlan.commands.unstage.includes("git restore --staged -- src/other.ts"),
      "drift repair plan should provide an unstage command"
    );
    assert(
      repairPlan.fixActions.some(
        (action) =>
          action.type === "unstage-file" &&
          action.priority === "blocker" &&
          action.target === "src/other.ts" &&
          action.command === "git restore --staged -- src/other.ts"
      ),
      "drift repair plan should provide a structured unstage action"
    );
    assert(
      repairPlan.fixActions.some((action) => action.type === "replan"),
      "drift repair plan should tell agents when to replan"
    );
    assert(
      Array.isArray(repairPlan.agentActions.manualReviewRequired),
      "drift repair plan should include agent action buckets"
    );
  });
}

async function testChangeIntentDetectsProtectedContractDrift() {
  const files = {
    "src/util.ts": [
      "export function trimName(value: string): string {",
      "  const normalized = value.trim();",
      "  return normalized;",
      "}",
      "",
    ].join("\n"),
    "src/index.ts": [
      "import { trimName } from './util';",
      "",
      "export function label(value: string): string {",
      "  return trimName(value);",
      "}",
      "",
    ].join("\n"),
  };
  const workspaceRoot = createWorkspace("intent-protected-contract", files);
  commitBaseline(workspaceRoot);

  let intent;
  await withScannedEngine(workspaceRoot, async (engine) => {
    const plan = engine.planContext("change trim behavior", "src/util.ts", 1800);
    assert(plan, "planContext should return a plan");
    intent = buildChangeIntent(plan);
  });

  writeFile(
    workspaceRoot,
    "src/util.ts",
    [
      "export function trimName(value: string, fallback = ''): string {",
      "  const normalized = value.trim();",
      "  return normalized || fallback;",
      "}",
      "",
    ].join("\n")
  );
  execFileSync("git", ["add", "src/util.ts"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });

  await withScannedEngine(workspaceRoot, async (engine) => {
    const staged = buildStagedCheckSummary(engine, {
      workspaceRoot,
      stagedFiles: listGitStagedFiles(workspaceRoot),
      tokenBudget: 1800,
    });
    const checked = validateStagedCheckAgainstIntent(staged, intent);

    assert(checked.intentValidation, "intent validation should be attached");
    assert.strictEqual(checked.intentValidation.verdict, "dangerous");
    assert.strictEqual(checked.intentValidation.driftVerdict.status, "danger");
    assert.strictEqual(
      checked.intentValidation.driftVerdict.decision,
      "stop-and-ask-human"
    );
    assert(
      checked.intentValidation.protectedContractChanges.includes("src/util.ts::trimName"),
      "signature change on protected symbol should be contract drift"
    );
    assert(
      checked.intentValidation.recommendedAction.includes("contract drift"),
      "dangerous intent should recommend contract drift review"
    );
    assert(
      checked.intentValidation.blockingReasons.includes(
        "Protected contract changed: src/util.ts::trimName"
      ),
      "dangerous intent should name protected contract drift"
    );
    const repairPlan = buildIntentDriftRepairPlan(checked);
    assert.strictEqual(repairPlan.verdict, "dangerous");
    assert.strictEqual(repairPlan.driftVerdict.status, "danger");
    assert.strictEqual(repairPlan.status, "contract-review-required");
    assert(
      repairPlan.reviewContracts.includes("src/util.ts::trimName"),
      "dangerous repair plan should list contract review symbols"
    );
    assert(
      repairPlan.fixActions.some(
        (action) =>
          action.type === "review-contract" &&
          action.priority === "blocker" &&
          action.target === "src/util.ts::trimName"
      ),
      "dangerous repair plan should provide a structured contract review action"
    );
    assert(
      repairPlan.agentActions.manualReviewRequired.some((item) =>
        item.includes("src/util.ts::trimName")
      ),
      "dangerous repair plan should preserve manual review actions"
    );
  });
}

// Golden proof: function mode catches edits outside the approved symbol.
async function testFunctionControlBoundaryDetectsSymbolDrift() {
  const files = {
    "src/auth.ts": [
      "export function refreshToken(value: string): string {",
      "  return value.trim();",
      "}",
      "",
      "export function login(value: string): string {",
      "  return value;",
      "}",
      "",
    ].join("\n"),
    "tests/auth.test.ts": [
      "import { refreshToken } from '../src/auth';",
      "",
      "export function testRefreshToken(): string {",
      "  return refreshToken(' abc ');",
      "}",
      "",
    ].join("\n"),
  };
  const workspaceRoot = createWorkspace("intent-function-boundary", files);
  commitBaseline(workspaceRoot);

  let intent;
  await withScannedEngine(workspaceRoot, async (engine) => {
    const plan = engine.planContext("fix refresh token retry behavior", "src/auth.ts", 1800);
    assert(plan, "planContext should return a plan");
    intent = buildChangeIntent(plan, {
      controlMode: "function",
      allowedSymbols: ["refreshToken"],
    });
    assert.strictEqual(intent.controlMode, "function");
    assert.deepStrictEqual(intent.allowedSymbols, ["src/auth.ts::refreshToken"]);
    assert.strictEqual(intent.humanGate, "required-before-edit");
    assert.strictEqual(intent.boundaryRisk, "high");
    assert.strictEqual(intent.policyExplanation.protocol, "ripple-policy-explanation");
    assert.strictEqual(intent.policyExplanation.effectiveMode, "function");
    assert.strictEqual(intent.policyExplanation.humanGate, "required-before-edit");
  });

  writeFile(
    workspaceRoot,
    "src/auth.ts",
    [
      "export function refreshToken(value: string): string {",
      "  return value.trim();",
      "}",
      "",
      "export function login(value: string): string {",
      "  const normalized = value.trim();",
      "  return normalized;",
      "}",
      "",
    ].join("\n")
  );
  execFileSync("git", ["add", "src/auth.ts"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });

  await withScannedEngine(workspaceRoot, async (engine) => {
    const staged = buildStagedCheckSummary(engine, {
      workspaceRoot,
      stagedFiles: listGitStagedFiles(workspaceRoot),
      tokenBudget: 1800,
    });
    const checked = validateStagedCheckAgainstIntent(staged, intent);

    assert(checked.intentValidation, "intent validation should be attached");
    assert.strictEqual(checked.intentValidation.verdict, "matched");
    assert.strictEqual(
      checked.intentValidation.policyExplanation.effectiveMode,
      "function",
      "staged checks should carry the saved policy explanation snapshot"
    );
    assert.strictEqual(checked.intentValidation.boundaryVerdict.status, "danger");
    assert.strictEqual(
      checked.intentValidation.boundaryVerdict.decision,
      "stop-and-ask-human"
    );
    assert(
      checked.intentValidation.boundaryVerdict.changedOutsideBoundarySymbols.includes(
        "src/auth.ts::login"
      ),
      "function mode should catch unapproved symbol edits inside the allowed file"
    );
    assert(
      checked.intentValidation.boundaryVerdict.fix.some((fix) =>
        fix.includes("src/auth.ts::login")
      ),
      "boundary verdict should tell agents which symbol to undo or replan"
    );
    assert.strictEqual(checked.intentValidation.driftVerdict.status, "danger");
    assert(
      checked.intentValidation.recommendedAction.includes("control boundary"),
      "boundary drift should override the proceed action"
    );

    const repairPlan = buildIntentDriftRepairPlan(checked);
    assert.strictEqual(repairPlan.verdict, "matched");
    assert.strictEqual(repairPlan.status, "human-review-required");
    assert.strictEqual(repairPlan.createNewIntent, true);
    assert.strictEqual(
      repairPlan.policyExplanation.effectiveMode,
      "function",
      "repair plans should carry the saved policy explanation snapshot"
    );
    assert(
      repairPlan.fixActions.some(
        (action) =>
          action.type === "review-symbol" &&
          action.target === "src/auth.ts::login" &&
          action.reason.includes("control boundary")
      ),
      "repair plan should tell agents exactly which symbol crossed the boundary"
    );
  });
}

async function testPolicyDriftWarnsWhenCurrentPolicyChanges() {
  const files = {
    "src/util.ts": [
      "export function trimName(value: string): string {",
      "  return value.trim();",
      "}",
      "",
    ].join("\n"),
  };
  const workspaceRoot = createWorkspace("intent-policy-drift", files);
  commitBaseline(workspaceRoot);

  let intent;
  await withScannedEngine(workspaceRoot, async (engine) => {
    const plan = engine.planContext("change trim behavior", "src/util.ts", 1800);
    assert(plan, "planContext should return a plan");
    intent = buildChangeIntent(plan, {
      controlMode: "file",
    });
    assert.strictEqual(intent.policyExplanation.policyRisk, "none");
    assert.strictEqual(intent.policyExplanation.humanGate, "none");
  });

  writeFile(
    workspaceRoot,
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  return value.trimStart().trimEnd();",
      "}",
      "",
    ].join("\n")
  );
  execFileSync("git", ["add", "src/util.ts"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });

  await withScannedEngine(workspaceRoot, async (engine) => {
    const staged = buildStagedCheckSummary(engine, {
      workspaceRoot,
      stagedFiles: listGitStagedFiles(workspaceRoot),
      tokenBudget: 1800,
    });
    const checked = validateStagedCheckAgainstIntent(staged, intent, {
      currentPolicyExplanation: {
        ...intent.policyExplanation,
        policySource: ".ripple/policy.json",
        policyExists: true,
        policyRisk: "critical",
        humanGate: "required-before-edit",
        humanRequired: true,
        matchedRules: ["riskRules[0] paths=src/util.ts risk=critical"],
        why: [
          "Trust policy loaded from .ripple/policy.json.",
          "Policy risk: critical.",
          "Policy requires human approval before editing.",
        ],
        nextSteps: ["Ask the human to approve before the agent edits this file."],
      },
    });

    assert(checked.intentValidation, "intent validation should be attached");
    assert.strictEqual(checked.intentValidation.verdict, "matched");
    assert.strictEqual(checked.intentValidation.boundaryVerdict.status, "pass");
    assert.strictEqual(checked.intentValidation.policyDrift.status, "changed");
    assert.strictEqual(checked.intentValidation.policyDrift.label, "DRIFT");
    assert(
      checked.intentValidation.policyDrift.changedFields.some((field) =>
        field.includes("policy_risk")
      ),
      "policy drift should explain changed risk"
    );
    assert.strictEqual(checked.intentValidation.driftVerdict.status, "drift");
    assert.strictEqual(checked.intentValidation.driftVerdict.decision, "stop-and-ask-human");

    const repairPlan = buildIntentDriftRepairPlan(checked);
    assert.strictEqual(repairPlan.status, "human-review-required");
    assert.strictEqual(repairPlan.policyDrift.status, "changed");
    assert(
      repairPlan.fixActions.some((action) => action.type === "review-policy"),
      "repair plan should ask agents to review policy drift"
    );
  });
}

async function testSharedUtilityQuality() {
  await withEngine("shared-utility", sharedUtilityFiles(), async (engine) => {
    const plan = engine.planContext("change trim behavior", "src/util.ts", 1800);
    assert(plan, "planContext should return a plan");

    assert.strictEqual(plan.targetFile, "src/util.ts");
    assert.strictEqual(plan.readFirst[0].file, "src/util.ts");
    assert.strictEqual(plan.readFirst[0].role, "target");
    assert(plan.readFirst[0].signals.includes("target"));
    assert.strictEqual(plan.adapterSupport.primaryAdapter.id, "builtin-js-ts");
    assert.strictEqual(plan.adapterSupport.supportLevel, "deep");
    assert(
      plan.planningSignals.some((signal) => signal.includes("Adapter ranking")),
      "plan should explain adapter-weighted ranking"
    );
    assert(
      plan.readFirst[0].adapterSignals.some(
        (signal) =>
          signal.capability === "files" &&
          signal.agentUse === "trust" &&
          signal.confidence >= 0.95
      ),
      "target file should carry trusted file-discovery adapter signal"
    );
    assert(
      plan.adapterSupport.primaryAdapter.agentPolicy.canTrust.some((item) =>
        item.includes("static imports")
      ),
      "plan should tell agents which adapter signals are trustworthy"
    );
    assert(
      plan.adapterSupport.primaryAdapter.capabilityProfile.some(
        (capability) =>
          capability.capability === "call-edges" &&
          capability.status === "partial" &&
          capability.agentUse === "verify"
      ),
      "plan should mark partial call-edge support as verify-only"
    );

    const directTest = assertPlannedFile(
      plan,
      "tests/util.test.ts",
      "test",
      "direct-test"
    );
    assert(directTest.score > 1000, "direct test should be strongly ranked");
    assert(
      directTest.adapterSignals.some(
        (signal) =>
          signal.capability === "tests" &&
          signal.agentUse === "verify" &&
          signal.confidence < 0.8
      ),
      "direct test ranking should carry verify-only test confidence"
    );
    assert(
      directTest.reason.includes("Adapter ranks tests as verify"),
      "direct test reason should explain verify-only adapter weighting"
    );

    assertPlannedFile(plan, "tests/index.spec.ts", "test", "test-for-importer");
    assertPlannedFile(plan, "src/app/page.ts", "entrypoint", "transitive-entrypoint");

    assert(
      plan.verificationTargets.indexOf("tests/util.test.ts") <
        plan.verificationTargets.indexOf("src/index.ts"),
      "direct tests should verify before importers"
    );
    assert(plan.verificationTargets.includes("tests/index.spec.ts"));
    assert(plan.verificationTargets.includes("src/app/page.ts"));
    assert(plan.planningSignals.some((signal) => signal.includes("direct test")));
    assert(plan.doNotReadFirst.some((item) => item.includes("Unrelated tests")));
    assert(plan.why.includes("direct tests"));

    assertNotPlanned(plan, "tests/unrelated.test.ts");
    assertNotPlanned(plan, "docs/usage.ts");
  });
}

async function testBudgetPressureKeepsTargetAndDefersOverflow() {
  await withEngine("budget-pressure", sharedUtilityFiles(), async (engine) => {
    const plan = engine.planContext("change trim behavior", "src/util.ts", 700);
    assert(plan, "planContext should return a plan");

    assert.strictEqual(plan.tokenBudget, 1000, "budgets below 1000 should be normalized");
    assert.strictEqual(plan.readFirst[0].file, "src/util.ts");
    assert(plan.readFirst[0].signals.includes("target"));
    assert(
      plan.estimatedTokens <= plan.tokenBudget,
      "readFirst estimate should stay inside the normalized budget"
    );
    assert(
      plan.readIfNeeded.length > 0,
      "lower budgets should defer useful but lower-priority context"
    );
    assert(
      plan.readIfNeeded.some((item) => item.file === "src/index.ts"),
      "direct importer should be deferred instead of crowding out target context"
    );
    assert(
      plan.readFirst.some((item) => item.file === "tests/util.test.ts"),
      "direct test should still fit before lower-priority context"
    );
  });
}

async function testDirectDependencyAndRouteEntrypointQuality() {
  await withEngine(
    "dependency-route",
    {
      "src/crypto.ts": [
        "export function hash(value) {",
        "  return `hashed:${value}`;",
        "}",
        "",
      ].join("\n"),
      "src/auth.ts": [
        "import { hash } from './crypto';",
        "",
        "export function validateToken(token) {",
        "  return hash(token).startsWith('hashed:');",
        "}",
        "",
      ].join("\n"),
      "src/server.ts": [
        "import { validateToken } from './auth';",
        "",
        "export function authorize(token) {",
        "  return validateToken(token);",
        "}",
        "",
      ].join("\n"),
      "src/app/api/login/route.ts": [
        "import { validateToken } from '../../../auth';",
        "",
        "export function POST(token) {",
        "  return validateToken(token);",
        "}",
        "",
      ].join("\n"),
      "tests/auth.test.ts": [
        "import { validateToken } from '../src/auth';",
        "",
        "export function testValidateToken() {",
        "  if (!validateToken('abc')) {",
        "    throw new Error('bad token');",
        "  }",
        "}",
        "",
      ].join("\n"),
    },
    async (engine) => {
      const plan = engine.planContext("change token validation", "src/auth.ts", 2400);
      assert(plan, "planContext should return a plan");

      assertPlannedFile(plan, "tests/auth.test.ts", "test", "direct-test");
      assertPlannedFile(plan, "src/crypto.ts", "dependency", "direct-dependency");
      assertPlannedFile(
        plan,
        "src/app/api/login/route.ts",
        "entrypoint",
        "transitive-entrypoint"
      );

      assert(plan.verificationTargets.includes("tests/auth.test.ts"));
      assert(plan.verificationTargets.includes("src/app/api/login/route.ts"));
      assert(
        plan.planningSignals.some((signal) => signal.includes("direct dependency")),
        "planner should report direct dependency count"
      );
    }
  );
}

async function testTaskAwareDependencyRanking() {
  await withEngine(
    "task-aware-dependency",
    {
      "src/sessionPolicy.ts": [
        "export function sessionWindow() {",
        "  return 30;",
        "}",
        "",
      ].join("\n"),
      "src/tokenStore.ts": [
        "export function refreshToken(value) {",
        "  return `token:${value}`;",
        "}",
        "",
      ].join("\n"),
      "src/auth.ts": [
        "import { sessionWindow } from './sessionPolicy';",
        "import { refreshToken } from './tokenStore';",
        "",
        "export function authenticate(value) {",
        "  if (sessionWindow() < 1) {",
        "    return 'expired';",
        "  }",
        "  return refreshToken(value);",
        "}",
        "",
      ].join("\n"),
      "tests/auth.test.ts": [
        "import { authenticate } from '../src/auth';",
        "",
        "export function testAuthenticate() {",
        "  return authenticate('abc');",
        "}",
        "",
      ].join("\n"),
    },
    async (engine) => {
      const plan = engine.planContext("change token refresh behavior", "src/auth.ts", 2600);
      assert(plan, "planContext should return a plan");

      const tokenStore = assertPlannedFile(
        plan,
        "src/tokenStore.ts",
        "dependency",
        "direct-dependency"
      );
      const sessionPolicy = assertPlannedFile(
        plan,
        "src/sessionPolicy.ts",
        "dependency",
        "direct-dependency"
      );

      assert(
        tokenStore.signals.includes("task-match"),
        "tokenStore should be boosted by task-match"
      );
      assert(
        tokenStore.reason.includes("Matches task terms"),
        "task-aware dependency should explain matched task terms"
      );
      assert(
        tokenStore.score > sessionPolicy.score,
        "task-matched dependency should outrank structurally similar dependency"
      );
      assertPlannedBefore(plan, "src/tokenStore.ts", "src/sessionPolicy.ts");
      assert(
        plan.planningSignals.some((signal) => signal.includes("task-matched")),
        "planner should report task-matched file count"
      );

      const authenticateSymbol = plan.symbolFocus.find(
        (symbol) => symbol.symbol === "src/auth.ts::authenticate"
      );
      assert(authenticateSymbol, "symbol focus should include src/auth.ts::authenticate");
      assert(
        authenticateSymbol.signals.includes("target-file"),
        "target symbol should be marked as target-file"
      );
      assert(
        authenticateSymbol.signals.includes("calls-task-matched-file"),
        "authenticate should point to the task-matched token dependency"
      );

      const refreshTokenSymbol = plan.symbolFocus.find(
        (symbol) => symbol.symbol === "src/tokenStore.ts::refreshToken"
      );
      assert(refreshTokenSymbol, "symbol focus should include tokenStore refreshToken");
      assert(
        refreshTokenSymbol.signals.includes("task-match"),
        "refreshToken should be boosted by task-match"
      );
      assert(
        plan.planningSignals.some((signal) => signal.includes("symbol focus")),
        "planner should report symbol focus count"
      );
    }
  );
}

async function testDangerousSharedFileQuality() {
  const files = {
    "src/config.ts": [
      "export function readConfig(name) {",
      "  return `config:${name}`;",
      "}",
      "",
    ].join("\n"),
    "tests/config.test.ts": [
      "import { readConfig } from '../src/config';",
      "",
      "export function testConfig() {",
      "  return readConfig('mode');",
      "}",
      "",
    ].join("\n"),
  };

  for (let i = 1; i <= 5; i++) {
    files[`src/consumer${i}.ts`] = [
      "import { readConfig } from './config';",
      "",
      `export function consumer${i}() {`,
      `  return readConfig('consumer${i}');`,
      "}",
      "",
    ].join("\n");
  }

  await withEngine("dangerous-shared", files, async (engine) => {
    const plan = engine.planContext("change config lookup", "src/config.ts", 2200);
    assert(plan, "planContext should return a plan");

    assert.strictEqual(plan.risk, "dangerous");
    assert.strictEqual(plan.readFirst[0].file, "src/config.ts");
    assert(plan.readFirst[0].signals.includes("target"));
    assert(plan.readFirst[0].signals.includes("risk"));
    assert(
      plan.readFirst[0].reason.includes("dangerous file"),
      "dangerous target should explain contract risk"
    );
    assertPlannedFile(plan, "tests/config.test.ts", "test", "direct-test");
    assert(
      plan.planningSignals.some((signal) => signal.includes("6 direct importer")),
      "planner should report the dangerous direct importer count"
    );
    assert(plan.verificationTargets.includes("tests/config.test.ts"));
    assert(plan.verificationTargets.includes("src/consumer1.ts"));
  });
}

async function testPythonAdapterContextQuality() {
  await withEngine("python-service-plan", pythonServiceFiles(), async (engine) => {
    const plan = engine.planContext("change authentication behavior", "src/auth.py", 2200);
    assert(plan, "planContext should return a plan for Python files");

    assert.strictEqual(plan.targetFile, "src/auth.py");
    assert.strictEqual(plan.adapterSupport.primaryAdapter.id, "builtin-python");
    assert.strictEqual(plan.adapterSupport.primaryAdapter.capabilities.language, "python");
    assert.strictEqual(plan.adapterSupport.supportLevel, "deep");
    assert.strictEqual(plan.readFirst[0].file, "src/auth.py");
    assert(
      plan.readFirst[0].adapterSignals.some(
        (signal) => signal.capability === "files" && signal.agentUse === "trust"
      ),
      "Python target should carry trusted file adapter signal"
    );
    assert(
      plan.planningSignals.some((signal) => signal.includes("Python deep adapter")),
      "Python plan should explain adapter-weighted ranking"
    );

    assertPlannedFile(plan, "tests/test_auth.py", "test", "direct-test");
    assertPlannedFile(plan, "src/api.py", "importer", "direct-importer");
    assertPlannedFile(plan, "src/utils.py", "dependency", "direct-dependency");
    assert(plan.verificationTargets.includes("tests/test_auth.py"));
    assert(plan.verificationTargets.includes("src/api.py"));

    const authSymbol = plan.symbolFocus.find(
      (symbol) => symbol.symbol === "src/auth.py::authenticate"
    );
    assert(authSymbol, "Python plan should include authenticate symbol focus");
    assert(authSymbol.callers >= 2, "Python call graph should track direct callers");
    assert(
      plan.adapterSupport.primaryAdapter.agentPolicy.canTrust.some((item) =>
        item.includes("Python source file discovery")
      ),
      "Python plan should tell agents what adapter signals are trustworthy"
    );
  });
}

async function testPythonStagedCheckQuality() {
  const workspaceRoot = createWorkspace("python-staged-check", pythonServiceFiles());
  commitBaseline(workspaceRoot);
  writeFile(
    workspaceRoot,
    "src/auth.py",
    [
      "from .utils import normalize_token",
      "",
      "",
      "def authenticate(token):",
      "    normalized = normalize_token(token)",
      "    return normalized in ('valid', 'admin')",
      "",
    ].join("\n")
  );
  execFileSync("git", ["add", "src/auth.py"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });

  await withScannedEngine(workspaceRoot, async (engine) => {
    const summary = buildStagedCheckSummary(engine, {
      workspaceRoot,
      stagedFiles: listGitStagedFiles(workspaceRoot),
      tokenBudget: 2200,
    });

    assert.strictEqual(summary.adapterSupport.primaryAdapter.id, "builtin-python");
    assert.strictEqual(summary.stagedFiles, 1);
    assert.strictEqual(summary.checkedFiles, 1);

    const authenticate = summary.changedSymbols.find(
      (symbol) => symbol.symbol === "src/auth.py::authenticate"
    );
    assert(authenticate, "Python staged check should detect changed authenticate symbol");
    assert.strictEqual(authenticate.symbolStatus, "modified");
    assert.strictEqual(authenticate.signatureChanged, false);
    assert.strictEqual(authenticate.returnLineChanged, true);
    assert.strictEqual(authenticate.contractRisk, "review");
    assert(
      authenticate.adapterSignals.some(
        (signal) => signal.capability === "symbols" && signal.agentUse === "trust"
      ),
      "Python changed symbol should include trusted symbol adapter confidence"
    );
    assert(
      authenticate.adapterSignals.some(
        (signal) => signal.capability === "call-edges" && signal.agentUse === "verify"
      ),
      "Python changed symbol should include verify-only call-edge confidence"
    );

    const authFile = summary.files.find((file) => file.file === "src/auth.py");
    assert(authFile, "Python staged check should include changed auth file");
    assert(
      authFile.verificationTargets.includes("tests/test_auth.py"),
      "Python staged check should include direct pytest verification target"
    );
    assert(
      summary.agentActions.verifyBeforeCommit.some((item) =>
        item.includes("tests/test_auth.py")
      ),
      "Python staged check should ask agents to verify direct tests"
    );
  });
}

async function main() {
  await testStagedCheckDetectsChangedSymbolsAndContractRisk();
  await testStagedCheckSeparatesImplementationFromSignatureChange();
  await testChangeIntentValidatesPlannedScope();
  await testChangeIntentDetectsProtectedContractDrift();
  await testFunctionControlBoundaryDetectsSymbolDrift();
  await testPolicyDriftWarnsWhenCurrentPolicyChanges();
  await testSharedUtilityQuality();
  await testBudgetPressureKeepsTargetAndDefersOverflow();
  await testDirectDependencyAndRouteEntrypointQuality();
  await testTaskAwareDependencyRanking();
  await testDangerousSharedFileQuality();
  await testPythonAdapterContextQuality();
  await testPythonStagedCheckQuality();

  console.log("Ripple core context planner quality tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
