#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import {
  appendRippleVerificationEvidence,
  buildChangeIntent,
  buildChangeIntentReadinessSnapshot,
  buildIntentDriftRepairPlan,
  buildRippleAuditSummary,
  buildRippleGateSummary,
  buildRippleReadinessSummary,
  buildStagedCheckSummary,
  ChangeIntent,
  ChangeIntentValidationSummary,
  ControlMode,
  defaultChangeIntentPath,
  DriftVerdictSummary,
  FileBlastRadiusSummary,
  FileDependencyLink,
  FileDependencySummary,
  FileFocusSummary,
  FileSymbolsSummary,
  GraphEngine,
  getAgentWorkflowSummary,
  ContextPlanAdapterSignal,
  ContextPlanFile,
  ContextPlanSummary,
  ContextPlanSymbol,
  IntentDriftRepairAction,
  IntentDriftRepairPlan,
  fingerprintRippleChangeDiff,
  isRippleSourceFile,
  listGitChangedDiff,
  listGitChangedFiles,
  listGitStagedFiles,
  listGitStagedDiff,
  listGitWorktreeFiles,
  listGitWorktreeDiff,
  loadChangeIntent,
  loadRipplePolicy,
  RecentHistorySummary,
  recordRippleApproval,
  RippleApprovalGate,
  RippleApprovalRecord,
  RippleApprovalStatus,
  RippleAuditSummary,
  RippleGateSummary,
  RippleAgentHandoffVerdict,
  RipplePolicyExplanation,
  RipplePolicyRiskRule,
  RippleReadinessSummary,
  RippleReviewPacket,
  RippleVerificationEvidence,
  RippleVerificationStatus,
  RIPPLE_CACHE_GITIGNORE_ENTRY,
  RIPPLE_CI_WORKFLOW_PATH,
  RIPPLE_GITIGNORE_PATH,
  RIPPLE_POLICY_PATH,
  buildSmartRipplePolicy,
  defaultRipplePolicy,
  explainRipplePolicyForTarget,
  explainRipplePolicyForIntent,
  formatRipplePolicy,
  ripplePolicyPath,
  resolveRippleApprovalStatus,
  resolveRipplePolicyForTarget,
  saveChangeIntent,
  StagedCheckSummary,
  StagedCheckWithIntentSummary,
  SymbolCallersSummary,
  SymbolGraphSummary,
  SymbolLinkSummary,
  validateStagedCheckAgainstIntent,
} from "@getripple/core";

// The CLI makes Ripple's plan/check/repair loop readable for both humans and agents.
type CliOptions = {
  json: boolean;
  agent: boolean;
  last: number;
  file?: string;
  task?: string;
  mode?: ControlMode;
  symbol?: string;
  gate?: RippleApprovalGate;
  reason?: string;
  approvedBy?: string;
  verificationCommand?: string;
  verificationRunCommand?: string;
  verificationStatus?: RippleVerificationStatus;
  note?: string;
  intent?: string;
  base?: string;
  budget: number;
  staged: boolean;
  changed: boolean;
  worktree: boolean;
  save: boolean;
  strict: boolean;
  githubAnnotations: boolean;
  force: boolean;
  print: boolean;
};

type ParsedCliArgs = {
  command: string | undefined;
  args: string[];
  options: CliOptions;
};

type ScanSummary = {
  workspace: string;
  files: number;
  symbols: number;
  callEdges: number;
  contextMode: "lean";
  cacheGenerated: boolean;
  cachePath: string;
  contextGenerated: boolean;
  contextPath: string;
};

type RippleInitFileSummary = {
  path: string;
  status: "written" | "updated" | "appended" | "overwritten" | "exists" | "printed";
  written: boolean;
  overwritten: boolean;
  content?: string;
};

type RippleInitSummary = {
  protocol: "ripple-init";
  version: 1;
  workspace: string;
  files: RippleInitFileSummary[];
  agentSetup?: RippleAgentSetupSummary;
  hooks?: RippleHookInstallSummary;
  readiness?: RippleReadinessSummary;
  nextSteps: string[];
};

type RippleWorkflowSummary = {
  protocol: "ripple-workflow";
  version: 1;
  workspace: string;
  path: string;
  written: boolean;
  contextGenerated: boolean;
  contextFiles: string[];
  focusFileCount: number;
  nextSteps: string[];
};

type RippleAgentSetupSummary = {
  protocol: "ripple-agent-setup";
  version: 1;
  workspace: string;
  files: RippleInitFileSummary[];
  mcp: {
    serverName: "ripple";
    command: "npx";
    args: string[];
    workspace: string;
    config: Record<string, unknown>;
  };
  setupRequired: string[];
  nextSteps: string[];
};

type RippleHookInstallAction = "created" | "appended" | "already-present";

type RippleHookInstallSummary = {
  protocol: "ripple-hook-install";
  version: 1;
  workspace: string;
  path: string;
  postCommitPath?: string;
  status: "written" | "exists" | "printed";
  written: boolean;
  overwritten: boolean;
  preCommitAction?: RippleHookInstallAction;
  postCommitAction?: RippleHookInstallAction;
  content?: string;
  preCommitContent?: string;
  postCommitContent?: string;
  nextSteps: string[];
};

type RipplePolicySyncStatus = "up-to-date" | "update-available";

type RipplePolicySyncMissingRule = RipplePolicyRiskRule & {
  reason: string;
};

type RipplePolicySyncSummary = {
  protocol: "ripple-policy-sync";
  version: 1;
  workspace: string;
  policyPath: string;
  policyExists: boolean;
  status: RipplePolicySyncStatus;
  missingRules: RipplePolicySyncMissingRule[];
  detections: Array<{
    kind: string;
    evidence: string[];
    missingRules: number;
  }>;
  nextSteps: string[];
};

type RippleDoctorOutput = RippleReadinessSummary & {
  policySync: RipplePolicySyncSummary;
};

type SavedChangeIntent = {
  intent: ChangeIntent;
  path: string;
};

type PlanJsonOutput = ContextPlanSummary & {
  policyExplanation: RipplePolicyExplanation;
  changeIntent?: ChangeIntent;
  changeIntentPath?: string;
};

type RippleVerifyOutput = {
  protocol: "ripple-verification-evidence";
  version: 1;
  workspace: string;
  intentPath: string;
  intentId: string;
  evidence: RippleVerificationEvidence;
  totalEvidence: number;
  nextSteps: string[];
};

type ExecutedVerificationResult = {
  command: string;
  status: Extract<RippleVerificationStatus, "passed" | "failed">;
  exitCode: number;
  durationMs: number;
  stdoutTail?: string;
  stderrTail?: string;
  note?: string;
};

type VerificationChangeSnapshot = {
  changedFiles: string[];
  changeMode: NonNullable<RippleVerificationEvidence["changeMode"]>;
  changeFingerprint?: string;
};

type RippleIntentSnapshot = {
  id: string;
  createdAt: string;
  task: string;
  targetFile: string;
  controlMode: ControlMode;
  humanGate: ChangeIntent["humanGate"];
  boundaryRisk: ChangeIntent["boundaryRisk"];
};

type RippleIntentStatusOutput = {
  protocol: "ripple-intent-status";
  version: 1;
  workspace: string;
  intentRef: string;
  intentPath: string;
  exists: boolean;
  active: boolean;
  intent?: RippleIntentSnapshot;
  nextSteps: string[];
};

type RippleIntentCloseOutput = {
  protocol: "ripple-intent-close";
  version: 1;
  workspace: string;
  intentRef: string;
  intentPath: string;
  archivePath: string;
  closedAt: string;
  closedBy: string;
  reason: string;
  intent: RippleIntentSnapshot;
  nextSteps: string[];
};

type RippleClosedIntentArchive = {
  protocol: "ripple-closed-intent";
  version: 1;
  closedAt: string;
  closedBy: string;
  reason: string;
  originalIntentPath: string;
  intent: ChangeIntent;
};

type ApprovalStatusOutput = RippleApprovalStatus & {
  intent: {
    id: string;
    task: string;
    targetFile: string;
    controlMode: ControlMode;
    humanGate: ChangeIntent["humanGate"];
    boundaryRisk: ChangeIntent["boundaryRisk"];
  };
};

const CONTROL_MODES: ControlMode[] = ["brainstorm", "function", "file", "task", "pr"];

function usage(): string {
  return [
    "Ripple CLI",
    "",
    "Usage:",
    "  ripple init [--force] [--json]",
    "  ripple doctor [--strict] [--agent]",
    "  ripple scan [path]",
    "  ripple workflow [--json]",
    "  ripple focus <file>",
    "  ripple blast <file>",
    "  ripple imports <file>",
    "  ripple importers <file>",
    "  ripple symbols <file>",
    "  ripple callers <file>::<symbol>",
    "  ripple history [--last N]",
    "  ripple plan --file <file> --task <task> [--mode file|function|brainstorm|task|pr] [--symbol name] [--budget N] [--save]",
    "  ripple intent status [--intent latest|path]",
    "  ripple intent close --reason text [--intent latest|path]",
    "  ripple check --staged [--intent latest|path] [--strict]",
    "  ripple check --worktree [--intent latest|path] [--strict]",
    "  ripple check --changed --base <ref> [--intent latest|path] [--strict]",
    "  ripple audit [--intent latest|path] [--worktree|--changed --base <ref>] [--strict]",
    "  ripple gate [--intent latest|path] [--worktree|--changed --base <ref>] [--strict]",
    "  ripple approval [--intent latest|path] [--gate before-risky-edit|before-merge]",
    "  ripple approve [--intent latest|path] [--gate before-risky-edit|before-merge] --reason text",
    "  ripple verify --run <test command> [--intent latest|path] [--note text]",
    "  ripple verify --command <test command> --status passed|failed|skipped|unknown [--intent latest|path] [--note text]",
    "  ripple repair [--intent latest|path] [--strict]",
    "  ripple ci [--base <ref>] [--intent latest|path] [--github-annotations]",
    "  ripple init-ci [--print] [--force]",
    "  ripple policy init [--print] [--force]",
    "  ripple policy explain --file <file>",
    "  ripple agent",
    "  ripple agent setup [--print] [--force]",
    "  ripple hook install [--print] [--force]",
    "",
    "Options:",
    "  --json, -j    Print machine-readable JSON",
    "  --agent       Print compact agent handoff for ripple doctor/plan/check/audit/gate/repair",
    "  --last N      Limit history groups (default: 10)",
    "  --file PATH   Target file for plan",
    "  --task TEXT   Task description for plan",
    "  --mode MODE   Agent control boundary for saved plans (default: file)",
    "  --symbol NAME Allowed symbol for --mode function",
    "  --gate GATE   Human approval gate for approve (before-risky-edit or before-merge)",
    "  --reason TEXT Required human approval reason",
    "  --approved-by NAME  Human approver name for approval records",
    "  --budget N    Token budget for plan (default: 4000)",
    "  --staged      Check currently staged JS/TS files",
    "  --changed     Check JS/TS files changed against --base",
    "  --worktree    Check unstaged working-tree JS/TS changes",
    "  --base REF    Base git ref for --changed checks (default: HEAD)",
    "  --save        Save a change intent from ripple plan",
    "  --intent REF  Validate changes against saved intent (latest, id, or path; local checks only)",
    "  --strict      Exit non-zero when check/repair detects missing intent, drift, or contract danger",
    "  --github-annotations  Emit GitHub Actions annotations for CI findings",
    "  --print       Print generated setup content instead of writing files",
    "  --force       Overwrite existing generated setup files",
    "",
    "Examples:",
    "  ripple init",
    "  ripple doctor",
    "  ripple workflow",
    "  ripple doctor --agent",
    "  ripple agent",
    "  ripple agent setup",
    "  ripple agent --json",
    "  ripple plan --file src/auth.ts --task \"change token refresh behavior\" --mode file --agent --save",
    "  ripple plan --file src/auth.ts --symbol refreshToken --task \"fix retry behavior\" --mode function --agent --save",
    "  ripple intent status",
    "  ripple intent close --reason \"task finished\"",
    "  ripple check --staged --agent --intent latest",
    "  ripple check --worktree --agent --intent latest",
    "  ripple audit --agent --intent latest",
    "  ripple gate --agent --intent latest",
    "  ripple approval --intent latest --agent",
    "  ripple approve --intent latest --gate before-risky-edit --reason \"plan reviewed\"",
    "  ripple repair --agent --intent latest",
    "  ripple check --staged --intent latest --strict",
    "  ripple check --changed --base origin/main --strict",
    "  ripple ci --base origin/main --github-annotations",
    "  ripple init",
    "  ripple init-ci",
    "  ripple policy init",
    "  ripple policy explain --file src/auth.ts",
    "",
    "  ripple --help",
    "  ripple --version",
  ].join("\n");
}

function agentWorkflowGuide(): string {
  const workflow = getAgentWorkflowSummary();

  return [
    "Ripple Agent Workflow",
    "",
    "Setup readiness:",
    `  ${workflow.commands.initializeRepo}`,
    `  ${workflow.commands.checkReadiness}`,
    `  ${workflow.commands.installCi} (CI-only repair path)`,
    "",
    "Before editing:",
    `  ${workflow.commands.planBeforeEditing}`,
    `  ${workflow.policyWorkflow.defaultAgentPath}`,
    "",
    "If human gate is required:",
    `  ${workflow.commands.checkApproval}`,
    `  ${workflow.commands.approveHumanGate}`,
    "",
    "Policy-only check:",
    `  ${workflow.commands.explainPolicy}`,
    `  ${workflow.policyWorkflow.policyOnlyPath}`,
    "",
    "Policy drift:",
    `  ${workflow.policyWorkflow.policyDriftPath}`,
    "",
    "After staging changes:",
    `  ${workflow.commands.checkAfterStaging}`,
    "",
    "Audit current change:",
    `  ${workflow.commands.auditCurrentChange}`,
    `  ${workflow.commands.gateCurrentChange}`,
    "",
    "Record verification evidence:",
    `  ${workflow.commands.recordVerification}`,
    "",
    "If staged changes drift:",
    `  ${workflow.commands.repairIntentDrift}`,
    "",
    "CI gate:",
    `  ${workflow.commands.ciGate}`,
    "",
    "Loop:",
    `  ${workflow.loop.join(" -> ")}`,
    "",
    "Runtime contract:",
    ...workflow.runtimeContract.phases.map(
      (phase) => `  ${phase.order}. ${phase.id}: ${phase.agentAction}`
    ),
    "",
    "Stop if:",
    ...workflow.runtimeContract.stopConditions.map((condition) => `  - ${condition}`),
    "",
    "Example:",
    ...workflow.example.map((command) => `  ${command}`),
  ].join("\n");
}

function mcpServerConfig(workspaceRoot: string): Record<string, unknown> {
  return {
    mcpServers: {
      ripple: {
        command: "npx",
        args: ["-y", "@getripple/mcp", "--workspace", workspaceRoot],
      },
    },
  };
}

function mcpServerConfigJson(workspaceRoot: string): string {
  return JSON.stringify(mcpServerConfig(workspaceRoot), null, 2);
}

type RippleAgentSetupFileName = "AGENTS.md" | "CLAUDE.md" | ".cursorrules";

const RIPPLE_AGENT_SETUP_FILE_NAMES: RippleAgentSetupFileName[] = ["AGENTS.md", "CLAUDE.md", ".cursorrules"];
const RIPPLE_DEFAULT_AGENT_SETUP_FILE: RippleAgentSetupFileName = ".cursorrules";

function agentInstructionMarkdown(_workspaceRoot: string, _fileName: RippleAgentSetupFileName): string {
  const workflow = getAgentWorkflowSummary();
  return [
    "# RIPPLE AGENT PROTOCOL",
    "You are connected to Ripple MCP for this repo.",
    `1. BEFORE editing: MUST call \`${workflow.mcpTools.planBeforeEditing}\` with saveIntent=true.`,
    `2. AFTER editing: MUST call \`${workflow.mcpTools.gateCurrentChange}\` or \`${workflow.mcpTools.checkChangedAgainstBase}\`.`,
    "3. If mustStop=true or needsHuman=true: STOP and ask the human.",
    "4. DO NOT edit `.ripple/` policy/cache/intent files unless explicitly requested.",
    "5. DO NOT claim Ripple passed unless you called a Ripple MCP tool.",
  ].join("\n");
}

const RIPPLE_AGENT_SECTION_START = "<!-- RIPPLE:START -->";
const RIPPLE_AGENT_SECTION_END = "<!-- RIPPLE:END -->";

function rippleAgentManagedSection(content: string): string {
  return [
    RIPPLE_AGENT_SECTION_START,
    content.trimEnd(),
    RIPPLE_AGENT_SECTION_END,
    "",
  ].join("\n");
}

function resolveAgentSetupFileNames(workspaceRoot: string): RippleAgentSetupFileName[] {
  const existing = RIPPLE_AGENT_SETUP_FILE_NAMES.filter((fileName) => fs.existsSync(path.join(workspaceRoot, fileName)));
  return existing.length > 0 ? existing : [RIPPLE_DEFAULT_AGENT_SETUP_FILE];
}

function agentSetupFiles(workspaceRoot: string): Array<{ path: string; absolutePath: string; content: string }> {
  return resolveAgentSetupFileNames(workspaceRoot).map((fileName) => ({
    path: fileName,
    absolutePath: path.join(workspaceRoot, fileName),
    content: rippleAgentManagedSection(agentInstructionMarkdown(workspaceRoot, fileName)),
  }));
}

function buildAgentSetupSummary(
  workspaceRoot: string,
  files: RippleInitFileSummary[]
): RippleAgentSetupSummary {
  const mcpArgs = ["-y", "@getripple/mcp", "--workspace", workspaceRoot];
  return {
    protocol: "ripple-agent-setup",
    version: 1,
    workspace: workspaceRoot,
    files,
    mcp: {
      serverName: "ripple",
      command: "npx",
      args: mcpArgs,
      workspace: workspaceRoot,
      config: mcpServerConfig(workspaceRoot),
    },
    setupRequired: [
      "Open your agent or IDE MCP settings.",
      "Add a new MCP server named ripple.",
      `Use command: npx ${mcpArgs.join(" ")}`,
      "Restart or reload the agent so Ripple MCP tools become available.",
    ],
    nextSteps: [
      "Ask the agent to call ripple_get_agent_workflow to confirm MCP connectivity.",
      "Before edits, the agent should call ripple_plan_context with saveIntent enabled.",
      "After edits, the agent should call ripple_gate or ripple_check_changed before handoff.",
    ],
  };
}

function printAgentSetupSummary(summary: RippleAgentSetupSummary): void {
  console.log("Ripple agent setup");
  console.log(`Workspace: ${summary.workspace}`);
  console.log("");
  console.log("Generated files:");
  summary.files.forEach((file) => {
    console.log(`  - ${file.path}: ${file.status}`);
  });
  console.log("");
  console.log("ACTION REQUIRED: connect Ripple MCP to your agent/IDE.");
  console.log("");
  console.log("MCP server:");
  console.log("  name: ripple");
  console.log("  command: npx");
  console.log(`  args: ${summary.mcp.args.join(" ")}`);
  console.log("");
  console.log("Paste this MCP config if your client accepts JSON:");
  console.log(mcpServerConfigJson(summary.workspace));
  console.log("");
  console.log("Cursor / Claude / agent steps:");
  summary.setupRequired.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
  console.log("");
  console.log("Next:");
  summary.nextSteps.forEach((step) => console.log(`  - ${step}`));
}

function agentSetupCommand(options: CliOptions): void {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const files = agentSetupFiles(workspaceRoot);

  if (options.print) {
    const summary = buildAgentSetupSummary(
      workspaceRoot,
      files.map((file) => ({
        path: file.path,
        status: "printed",
        written: false,
        overwritten: false,
        content: file.content,
      }))
    );
    if (options.json) {
      printJson(summary);
      return;
    }
    process.stdout.write(
      files
        .flatMap((file) => [`# ${file.path}`, file.content.trimEnd(), ""])
        .join("\n")
    );
    return;
  }

  const writtenFiles = files.map((file) => writeAgentSetupFile(file, options.force));
  const summary = buildAgentSetupSummary(workspaceRoot, writtenFiles);

  if (options.json) {
    printJson(summary);
  } else {
    printAgentSetupSummary(summary);
  }
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  let command: string | undefined;
  const args: string[] = [];
  const options: CliOptions = {
    json: false,
    agent: false,
    last: 10,
    budget: 4000,
    staged: false,
    changed: false,
    worktree: false,
    save: false,
    strict: false,
    githubAnnotations: false,
    force: false,
    print: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--json" || token === "-j") {
      options.json = true;
      continue;
    }
    if (token === "--agent") {
      options.agent = true;
      continue;
    }
    if (token === "--staged") {
      options.staged = true;
      continue;
    }
    if (token === "--changed") {
      options.changed = true;
      continue;
    }
    if (token === "--worktree") {
      options.worktree = true;
      continue;
    }
    if (token === "--save") {
      options.save = true;
      continue;
    }
    if (token === "--strict") {
      options.strict = true;
      continue;
    }
    if (token === "--github-annotations") {
      options.githubAnnotations = true;
      continue;
    }
    if (token === "--force") {
      options.force = true;
      continue;
    }
    if (token === "--print") {
      options.print = true;
      continue;
    }
    if (token === "--last") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --last");
      }
      options.last = parsePositiveInteger(value, "--last");
      i++;
      continue;
    }
    if (token.startsWith("--last=")) {
      options.last = parsePositiveInteger(token.slice("--last=".length), "--last");
      continue;
    }
    if (token === "--file") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --file");
      }
      options.file = value;
      i++;
      continue;
    }
    if (token.startsWith("--file=")) {
      options.file = token.slice("--file=".length);
      continue;
    }
    if (token === "--task") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --task");
      }
      options.task = value;
      i++;
      continue;
    }
    if (token.startsWith("--task=")) {
      options.task = token.slice("--task=".length);
      continue;
    }
    if (token === "--mode") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --mode");
      }
      options.mode = parseControlMode(value);
      i++;
      continue;
    }
    if (token.startsWith("--mode=")) {
      options.mode = parseControlMode(token.slice("--mode=".length));
      continue;
    }
    if (token === "--symbol") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --symbol");
      }
      options.symbol = value;
      i++;
      continue;
    }
    if (token.startsWith("--symbol=")) {
      options.symbol = token.slice("--symbol=".length);
      continue;
    }
    if (token === "--gate") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --gate");
      }
      options.gate = parseApprovalGate(value);
      i++;
      continue;
    }
    if (token.startsWith("--gate=")) {
      options.gate = parseApprovalGate(token.slice("--gate=".length));
      continue;
    }
    if (token === "--run") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --run");
      }
      options.verificationRunCommand = value;
      i++;
      continue;
    }
    if (token.startsWith("--run=")) {
      options.verificationRunCommand = token.slice("--run=".length);
      continue;
    }
    if (token === "--command") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --command");
      }
      options.verificationCommand = value;
      i++;
      continue;
    }
    if (token.startsWith("--command=")) {
      options.verificationCommand = token.slice("--command=".length);
      continue;
    }
    if (token === "--status") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --status");
      }
      options.verificationStatus = parseVerificationStatus(value);
      i++;
      continue;
    }
    if (token.startsWith("--status=")) {
      options.verificationStatus = parseVerificationStatus(token.slice("--status=".length));
      continue;
    }
    if (token === "--note") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --note");
      }
      options.note = value;
      i++;
      continue;
    }
    if (token.startsWith("--note=")) {
      options.note = token.slice("--note=".length);
      continue;
    }
    if (token === "--reason") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --reason");
      }
      options.reason = value;
      i++;
      continue;
    }
    if (token.startsWith("--reason=")) {
      options.reason = token.slice("--reason=".length);
      continue;
    }
    if (token === "--approved-by") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --approved-by");
      }
      options.approvedBy = value;
      i++;
      continue;
    }
    if (token.startsWith("--approved-by=")) {
      options.approvedBy = token.slice("--approved-by=".length);
      continue;
    }
    if (token === "--intent") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --intent");
      }
      options.intent = value;
      i++;
      continue;
    }
    if (token.startsWith("--intent=")) {
      options.intent = token.slice("--intent=".length);
      continue;
    }
    if (token === "--base") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --base");
      }
      options.base = value;
      i++;
      continue;
    }
    if (token.startsWith("--base=")) {
      options.base = token.slice("--base=".length);
      continue;
    }
    if (token === "--budget") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --budget");
      }
      options.budget = parsePositiveInteger(value, "--budget");
      i++;
      continue;
    }
    if (token.startsWith("--budget=")) {
      options.budget = parsePositiveInteger(token.slice("--budget=".length), "--budget");
      continue;
    }
    if (!command) {
      command = token;
      continue;
    }
    args.push(token);
  }

  return { command, args, options };
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function parseControlMode(value: string): ControlMode {
  if (CONTROL_MODES.includes(value as ControlMode)) {
    return value as ControlMode;
  }
  throw new Error(`--mode must be one of: ${CONTROL_MODES.join(", ")}`);
}

function parseVerificationStatus(value: string): RippleVerificationStatus {
  if (value === "passed" || value === "failed" || value === "skipped" || value === "unknown") {
    return value;
  }
  throw new Error("--status must be one of: passed, failed, skipped, unknown");
}

function parseApprovalGate(value: string): RippleApprovalGate {
  if (value === "before-risky-edit" || value === "before-merge") {
    return value;
  }
  throw new Error("--gate must be one of: before-risky-edit, before-merge");
}

function version(): string {
  const pkgPath = path.resolve(__dirname, "..", "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function rippleCliPackageSpec(): string {
  const currentVersion = version();
  return currentVersion === "0.0.0"
    ? "@getripple/cli"
    : `@getripple/cli@${currentVersion}`;
}

const GITHUB_ACTIONS_WORKFLOW_PATH = RIPPLE_CI_WORKFLOW_PATH;

function githubActionsWorkflow(): string {
  return [
    "name: Ripple",
    "",
    "on:",
    "  pull_request:",
    "",
    "permissions:",
    "  contents: read",
    "  pull-requests: read",
    "",
    "jobs:",
    "  ripple:",
    "    name: Ripple architecture gate",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Checkout",
    "        uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "      - name: Setup Node",
    "        uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 20",
    "      - name: Ripple CI",
    `        run: npx -y ${rippleCliPackageSpec()} ci --base origin/\${{ github.base_ref }} --github-annotations`,
    "",
  ].join("\n");
}

function rippleGitIgnoreBlock(): string {
  return [
    "# Ripple machine cache - regenerated automatically",
    RIPPLE_CACHE_GITIGNORE_ENTRY,
    "",
  ].join("\n");
}

function defaultInitNextSteps(readiness?: RippleReadinessSummary): string[] {
  return uniqueLines([
    ...(readiness?.nextSteps ?? []),
    "Run ripple plan --file <file> --task \"<task>\" --mode file --agent --save.",
    "Run ripple doctor --agent --strict after saving the first intent.",
    "Commit .ripple/policy.json, approvals when needed, and .github/workflows/ripple.yml. Keep local intents out of PRs.",
  ]);
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (seen.has(line)) {
      return false;
    }
    seen.add(line);
    return true;
  });
}

function resolveWorkspaceRoot(inputPath: string | undefined): string {
  const candidate = path.resolve(process.cwd(), inputPath ?? ".");
  if (!fs.existsSync(candidate)) {
    throw new Error(`Path does not exist: ${candidate}`);
  }
  const stat = fs.statSync(candidate);
  if (!stat.isDirectory()) {
    throw new Error(`Scan path must be a directory: ${candidate}`);
  }
  return candidate;
}

function countCallEdges(engine: GraphEngine): number {
  let count = 0;
  engine.graph.symbols.forEach((symbol) => {
    count += symbol.calls.size;
  });
  return count;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function applyStrictExit(shouldFail: boolean): void {
  if (shouldFail) {
    process.exitCode = 1;
  }
}

function strictCheckShouldFail(summary: StagedCheckWithIntentSummary): boolean {
  return !summary.intentValidation || summary.intentValidation.driftVerdict.status !== "pass";
}

function strictRepairShouldFail(plan: IntentDriftRepairPlan): boolean {
  return plan.status !== "no-repair-needed";
}

function strictAuditShouldFail(summary: RippleAuditSummary): boolean {
  return summary.status !== "pass";
}

const MISSING_INTENT_NEXT_REQUIRED_PHASE = "plan_before_edit";
const MISSING_INTENT_NEXT_REQUIRED_ACTION =
  "Create a saved Ripple plan with ripple plan --file <file> --task \"<task>\" --agent --save before relying on CI or drift checks.";

function intentLoadFailureMessage(intentRef: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    `Could not load Ripple change intent '${intentRef}'.`,
    "Run ripple plan --save for local intent-based checks, or pass a valid --intent path. Do not commit local latest intents into PRs.",
    detail,
  ].join(" ");
}

function defaultCiBaseRef(): string {
  const githubBaseRef = process.env.GITHUB_BASE_REF?.trim();
  if (githubBaseRef) {
    return `origin/${githubBaseRef}`;
  }
  return "HEAD";
}

function shouldEmitGithubAnnotations(options: CliOptions): boolean {
  return options.githubAnnotations || process.env.GITHUB_ACTIONS === "true";
}

function printGithubIntentLoadError(message: string): void {
  printGithubErrorAnnotation({
    title: "Ripple intent required",
    message: `next=${MISSING_INTENT_NEXT_REQUIRED_PHASE}. ${MISSING_INTENT_NEXT_REQUIRED_ACTION} ${message}`,
  });
}

function writeGithubStepSummary(input: {
  summary: StagedCheckWithIntentSummary;
  intentLoadError?: string;
}): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();
  if (!summaryPath) {
    return;
  }

  try {
    fs.appendFileSync(summaryPath, buildGithubStepSummary(input), "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Ripple CLI warning: Could not write GitHub step summary: ${message}`);
  }
}

function writeGithubAuditStepSummary(audit: RippleAuditSummary): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();
  if (!summaryPath) {
    return;
  }

  try {
    fs.appendFileSync(summaryPath, buildGithubAuditStepSummary(audit), "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Ripple CLI warning: Could not write GitHub step summary: ${message}`);
  }
}

function writeGithubPolicyAuditStepSummary(summary: StagedCheckSummary, policySync?: RipplePolicySyncSummary): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();
  if (!summaryPath) {
    return;
  }

  try {
    fs.appendFileSync(summaryPath, buildGithubPolicyAuditStepSummary(summary, policySync), "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Ripple CLI warning: Could not write GitHub step summary: ${message}`);
  }
}


function pushMarkdownList(lines: string[], title: string, items: string[], limit: number): void {
  lines.push(`#### ${title}`);
  if (items.length === 0) {
    lines.push("- none");
    return;
  }
  items.slice(0, limit).forEach((item) => lines.push(`- ${item}`));
  if (items.length > limit) {
    lines.push(`- ...and ${items.length - limit} more`);
  }
}

function appendGithubReviewPacket(lines: string[], packet: RippleReviewPacket | undefined): void {
  if (!packet) {
    return;
  }

  lines.push("### Review packet", "");
  lines.push(`- Protocol: ${packet.protocol} v${packet.version}`);
  lines.push(`- Task: ${packet.originalTask}`);
  lines.push(`- Mode: ${packet.mode}`);
  lines.push(`- Declared scope: ${packet.declaredScope.controlMode} ${packet.declaredScope.targetFile}`);
  lines.push(`- Human gate: ${packet.declaredScope.humanGate}`);
  lines.push(`- Boundary risk: ${packet.declaredScope.boundaryRisk}`);
  lines.push(`- Tests run: ${packet.verification.testsRun}`);
  if (packet.verification.evidence.length > 0) {
    lines.push(`- Verification status: ${verificationEvidenceStatusLabel(packet.verification.evidence)}`);
  }
  lines.push(`- Decision: ${packet.decision.verdict}`);
  lines.push(`- Can continue: ${packet.decision.canContinue}`);
  lines.push(`- Must stop: ${packet.decision.mustStop}`);
  lines.push(`- Needs human: ${packet.decision.needsHuman}`);
  lines.push(`- Next required action: ${packet.decision.nextRequiredAction}`);
  lines.push("");
  pushMarkdownList(lines, "Allowed files", packet.declaredScope.allowedFiles, 12);
  lines.push("");
  pushMarkdownList(lines, "Allowed symbols", packet.declaredScope.allowedSymbols, 12);
  lines.push("");
  pushMarkdownList(lines, "Actual changed files", packet.actualChanges.changedFiles, 20);
  lines.push("");
  pushMarkdownList(lines, "Changed symbols", packet.actualChanges.changedSymbols, 16);
  lines.push("");
  pushMarkdownList(lines, "Outside boundary files", packet.scopeFindings.outsideBoundaryFiles, 20);
  lines.push("");
  pushMarkdownList(lines, "Outside boundary symbols", packet.scopeFindings.outsideBoundarySymbols, 16);
  lines.push("");
  pushMarkdownList(
    lines,
    "Contract changes to review",
    uniqueItems([
      ...packet.scopeFindings.protectedContractChanges,
      ...packet.scopeFindings.unplannedContractChanges,
    ]),
    16
  );
  lines.push("");
  pushMarkdownList(lines, "Verification expected", packet.verification.expectedCommands, 20);
  lines.push("");
  pushMarkdownList(lines, "Verification evidence", packet.verification.evidence.map(formatVerificationEvidence), 20);
  lines.push("");
  lines.push("#### Verification note");
  lines.push(`- ${packet.verification.note}`);
  lines.push("");
  pushMarkdownList(lines, "Reviewer notes", packet.reviewerNotes, 12);
  lines.push("");
}

function buildGithubPolicyAuditStepSummary(summary: StagedCheckSummary, policySync?: RipplePolicySyncSummary): string {
  const pushList = (lines: string[], title: string, items: string[], limit: number): void => {
    lines.push(`#### ${title}`);
    if (items.length === 0) {
      lines.push("- none");
      return;
    }
    items.slice(0, limit).forEach((item) => lines.push(`- ${item}`));
    if (items.length > limit) {
      lines.push(`- ...and ${items.length - limit} more`);
    }
  };
  const lines = [
    "## Ripple architecture gate",
    "",
    "Status: audit",
    "Mode: policy-only",
    "Blocking: false",
    "Intent: none (local intents are not required in CI audit mode)",
    `Checked files: ${summary.checkedFiles}`,
    `Highest risk: ${summary.highestRisk}`,
    `Requires attention: ${summary.requiresAttention}`,
    "",
  ];

  if (summary.baseRef) {
    lines.splice(5, 0, `Base ref: ${summary.baseRef}`);
  }

  if (summary.files.length > 0) {
    lines.push("### Changed files", "");
    summary.files.slice(0, 20).forEach((file) => {
      lines.push(`- ${file.file} (${file.modificationRisk}, importers: ${file.importerCount})`);
    });
    if (summary.files.length > 20) {
      lines.push(`- ...and ${summary.files.length - 20} more`);
    }
    lines.push("");
  }

  if (policySync) {
    lines.push("### Policy sync", "");
    lines.push(`Status: ${policySync.status}`);
    if (policySync.missingRules.length > 0) {
      policySync.missingRules.slice(0, 12).forEach((rule) => {
        lines.push(`- ${rule.paths.join(", ")} (risk: ${rule.risk ?? "medium"})`);
      });
      if (policySync.missingRules.length > 12) {
        lines.push(`- ...and ${policySync.missingRules.length - 12} more`);
      }
    } else {
      lines.push("- up to date");
    }
    lines.push("");
  }

  lines.push("### Agent actions", "");
  pushList(lines, "Trusted findings", summary.agentActions.trustedFindings, 12);
  lines.push("");
  pushList(lines, "Verify before merge", summary.agentActions.verifyBeforeCommit, 12);
  lines.push("");
  pushList(lines, "Manual review recommended", summary.agentActions.manualReviewRequired, 12);
  lines.push("");

  const verificationTargets = uniqueItems(
    summary.files.flatMap((file) => file.verificationTargets)
  );
  if (verificationTargets.length > 0) {
    lines.push("### Verify", "");
    verificationTargets.slice(0, 20).forEach((target) => lines.push(`- ${target}`));
    if (verificationTargets.length > 20) {
      lines.push(`- ...and ${verificationTargets.length - 20} more`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function buildGithubStepSummary(input: {
  summary: StagedCheckWithIntentSummary;
  intentLoadError?: string;
}): string {
  const { summary, intentLoadError } = input;
  const validation = summary.intentValidation;
  const gateDecision = validation?.handoff.decision ?? "create-intent";
  const canContinue = validation?.handoff.canContinue ?? false;
  const mustStop = validation?.handoff.mustStop ?? true;
  const needsHuman = validation?.handoff.needsHuman ?? true;
  const status = intentLoadError || !validation || validation.driftVerdict.status !== "pass"
    ? "failed"
    : "passed";
  const gateStatus = canContinue ? "open" : "closed";
  const nextRequiredPhase = intentLoadError
    ? MISSING_INTENT_NEXT_REQUIRED_PHASE
    : validation?.nextRequiredPhase ?? MISSING_INTENT_NEXT_REQUIRED_PHASE;
  const nextRequiredAction = intentLoadError
    ? MISSING_INTENT_NEXT_REQUIRED_ACTION
    : validation?.nextRequiredAction ?? MISSING_INTENT_NEXT_REQUIRED_ACTION;
  const pushList = (lines: string[], title: string, items: string[], limit: number): void => {
    lines.push(`#### ${title}`);
    if (items.length === 0) {
      lines.push("- none");
      return;
    }
    items.slice(0, limit).forEach((item) => lines.push(`- ${item}`));
    if (items.length > limit) {
      lines.push(`- ...and ${items.length - limit} more`);
    }
  };
  const lines = [
    "## Ripple architecture gate",
    "",
    `Status: ${status}`,
    `Gate status: ${gateStatus}`,
    `Gate decision: ${gateDecision}`,
    `Can continue: ${canContinue}`,
    `Must stop: ${mustStop}`,
    `Needs human: ${needsHuman}`,
    `Next required phase: ${nextRequiredPhase}`,
    `Next required action: ${nextRequiredAction}`,
    `Mode: ${summary.mode}`,
  ];

  if (summary.baseRef) {
    lines.push(`Base ref: ${summary.baseRef}`);
  }

  lines.push(
    `Checked files: ${summary.checkedFiles}`,
    `Highest risk: ${summary.highestRisk}`,
    ""
  );

  if (intentLoadError) {
    lines.push(
      "### Intent",
      "",
      `- ${intentLoadError}`,
      `- Next required phase: ${nextRequiredPhase}`,
      `- Next required action: ${nextRequiredAction}`,
      ""
    );
  } else if (validation) {
    lines.push(
      "### Intent",
      "",
      `- Intent: ${validation.intentId}`,
      `- Verdict: ${validation.verdict}`,
      `- Drift verdict: ${validation.driftVerdict.label}`,
      `- Control mode: ${validation.controlMode}`,
      `- Boundary verdict: ${validation.boundaryVerdict.label}`,
      `- Policy drift: ${validation.policyDrift.label}`,
      `- Readiness drift: ${validation.readinessDrift.label}`,
      `- Planned scope: ${validation.plannedScope}`,
      `- Next required phase: ${validation.nextRequiredPhase}`,
      `- Recommended action: ${validation.recommendedAction}`,
      ""
    );
  } else {
    lines.push(
      "### Intent",
      "",
      "- No saved change intent was provided.",
      `- Next required phase: ${nextRequiredPhase}`,
      `- Next required action: ${nextRequiredAction}`,
      ""
    );
  }

  appendGithubReviewPacket(lines, summary.reviewPacket);

  const blockingReasons = validation?.blockingReasons ?? [];
  if (blockingReasons.length > 0) {
    lines.push("### Blocking reasons", "");
    blockingReasons.forEach((reason) => lines.push(`- ${reason}`));
    lines.push("");
  }

  if (validation?.policyDrift) {
    lines.push(
      "### Policy drift",
      "",
      `- Status: ${validation.policyDrift.status}`,
      `- Decision: ${validation.policyDrift.decision}`,
      `- Summary: ${validation.policyDrift.summary}`,
      ""
    );
    pushList(lines, "Changed policy fields", validation.policyDrift.changedFields, 12);
    lines.push("");
    pushList(lines, "Policy drift fix", validation.policyDrift.fix, 8);
    lines.push("");
  }

  if (validation?.readinessDrift) {
    lines.push(
      "### Readiness drift",
      "",
      `- Status: ${validation.readinessDrift.status}`,
      `- Decision: ${validation.readinessDrift.decision}`,
      `- Summary: ${validation.readinessDrift.summary}`,
      `- Saved enforcement: ${validation.readinessDrift.savedReadiness.enforcementLevel}`,
      `- Current enforcement: ${validation.readinessDrift.currentReadiness?.enforcementLevel ?? "unknown"}`,
      ""
    );
    pushList(lines, "Weakened readiness fields", validation.readinessDrift.weakenedFields, 12);
    lines.push("");
    pushList(lines, "Readiness drift fix", validation.readinessDrift.fix, 8);
    lines.push("");
  }

  if (summary.files.length > 0) {
    lines.push("### Changed files", "");
    summary.files.slice(0, 20).forEach((file) => {
      lines.push(`- ${file.file} (${file.modificationRisk}, importers: ${file.importerCount})`);
    });
    if (summary.files.length > 20) {
      lines.push(`- ...and ${summary.files.length - 20} more`);
    }
    lines.push("");
  }

  lines.push("### Agent actions", "");
  pushList(lines, "Trusted findings", summary.agentActions.trustedFindings, 12);
  lines.push("");
  pushList(lines, "Verify before commit", summary.agentActions.verifyBeforeCommit, 12);
  lines.push("");
  pushList(lines, "Manual review required", summary.agentActions.manualReviewRequired, 12);
  lines.push("");

  const verificationTargets = uniqueItems(
    summary.files.flatMap((file) => file.verificationTargets)
  );
  if (verificationTargets.length > 0) {
    lines.push("### Verify", "");
    verificationTargets.slice(0, 20).forEach((target) => lines.push(`- ${target}`));
    if (verificationTargets.length > 20) {
      lines.push(`- ...and ${verificationTargets.length - 20} more`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function buildGithubAuditStepSummary(audit: RippleAuditSummary): string {
  const summary = audit.stagedCheck;
  const validation = summary.intentValidation;
  const gate = buildRippleGateSummary(audit);
  const status = gate.canContinue ? "passed" : "failed";
  const pushList = (lines: string[], title: string, items: string[], limit: number): void => {
    lines.push(`#### ${title}`);
    if (items.length === 0) {
      lines.push("- none");
      return;
    }
    items.slice(0, limit).forEach((item) => lines.push(`- ${item}`));
    if (items.length > limit) {
      lines.push(`- ...and ${items.length - limit} more`);
    }
  };
  const lines = [
    "## Ripple architecture gate",
    "",
    `Status: ${status}`,
    `Gate status: ${gate.status}`,
    `Gate decision: ${gate.decision}`,
    `Can continue: ${gate.canContinue}`,
    `Must stop: ${gate.mustStop}`,
    `Needs human: ${gate.needsHuman}`,
    `Gate next required phase: ${gate.nextRequiredPhase}`,
    `Gate next required action: ${gate.nextRequiredAction}`,
    `Audit status: ${audit.status}`,
    `Decision: ${audit.decision}`,
    `Can proceed: ${audit.canProceed}`,
    `Next required phase: ${audit.nextRequiredPhase}`,
    `Next required action: ${audit.nextRequiredAction}`,
    `Mode: ${audit.mode}`,
  ];

  if (audit.baseRef) {
    lines.push(`Base ref: ${audit.baseRef}`);
  }

  lines.push(
    `Checked files: ${summary.checkedFiles}`,
    `Highest risk: ${summary.highestRisk}`,
    ""
  );

  lines.push(
    "### Intent",
    "",
    `- Intent: ${audit.intent.id}`,
    `- Task: ${audit.intent.task}`,
    `- Target: ${audit.intent.targetFile}`,
    `- Verdict: ${validation?.verdict ?? "unknown"}`,
    `- Drift verdict: ${validation?.driftVerdict.label ?? "UNKNOWN"}`,
    `- Control mode: ${audit.intent.controlMode}`,
    `- Boundary verdict: ${validation?.boundaryVerdict.label ?? "UNKNOWN"}`,
    `- Human gate: ${audit.intent.humanGate}`,
    `- Policy drift: ${validation?.policyDrift.label ?? "UNKNOWN"}`,
    `- Readiness drift: ${validation?.readinessDrift.label ?? "UNKNOWN"}`,
    `- Repair status: ${audit.repairPlan.status}`,
    `- Next required phase: ${audit.nextRequiredPhase}`,
    `- Recommended action: ${audit.recommendedAction}`,
    ""
  );

  lines.push(
    "### Approval",
    "",
    `- Status: ${audit.approvalStatus.status}`,
    `- Decision: ${audit.approvalStatus.decision}`,
    `- Required: ${audit.approvalStatus.required}`,
    `- Approved: ${audit.approvalStatus.approved}`,
    `- Gate: ${audit.approvalStatus.gate ?? "none"}`,
    `- Summary: ${audit.approvalStatus.summary}`,
    ""
  );
  if (audit.approvalStatus.approval) {
    lines.push(
      `- Approved by: ${audit.approvalStatus.approval.approvedBy}`,
      `- Approved at: ${audit.approvalStatus.approval.approvedAt}`,
      ""
    );
  }
  pushList(lines, "Approval why", audit.approvalStatus.why, 8);
  lines.push("");

  appendGithubReviewPacket(lines, audit.reviewPacket);

  if (audit.blockingReasons.length > 0) {
    lines.push("### Blocking reasons", "");
    audit.blockingReasons.forEach((reason) => lines.push(`- ${reason}`));
    lines.push("");
  }

  lines.push(
    "### Gate handoff",
    "",
    `- Summary: ${gate.summary}`,
    `- Decision: ${gate.decision}`,
    `- Can continue: ${gate.canContinue}`,
    `- Must stop: ${gate.mustStop}`,
    `- Needs human: ${gate.needsHuman}`,
    ""
  );
  pushList(lines, "Gate why", gate.why, 8);
  lines.push("");
  pushList(lines, "Fix now", gate.fixNow, 12);
  lines.push("");
  lines.push(
    "### Risk",
    "",
    `- Level: ${gate.risk.level}`,
    `- Score: ${gate.risk.score}/100`,
    `- Summary: ${gate.risk.summary}`,
    ""
  );
  pushList(lines, "Why this is risky", compactGateRiskReasons(gate), 8);
  lines.push("");
  pushList(lines, "Risk evidence", compactGateRiskEvidence(gate), 12);
  lines.push("");
  pushList(lines, "Risk required actions", compactGateRiskActions(gate), 12);
  lines.push("");
  pushList(lines, "Ask human", gate.askHuman, 8);
  lines.push("");
  pushList(
    lines,
    "Gate commands",
    uniqueItems([
      ...gate.commands.doctor,
      ...gate.commands.check,
      ...gate.commands.audit,
      ...gate.commands.repair,
      ...gate.commands.approve,
      ...gate.commands.unstage,
      ...gate.commands.verify,
    ]),
    16
  );
  lines.push("");

  if (validation?.policyDrift) {
    lines.push(
      "### Policy drift",
      "",
      `- Status: ${validation.policyDrift.status}`,
      `- Decision: ${validation.policyDrift.decision}`,
      `- Summary: ${validation.policyDrift.summary}`,
      ""
    );
    pushList(lines, "Changed policy fields", validation.policyDrift.changedFields, 12);
    lines.push("");
    pushList(lines, "Policy drift fix", validation.policyDrift.fix, 8);
    lines.push("");
  }

  if (validation?.readinessDrift) {
    lines.push(
      "### Readiness drift",
      "",
      `- Status: ${validation.readinessDrift.status}`,
      `- Decision: ${validation.readinessDrift.decision}`,
      `- Summary: ${validation.readinessDrift.summary}`,
      `- Saved enforcement: ${validation.readinessDrift.savedReadiness.enforcementLevel}`,
      `- Current enforcement: ${validation.readinessDrift.currentReadiness?.enforcementLevel ?? "unknown"}`,
      ""
    );
    pushList(lines, "Weakened readiness fields", validation.readinessDrift.weakenedFields, 12);
    lines.push("");
    pushList(lines, "Readiness drift fix", validation.readinessDrift.fix, 8);
    lines.push("");
  }

  if (summary.files.length > 0) {
    lines.push("### Changed files", "");
    summary.files.slice(0, 20).forEach((file) => {
      lines.push(`- ${file.file} (${file.modificationRisk}, importers: ${file.importerCount})`);
    });
    if (summary.files.length > 20) {
      lines.push(`- ...and ${summary.files.length - 20} more`);
    }
    lines.push("");
  }

  lines.push("### Agent actions", "");
  pushList(lines, "Trusted findings", summary.agentActions.trustedFindings, 12);
  lines.push("");
  pushList(lines, "Verify before commit", summary.agentActions.verifyBeforeCommit, 12);
  lines.push("");
  pushList(lines, "Manual review required", summary.agentActions.manualReviewRequired, 12);
  lines.push("");
  pushList(lines, "Fix actions", audit.repairPlan.fixActions.map(formatRepairActionForAgent), 12);
  lines.push("");

  if (audit.verificationTargets.length > 0) {
    lines.push("### Verify", "");
    audit.verificationTargets.slice(0, 20).forEach((target) => lines.push(`- ${target}`));
    if (audit.verificationTargets.length > 20) {
      lines.push(`- ...and ${audit.verificationTargets.length - 20} more`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function printGithubCheckAnnotations(summary: StagedCheckWithIntentSummary): void {
  const validation = summary.intentValidation;
  if (!validation) {
    printGithubErrorAnnotation({
      title: "Ripple intent required",
      message: "Strict Ripple checks need --intent latest or another saved change intent.",
    });
    return;
  }

  if (validation.policyDrift.status === "changed") {
    printGithubWarningAnnotation({
      file: validation.targetFile,
      title: "Ripple policy drift",
      message: validation.policyDrift.summary,
    });
    validation.policyDrift.changedFields.slice(0, 8).forEach((field) => {
      printGithubWarningAnnotation({
        file: validation.targetFile,
        title: "Ripple policy drift",
        message: field,
      });
    });
  }

  if (validation.readinessDrift.status === "weakened") {
    printGithubWarningAnnotation({
      file: validation.targetFile,
      title: "Ripple readiness drift",
      message: validation.readinessDrift.summary,
    });
    validation.readinessDrift.weakenedFields.slice(0, 8).forEach((field) => {
      printGithubWarningAnnotation({
        file: validation.targetFile,
        title: "Ripple readiness drift",
        message: `Weakened readiness field: ${field}`,
      });
    });
  }

  validation.unplannedFiles.forEach((file) => {
    printGithubWarningAnnotation({
      file,
      title: "Ripple intent drift",
      message: `Unplanned file changed: ${file}`,
    });
  });

  validation.unplannedSymbols.forEach((symbol) => {
    const file = symbolFile(symbol);
    printGithubWarningAnnotation({
      file,
      title: "Ripple symbol drift",
      message: `Unplanned symbol changed: ${symbol}`,
    });
  });

  validation.boundaryVerdict.changedOutsideBoundaryFiles.forEach((file) => {
    printGithubErrorAnnotation({
      file,
      title: "Ripple boundary drift",
      message: `File changed outside ${validation.controlMode} boundary: ${file}`,
    });
  });

  validation.boundaryVerdict.changedOutsideBoundarySymbols.forEach((symbol) => {
    printGithubErrorAnnotation({
      file: symbolFile(symbol),
      title: "Ripple boundary drift",
      message: `Symbol changed outside ${validation.controlMode} boundary: ${symbol}`,
    });
  });

  uniqueItems([
    ...validation.protectedContractChanges,
    ...validation.unplannedContractChanges,
  ]).forEach((symbol) => {
    const file = symbolFile(symbol);
    printGithubErrorAnnotation({
      file,
      title: "Ripple contract drift",
      message: `Contract review required: ${symbol}`,
    });
  });

  validation.blockingReasons
    .filter((reason) => !reason.startsWith("Unplanned file changed: "))
    .forEach((reason) => {
      printGithubErrorAnnotation({
        title: "Ripple check blocked",
        message: reason,
      });
    });

  summary.agentActions.trustedFindings.slice(0, 12).forEach((action) => {
    printGithubNoticeAnnotation({
      file: actionFile(action),
      title: "Ripple trusted finding",
      message: action,
    });
  });

  summary.agentActions.verifyBeforeCommit.slice(0, 12).forEach((action) => {
    printGithubWarningAnnotation({
      file: actionFile(action),
      title: "Ripple verify before commit",
      message: action,
    });
  });

  summary.agentActions.manualReviewRequired.slice(0, 12).forEach((action) => {
    printGithubWarningAnnotation({
      file: actionFile(action),
      title: "Ripple manual review required",
      message: action,
    });
  });
}

function printGithubPolicyAuditAnnotations(summary: StagedCheckSummary, policySync?: RipplePolicySyncSummary): void {
  if (summary.requiresAttention) {
    printGithubWarningAnnotation({
      title: "Ripple policy audit",
      message: `Policy audit detected ${summary.highestRisk} risk changes. Ripple is in audit mode, so this does not block merge. Ensure human review before merging.`,
    });
  } else {
    printGithubNoticeAnnotation({
      title: "Ripple policy audit",
      message: "Policy audit completed without high-risk findings.",
    });
  }

  if (policySync && policySync.missingRules.length > 0) {
    printGithubWarningAnnotation({
      title: "Ripple policy rot",
      message: `Policy may be missing ${policySync.missingRules.length} risky repo surface(s). Run ripple policy sync and review .ripple/policy.json.`,
    });
  }

  summary.agentActions.verifyBeforeCommit.slice(0, 12).forEach((action) => {
    printGithubWarningAnnotation({
      file: actionFile(action),
      title: "Ripple verify before merge",
      message: action,
    });
  });

  summary.agentActions.manualReviewRequired.slice(0, 12).forEach((action) => {
    printGithubWarningAnnotation({
      file: actionFile(action),
      title: "Ripple manual review recommended",
      message: action,
    });
  });
}

function printGithubAuditAnnotations(audit: RippleAuditSummary): void {
  const gate = buildRippleGateSummary(audit);
  if (audit.status !== "pass") {
    printGithubWarningAnnotation({
      file: audit.intent.targetFile,
      title: "Ripple gate closed",
      message: `${gate.status}/${gate.decision}: next=${gate.nextRequiredPhase}. ${gate.nextRequiredAction}`,
    });
  }
  if (audit.approvalStatus.required && !audit.approvalStatus.approved) {
    printGithubWarningAnnotation({
      file: audit.intent.targetFile,
      title: "Ripple approval required",
      message: audit.approvalStatus.summary,
    });
  }
  printGithubCheckAnnotations(audit.stagedCheck);
}

function printGithubNoticeAnnotation(input: {
  file?: string;
  title: string;
  message: string;
}): void {
  printGithubAnnotation("notice", input);
}

function printGithubWarningAnnotation(input: {
  file?: string;
  title: string;
  message: string;
}): void {
  printGithubAnnotation("warning", input);
}

function printGithubErrorAnnotation(input: {
  file?: string;
  title: string;
  message: string;
}): void {
  printGithubAnnotation("error", input);
}

function printGithubAnnotation(
  kind: "notice" | "warning" | "error",
  input: {
    file?: string;
    title: string;
    message: string;
  }
): void {
  const properties = [
    input.file ? `file=${escapeGithubCommandProperty(input.file)}` : null,
    `title=${escapeGithubCommandProperty(input.title)}`,
  ].filter(Boolean).join(",");
  console.log(`::${kind} ${properties}::${escapeGithubCommandData(input.message)}`);
}

function escapeGithubCommandData(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function escapeGithubCommandProperty(value: string): string {
  return escapeGithubCommandData(value)
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}

function symbolFile(symbol: string): string | undefined {
  const index = symbol.indexOf("::");
  if (index <= 0) {
    return undefined;
  }
  return symbol.slice(0, index);
}

function actionFile(action: string): string | undefined {
  const subjectEnd = action.indexOf(":");
  if (subjectEnd <= 0) {
    return undefined;
  }

  const subject = action.slice(0, subjectEnd);
  const fileFromSymbol = symbolFile(subject);
  if (fileFromSymbol) {
    return fileFromSymbol;
  }

  return /\.(ts|tsx|js|jsx)$/i.test(subject) ? subject : undefined;
}

function relativeToWorkspace(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/");
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function resolveCliIntentPath(workspaceRoot: string, intentRef: string): string {
  const normalized = intentRef.trim();
  if (normalized.length === 0 || normalized === "latest") {
    return defaultChangeIntentPath(workspaceRoot);
  }
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  if (normalized.endsWith(".json") || normalized.includes("/") || normalized.includes("\\")) {
    return path.resolve(workspaceRoot, normalized);
  }
  return path.join(workspaceRoot, ".ripple", "intents", `${normalized}.json`);
}

function isActiveChangeIntentFile(filePath: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { protocol?: unknown };
    return parsed.protocol === "ripple-change-intent";
  } catch {
    return false;
  }
}

function formatEventLine(event: RecentHistorySummary["groups"][number]["events"][number]): string {
  const target = event.target ? ` -> ${event.target}` : "";
  const details = [
    event.kind ? `kind:${event.kind}` : null,
    event.layer ? `layer:${event.layer}` : null,
    event.metadata ?? null,
  ].filter(Boolean).join(", ");
  return `${event.type} ${event.source}${target}${details ? ` (${details})` : ""}`;
}

async function runWithQuietEngine<T>(task: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await task();
  } finally {
    console.log = originalLog;
  }
}

function createCliEngine(
  workspaceRoot: string,
  contextMode: "full" | "lean" | "on-demand" = "lean"
): GraphEngine {
  const engine = new GraphEngine(workspaceRoot);
  engine.setContextGenerationMode(contextMode);
  return engine;
}

function createFastCheckEngine(workspaceRoot: string): GraphEngine {
  const engine = createCliEngine(workspaceRoot, "lean");
  return engine;
}

function fastCheckCandidateFiles(files: string[], intent?: ChangeIntent): string[] {
  const intentSymbolFiles = (intent?.allowedSymbols ?? [])
    .map((symbolId) => symbolId.split("::")[0])
    .filter(Boolean);

  return uniqueItems([
    ...files,
    ...(intent
      ? [
          intent.targetFile,
          ...intent.editableFiles,
          ...intent.allowedFiles,
          ...intent.expectedFiles,
          ...intent.contextFiles,
          ...intentSymbolFiles,
        ]
      : []),
  ].filter((file): file is string => Boolean(file)));
}

function printScanSummary(summary: ScanSummary): void {
  console.log("Ripple scan complete");
  console.log(`Workspace: ${summary.workspace}`);
  console.log(`Files: ${summary.files}`);
  console.log(`Symbols: ${summary.symbols}`);
  console.log(`Call edges: ${summary.callEdges}`);
  console.log(`Mode: ${summary.contextMode}`);
  console.log(`Graph cache: ${summary.cacheGenerated ? summary.cachePath : "not generated"}`);
  console.log(`Context bundle: ${summary.contextGenerated ? summary.contextPath : "not generated by lean scan"}`);
}

function printWorkflowSummary(summary: RippleWorkflowSummary): void {
  console.log("Ripple workflow generated");
  console.log(`Workspace: ${summary.workspace}`);
  console.log(`Path: ${summary.path}`);
  console.log(`Context bundle: ${summary.contextGenerated ? "generated" : "missing"}`);
  console.log(`Focus files: ${summary.focusFileCount}`);
  console.log("");
  printHumanList("Next:", summary.nextSteps);
}

function printDoctorSummary(summary: RippleDoctorOutput): void {
  console.log("Ripple doctor");
  console.log(`Workspace: ${summary.workspace}`);
  console.log(`Status: ${summary.status}`);
  console.log("");
  console.log(
    `Adapter: ${summary.adapterSupport.primaryAdapter.capabilities.displayName} (${summary.adapterSupport.supportLevel})`
  );
  console.log(`Adapter confidence: ${Math.round(summary.adapterSupport.primaryAdapter.confidence * 100)}%`);
  console.log(`Agent trust: ${summary.adapterSupport.primaryAdapter.agentPolicy.canTrust.join(", ")}`);
  console.log(`Graph: ${summary.checks.graph.ok ? "ok" : "missing"} - ${summary.checks.graph.detail}`);
  console.log(`Git: ${summary.checks.git.ok ? "ok" : "missing"} - ${summary.checks.git.detail}`);
  console.log(
    `Git ignore: ${summary.checks.gitIgnore.ok ? "ok" : "missing"} - ${summary.checks.gitIgnore.detail}`
  );
  console.log(
    `CI workflow: ${summary.checks.ciWorkflow.ok ? "ok" : "missing"} - ${summary.checks.ciWorkflow.detail}`
  );
  console.log(
    `Latest intent: ${summary.checks.latestIntent.ok ? "ok" : "missing"} - ${summary.checks.latestIntent.detail}`
  );
  console.log("");
  console.log("Enforcement:");
  console.log(`  level: ${summary.enforcement.level}`);
  console.log(`  can guide agents: ${summary.enforcement.canGuideAgents}`);
  console.log(`  can detect drift: ${summary.enforcement.canDetectDrift}`);
  console.log(`  can block in CI: ${summary.enforcement.canBlockInCi}`);
  console.log(`  policy: ${summary.enforcement.explicitPolicy.detail}`);
  console.log(`  summary: ${summary.enforcement.summary}`);
  if (summary.enforcement.gaps.length > 0) {
    console.log("  gaps:");
    summary.enforcement.gaps.forEach((gap) => console.log(`    - ${gap}`));
  }
  console.log("");
  console.log("Policy sync:");
  console.log(`  status: ${summary.policySync.status}`);
  if (summary.policySync.missingRules.length > 0) {
    console.log("  missing coverage:");
    summary.policySync.missingRules.slice(0, 12).forEach((rule) => {
      console.log(`    - ${rule.paths.join(", ")} risk=${rule.risk ?? "medium"}`);
    });
  }
  console.log("");
  console.log("Next steps:");
  summary.nextSteps.forEach((step) => console.log(`  - ${step}`));
}

function printInitSummary(summary: RippleInitSummary): void {
  console.log("Ripple init");
  console.log(`Workspace: ${summary.workspace}`);
  console.log("");
  console.log("Setup files:");
  summary.files.forEach((file) => {
    console.log(`  - ${file.path}: ${file.status}`);
  });
  if (summary.agentSetup) {
    console.log("");
    console.log("Agent setup files:");
    summary.agentSetup.files.forEach((file) => {
      console.log(`  - ${file.path}: ${file.status}`);
    });
  }
  if (summary.hooks) {
    console.log("");
    console.log("Git hooks:");
    console.log(`  - ${summary.hooks.path}: ${summary.hooks.preCommitAction ?? summary.hooks.status}`);
    if (summary.hooks.postCommitPath) {
      console.log(`  - ${summary.hooks.postCommitPath}: ${summary.hooks.postCommitAction ?? summary.hooks.status}`);
    }
  }
  if (summary.readiness) {
    console.log("");
    console.log("Readiness after init:");
    console.log(`  status: ${summary.readiness.status}`);
    console.log(`  enforcement: ${summary.readiness.enforcement.level}`);
    console.log(`  can guide agents: ${summary.readiness.enforcement.canGuideAgents}`);
    console.log(`  can detect drift: ${summary.readiness.enforcement.canDetectDrift}`);
    console.log(`  can block in CI: ${summary.readiness.enforcement.canBlockInCi}`);
  }
  console.log("");
  console.log("Next steps:");
  summary.nextSteps.forEach((step) => console.log(`  - ${step}`));
}

function printAgentDoctorSummary(summary: RippleDoctorOutput): void {
  console.log("RIPPLE_DOCTOR");
  console.log(`status: ${summary.status}`);
  console.log(`decision: ${summary.decision}`);
  console.log(`can_continue: ${summary.canContinue}`);
  console.log(`must_stop: ${summary.mustStop}`);
  console.log(`next_required_action: ${summary.nextRequiredAction}`);
  console.log(`workspace: ${summary.workspace}`);
  console.log(`adapter: ${summary.adapterSupport.primaryAdapter.id}`);
  console.log(`adapter_support: ${summary.adapterSupport.supportLevel}`);
  console.log(`adapter_confidence: ${Math.round(summary.adapterSupport.primaryAdapter.confidence * 100)}%`);
  console.log(`enforcement_level: ${summary.enforcement.level}`);
  console.log(`can_guide_agents: ${summary.enforcement.canGuideAgents}`);
  console.log(`can_detect_drift: ${summary.enforcement.canDetectDrift}`);
  console.log(`can_block_in_ci: ${summary.enforcement.canBlockInCi}`);
  console.log(`policy_explicit: ${summary.enforcement.explicitPolicy.ok}`);
  console.log(`policy_detail: ${summary.enforcement.explicitPolicy.detail}`);
  console.log(`graph: ${summary.checks.graph.ok ? "ok" : "missing"} - ${summary.checks.graph.detail}`);
  console.log(`git: ${summary.checks.git.ok ? "ok" : "missing"} - ${summary.checks.git.detail}`);
  console.log(`git_ignore: ${summary.checks.gitIgnore.ok ? "ok" : "missing"} - ${summary.checks.gitIgnore.detail}`);
  console.log(`ci_workflow: ${summary.checks.ciWorkflow.ok ? "ok" : "missing"} - ${summary.checks.ciWorkflow.detail}`);
  console.log(`latest_intent: ${summary.checks.latestIntent.ok ? "ok" : "missing"} - ${summary.checks.latestIntent.detail}`);
  console.log(`policy_sync: ${summary.policySync.status}`);
  if (summary.policySync.missingRules.length > 0) {
    console.log("policy_sync_missing_rules:");
    summary.policySync.missingRules.slice(0, 12).forEach((rule) => {
      console.log(`- ${rule.paths.join(", ")} risk=${rule.risk ?? "medium"}`);
    });
  }
  console.log("");
  printAgentList("why", summary.why);
  console.log("");
  printAgentList("fix_now", summary.fixNow);
  console.log("");
  printAgentList("next_steps", summary.nextSteps);
}

function printHistorySummary(summary: RecentHistorySummary): void {
  console.log("Ripple history");
  console.log(`Events: ${summary.totalEvents}`);
  console.log(`Groups: ${summary.returnedGroups}`);

  if (summary.groups.length === 0) {
    console.log("");
    console.log("No history events found.");
    return;
  }

  summary.groups.forEach((group, index) => {
    console.log("");
    console.log(`${index + 1}. ${group.changedAt} ${group.id}`);
    console.log(`   Events: ${group.eventCount}`);
    if (group.filesChanged.length > 0) {
      console.log(`   Files: ${group.filesChanged.join(", ")}`);
    }
    if (group.symbolsChanged.length > 0) {
      console.log(`   Symbols: ${group.symbolsChanged.slice(0, 5).join(", ")}`);
    }
    if (group.relatedFiles.length > 0) {
      console.log(`   Related: ${group.relatedFiles.join(", ")}`);
    }
    group.events.slice(0, 5).forEach((event) => {
      console.log(`   - ${formatEventLine(event)}`);
    });
  });
}

function printPlanFiles(title: string, files: ContextPlanFile[]): void {
  console.log(title);
  if (files.length === 0) {
    console.log("  none");
    return;
  }
  files.forEach((file) => {
    const role = file.role ?? "related";
    const score = file.score === undefined ? "" : `, score: ${file.score}`;
    const signals = file.signals && file.signals.length > 0
      ? file.signals.join(", ")
      : "none";

    console.log(
      `  - ${file.file} [${role}, ${file.modificationRisk}${score}, ~${file.estimatedTokens} tokens]`
    );
    console.log(`    signals: ${signals}`);
    if (file.adapterSignals && file.adapterSignals.length > 0) {
      console.log(`    adapter signals: ${formatAdapterSignalInline(file.adapterSignals)}`);
    }
    console.log(`    reason: ${file.reason}`);
    console.log(`    focus: ${file.focus}`);
  });
}

function formatAdapterSignalInline(signals: ContextPlanAdapterSignal[] | undefined): string {
  if (!signals || signals.length === 0) {
    return "none";
  }
  return signals
    .map((signal) =>
      `${signal.capability}:${signal.agentUse}/${Math.round(signal.confidence * 100)}%`
    )
    .join(", ");
}

function printSymbolFocus(symbols: ContextPlanSymbol[]): void {
  console.log("Symbol focus:");
  if (symbols.length === 0) {
    console.log("  none");
    return;
  }

  symbols.slice(0, 12).forEach((symbol) => {
    const signals = symbol.signals.length > 0 ? symbol.signals.join(", ") : "none";
    console.log(
      `  - ${symbol.symbol} [${symbol.kind}, ${symbol.layer}, score: ${symbol.score}, callers: ${symbol.callers}, calls: ${symbol.calls}]`
    );
    console.log(`    signals: ${signals}`);
    console.log(`    reason: ${symbol.reason}`);
  });
}

function adapterConfidencePercent(summary: ContextPlanSummary): number {
  return Math.round(summary.adapterSupport.primaryAdapter.confidence * 100);
}

function printPlanAdapterSupport(summary: ContextPlanSummary): void {
  const adapter = summary.adapterSupport.primaryAdapter;
  console.log(
    `Adapter: ${adapter.capabilities.displayName} (${adapter.supportLevel}, ${adapterConfidencePercent(summary)}%)`
  );
  console.log(`Adapter language: ${adapter.capabilities.language}`);
  console.log("Adapter trust:");
  adapter.agentPolicy.canTrust.forEach((item) => console.log(`  - ${item}`));
  console.log("Adapter verify:");
  adapter.agentPolicy.beCarefulWith.forEach((item) => console.log(`  - ${item}`));
  if (adapter.agentPolicy.mustFallbackToManual.length > 0) {
    console.log("Adapter manual fallback:");
    adapter.agentPolicy.mustFallbackToManual.forEach((item) => console.log(`  - ${item}`));
  }
}

function printContextPlan(summary: ContextPlanSummary, savedIntent?: SavedChangeIntent): void {
  console.log("Ripple context plan");
  console.log(`Task: ${summary.task}`);
  console.log(`Target: ${summary.targetFile}`);
  console.log(`Risk: ${summary.risk}`);
  console.log(`Budget: ${summary.tokenBudget}`);
  console.log(`Estimated readFirst tokens: ${summary.estimatedTokens}`);
  console.log(`Why: ${summary.why}`);
  console.log("");
  printPlanAdapterSupport(summary);
  if (summary.planningSignals && summary.planningSignals.length > 0) {
    console.log("");
    console.log("Planning signals:");
    summary.planningSignals.forEach((signal) => console.log(`  - ${signal}`));
  }
  console.log("");
  printPlanFiles("Read first:", summary.readFirst);
  console.log("");
  printPlanFiles("Read if needed:", summary.readIfNeeded);
  console.log("");
  printSymbolFocus(summary.symbolFocus);
  console.log("");
  console.log("Avoid initially:");
  summary.avoidInitially.forEach((item) => console.log(`  - ${item}`));
  if (summary.doNotReadFirst && summary.doNotReadFirst.length > 0) {
    console.log("");
    console.log("Do not read first:");
    summary.doNotReadFirst.forEach((item) => console.log(`  - ${item}`));
  }
  if (summary.verificationTargets.length > 0) {
    console.log("");
    console.log("Verification targets:");
    summary.verificationTargets.slice(0, 12).forEach((item) => console.log(`  - ${item}`));
  }
  if (savedIntent) {
    console.log("");
    console.log(`Saved change intent: ${relativeToWorkspace(process.cwd(), savedIntent.path)}`);
    console.log(`Intent id: ${savedIntent.intent.id}`);
    console.log(`Control mode: ${savedIntent.intent.controlMode}`);
    console.log(`Human gate: ${savedIntent.intent.humanGate}`);
    console.log(`Boundary risk: ${savedIntent.intent.boundaryRisk}`);
    console.log(`Policy source: ${savedIntent.intent.policySource}`);
    console.log(`Enforcement at plan time: ${savedIntent.intent.readinessSnapshot.enforcementLevel}`);
    console.log(
      `Can detect drift: ${savedIntent.intent.readinessSnapshot.canDetectDrift ? "yes" : "no"}`
    );
    console.log(
      `Can block in CI: ${savedIntent.intent.readinessSnapshot.canBlockInCi ? "yes" : "no"}`
    );
    console.log("Editable files:");
    savedIntent.intent.editableFiles.forEach((file) => console.log(`  - ${file}`));
    if (savedIntent.intent.allowedSymbols.length > 0) {
      console.log("Allowed symbols:");
      savedIntent.intent.allowedSymbols.forEach((symbol) => console.log(`  - ${symbol}`));
    }
    if (savedIntent.intent.policyMatches.length > 0) {
      console.log("Policy matches:");
      savedIntent.intent.policyMatches.forEach((match) => console.log(`  - ${match}`));
    }
    console.log("Context-only files:");
    savedIntent.intent.contextFiles.slice(0, 12).forEach((file) => console.log(`  - ${file}`));
    if (savedIntent.intent.humanGateReason.length > 0) {
      console.log("Human gate reason:");
      savedIntent.intent.humanGateReason.forEach((reason) => console.log(`  - ${reason}`));
    }
  }
}

function printAgentList(title: string, items: string[]): void {
  console.log(`${title}:`);
  if (items.length === 0) {
    console.log("- none");
    return;
  }
  items.forEach((item) => console.log(`- ${item}`));
}

function printAgentHandoffBlock(
  title: string,
  handoff: RippleAgentHandoffVerdict
): void {
  console.log(`${title}:`);
  console.log(`can_continue: ${handoff.canContinue}`);
  console.log(`must_stop: ${handoff.mustStop}`);
  console.log(`needs_human: ${handoff.needsHuman}`);
  console.log(`decision: ${handoff.decision}`);
  console.log(`next_required_phase: ${handoff.nextRequiredPhase}`);
  console.log(`next_required_action: ${handoff.nextRequiredAction}`);
  console.log(`summary: ${handoff.summary}`);
  console.log("");
  printAgentList("handoff_why", handoff.why);
  console.log("");
  printAgentList("fix_now", handoff.fixNow);
  console.log("");
  printAgentList("ask_human", handoff.askHuman);
  console.log("");
  printAgentList("commands_doctor", handoff.commands.doctor);
  console.log("");
  printAgentList("commands_plan", handoff.commands.plan);
  console.log("");
  printAgentList("commands_check", handoff.commands.check);
  console.log("");
  printAgentList("commands_audit", handoff.commands.audit);
  console.log("");
  printAgentList("commands_repair", handoff.commands.repair);
  console.log("");
  printAgentList("commands_approve", handoff.commands.approve);
  console.log("");
  printAgentList("commands_unstage", handoff.commands.unstage);
  console.log("");
  printAgentList("commands_verify", handoff.commands.verify);
}

function printAgentPolicyExplanationBlock(
  title: string,
  explanation: RipplePolicyExplanation
): void {
  console.log(`${title}:`);
  console.log(`effective_mode: ${explanation.effectiveMode}`);
  console.log(`policy_risk: ${explanation.policyRisk}`);
  console.log(`human_gate: ${explanation.humanGate}`);
  console.log(`human_required: ${explanation.humanRequired}`);
  console.log(`policy_source: ${explanation.policySource}`);
  printAgentList("policy_matches", explanation.matchedRules);
}

function printPolicyExplanationSummary(
  title: string,
  explanation: RipplePolicyExplanation
): void {
  console.log(title);
  console.log(`  effective mode: ${explanation.effectiveMode}`);
  console.log(`  policy risk: ${explanation.policyRisk}`);
  console.log(`  human gate: ${explanation.humanGate}`);
  console.log(`  human required: ${explanation.humanRequired}`);
  console.log(`  policy source: ${explanation.policySource}`);
  console.log(
    `  matched rules: ${explanation.matchedRules.length > 0 ? explanation.matchedRules.join("; ") : "none"}`
  );
}

function printAgentPolicyDriftBlock(
  title: string,
  drift: ChangeIntentValidationSummary["policyDrift"]
): void {
  console.log(`${title}:`);
  console.log(`label: ${drift.label}`);
  console.log(`status: ${drift.status}`);
  console.log(`decision: ${drift.decision}`);
  console.log(`summary: ${drift.summary}`);
  printAgentList("changed_policy_fields", drift.changedFields);
  console.log("");
  printAgentList("policy_drift_why", drift.why);
  console.log("");
  printAgentList("policy_drift_fix", drift.fix);
}

function printAgentReadinessDriftBlock(
  title: string,
  drift: ChangeIntentValidationSummary["readinessDrift"]
): void {
  console.log(`${title}:`);
  console.log(`label: ${drift.label}`);
  console.log(`status: ${drift.status}`);
  console.log(`decision: ${drift.decision}`);
  console.log(`summary: ${drift.summary}`);
  console.log(`saved_enforcement_level: ${drift.savedReadiness.enforcementLevel}`);
  if (drift.currentReadiness) {
    console.log(`current_enforcement_level: ${drift.currentReadiness.enforcementLevel}`);
  }
  printAgentList("changed_readiness_fields", drift.changedFields);
  console.log("");
  printAgentList("weakened_readiness_fields", drift.weakenedFields);
  console.log("");
  printAgentList("readiness_drift_why", drift.why);
  console.log("");
  printAgentList("readiness_drift_fix", drift.fix);
}

function printPolicyDriftSummary(
  title: string,
  drift: ChangeIntentValidationSummary["policyDrift"]
): void {
  console.log(title);
  console.log(`  verdict: ${drift.label}`);
  console.log(`  status: ${drift.status}`);
  console.log(`  decision: ${drift.decision}`);
  console.log(`  summary: ${drift.summary}`);
  if (drift.changedFields.length > 0) {
    console.log("  changed fields:");
    drift.changedFields.forEach((field) => console.log(`    - ${field}`));
  }
}

function printReadinessDriftSummary(
  title: string,
  drift: ChangeIntentValidationSummary["readinessDrift"]
): void {
  console.log(title);
  console.log(`  verdict: ${drift.label}`);
  console.log(`  status: ${drift.status}`);
  console.log(`  decision: ${drift.decision}`);
  console.log(`  summary: ${drift.summary}`);
  console.log(`  saved enforcement: ${drift.savedReadiness.enforcementLevel}`);
  if (drift.currentReadiness) {
    console.log(`  current enforcement: ${drift.currentReadiness.enforcementLevel}`);
  }
  if (drift.weakenedFields.length > 0) {
    console.log("  weakened fields:");
    drift.weakenedFields.forEach((field) => console.log(`    - ${field}`));
  }
}

function printAgentContextPlan(summary: ContextPlanSummary, savedIntent?: SavedChangeIntent): void {
  const adapter = summary.adapterSupport.primaryAdapter;
  console.log("RIPPLE_AGENT_CONTEXT");
  console.log(`task: ${summary.task}`);
  console.log(`target: ${summary.targetFile}`);
  console.log(`risk: ${summary.risk}`);
  console.log(
    `adapter: ${adapter.id} (${adapter.capabilities.displayName}, ${adapter.supportLevel}, ${adapterConfidencePercent(summary)}%)`
  );
  console.log(`adapter_language: ${adapter.capabilities.language}`);
  console.log(`token_budget: ${summary.tokenBudget}`);
  console.log(`estimated_read_first_tokens: ${summary.estimatedTokens}`);
  if (savedIntent) {
    console.log(`intent_id: ${savedIntent.intent.id}`);
    console.log(`intent_path: ${relativeToWorkspace(process.cwd(), savedIntent.path)}`);
    console.log(`control_mode: ${savedIntent.intent.controlMode}`);
    console.log(`human_gate: ${savedIntent.intent.humanGate}`);
    console.log(`human_required: ${savedIntent.intent.humanGate !== "none"}`);
    console.log(`boundary_risk: ${savedIntent.intent.boundaryRisk}`);
    console.log(`policy_source: ${savedIntent.intent.policySource}`);
    console.log(`readiness_status: ${savedIntent.intent.readinessSnapshot.status}`);
    console.log(`enforcement_level: ${savedIntent.intent.readinessSnapshot.enforcementLevel}`);
    console.log(`can_guide_agents: ${savedIntent.intent.readinessSnapshot.canGuideAgents}`);
    console.log(`can_detect_drift: ${savedIntent.intent.readinessSnapshot.canDetectDrift}`);
    console.log(`can_block_in_ci: ${savedIntent.intent.readinessSnapshot.canBlockInCi}`);
    console.log(`policy_explicit: ${savedIntent.intent.readinessSnapshot.policyExplicit}`);
  }
  console.log("");
  if (savedIntent) {
    printAgentPolicyExplanationBlock("policy_explanation", savedIntent.intent.policyExplanation);
    console.log("");
    printAgentList("readiness_gaps", savedIntent.intent.readinessSnapshot.gaps);
    console.log("");
    printAgentList("readiness_next_steps", savedIntent.intent.readinessSnapshot.nextSteps);
    console.log("");
    printAgentList("allowed_files", savedIntent.intent.editableFiles);
    console.log("");
    printAgentList("allowed_symbols", savedIntent.intent.allowedSymbols);
    console.log("");
    printAgentList("human_gate_reason", savedIntent.intent.humanGateReason);
    console.log("");
    printAgentList("editable_files", savedIntent.intent.editableFiles);
    console.log("");
    printAgentList("context_files", savedIntent.intent.contextFiles.slice(0, 16));
    console.log("");
  }
  printAgentList("adapter_trust", adapter.agentPolicy.canTrust);
  console.log("");
  printAgentList("adapter_verify", adapter.agentPolicy.beCarefulWith);
  console.log("");
  printAgentList("adapter_manual_fallback", adapter.agentPolicy.mustFallbackToManual);
  console.log("");
  printAgentList("adapter_guidance", adapter.agentPolicy.planningGuidance);
  console.log("");
  printAgentList("read_first", summary.readFirst.map((file) => file.file));
  if (summary.readIfNeeded.length > 0) {
    console.log("");
    printAgentList(
      "read_if_needed",
      summary.readIfNeeded.slice(0, 8).map((file) => file.file)
    );
  }
  console.log("");
  printAgentList(
    "symbols_first",
    summary.symbolFocus.slice(0, 8).map((symbol) => symbol.symbol)
  );
  console.log("");
  printAgentList("verify", summary.verificationTargets.slice(0, 12));
  console.log("");
  printAgentList(
    "avoid_first",
    (summary.doNotReadFirst ?? summary.avoidInitially).slice(0, 6)
  );
}

function uniqueItems(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });
}

function printAgentIntentValidation(validation: ChangeIntentValidationSummary | undefined): void {
  if (!validation) {
    return;
  }

  console.log("");
  console.log(`intent_id: ${validation.intentId}`);
  console.log(`intent_verdict: ${validation.verdict}`);
  console.log(`control_mode: ${validation.controlMode}`);
  console.log(`human_gate: ${validation.humanGate}`);
  console.log(`human_required: ${validation.boundaryVerdict.humanRequired}`);
  console.log(`boundary_risk: ${validation.boundaryRisk}`);
  console.log(`boundary_verdict: ${validation.boundaryVerdict.label}`);
  console.log(`boundary_status: ${validation.boundaryVerdict.status}`);
  console.log(`boundary_decision: ${validation.boundaryVerdict.decision}`);
  console.log(`boundary_summary: ${validation.boundaryVerdict.summary}`);
  console.log(`planned_scope: ${validation.plannedScope}`);
  printAgentDriftVerdict(validation.driftVerdict);
  console.log(`next_required_phase: ${validation.nextRequiredPhase}`);
  console.log(`next_required_action: ${validation.nextRequiredAction}`);
  console.log(`recommended_action: ${validation.recommendedAction}`);
  console.log("");
  printAgentHandoffBlock("handoff", validation.handoff);
  console.log("");
  printAgentPolicyExplanationBlock("saved_policy_explanation", validation.policyExplanation);
  console.log("");
  printAgentPolicyDriftBlock("policy_drift", validation.policyDrift);
  console.log("");
  printAgentReadinessDriftBlock("readiness_drift", validation.readinessDrift);
  console.log("");
  printAgentList("allowed_files", validation.allowedFiles);
  console.log("");
  printAgentList("allowed_symbols", validation.allowedSymbols);
  console.log("");
  printAgentList("boundary_why", validation.boundaryVerdict.why);
  console.log("");
  printAgentList("boundary_fix", validation.boundaryVerdict.fix);
  console.log("");
  printAgentList("changed_outside_boundary_files", validation.boundaryVerdict.changedOutsideBoundaryFiles);
  console.log("");
  printAgentList("changed_outside_boundary_symbols", validation.boundaryVerdict.changedOutsideBoundarySymbols);
  console.log("");
  printAgentList("blocking_reasons", validation.blockingReasons);
  console.log("");
  printAgentList("next_steps", validation.nextSteps);
  console.log("");
  printAgentList("editable_files", validation.editableFiles);
  console.log("");
  printAgentList("context_files_changed", validation.contextFilesChanged);
  console.log("");
  printAgentList("unplanned_files", validation.unplannedFiles);
  console.log("");
  printAgentList("unplanned_symbols", validation.unplannedSymbols);
  console.log("");
  printAgentList(
    "contract_drift",
    uniqueItems([
      ...validation.protectedContractChanges,
      ...validation.unplannedContractChanges,
    ])
  );
}

function printAgentDriftVerdict(verdict: DriftVerdictSummary): void {
  console.log(`drift_verdict: ${verdict.label}`);
  console.log(`drift_status: ${verdict.status}`);
  console.log(`drift_decision: ${verdict.decision}`);
  console.log(`drift_summary: ${verdict.summary}`);
  console.log("");
  printAgentList("drift_why", verdict.why);
  console.log("");
  printAgentList("drift_fix", verdict.fix);
}

function printAgentStagedCheckSummary(summary: StagedCheckWithIntentSummary): void {
  const adapter = summary.adapterSupport.primaryAdapter;
  console.log("RIPPLE_STAGED_CHECK");
  console.log(`mode: ${summary.mode}`);
  if (summary.baseRef) {
    console.log(`base_ref: ${summary.baseRef}`);
  }
  console.log(`highest_risk: ${summary.highestRisk}`);
  console.log(`requires_attention: ${summary.requiresAttention}`);
  console.log(
    `adapter: ${adapter.id} (${adapter.capabilities.displayName}, ${adapter.supportLevel}, ${Math.round(adapter.confidence * 100)}%)`
  );
  console.log(`adapter_language: ${adapter.capabilities.language}`);
  console.log(`checked_js_ts_files: ${summary.stagedFiles}`);
  console.log(`checked_files: ${summary.checkedFiles}`);
  printAgentIntentValidation(summary.intentValidation);
  if (summary.reviewPacket) {
    console.log("");
    printAgentReviewPacket(summary.reviewPacket);
  }

  console.log("");
  printAgentList("trusted_findings", summary.agentActions.trustedFindings);
  console.log("");
  printAgentList("verify_before_commit", summary.agentActions.verifyBeforeCommit);
  console.log("");
  printAgentList("manual_review_required", summary.agentActions.manualReviewRequired);

  console.log("");
  console.log("changed_files:");
  if (summary.files.length === 0) {
    console.log("- none");
  } else {
    summary.files.forEach((file) => {
      console.log(
        `- ${file.file} [${file.modificationRisk}, importers: ${file.importerCount}, symbols: ${file.symbolCount}, adapter: ${formatAdapterSignalInline(file.adapterSignals)}]`
      );
    });
  }

  console.log("");
  printAgentList(
    "changed_symbols",
    summary.changedSymbols.slice(0, 16).map((symbol) => {
      return `${symbol.symbol} [${symbol.symbolStatus}, ${symbol.changeKind}, signature_changed: ${symbol.signatureChanged}, risk: ${symbol.contractRisk}, callers: ${symbol.callers}, adapter: ${formatAdapterSignalInline(symbol.adapterSignals)}]`;
    })
  );
  console.log("");
  printAgentList(
    "contract_risk",
    summary.contractRisks.slice(0, 16).map((risk) => {
      return `${risk.symbol} [${risk.risk}, adapter: ${formatAdapterSignalInline(risk.adapterSignals)}] ${risk.reason}`;
    })
  );
  console.log("");
  printAgentList(
    "read_first",
    uniqueItems(summary.files.flatMap((file) => file.readFirst)).slice(0, 16)
  );
  console.log("");
  printAgentList(
    "symbols_first",
    uniqueItems(summary.files.flatMap((file) => file.symbolFocus)).slice(0, 16)
  );
  console.log("");
  printAgentList(
    "verify",
    uniqueItems(summary.files.flatMap((file) => file.verificationTargets)).slice(0, 16)
  );

  if (summary.skippedFiles.length > 0) {
    console.log("");
    printAgentList("skipped", summary.skippedFiles);
  }
  if (summary.missingFiles.length > 0) {
    console.log("");
    printAgentList("missing_from_graph", summary.missingFiles);
  }
}

function printAgentIntentDriftRepairPlan(plan: IntentDriftRepairPlan): void {
  console.log("RIPPLE_INTENT_DRIFT_REPAIR");
  if (plan.intentId) {
    console.log(`intent_id: ${plan.intentId}`);
  }
  console.log(`verdict: ${plan.verdict}`);
  console.log(`status: ${plan.status}`);
  console.log("");
  printAgentHandoffBlock("handoff", plan.handoff);
  console.log("");
  printAgentDriftVerdict(plan.driftVerdict);
  if (plan.boundaryVerdict) {
    console.log(`boundary_verdict: ${plan.boundaryVerdict.label}`);
    console.log(`boundary_decision: ${plan.boundaryVerdict.decision}`);
    console.log(`control_mode: ${plan.boundaryVerdict.controlMode}`);
    console.log(`human_required: ${plan.boundaryVerdict.humanRequired}`);
  }
  if (plan.policyExplanation) {
    printAgentPolicyExplanationBlock("saved_policy_explanation", plan.policyExplanation);
  }
  if (plan.policyDrift) {
    console.log("");
    printAgentPolicyDriftBlock("policy_drift", plan.policyDrift);
  }
  if (plan.readinessDrift) {
    console.log("");
    printAgentReadinessDriftBlock("readiness_drift", plan.readinessDrift);
  }
  console.log(`create_new_intent: ${plan.createNewIntent}`);
  console.log(`recommended_action: ${plan.recommendedAction}`);
  console.log(`summary: ${plan.summary}`);
  console.log("");
  printAgentList("blocking_reasons", plan.blockingReasons);
  console.log("");
  if (plan.boundaryVerdict) {
    printAgentList("boundary_why", plan.boundaryVerdict.why);
    console.log("");
    printAgentList("boundary_fix", plan.boundaryVerdict.fix);
    console.log("");
    printAgentList("changed_outside_boundary_files", plan.boundaryVerdict.changedOutsideBoundaryFiles);
    console.log("");
    printAgentList("changed_outside_boundary_symbols", plan.boundaryVerdict.changedOutsideBoundarySymbols);
    console.log("");
  }
  printAgentList("unstage_files", plan.unstageFiles);
  console.log("");
  printAgentList("review_contracts", plan.reviewContracts);
  console.log("");
  printAgentList("fix_actions", plan.fixActions.map(formatRepairActionForAgent));
  console.log("");
  printAgentList("trusted_findings", plan.agentActions.trustedFindings);
  console.log("");
  printAgentList("verify_before_commit", plan.agentActions.verifyBeforeCommit);
  console.log("");
  printAgentList("manual_review_required", plan.agentActions.manualReviewRequired);
  console.log("");
  printAgentList("commands_unstage", plan.commands.unstage);
  console.log("");
  printAgentList("commands_replan", plan.commands.replan);
  console.log("");
  printAgentList("verify", plan.verificationTargets);
  console.log("");
  printAgentList("next_steps", plan.nextSteps);
}

function formatRepairActionForAgent(action: IntentDriftRepairAction): string {
  const target = action.target ? ` target=${action.target}` : "";
  const command = action.command ? ` command=${action.command}` : "";
  return `${action.priority} ${action.type}${target}${command} :: ${action.instruction} Reason: ${action.reason}`;
}

function printIntentDriftRepairPlan(plan: IntentDriftRepairPlan): void {
  console.log("Ripple intent drift repair");
  if (plan.intentId) {
    console.log(`Intent: ${plan.intentId}`);
  }
  console.log(`Verdict: ${plan.verdict}`);
  console.log(`Status: ${plan.status}`);
  console.log(`Drift verdict: ${plan.driftVerdict.label}`);
  console.log(`Drift decision: ${plan.driftVerdict.decision}`);
  console.log(`Drift summary: ${plan.driftVerdict.summary}`);
  if (plan.boundaryVerdict) {
    console.log(`Boundary verdict: ${plan.boundaryVerdict.label}`);
    console.log(`Boundary decision: ${plan.boundaryVerdict.decision}`);
    console.log(`Control mode: ${plan.boundaryVerdict.controlMode}`);
    console.log(`Human required: ${plan.boundaryVerdict.humanRequired}`);
  }
  if (plan.policyExplanation) {
    printPolicyExplanationSummary("Saved policy explanation:", plan.policyExplanation);
  }
  if (plan.policyDrift) {
    printPolicyDriftSummary("Policy drift:", plan.policyDrift);
  }
  if (plan.readinessDrift) {
    printReadinessDriftSummary("Readiness drift:", plan.readinessDrift);
  }
  console.log(`Create new intent: ${plan.createNewIntent}`);
  console.log(`Recommended action: ${plan.recommendedAction}`);
  console.log(`Summary: ${plan.summary}`);

  if (plan.blockingReasons.length > 0) {
    console.log("");
    console.log("Blocking reasons:");
    plan.blockingReasons.forEach((reason) => console.log(`  - ${reason}`));
  }

  console.log("");
  console.log("Drift why:");
  if (plan.driftVerdict.why.length === 0) {
    console.log("  - none");
  } else {
    plan.driftVerdict.why.forEach((reason) => console.log(`  - ${reason}`));
  }

  console.log("");
  console.log("Drift fix:");
  if (plan.driftVerdict.fix.length === 0) {
    console.log("  - none");
  } else {
    plan.driftVerdict.fix.forEach((fix) => console.log(`  - ${fix}`));
  }

  if (plan.boundaryVerdict) {
    console.log("");
    console.log("Boundary why:");
    if (plan.boundaryVerdict.why.length === 0) {
      console.log("  - none");
    } else {
      plan.boundaryVerdict.why.forEach((reason) => console.log(`  - ${reason}`));
    }
  }

  console.log("");
  console.log("Unstage files:");
  if (plan.unstageFiles.length === 0) {
    console.log("  none");
  } else {
    plan.unstageFiles.forEach((file) => console.log(`  - ${file}`));
  }

  if (plan.reviewContracts.length > 0) {
    console.log("");
    console.log("Review contracts:");
    plan.reviewContracts.forEach((contract) => console.log(`  - ${contract}`));
  }

  if (plan.fixActions.length > 0) {
    console.log("");
    console.log("Fix actions:");
    plan.fixActions.slice(0, 16).forEach((action) => {
      const target = action.target ? ` ${action.target}` : "";
      const command = action.command ? ` (${action.command})` : "";
      console.log(
        `  - [${action.priority}] ${action.type}${target}${command}: ${action.instruction}`
      );
    });
  }

  console.log("");
  console.log("Agent actions:");
  console.log("  trusted findings:");
  if (plan.agentActions.trustedFindings.length === 0) {
    console.log("    - none");
  } else {
    plan.agentActions.trustedFindings.slice(0, 12).forEach((item) => {
      console.log(`    - ${item}`);
    });
  }
  console.log("  verify before commit:");
  if (plan.agentActions.verifyBeforeCommit.length === 0) {
    console.log("    - none");
  } else {
    plan.agentActions.verifyBeforeCommit.slice(0, 12).forEach((item) => {
      console.log(`    - ${item}`);
    });
  }
  console.log("  manual review required:");
  if (plan.agentActions.manualReviewRequired.length === 0) {
    console.log("    - none");
  } else {
    plan.agentActions.manualReviewRequired.slice(0, 12).forEach((item) => {
      console.log(`    - ${item}`);
    });
  }

  if (plan.commands.unstage.length > 0 || plan.commands.replan.length > 0) {
    console.log("");
    console.log("Commands:");
    [...plan.commands.unstage, ...plan.commands.replan].forEach((command) => {
      console.log(`  - ${command}`);
    });
  }

  if (plan.verificationTargets.length > 0) {
    console.log("");
    console.log("Verify:");
    plan.verificationTargets.slice(0, 16).forEach((target) => console.log(`  - ${target}`));
  }

  if (plan.nextSteps.length > 0) {
    console.log("");
    console.log("Next steps:");
    plan.nextSteps.forEach((step) => console.log(`  - ${step}`));
  }
}

function printAgentAuditSummary(summary: RippleAuditSummary): void {
  const validation = summary.stagedCheck.intentValidation;
  console.log("RIPPLE_AUDIT");
  console.log(`status: ${summary.status}`);
  console.log(`decision: ${summary.decision}`);
  console.log(`can_proceed: ${summary.canProceed}`);
  console.log(`next_required_phase: ${summary.nextRequiredPhase}`);
  console.log(`next_required_action: ${summary.nextRequiredAction}`);
  console.log(`approval_status: ${summary.approvalStatus.status}`);
  console.log(`approval_decision: ${summary.approvalStatus.decision}`);
  console.log(`approval_required: ${summary.approvalStatus.required}`);
  console.log(`approval_approved: ${summary.approvalStatus.approved}`);
  if (summary.approvalStatus.gate) {
    console.log(`approval_gate: ${summary.approvalStatus.gate}`);
  }
  console.log(`mode: ${summary.mode}`);
  if (summary.baseRef) {
    console.log(`base_ref: ${summary.baseRef}`);
  }
  console.log(`intent_id: ${summary.intent.id}`);
  console.log(`task: ${summary.intent.task}`);
  console.log(`target: ${summary.intent.targetFile}`);
  console.log(`control_mode: ${summary.intent.controlMode}`);
  console.log(`human_gate: ${summary.intent.humanGate}`);
  console.log(`boundary_risk: ${summary.intent.boundaryRisk}`);
  console.log(`drift_verdict: ${validation?.driftVerdict.label ?? "UNKNOWN"}`);
  console.log(`boundary_verdict: ${validation?.boundaryVerdict.label ?? "UNKNOWN"}`);
  console.log(`policy_drift: ${validation?.policyDrift.label ?? "UNKNOWN"}`);
  console.log(`readiness_drift: ${validation?.readinessDrift.label ?? "UNKNOWN"}`);
  console.log(`repair_status: ${summary.repairPlan.status}`);
  console.log(`recommended_action: ${summary.recommendedAction}`);
  console.log("");
  printAgentReviewPacket(summary.reviewPacket);
  console.log("");
  printAgentHandoffBlock("handoff", summary.handoff);
  if (summary.approvalStatus.approval) {
    console.log(`approved_by: ${summary.approvalStatus.approval.approvedBy}`);
    console.log(`approved_at: ${summary.approvalStatus.approval.approvedAt}`);
  }
  console.log("");
  printAgentList("approval_why", summary.approvalStatus.why);
  console.log("");
  printAgentPolicyExplanationBlock("saved_policy_explanation", summary.savedPolicyExplanation);
  console.log("");
  if (summary.currentPolicyExplanation) {
    printAgentPolicyExplanationBlock("current_policy_explanation", summary.currentPolicyExplanation);
    console.log("");
  }
  if (validation) {
    printAgentPolicyDriftBlock("policy_drift_detail", validation.policyDrift);
    console.log("");
    printAgentReadinessDriftBlock("readiness_drift_detail", validation.readinessDrift);
    console.log("");
  }
  printAgentList("blocking_reasons", summary.blockingReasons);
  console.log("");
  printAgentList("next_steps", summary.nextSteps);
  console.log("");
  printAgentList("changed_files", summary.changedFiles);
  console.log("");
  printAgentList("verify", summary.verificationTargets);
  console.log("");
  printAgentList("fix_actions", summary.repairPlan.fixActions.map(formatRepairActionForAgent));
}

function printAgentGateSummary(summary: RippleGateSummary): void {
  console.log("RIPPLE_GATE");
  console.log(`status: ${summary.status}`);
  console.log(`decision: ${summary.decision}`);
  console.log(`can_continue: ${summary.canContinue}`);
  console.log(`must_stop: ${summary.mustStop}`);
  console.log(`needs_human: ${summary.needsHuman}`);
  console.log(`next_required_phase: ${summary.nextRequiredPhase}`);
  console.log(`next_required_action: ${summary.nextRequiredAction}`);
  console.log(`summary: ${summary.summary}`);
  console.log(`audit_status: ${summary.auditStatus}`);
  console.log(`audit_decision: ${summary.auditDecision}`);
  console.log(`approval_status: ${summary.approvalStatus}`);
  console.log(`mode: ${summary.mode}`);
  if (summary.baseRef) {
    console.log(`base_ref: ${summary.baseRef}`);
  }
  console.log(`intent_id: ${summary.intent.id}`);
  console.log(`task: ${summary.intent.task}`);
  console.log(`target: ${summary.intent.targetFile}`);
  console.log(`control_mode: ${summary.intent.controlMode}`);
  console.log(`human_gate: ${summary.intent.humanGate}`);
  console.log(`boundary_risk: ${summary.intent.boundaryRisk}`);
  console.log(`risk_level: ${summary.risk.level}`);
  console.log(`risk_score: ${summary.risk.score}`);
  console.log(`risk_summary: ${summary.risk.summary}`);
  console.log("");
  printAgentReviewPacket(summary.reviewPacket);
  console.log("");
  printAgentList("risk_reasons", compactGateRiskReasons(summary));
  console.log("");
  printAgentList("risk_evidence", compactGateRiskEvidence(summary));
  console.log("");
  printAgentList("risk_required_actions", compactGateRiskActions(summary));
  console.log("");
  printAgentList("why", summary.why);
  console.log("");
  printAgentList("fix_now", summary.fixNow);
  console.log("");
  printAgentList("ask_human", summary.askHuman);
  console.log("");
  printAgentList("commands_doctor", summary.commands.doctor);
  console.log("");
  printAgentList("commands_plan", summary.commands.plan);
  console.log("");
  printAgentList("commands_check", summary.commands.check);
  console.log("");
  printAgentList("commands_audit", summary.commands.audit);
  console.log("");
  printAgentList("commands_repair", summary.commands.repair);
  console.log("");
  printAgentList("commands_approve", summary.commands.approve);
  console.log("");
  printAgentList("commands_unstage", summary.commands.unstage);
  console.log("");
  printAgentList("commands_verify", summary.commands.verify);
}

function printGateSummary(summary: RippleGateSummary): void {
  const statusLabel = summary.canContinue ? "CONTINUE" : "STOP";
  console.log(`Ripple gate: ${statusLabel}`);
  console.log(gateHeadline(summary));
  console.log("");
  console.log(`Decision: ${summary.decision}`);
  console.log(`Can continue: ${formatYesNo(summary.canContinue)}`);
  console.log(`Must stop: ${formatYesNo(summary.mustStop)}`);
  console.log("");
  printReviewPacketSummary(summary.reviewPacket);
  console.log("");
  console.log("Intent:");
  console.log(`  Task: ${summary.intent.task}`);
  console.log(`  Boundary: ${summary.intent.controlMode}`);
  console.log(`  Target: ${summary.intent.targetFile}`);
  console.log(`  Human gate: ${summary.intent.humanGate}`);
  console.log(`  Approval: ${summary.approvalStatus}`);
  console.log("");
  printHumanList("Allowed:", gateAllowedItems(summary));
  const outsideBoundary = gateChangedOutsideItems(summary);
  printHumanList(
    outsideBoundary.length > 0 ? "Changed outside boundary:" : "Changed files:",
    outsideBoundary.length > 0 ? outsideBoundary : summary.changedFiles
  );
  console.log("");
  printHumanList("Why:", compactGateReasons(summary));
  printHumanList("Fix now:", compactGateFixes(summary));
  if (summary.canContinue) {
    printHumanList("Verify:", summary.verificationTargets.slice(0, 8));
  } else {
    printHumanList("Commands:", compactGateCommands(summary));
  }
  printGateRiskSummary(summary);
}

function printGateRiskSummary(summary: RippleGateSummary): void {
  console.log("");
  console.log(`Risk: ${summary.risk.level.toUpperCase()} ${summary.risk.score}/100`);
  console.log(`Risk summary: ${summary.risk.summary}`);
  printHumanList("Why this is risky:", compactGateRiskReasons(summary));
  printHumanList("Evidence:", compactGateRiskEvidence(summary));
  printHumanList("Required:", compactGateRiskActions(summary));
}

function compactGateRiskReasons(summary: RippleGateSummary): string[] {
  return summary.risk.reasons
    .map((reason) => `${reason.severity.toUpperCase()} ${reason.kind}: ${reason.message}`)
    .slice(0, 6);
}

function compactGateRiskEvidence(summary: RippleGateSummary): string[] {
  return uniqueItems(summary.risk.reasons.flatMap((reason) => reason.evidence)).slice(0, 10);
}

function compactGateRiskActions(summary: RippleGateSummary): string[] {
  return uniqueItems(summary.risk.requiredActions).slice(0, 8);
}

function gateHeadline(summary: RippleGateSummary): string {
  if (summary.canContinue) {
    return "Agent may continue after running the listed verification targets.";
  }
  if (summary.decision === "restore-readiness") {
    return "Agent must stop because Ripple readiness is weaker than the saved intent.";
  }
  if (summary.needsHuman) {
    return "Agent must stop and ask the human before continuing.";
  }
  return "Agent must stop and repair the staged change before continuing.";
}

function gateAllowedItems(summary: RippleGateSummary): string[] {
  if (summary.intent.controlMode === "brainstorm") {
    return ["no file edits"];
  }
  if (summary.allowedSymbols.length > 0) {
    return summary.allowedSymbols;
  }
  if (summary.allowedFiles.length > 0) {
    return summary.allowedFiles;
  }
  return [summary.intent.targetFile];
}

function gateChangedOutsideItems(summary: RippleGateSummary): string[] {
  return [
    ...summary.changedOutsideBoundaryFiles.map((file) => `file: ${file}`),
    ...summary.changedOutsideBoundarySymbols.map((symbol) => `symbol: ${symbol}`),
  ];
}

function compactGateReasons(summary: RippleGateSummary): string[] {
  return uniqueItems(summary.why).slice(0, 6);
}

function compactGateFixes(summary: RippleGateSummary): string[] {
  return uniqueItems(summary.fixNow).slice(0, 6);
}

function compactGateCommands(summary: RippleGateSummary): string[] {
  return uniqueItems([
    ...summary.commands.unstage,
    ...summary.commands.repair,
    ...summary.commands.approve,
    ...summary.commands.plan,
    ...summary.commands.doctor,
  ]).slice(0, 6);
}

function formatYesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function printAuditSummary(summary: RippleAuditSummary): void {
  const validation = summary.stagedCheck.intentValidation;
  const gate = buildRippleGateSummary(summary);
  console.log("Ripple audit");
  console.log(`Workspace: ${summary.workspace}`);
  console.log(`Mode: ${summary.mode}`);
  if (summary.baseRef) {
    console.log(`Base ref: ${summary.baseRef}`);
  }
  console.log(`Status: ${summary.status}`);
  console.log(`Decision: ${summary.decision}`);
  console.log(`Can proceed: ${summary.canProceed}`);
  console.log(`Next required phase: ${summary.nextRequiredPhase}`);
  console.log(`Next required action: ${summary.nextRequiredAction}`);
  console.log(`Recommended action: ${summary.recommendedAction}`);
  console.log("");
  console.log("Gate:");
  console.log(`  status: ${gate.status}`);
  console.log(`  decision: ${gate.decision}`);
  console.log(`  can continue: ${gate.canContinue}`);
  console.log(`  must stop: ${gate.mustStop}`);
  console.log(`  needs human: ${gate.needsHuman}`);
  console.log(`  next required phase: ${gate.nextRequiredPhase}`);
  console.log(`  next required action: ${gate.nextRequiredAction}`);
  console.log(`  summary: ${gate.summary}`);
  console.log("");
  printReviewPacketSummary(summary.reviewPacket);
  console.log("");
  console.log("Approval:");
  console.log(`  status: ${summary.approvalStatus.status}`);
  console.log(`  decision: ${summary.approvalStatus.decision}`);
  console.log(`  required: ${summary.approvalStatus.required}`);
  console.log(`  approved: ${summary.approvalStatus.approved}`);
  if (summary.approvalStatus.gate) {
    console.log(`  gate: ${summary.approvalStatus.gate}`);
  }
  if (summary.approvalStatus.approval) {
    console.log(`  approved by: ${summary.approvalStatus.approval.approvedBy}`);
    console.log(`  approved at: ${summary.approvalStatus.approval.approvedAt}`);
  }
  console.log(`  summary: ${summary.approvalStatus.summary}`);
  console.log("");
  console.log("Intent:");
  console.log(`  id: ${summary.intent.id}`);
  console.log(`  task: ${summary.intent.task}`);
  console.log(`  target: ${summary.intent.targetFile}`);
  console.log(`  control mode: ${summary.intent.controlMode}`);
  console.log(`  human gate: ${summary.intent.humanGate}`);
  console.log(`  boundary risk: ${summary.intent.boundaryRisk}`);
  console.log("");
  console.log("Verdicts:");
  console.log(`  drift: ${validation?.driftVerdict.label ?? "UNKNOWN"}`);
  console.log(`  boundary: ${validation?.boundaryVerdict.label ?? "UNKNOWN"}`);
  console.log(`  policy drift: ${validation?.policyDrift.label ?? "UNKNOWN"}`);
  console.log(`  readiness drift: ${validation?.readinessDrift.label ?? "UNKNOWN"}`);
  console.log(`  repair status: ${summary.repairPlan.status}`);
  console.log("");
  printPolicyExplanationSummary("Saved policy explanation:", summary.savedPolicyExplanation);
  if (summary.currentPolicyExplanation) {
    printPolicyExplanationSummary("Current policy explanation:", summary.currentPolicyExplanation);
  }
  if (validation) {
    printPolicyDriftSummary("Policy drift:", validation.policyDrift);
    printReadinessDriftSummary("Readiness drift:", validation.readinessDrift);
  }
  console.log("");
  console.log("Blocking reasons:");
  if (summary.blockingReasons.length === 0) {
    console.log("  - none");
  } else {
    summary.blockingReasons.forEach((reason) => console.log(`  - ${reason}`));
  }
  console.log("");
  console.log("Changed files:");
  if (summary.changedFiles.length === 0) {
    console.log("  - none");
  } else {
    summary.changedFiles.forEach((file) => console.log(`  - ${file}`));
  }
  if (summary.verificationTargets.length > 0) {
    console.log("");
    console.log("Verify:");
    summary.verificationTargets.slice(0, 16).forEach((target) => console.log(`  - ${target}`));
  }
  if (summary.nextSteps.length > 0) {
    console.log("");
    console.log("Next steps:");
    summary.nextSteps.forEach((step) => console.log(`  - ${step}`));
  }
}

function printAgentApprovalRecord(approval: RippleApprovalRecord): void {
  console.log("RIPPLE_APPROVAL");
  console.log(`approval_id: ${approval.id}`);
  console.log(`intent_id: ${approval.intentId}`);
  console.log(`gate: ${approval.gate}`);
  console.log(`target: ${approval.targetFile}`);
  console.log(`control_mode: ${approval.controlMode}`);
  console.log(`human_gate: ${approval.humanGate}`);
  console.log(`boundary_risk: ${approval.boundaryRisk}`);
  console.log(`approved_by: ${approval.approvedBy}`);
  console.log(`approved_at: ${approval.approvedAt}`);
  if (approval.reason) {
    console.log(`reason: ${approval.reason}`);
  }
}

function printApprovalRecord(approval: RippleApprovalRecord): void {
  console.log("Ripple approval recorded");
  console.log(`Approval id: ${approval.id}`);
  console.log(`Intent id: ${approval.intentId}`);
  console.log(`Gate: ${approval.gate}`);
  console.log(`Target: ${approval.targetFile}`);
  console.log(`Control mode: ${approval.controlMode}`);
  console.log(`Human gate: ${approval.humanGate}`);
  console.log(`Boundary risk: ${approval.boundaryRisk}`);
  console.log(`Approved by: ${approval.approvedBy}`);
  console.log(`Approved at: ${approval.approvedAt}`);
  if (approval.reason) {
    console.log(`Reason: ${approval.reason}`);
  }
}

function printAgentApprovalStatus(status: ApprovalStatusOutput): void {
  console.log("RIPPLE_APPROVAL_STATUS");
  console.log(`status: ${status.status}`);
  console.log(`decision: ${status.decision}`);
  console.log(`required: ${status.required}`);
  console.log(`approved: ${status.approved}`);
  if (status.gate) {
    console.log(`gate: ${status.gate}`);
  }
  console.log(`intent_id: ${status.intent.id}`);
  console.log(`task: ${status.intent.task}`);
  console.log(`target: ${status.intent.targetFile}`);
  console.log(`control_mode: ${status.intent.controlMode}`);
  console.log(`human_gate: ${status.intent.humanGate}`);
  console.log(`boundary_risk: ${status.intent.boundaryRisk}`);
  if (status.approvalPath) {
    console.log(`approval_path: ${status.approvalPath}`);
  }
  if (status.approval) {
    console.log(`approved_by: ${status.approval.approvedBy}`);
    console.log(`approved_at: ${status.approval.approvedAt}`);
  }
  console.log(`summary: ${status.summary}`);
  console.log("");
  printAgentList("why", status.why);
  console.log("");
  printAgentList("next_steps", status.nextSteps);
}

function printApprovalStatus(status: ApprovalStatusOutput): void {
  console.log("Ripple approval status");
  console.log(`Status: ${status.status}`);
  console.log(`Decision: ${status.decision}`);
  console.log(`Required: ${status.required}`);
  console.log(`Approved: ${status.approved}`);
  if (status.gate) {
    console.log(`Gate: ${status.gate}`);
  }
  console.log("");
  console.log("Intent:");
  console.log(`  id: ${status.intent.id}`);
  console.log(`  task: ${status.intent.task}`);
  console.log(`  target: ${status.intent.targetFile}`);
  console.log(`  control mode: ${status.intent.controlMode}`);
  console.log(`  human gate: ${status.intent.humanGate}`);
  console.log(`  boundary risk: ${status.intent.boundaryRisk}`);
  if (status.approvalPath) {
    console.log(`Approval path: ${status.approvalPath}`);
  }
  if (status.approval) {
    console.log(`Approved by: ${status.approval.approvedBy}`);
    console.log(`Approved at: ${status.approval.approvedAt}`);
  }
  console.log(`Summary: ${status.summary}`);
  printHumanList("Why:", status.why);
  printHumanList("Next steps:", status.nextSteps);
}

function printHumanList(title: string, items: string[]): void {
  console.log(title);
  if (items.length === 0) {
    console.log("  - none");
    return;
  }
  items.forEach((item) => console.log(`  - ${item}`));
}

function formatVerificationEvidence(evidence: RippleVerificationEvidence): string {
  const note = evidence.note ? ` note=${evidence.note}` : "";
  const exitCode = typeof evidence.exitCode === "number" ? ` exitCode=${evidence.exitCode}` : "";
  const duration = typeof evidence.durationMs === "number" ? ` durationMs=${evidence.durationMs}` : "";
  const files = evidence.changedFiles
    ? ` files=${evidence.changedFiles.length > 0 ? evidence.changedFiles.join(",") : "none"}`
    : "";
  const mode = evidence.changeMode ? ` mode=${evidence.changeMode}` : "";
  const fingerprint = evidence.changeFingerprint
    ? ` fingerprint=${evidence.changeFingerprint.slice(0, 12)}`
    : "";
  return `${evidence.status}: ${evidence.command} (${evidence.source}${exitCode}${duration}${files}${mode}${fingerprint} ${evidence.recordedAt})${note}`;
}

function verificationEvidenceStatusLabel(evidence: RippleVerificationEvidence[]): string {
  if (evidence.length === 0) {
    return "none";
  }
  if (evidence.some((item) => item.status === "failed")) {
    return "failed";
  }
  if (evidence.some((item) => item.status === "unknown")) {
    return "unknown";
  }
  if (evidence.some((item) => item.status === "skipped")) {
    return "skipped";
  }
  return "passed";
}

function printReviewPacketSummary(packet: RippleReviewPacket): void {
  console.log("Review packet:");
  console.log(`  protocol: ${packet.protocol}`);
  console.log(`  task: ${packet.originalTask}`);
  console.log(`  declared scope: ${packet.declaredScope.controlMode} ${packet.declaredScope.targetFile}`);
  console.log(`  human gate: ${packet.declaredScope.humanGate}`);
  console.log(`  boundary risk: ${packet.declaredScope.boundaryRisk}`);
  printHumanList("  changed files", packet.actualChanges.changedFiles);
  printHumanList("  outside boundary files", packet.scopeFindings.outsideBoundaryFiles);
  printHumanList("  outside boundary symbols", packet.scopeFindings.outsideBoundarySymbols);
  printHumanList("  verification expected", packet.verification.expectedCommands);
  console.log(`  tests run: ${packet.verification.testsRun}`);
  if (packet.verification.evidence.length > 0) {
    console.log(`  verification status: ${verificationEvidenceStatusLabel(packet.verification.evidence)}`);
  }
  printHumanList("  verification evidence", packet.verification.evidence.map(formatVerificationEvidence));
  console.log(`  can continue: ${formatYesNo(packet.decision.canContinue)}`);
  console.log(`  must stop: ${formatYesNo(packet.decision.mustStop)}`);
  console.log(`  needs human: ${formatYesNo(packet.decision.needsHuman)}`);
  printHumanList("  reviewer notes", packet.reviewerNotes);
}

function printAgentReviewPacket(packet: RippleReviewPacket): void {
  console.log(`review_packet_protocol: ${packet.protocol}`);
  console.log(`review_packet_version: ${packet.version}`);
  console.log(`review_packet_task: ${packet.originalTask}`);
  console.log(`review_packet_scope: ${packet.declaredScope.controlMode} ${packet.declaredScope.targetFile}`);
  console.log(`review_packet_human_gate: ${packet.declaredScope.humanGate}`);
  console.log(`review_packet_boundary_risk: ${packet.declaredScope.boundaryRisk}`);
  console.log(`review_packet_tests_run: ${packet.verification.testsRun}`);
  console.log(`review_packet_verification_status: ${verificationEvidenceStatusLabel(packet.verification.evidence)}`);
  console.log(`review_packet_can_continue: ${packet.decision.canContinue}`);
  console.log(`review_packet_must_stop: ${packet.decision.mustStop}`);
  console.log(`review_packet_needs_human: ${packet.decision.needsHuman}`);
  console.log("");
  printAgentList("review_packet_changed_files", packet.actualChanges.changedFiles);
  console.log("");
  printAgentList("review_packet_outside_boundary_files", packet.scopeFindings.outsideBoundaryFiles);
  console.log("");
  printAgentList("review_packet_outside_boundary_symbols", packet.scopeFindings.outsideBoundarySymbols);
  console.log("");
  printAgentList("review_packet_verification_expected", packet.verification.expectedCommands);
  console.log("");
  printAgentList("review_packet_verification_reported", packet.verification.evidence.map(formatVerificationEvidence));
  console.log("");
  printAgentList("review_packet_reviewer_notes", packet.reviewerNotes);
}

function printStagedCheckSummary(summary: StagedCheckWithIntentSummary): void {
  const adapter = summary.adapterSupport.primaryAdapter;
  console.log(summary.mode === "changed" ? "Ripple changed-files check" : summary.mode === "worktree" ? "Ripple worktree check" : "Ripple staged check");
  console.log(`Workspace: ${summary.workspace}`);
  console.log(`Mode: ${summary.mode}`);
  if (summary.baseRef) {
    console.log(`Base ref: ${summary.baseRef}`);
  }
  console.log(`Checked JS/TS files: ${summary.stagedFiles}`);
  console.log(`Checked files: ${summary.checkedFiles}`);
  console.log(`Highest risk: ${summary.highestRisk}`);
  console.log(
    `Adapter: ${adapter.capabilities.displayName} (${adapter.supportLevel}, ${Math.round(adapter.confidence * 100)}%)`
  );
  if (summary.intentValidation) {
    console.log(`Intent: ${summary.intentValidation.intentId}`);
    console.log(`Intent verdict: ${summary.intentValidation.verdict}`);
    console.log(`Drift verdict: ${summary.intentValidation.driftVerdict.label}`);
    console.log(`Drift decision: ${summary.intentValidation.driftVerdict.decision}`);
    console.log(`Control mode: ${summary.intentValidation.controlMode}`);
    console.log(`Boundary verdict: ${summary.intentValidation.boundaryVerdict.label}`);
    console.log(`Boundary decision: ${summary.intentValidation.boundaryVerdict.decision}`);
    console.log(`Human required: ${summary.intentValidation.boundaryVerdict.humanRequired}`);
    printPolicyExplanationSummary(
      "Saved policy explanation:",
      summary.intentValidation.policyExplanation
    );
    printPolicyDriftSummary("Policy drift:", summary.intentValidation.policyDrift);
    printReadinessDriftSummary("Readiness drift:", summary.intentValidation.readinessDrift);
    console.log(`Planned scope: ${summary.intentValidation.plannedScope}`);
  }
  if (summary.reviewPacket) {
    console.log("");
    printReviewPacketSummary(summary.reviewPacket);
  }

  if (summary.skippedFiles.length > 0) {
    console.log(`Skipped non-source files: ${summary.skippedFiles.length}`);
  }

  if (summary.missingFiles.length > 0) {
    console.log("");
    console.log("Missing from graph:");
    summary.missingFiles.forEach((file) => console.log(`  - ${file}`));
  }

  if (summary.files.length === 0) {
    console.log("");
    console.log(
      summary.mode === "changed"
        ? "No changed JS/TS files found."
        : summary.mode === "worktree"
          ? "No worktree JS/TS changes found."
          : "No staged JS/TS files found."
    );
    return;
  }

  console.log("");
  console.log("Agent actions:");
  console.log("  trusted findings:");
  if (summary.agentActions.trustedFindings.length === 0) {
    console.log("    - none");
  } else {
    summary.agentActions.trustedFindings.slice(0, 12).forEach((item) => {
      console.log(`    - ${item}`);
    });
  }
  console.log("  verify before commit:");
  if (summary.agentActions.verifyBeforeCommit.length === 0) {
    console.log("    - none");
  } else {
    summary.agentActions.verifyBeforeCommit.slice(0, 12).forEach((item) => {
      console.log(`    - ${item}`);
    });
  }
  console.log("  manual review required:");
  if (summary.agentActions.manualReviewRequired.length === 0) {
    console.log("    - none");
  } else {
    summary.agentActions.manualReviewRequired.slice(0, 12).forEach((item) => {
      console.log(`    - ${item}`);
    });
  }

  console.log("");
  console.log("Files:");
  summary.files.forEach((file) => {
    console.log(
      `  - ${file.file} [${file.modificationRisk}, importers: ${file.importerCount}, symbols: ${file.symbolCount}]`
    );
    console.log(`    ${file.focus}`);
    if (file.adapterSignals.length > 0) {
      console.log(`    adapter signals: ${formatAdapterSignalInline(file.adapterSignals)}`);
    }
    if (file.readFirst.length > 0) {
      console.log(`    read first: ${file.readFirst.join(", ")}`);
    }
    if (file.changedSymbols.length > 0) {
      console.log(
        `    changed symbols: ${file.changedSymbols.map((symbol) => `${symbol.symbol} [${symbol.symbolStatus}, ${symbol.changeKind}, signature_changed: ${symbol.signatureChanged}, adapter: ${formatAdapterSignalInline(symbol.adapterSignals)}]`).join(", ")}`
      );
    }
    if (file.contractRisks.length > 0) {
      console.log(
        `    contract risk: ${file.contractRisks.map((risk) => `${risk.symbol} [${risk.risk}, adapter: ${formatAdapterSignalInline(risk.adapterSignals)}]`).join(", ")}`
      );
    }
    if (file.verificationTargets.length > 0) {
      console.log(`    verify: ${file.verificationTargets.join(", ")}`);
    }
  });

  if (summary.intentValidation) {
    console.log("");
    console.log("Intent validation:");
    summary.intentValidation.reasons.forEach((reason) => console.log(`  - ${reason}`));
    console.log(`  recommended action: ${summary.intentValidation.recommendedAction}`);
    console.log(`  drift summary: ${summary.intentValidation.driftVerdict.summary}`);
    console.log("  drift why:");
    summary.intentValidation.driftVerdict.why.forEach((reason) => {
      console.log(`    - ${reason}`);
    });
    console.log("  drift fix:");
    summary.intentValidation.driftVerdict.fix.forEach((fix) => {
      console.log(`    - ${fix}`);
    });
    if (summary.intentValidation.blockingReasons.length > 0) {
      console.log("  blocking reasons:");
      summary.intentValidation.blockingReasons.forEach((reason) => {
        console.log(`    - ${reason}`);
      });
    }
    if (summary.intentValidation.nextSteps.length > 0) {
      console.log("  next steps:");
      summary.intentValidation.nextSteps.forEach((step) => {
        console.log(`    - ${step}`);
      });
    }
    if (summary.intentValidation.unplannedFiles.length > 0) {
      console.log(`  unplanned files: ${summary.intentValidation.unplannedFiles.join(", ")}`);
    }
    if (summary.intentValidation.contextFilesChanged.length > 0) {
      console.log(`  context-only files changed: ${summary.intentValidation.contextFilesChanged.join(", ")}`);
    }
    if (summary.intentValidation.unplannedSymbols.length > 0) {
      console.log(`  unplanned symbols: ${summary.intentValidation.unplannedSymbols.join(", ")}`);
    }
  }
}

function printFocusSummary(summary: FileFocusSummary): void {
  console.log("Ripple focus");
  console.log(`File: ${summary.projectPath}`);
  console.log(`Risk: ${summary.modificationRisk}`);
  console.log(`Imports: ${summary.imports.length}`);
  console.log(`Imported by: ${summary.importedBy.length}`);
  console.log(`Symbols: ${summary.symbols.length}`);
  console.log(`Focus file: ${summary.focusPath}`);

  if (summary.importedBy.length > 0) {
    console.log("");
    console.log("Imported by:");
    summary.importedBy.slice(0, 10).forEach((item) => {
      console.log(`  - ${item.file} [${item.modificationRisk}]`);
    });
  }

  if (summary.symbols.length > 0) {
    console.log("");
    console.log("Symbols:");
    summary.symbols.slice(0, 10).forEach((symbol) => {
      console.log(`  - ${symbol.name} (${symbol.kind}, ${symbol.layer}, callers: ${symbol.callerCount})`);
    });
  }
}

function printDependencyItems(items: FileDependencyLink[]): void {
  items.slice(0, 25).forEach((item) => {
    console.log(
      `  - ${item.file} [${item.modificationRisk}, imports: ${item.importCount}, importers: ${item.importerCount}]`
    );
  });
}

function printDependencySummary(
  summary: FileDependencySummary,
  direction: "imports" | "importers"
): void {
  const items = direction === "imports" ? summary.imports : summary.importers;
  const title = direction === "imports" ? "Ripple imports" : "Ripple importers";

  console.log(title);
  console.log(`File: ${summary.projectPath}`);
  console.log(`Risk: ${summary.modificationRisk}`);
  console.log(`${direction === "imports" ? "Imports" : "Importers"}: ${items.length}`);

  if (items.length === 0) {
    console.log("");
    console.log(`No ${direction} found.`);
    return;
  }

  console.log("");
  console.log(direction === "imports" ? "Imports:" : "Importers:");
  printDependencyItems(items);
}

function printSymbolLink(symbol: SymbolLinkSummary): void {
  console.log(
    `  - ${symbol.projectSymbolId} (${symbol.kind}, ${symbol.layer}, callers: ${symbol.callerCount}, calls: ${symbol.callCount})`
  );
}

function printSymbolSummary(symbol: SymbolGraphSummary): void {
  printSymbolLink(symbol);
  if (symbol.calledBy.length > 0) {
    console.log(`    called by: ${symbol.calledBy.slice(0, 5).map((caller) => caller.projectSymbolId).join(", ")}`);
  }
  if (symbol.calls.length > 0) {
    console.log(`    calls: ${symbol.calls.slice(0, 5).map((call) => call.projectSymbolId).join(", ")}`);
  }
}

function printFileSymbolsSummary(summary: FileSymbolsSummary): void {
  console.log("Ripple symbols");
  console.log(`File: ${summary.projectPath}`);
  console.log(`Risk: ${summary.modificationRisk}`);
  console.log(`Symbols: ${summary.symbols.length}`);

  if (summary.symbols.length === 0) {
    console.log("");
    console.log("No symbols found.");
    return;
  }

  console.log("");
  console.log("Symbols:");
  summary.symbols.slice(0, 25).forEach(printSymbolSummary);
}

function printSymbolCallersSummary(summary: SymbolCallersSummary): void {
  console.log("Ripple callers");
  console.log(`Symbol: ${summary.symbol.projectSymbolId}`);
  console.log(`Kind: ${summary.symbol.kind}`);
  console.log(`Layer: ${summary.symbol.layer}`);
  console.log(`Callers: ${summary.callerCount}`);

  if (summary.callers.length === 0) {
    console.log("");
    console.log("No callers found.");
    return;
  }

  console.log("");
  console.log("Callers:");
  summary.callers.slice(0, 25).forEach(printSymbolLink);
}

function printBlastRadiusSummary(summary: FileBlastRadiusSummary): void {
  console.log("Ripple blast radius");
  console.log(`File: ${summary.projectPath}`);
  console.log(`Risk: ${summary.modificationRisk}`);
  console.log(`Direct importers: ${summary.affectedCount}`);

  if (summary.directImporters.length === 0) {
    console.log("");
    console.log("No direct downstream files found.");
    return;
  }

  console.log("");
  console.log("Affected files:");
  summary.directImporters.slice(0, 25).forEach((item) => {
    console.log(`  - ${item.file} [${item.modificationRisk}, importers: ${item.importerCount}]`);
  });
}

async function planCommand(options: CliOptions): Promise<void> {
  if (!options.file) {
    throw new Error("Missing target file. Usage: ripple plan --file <file> --task <task> [--budget N]");
  }

  const workspaceRoot = resolveWorkspaceRoot(".");
  const engine = createCliEngine(workspaceRoot);

  try {
    await runWithQuietEngine(() => engine.initialScan());
    const summary = engine.planContext(options.task ?? "", options.file, options.budget);

    if (!summary) {
      throw new Error(`File is not in the Ripple graph: ${options.file}`);
    }

    const policyExplanation = explainRipplePolicyForTarget(
      loadRipplePolicy(workspaceRoot),
      summary.targetFile,
      { controlMode: options.mode }
    );
    const savedIntent = options.save
      ? savePlanChangeIntent(workspaceRoot, engine, summary, options, policyExplanation)
      : undefined;

    if (options.json) {
      const output: PlanJsonOutput = savedIntent
        ? {
            ...summary,
            policyExplanation: savedIntent.intent.policyExplanation,
            changeIntent: savedIntent.intent,
            changeIntentPath: savedIntent.path,
          }
        : {
            ...summary,
            policyExplanation,
          };
      printJson(output);
    } else if (options.agent) {
      printAgentContextPlan(summary, savedIntent);
    } else {
      printContextPlan(summary, savedIntent);
    }
  } finally {
    engine.dispose();
  }
}

function savePlanChangeIntent(
  workspaceRoot: string,
  engine: GraphEngine,
  summary: ContextPlanSummary,
  options: CliOptions,
  policyExplanation: RipplePolicyExplanation
): SavedChangeIntent {
  const loadedPolicy = loadRipplePolicy(workspaceRoot);
  const policy = resolveRipplePolicyForTarget(loadedPolicy, summary.targetFile);
  const intent = buildChangeIntent(summary, {
    controlMode: options.mode,
    allowedSymbols: options.symbol ? [options.symbol] : undefined,
    policy,
    policyExplanation,
  });
  const intentPath = saveChangeIntent(workspaceRoot, intent, defaultChangeIntentPath(workspaceRoot));
  const readiness = buildRippleReadinessSummary(workspaceRoot, engine);
  intent.readinessSnapshot = buildChangeIntentReadinessSnapshot(readiness);
  saveChangeIntent(workspaceRoot, intent, intentPath);
  return {
    intent,
    path: intentPath,
  };
}

function currentPolicyExplanationForIntent(
  workspaceRoot: string,
  intent: ChangeIntent
): RipplePolicyExplanation {
  return explainRipplePolicyForIntent(loadRipplePolicy(workspaceRoot), intent);
}

function currentReadinessSnapshotForEngine(
  workspaceRoot: string,
  engine: GraphEngine
): ChangeIntent["readinessSnapshot"] {
  return buildChangeIntentReadinessSnapshot(
    buildRippleReadinessSummary(workspaceRoot, engine)
  );
}

function intentSnapshot(intent: ChangeIntent): RippleIntentSnapshot {
  return {
    id: intent.id,
    createdAt: intent.createdAt,
    task: intent.task,
    targetFile: intent.targetFile,
    controlMode: intent.controlMode,
    humanGate: intent.humanGate,
    boundaryRisk: intent.boundaryRisk,
  };
}

function intentCommand(action: string | undefined, options: CliOptions): void {
  if (!action || action === "status") {
    intentStatusCommand(options);
    return;
  }
  if (action === "close") {
    closeIntentCommand(options);
    return;
  }
  throw new Error("Usage: ripple intent status [--intent latest|path] or ripple intent close --reason <text> [--intent latest|path]");
}

function intentStatusCommand(options: CliOptions): void {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const intentRef = options.intent ?? "latest";
  const intentPath = resolveCliIntentPath(workspaceRoot, intentRef);
  const exists = fs.existsSync(intentPath);
  const active = exists && isActiveChangeIntentFile(intentPath);
  const output: RippleIntentStatusOutput = {
    protocol: "ripple-intent-status",
    version: 1,
    workspace: workspaceRoot,
    intentRef,
    intentPath: relativeToWorkspace(workspaceRoot, intentPath),
    exists,
    active,
    nextSteps: active
      ? [
          "Run ripple gate --intent latest before continuing.",
          "Run ripple intent close --reason \"<why this boundary is done>\" when the task boundary is complete or intentionally replaced.",
        ]
      : [
          "Run ripple plan --file <file> --task \"<task>\" --agent --save before an agent edits.",
        ],
  };

  if (active) {
    output.intent = intentSnapshot(loadChangeIntent(workspaceRoot, intentRef));
  }

  if (options.json) {
    printJson(output);
    return;
  }
  printIntentStatus(output);
}

function closeIntentCommand(options: CliOptions): void {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const intentRef = options.intent ?? "latest";
  const intentPath = resolveCliIntentPath(workspaceRoot, intentRef);
  if (!fs.existsSync(intentPath) || !isActiveChangeIntentFile(intentPath)) {
    throw new Error(`No active Ripple intent exists at ${relativeToWorkspace(workspaceRoot, intentPath)}.`);
  }
  const reason = options.reason?.trim();
  if (!reason) {
    throw new Error("Closing an active Ripple intent requires --reason.");
  }

  const intent = loadChangeIntent(workspaceRoot, intentRef);
  const closedAt = new Date().toISOString();
  const closedBy = options.approvedBy?.trim() || "human";
  const archivePath = archivedIntentPath(workspaceRoot, intent, closedAt);
  const archive: RippleClosedIntentArchive = {
    protocol: "ripple-closed-intent",
    version: 1,
    closedAt,
    closedBy,
    reason,
    originalIntentPath: relativeToWorkspace(workspaceRoot, intentPath),
    intent,
  };

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.writeFileSync(archivePath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
  fs.writeFileSync(intentPath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");

  const output: RippleIntentCloseOutput = {
    protocol: "ripple-intent-close",
    version: 1,
    workspace: workspaceRoot,
    intentRef,
    intentPath: relativeToWorkspace(workspaceRoot, intentPath),
    archivePath: relativeToWorkspace(workspaceRoot, archivePath),
    closedAt,
    closedBy,
    reason,
    intent: intentSnapshot(intent),
    nextSteps: [
      "Run ripple intent status to confirm no active saved boundary remains.",
      "Run ripple plan --file <file> --task \"<task>\" --agent --save to start the next agent boundary.",
    ],
  };

  if (options.json) {
    printJson(output);
    return;
  }
  printIntentClose(output);
}

function archivedIntentPath(
  workspaceRoot: string,
  intent: ChangeIntent,
  closedAt: string
): string {
  const timestamp = closedAt.replace(/[:.]/g, "-");
  const safeId = intent.id.replace(/[^a-zA-Z0-9._-]/g, "-");
  return path.join(workspaceRoot, ".ripple", "intents", "archive", `${timestamp}-${safeId}.json`);
}

function printIntentStatus(summary: RippleIntentStatusOutput): void {
  console.log("Ripple intent status");
  console.log(`Intent: ${summary.intentRef}`);
  console.log(`Path: ${summary.intentPath}`);
  console.log(`Active: ${formatYesNo(summary.active)}`);
  if (summary.intent) {
    console.log(`Id: ${summary.intent.id}`);
    console.log(`Task: ${summary.intent.task}`);
    console.log(`Target: ${summary.intent.targetFile}`);
    console.log(`Control mode: ${summary.intent.controlMode}`);
    console.log(`Human gate: ${summary.intent.humanGate}`);
    console.log(`Boundary risk: ${summary.intent.boundaryRisk}`);
  }
  printHumanList("Next:", summary.nextSteps);
}

function printIntentClose(summary: RippleIntentCloseOutput): void {
  console.log("Ripple intent closed");
  console.log(`Intent: ${summary.intent.id}`);
  console.log(`Task: ${summary.intent.task}`);
  console.log(`Target: ${summary.intent.targetFile}`);
  console.log(`Closed by: ${summary.closedBy}`);
  console.log(`Reason: ${summary.reason}`);
  console.log(`Archived: ${summary.archivePath}`);
  console.log(`Closed marker: ${summary.intentPath}`);
  printHumanList("Next:", summary.nextSteps);
}

function approvalStatusOutput(
  intent: ChangeIntent,
  status: RippleApprovalStatus
): ApprovalStatusOutput {
  return {
    ...status,
    intent: {
      id: intent.id,
      task: intent.task,
      targetFile: intent.targetFile,
      controlMode: intent.controlMode,
      humanGate: intent.humanGate,
      boundaryRisk: intent.boundaryRisk,
    },
  };
}

async function buildAuditForFiles(input: {
  workspaceRoot: string;
  files: string[];
  mode: RippleAuditSummary["mode"];
  baseRef?: string;
  tokenBudget: number;
  intent: ChangeIntent;
  currentPolicyExplanation: RipplePolicyExplanation;
}): Promise<RippleAuditSummary> {
  const engine = createFastCheckEngine(input.workspaceRoot);
  try {
    await runWithQuietEngine(() =>
      engine.fastCheckScan(fastCheckCandidateFiles(input.files, input.intent))
    );
    const stagedCheck = buildStagedCheckSummary(engine, {
      workspaceRoot: input.workspaceRoot,
      stagedFiles: input.files,
      mode: input.mode,
      baseRef: input.baseRef,
      tokenBudget: input.tokenBudget,
    });
    const validatedCheck = validateStagedCheckAgainstIntent(stagedCheck, input.intent, {
      currentPolicyExplanation: input.currentPolicyExplanation,
      currentReadinessSnapshot: currentReadinessSnapshotForEngine(input.workspaceRoot, engine),
    });
    const repairPlan = buildIntentDriftRepairPlan(validatedCheck);
    return buildRippleAuditSummary({
      workspaceRoot: input.workspaceRoot,
      mode: input.mode,
      baseRef: input.baseRef,
      stagedCheck: validatedCheck,
      repairPlan,
      intent: input.intent,
      currentPolicyExplanation: input.currentPolicyExplanation,
    });
  } finally {
    engine.dispose();
  }
}

async function buildCheckSummaryForFiles(input: {
  workspaceRoot: string;
  files: string[];
  mode: StagedCheckSummary["mode"];
  baseRef?: string;
  tokenBudget: number;
}): Promise<StagedCheckWithIntentSummary> {
  const engine = createFastCheckEngine(input.workspaceRoot);
  try {
    await runWithQuietEngine(() => engine.fastCheckScan(fastCheckCandidateFiles(input.files)));
    return buildStagedCheckSummary(engine, {
      workspaceRoot: input.workspaceRoot,
      stagedFiles: input.files,
      mode: input.mode,
      baseRef: input.baseRef,
      tokenBudget: input.tokenBudget,
    });
  } finally {
    engine.dispose();
  }
}

function selectedChangeMode(options: CliOptions): StagedCheckSummary["mode"] {
  if (options.changed) {
    return "changed";
  }
  if (options.worktree) {
    return "worktree";
  }
  return "staged";
}

function selectedChangeModeCount(options: CliOptions): number {
  return [options.staged, options.changed, options.worktree].filter(Boolean).length;
}

function listFilesForChangeMode(
  workspaceRoot: string,
  mode: StagedCheckSummary["mode"],
  baseRef: string
): string[] {
  if (mode === "changed") {
    return listGitChangedFiles(workspaceRoot, baseRef);
  }
  if (mode === "worktree") {
    return listGitWorktreeFiles(workspaceRoot);
  }
  return listGitStagedFiles(workspaceRoot);
}

async function checkCommand(options: CliOptions): Promise<void> {
  if (selectedChangeModeCount(options) !== 1) {
    throw new Error("Choose one check mode: --staged, --worktree, or --changed --base <ref>");
  }

  const workspaceRoot = resolveWorkspaceRoot(".");
  const baseRef = options.base ?? "HEAD";
  const mode = selectedChangeMode(options);
  const checkFiles = listFilesForChangeMode(workspaceRoot, mode, baseRef);
  const engine = createFastCheckEngine(workspaceRoot);

  try {
    await runWithQuietEngine(() => engine.fastCheckScan(fastCheckCandidateFiles(checkFiles)));
    const stagedSummary = buildStagedCheckSummary(engine, {
      workspaceRoot,
      stagedFiles: checkFiles,
      mode,
      baseRef: mode === "changed" ? baseRef : undefined,
      tokenBudget: options.budget,
    });
    let summary: StagedCheckWithIntentSummary = stagedSummary;
    if (options.intent) {
      try {
        const intent = loadChangeIntent(workspaceRoot, options.intent);
        summary = validateStagedCheckAgainstIntent(
          stagedSummary,
          intent,
          {
            currentPolicyExplanation: currentPolicyExplanationForIntent(workspaceRoot, intent),
            currentReadinessSnapshot: currentReadinessSnapshotForEngine(workspaceRoot, engine),
          }
        );
      } catch (err) {
        if (!options.strict && !options.githubAnnotations) {
          throw err;
        }

        const message = intentLoadFailureMessage(options.intent, err);
        if (options.json) {
          printJson({
            ...summary,
            nextRequiredPhase: MISSING_INTENT_NEXT_REQUIRED_PHASE,
            nextRequiredAction: MISSING_INTENT_NEXT_REQUIRED_ACTION,
            intentLoadError: {
              intent: options.intent,
              message,
              nextRequiredPhase: MISSING_INTENT_NEXT_REQUIRED_PHASE,
              nextRequiredAction: MISSING_INTENT_NEXT_REQUIRED_ACTION,
            },
          });
        } else if (options.agent) {
          printAgentStagedCheckSummary(summary);
          console.log("");
          console.log(`next_required_phase: ${MISSING_INTENT_NEXT_REQUIRED_PHASE}`);
          console.log(`next_required_action: ${MISSING_INTENT_NEXT_REQUIRED_ACTION}`);
          console.log("");
          console.log("intent_error:");
          console.log(`- ${message}`);
        } else {
          printStagedCheckSummary(summary);
          console.log("");
          console.log(`Next required phase: ${MISSING_INTENT_NEXT_REQUIRED_PHASE}`);
          console.log(`Next required action: ${MISSING_INTENT_NEXT_REQUIRED_ACTION}`);
          console.log(`Intent error: ${message}`);
        }
        if (options.githubAnnotations && !options.json) {
          printGithubIntentLoadError(message);
        }
        writeGithubStepSummary({ summary, intentLoadError: message });
        applyStrictExit(options.strict);
        return;
      }
    }

    if (options.json) {
      printJson(summary);
    } else if (options.agent) {
      printAgentStagedCheckSummary(summary);
    } else {
      printStagedCheckSummary(summary);
    }
    if (options.githubAnnotations && !options.json) {
      printGithubCheckAnnotations(summary);
    }
    writeGithubStepSummary({ summary });
    applyStrictExit(options.strict && strictCheckShouldFail(summary));
  } finally {
    engine.dispose();
  }
}

async function buildAuditFromCliOptions(options: CliOptions): Promise<RippleAuditSummary> {
  if (selectedChangeModeCount(options) > 1) {
    throw new Error("Choose one gate/audit mode: --staged, --worktree, or --changed --base <ref>");
  }

  const workspaceRoot = resolveWorkspaceRoot(".");
  const intentRef = options.intent ?? "latest";
  const mode = selectedChangeMode(options);
  const baseRef = options.base ?? "HEAD";
  const files = listFilesForChangeMode(workspaceRoot, mode, baseRef);
  const intent = loadChangeIntent(workspaceRoot, intentRef);
  const currentPolicyExplanation = currentPolicyExplanationForIntent(workspaceRoot, intent);

  return buildAuditForFiles({
    workspaceRoot,
    files,
    mode,
    baseRef: mode === "changed" ? baseRef : undefined,
    tokenBudget: options.budget,
    intent,
    currentPolicyExplanation,
  });
}

async function auditCommand(options: CliOptions): Promise<void> {
  const audit = await buildAuditFromCliOptions(options);

  if (options.json) {
    printJson({
      ...audit,
      gate: buildRippleGateSummary(audit),
    });
  } else if (options.agent) {
    printAgentAuditSummary(audit);
  } else {
    printAuditSummary(audit);
  }
  applyStrictExit(options.strict && strictAuditShouldFail(audit));
}

async function gateCommand(options: CliOptions): Promise<void> {
  const audit = await buildAuditFromCliOptions(options);
  const gate = buildRippleGateSummary(audit);

  if (options.json) {
    printJson(gate);
  } else if (options.agent) {
    printAgentGateSummary(gate);
  } else {
    printGateSummary(gate);
  }
  applyStrictExit(options.strict && !gate.canContinue);
}

function approveCommand(options: CliOptions): void {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const intentRef = options.intent ?? "latest";
  if (!options.reason || options.reason.trim().length === 0) {
    throw new Error(
      "Approval requires --reason explaining why this boundary is approved."
    );
  }
  const intent = loadChangeIntent(workspaceRoot, intentRef);
  const approval = recordRippleApproval(workspaceRoot, intent, {
    gate: options.gate,
    approvedBy: options.approvedBy,
    reason: options.reason,
  });

  if (options.json) {
    printJson(approval);
    return;
  }
  if (options.agent) {
    printAgentApprovalRecord(approval);
    return;
  }
  printApprovalRecord(approval);
}

function executeVerificationCommand(
  workspaceRoot: string,
  command: string,
  note?: string
): ExecutedVerificationResult {
  const startedAt = Date.now();
  const result = spawnSync(command, {
    cwd: workspaceRoot,
    shell: true,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const durationMs = Math.max(0, Date.now() - startedAt);
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const stderr = [
    typeof result.stderr === "string" ? result.stderr : "",
    result.error ? result.error.message : "",
  ].filter(Boolean).join("\n");

  return {
    command,
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    durationMs,
    stdoutTail: outputTail(typeof result.stdout === "string" ? result.stdout : ""),
    stderrTail: outputTail(stderr),
    note,
  };
}

function outputTail(value: string, maxLength = 4000): string | undefined {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized.length > maxLength ? normalized.slice(-maxLength) : normalized;
}

function currentChangeSnapshotForVerification(
  workspaceRoot: string,
  intent: ChangeIntent
): VerificationChangeSnapshot {
  const scope = verificationSnapshotScope(intent);
  const snapshot = (
    changedFiles: string[],
    diff: string,
    changeMode: VerificationChangeSnapshot["changeMode"]
  ): VerificationChangeSnapshot => ({
    changedFiles: changedFiles
      .map(normalizeProjectPath)
      .filter(isRippleSourceFile)
      .filter((file) => scope.size === 0 || scope.has(file)),
    changeMode,
    changeFingerprint: fingerprintRippleChangeDiff(diff),
  });

  try {
    const diff = listGitChangedDiff(workspaceRoot, "HEAD");
    const changedFiles = listGitChangedFiles(workspaceRoot, "HEAD");
    const changedSnapshot = snapshot(changedFiles, diff, "changed");
    if (changedSnapshot.changedFiles.length > 0) {
      return changedSnapshot;
    }
  } catch {
    // Repositories without a HEAD commit fall back to staged/worktree snapshots.
  }

  try {
    const diff = listGitStagedDiff(workspaceRoot);
    const stagedSnapshot = snapshot(listGitStagedFiles(workspaceRoot), diff, "staged");
    if (stagedSnapshot.changedFiles.length > 0) {
      return stagedSnapshot;
    }
  } catch {
    // Fall through to worktree or empty coverage.
  }

  try {
    return snapshot(listGitWorktreeFiles(workspaceRoot), listGitWorktreeDiff(workspaceRoot), "worktree");
  } catch {
    return { changedFiles: [], changeMode: "staged" };
  }
}

function verificationSnapshotScope(intent: ChangeIntent): Set<string> {
  return new Set(
    [
      ...intent.editableFiles,
      ...intent.expectedFiles,
      intent.targetFile,
    ].map(normalizeProjectPath)
  );
}


function verifyCommand(options: CliOptions): void {
  const workspaceRoot = process.cwd();
  const intentRef = options.intent ?? "latest";
  const reportedCommand = options.verificationCommand?.trim();
  const runCommand = options.verificationRunCommand?.trim();
  if (reportedCommand && runCommand) {
    throw new Error("Use either --run for Ripple-executed evidence or --command/--status for reported evidence, not both.");
  }
  if (!reportedCommand && !runCommand) {
    throw new Error("Usage: ripple verify --run <test command> [--intent latest|path] or ripple verify --command <test command> --status passed|failed|skipped|unknown [--intent latest|path]");
  }
  if (runCommand && options.verificationStatus) {
    throw new Error("--status is only valid with --command. Use --run to let Ripple compute passed/failed from the exit code.");
  }
  const intent = loadChangeIntent(workspaceRoot, intentRef);
  const executed = runCommand
    ? executeVerificationCommand(workspaceRoot, runCommand, options.note)
    : undefined;
  const changeSnapshot = currentChangeSnapshotForVerification(workspaceRoot, intent);
  const updatedIntent = appendRippleVerificationEvidence(intent, {
    command: executed?.command ?? reportedCommand ?? "",
    status: executed?.status ?? options.verificationStatus ?? "unknown",
    source: executed ? "executed" : "reported",
    changedFiles: changeSnapshot.changedFiles,
    changeMode: changeSnapshot.changeMode,
    changeFingerprint: changeSnapshot.changeFingerprint,
    exitCode: executed?.exitCode,
    durationMs: executed?.durationMs,
    stdoutTail: executed?.stdoutTail,
    stderrTail: executed?.stderrTail,
    note: executed?.note ?? options.note,
  });
  const intentPath = saveChangeIntent(workspaceRoot, updatedIntent, intentRef);
  const evidence = updatedIntent.verificationEvidence[updatedIntent.verificationEvidence.length - 1];
  const evidenceSourceLabel = evidence.source === "executed"
    ? "Ripple executed this command and recorded its exit code."
    : "Ripple recorded reported evidence only; it did not independently run this command.";
  const output: RippleVerifyOutput = {
    protocol: "ripple-verification-evidence",
    version: 1,
    workspace: workspaceRoot,
    intentPath,
    intentId: updatedIntent.id,
    evidence,
    totalEvidence: updatedIntent.verificationEvidence.length,
    nextSteps: [
      "Run ripple gate --intent latest --json to include this evidence in the review packet.",
      evidence.status === "failed"
        ? "Fix the failing verification, rerun ripple verify --run, then run ripple gate again."
        : "Run ripple gate again before handoff so the continue/stop decision includes this evidence.",
      evidenceSourceLabel,
    ],
  };

  if (options.json) {
    printJson(output);
    return;
  }

  console.log("Ripple verification evidence");
  console.log(`Intent: ${output.intentId}`);
  console.log(`Intent path: ${path.relative(workspaceRoot, output.intentPath) || output.intentPath}`);
  console.log(`Status: ${output.evidence.status}`);
  console.log(`Command: ${output.evidence.command}`);
  console.log(`Source: ${output.evidence.source}`);
  if (typeof output.evidence.exitCode === "number") {
    console.log(`Exit code: ${output.evidence.exitCode}`);
  }
  if (typeof output.evidence.durationMs === "number") {
    console.log(`Duration ms: ${output.evidence.durationMs}`);
  }
  if (output.evidence.changedFiles) {
    printHumanList("Changed files covered:", output.evidence.changedFiles);
  }
  if (output.evidence.changeMode) {
    console.log(`Change mode: ${output.evidence.changeMode}`);
  }
  if (output.evidence.changeFingerprint) {
    console.log(`Change fingerprint: ${output.evidence.changeFingerprint.slice(0, 12)}`);
  }
  console.log(`Recorded at: ${output.evidence.recordedAt}`);
  if (output.evidence.note) {
    console.log(`Note: ${output.evidence.note}`);
  }
  if (output.evidence.stderrTail) {
    console.log("Stderr tail:");
    console.log(output.evidence.stderrTail);
  }
  console.log(`Note: ${evidenceSourceLabel}`);
}

function approvalCommand(options: CliOptions): void {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const intentRef = options.intent ?? "latest";
  const intent = loadChangeIntent(workspaceRoot, intentRef);
  const status = approvalStatusOutput(
    intent,
    resolveRippleApprovalStatus(workspaceRoot, intent, options.gate)
  );

  if (options.json) {
    printJson(status);
    return;
  }
  if (options.agent) {
    printAgentApprovalStatus(status);
    return;
  }
  printApprovalStatus(status);
}

async function ciCommand(options: CliOptions): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const baseRef = options.base ?? defaultCiBaseRef();
  const hasExplicitIntent = Boolean(options.intent);
  const intentRef = options.intent ?? "latest";
  const files = listGitChangedFiles(workspaceRoot, baseRef);
  const emitGithubAnnotations = shouldEmitGithubAnnotations(options);

  if (!hasExplicitIntent) {
    const summary = await buildCheckSummaryForFiles({
      workspaceRoot,
      files,
      mode: "changed",
      baseRef,
      tokenBudget: options.budget,
    });
    const policySync = buildPolicySyncSummary(workspaceRoot);

    if (options.json) {
      printJson({
        ...summary,
        protocol: "ripple-ci-policy-audit",
        version: 1,
        auditMode: true,
        blocking: false,
        intentRequired: false,
        policySync,
      });
    } else if (options.agent) {
      printAgentStagedCheckSummary(summary);
      console.log("");
      console.log("ci_mode: policy-audit");
      console.log("blocking: false");
      console.log("intent_required: false");
      console.log(`policy_sync: ${policySync.status}`);
      if (policySync.missingRules.length > 0) {
        console.log("policy_sync_missing_rules:");
        policySync.missingRules.slice(0, 12).forEach((rule) => {
          console.log(`- ${rule.paths.join(", ")} risk=${rule.risk ?? "medium"}`);
        });
      }
      console.log("next_required_action: Review policy-risk findings and policy-sync warnings before merge. Use --intent latest --strict only when you want an intent-bound hard gate.");
    } else {
      console.log("Ripple CI policy audit");
      console.log("Status: audit");
      console.log("Blocking: false");
      console.log("Intent: none (local intents are not required in CI audit mode)");
      console.log(`Policy sync: ${policySync.status}`);
      if (policySync.missingRules.length > 0) {
        console.log("");
        console.log("Policy may be missing risky repo surfaces:");
        policySync.missingRules.slice(0, 12).forEach((rule) => {
          console.log(`- ${rule.paths.join(", ")} risk=${rule.risk ?? "medium"}`);
        });
      }
      console.log("");
      printStagedCheckSummary(summary);
      console.log("");
      console.log("Next action: Review policy-risk findings and policy-sync warnings before merge. Use --intent latest --strict only when you want an intent-bound hard gate.");
    }

    if (emitGithubAnnotations && !options.json) {
      printGithubPolicyAuditAnnotations(summary, policySync);
    }
    writeGithubPolicyAuditStepSummary(summary, policySync);
    return;
  }

  let intent: ChangeIntent;

  try {
    intent = loadChangeIntent(workspaceRoot, intentRef);
  } catch (err) {
    const summary = await buildCheckSummaryForFiles({
      workspaceRoot,
      files,
      mode: "changed",
      baseRef,
      tokenBudget: options.budget,
    });
    const message = intentLoadFailureMessage(intentRef, err);
    if (options.json) {
      printJson({
        ...summary,
        nextRequiredPhase: MISSING_INTENT_NEXT_REQUIRED_PHASE,
        nextRequiredAction: MISSING_INTENT_NEXT_REQUIRED_ACTION,
        intentLoadError: {
          intent: intentRef,
          message,
          nextRequiredPhase: MISSING_INTENT_NEXT_REQUIRED_PHASE,
          nextRequiredAction: MISSING_INTENT_NEXT_REQUIRED_ACTION,
        },
      });
    } else if (options.agent) {
      printAgentStagedCheckSummary(summary);
      console.log("");
      console.log(`next_required_phase: ${MISSING_INTENT_NEXT_REQUIRED_PHASE}`);
      console.log(`next_required_action: ${MISSING_INTENT_NEXT_REQUIRED_ACTION}`);
      console.log("");
      console.log("intent_error:");
      console.log(`- ${message}`);
    } else {
      printStagedCheckSummary(summary);
      console.log("");
      console.log(`Next required phase: ${MISSING_INTENT_NEXT_REQUIRED_PHASE}`);
      console.log(`Next required action: ${MISSING_INTENT_NEXT_REQUIRED_ACTION}`);
      console.log(`Intent error: ${message}`);
    }
    if (emitGithubAnnotations && !options.json) {
      printGithubIntentLoadError(message);
    }
    writeGithubStepSummary({ summary, intentLoadError: message });
    applyStrictExit(options.strict);
    return;
  }

  const audit = await buildAuditForFiles({
    workspaceRoot,
    files,
    mode: "changed",
    baseRef,
    tokenBudget: options.budget,
    intent,
    currentPolicyExplanation: currentPolicyExplanationForIntent(workspaceRoot, intent),
  });

  if (options.json) {
    printJson({
      ...audit,
      gate: buildRippleGateSummary(audit),
    });
  } else if (options.agent) {
    printAgentAuditSummary(audit);
  } else {
    printAuditSummary(audit);
  }
  if (emitGithubAnnotations && !options.json) {
    printGithubAuditAnnotations(audit);
  }
  writeGithubAuditStepSummary(audit);
  applyStrictExit(options.strict && strictAuditShouldFail(audit));
}

async function doctorCommand(options: CliOptions): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const engine = createCliEngine(workspaceRoot);

  try {
    await runWithQuietEngine(() => engine.initialScan());
    const summary = buildRippleReadinessSummary(workspaceRoot, engine);
    const policySync = buildPolicySyncSummary(workspaceRoot);
    const output: RippleDoctorOutput = {
      ...summary,
      policySync,
    };

    if (options.json) {
      printJson(output);
    } else if (options.agent) {
      printAgentDoctorSummary(output);
    } else {
      printDoctorSummary(output);
    }
    applyStrictExit(options.strict && summary.status !== "ready");
  } finally {
    engine.dispose();
  }
}

async function initCommand(options: CliOptions): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const { policy } = buildSmartRipplePolicy(workspaceRoot);
  const policyContents = formatRipplePolicy(policy);
  const workflow = githubActionsWorkflow();
  const gitignoreBlock = rippleGitIgnoreBlock();
  const files = [
    {
      path: RIPPLE_POLICY_PATH.split(path.sep).join("/"),
      absolutePath: ripplePolicyPath(workspaceRoot),
      content: policyContents,
    },
    {
      path: GITHUB_ACTIONS_WORKFLOW_PATH.split(path.sep).join("/"),
      absolutePath: path.join(workspaceRoot, GITHUB_ACTIONS_WORKFLOW_PATH),
      content: workflow,
    },
    {
      path: RIPPLE_GITIGNORE_PATH,
      absolutePath: path.join(workspaceRoot, RIPPLE_GITIGNORE_PATH),
      content: gitignoreBlock,
      merge: true,
    },
  ];

  if (options.print) {
    const agentFiles = agentSetupFiles(workspaceRoot);
    const agentSetup = buildAgentSetupSummary(
      workspaceRoot,
      agentFiles.map((file) => ({
        path: file.path,
        status: "printed",
        written: false,
        overwritten: false,
        content: file.content,
      }))
    );
    const preCommitContent = ripplePreCommitHookScript();
    const postCommitContent = ripplePostCommitHookScript();
    const hookPath = preferredHookPath(workspaceRoot, "pre-commit");
    const postCommitHookPath = preferredHookPath(workspaceRoot, "post-commit");
    const hooks: RippleHookInstallSummary = {
      protocol: "ripple-hook-install",
      version: 1,
      workspace: workspaceRoot,
      path: normalizeHookPathForOutput(workspaceRoot, hookPath),
      postCommitPath: normalizeHookPathForOutput(workspaceRoot, postCommitHookPath),
      status: "printed",
      written: false,
      overwritten: false,
      content: [preCommitContent, postCommitContent].join("\n--- ripple-post-commit ---\n"),
      preCommitContent,
      postCommitContent,
      nextSteps: ["Review the hook scripts, then run ripple init to write the full local setup."],
    };
    const summary: RippleInitSummary = {
      protocol: "ripple-init",
      version: 1,
      workspace: workspaceRoot,
      files: files.map((file) => ({
        path: file.path,
        status: "printed",
        written: false,
        overwritten: false,
        content: file.content,
      })),
      agentSetup,
      hooks,
      nextSteps: defaultInitNextSteps(),
    };
    if (options.json) {
      printJson(summary);
      return;
    }
    process.stdout.write(
      [
        ...files.flatMap((file) => [`# ${file.path}`, file.content.trimEnd(), ""]),
        ...agentFiles.flatMap((file) => [`# ${file.path}`, file.content.trimEnd(), ""]),
        "# .git hooks",
        preCommitContent.trimEnd(),
        "--- ripple-post-commit ---",
        postCommitContent.trimEnd(),
        "",
      ].join("\n")
    );
    return;
  }

  const writtenFiles = files.map((file) =>
    file.merge
      ? writeRippleGitIgnoreFile(file.absolutePath)
      : writeInitFile(file, options.force)
  );
  const agentSetup = buildAgentSetupSummary(
    workspaceRoot,
    agentSetupFiles(workspaceRoot).map((file) => writeAgentSetupFile(file, options.force))
  );
  const hooks = installRippleHooks(workspaceRoot);
  const engine = createCliEngine(workspaceRoot);

  try {
    await runWithQuietEngine(() => engine.initialScan());
    const readiness = buildRippleReadinessSummary(workspaceRoot, engine);
    const summary: RippleInitSummary = {
      protocol: "ripple-init",
      version: 1,
      workspace: workspaceRoot,
      files: writtenFiles,
      agentSetup,
      hooks,
      readiness,
      nextSteps: defaultInitNextSteps(readiness),
    };

    if (options.json) {
      printJson(summary);
    } else {
      printInitSummary(summary);
    }
  } finally {
    engine.dispose();
  }
}

function writeAgentSetupFile(
  file: {
    path: string;
    absolutePath: string;
    content: string;
  },
  force: boolean
): RippleInitFileSummary {
  const existed = fs.existsSync(file.absolutePath);
  const nextSection = normalizeLf(file.content);

  if (!existed || force) {
    fs.mkdirSync(path.dirname(file.absolutePath), { recursive: true });
    fs.writeFileSync(file.absolutePath, ensureTrailingLf(nextSection), "utf8");
    return {
      path: file.path,
      status: existed ? "overwritten" : "written",
      written: true,
      overwritten: existed,
    };
  }

  const existing = fs.readFileSync(file.absolutePath, "utf8");
  const updated = mergeRippleManagedSection(existing, nextSection);
  if (updated.content === existing) {
    return {
      path: file.path,
      status: "exists",
      written: false,
      overwritten: false,
    };
  }

  fs.writeFileSync(file.absolutePath, updated.content, "utf8");
  return {
    path: file.path,
    status: updated.action,
    written: true,
    overwritten: false,
  };
}

function mergeRippleManagedSection(
  existing: string,
  nextSection: string
): { content: string; action: "updated" | "appended" } {
  const normalizedExisting = normalizeLf(existing);
  const start = normalizedExisting.indexOf(RIPPLE_AGENT_SECTION_START);
  const end = normalizedExisting.indexOf(RIPPLE_AGENT_SECTION_END);

  if (start !== -1 && end !== -1 && end > start) {
    const afterEnd = end + RIPPLE_AGENT_SECTION_END.length;
    const withoutOldSection = `${normalizedExisting.slice(0, start)}${normalizedExisting.slice(afterEnd)}`;
    return {
      content: appendRippleSectionAtBottom(withoutOldSection, nextSection),
      action: "updated",
    };
  }

  return {
    content: appendRippleSectionAtBottom(normalizedExisting, nextSection),
    action: "appended",
  };
}

function appendRippleSectionAtBottom(existing: string, nextSection: string): string {
  const base = normalizeLf(existing).replace(/\n*$/, "");
  const separator = base.length === 0 ? "" : "\n\n";
  return `${base}${separator}${ensureTrailingLf(normalizeLf(nextSection))}`;
}

function normalizeLf(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function ensureTrailingLf(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function writeInitFile(
  file: {
    path: string;
    absolutePath: string;
    content: string;
  },
  force: boolean
): RippleInitFileSummary {
  const existed = fs.existsSync(file.absolutePath);
  if (existed && !force) {
    return {
      path: file.path,
      status: "exists",
      written: false,
      overwritten: false,
    };
  }

  fs.mkdirSync(path.dirname(file.absolutePath), { recursive: true });
  fs.writeFileSync(file.absolutePath, file.content, "utf8");

  return {
    path: file.path,
    status: existed ? "overwritten" : "written",
    written: true,
    overwritten: existed,
  };
}

function writeRippleGitIgnoreFile(targetPath: string): RippleInitFileSummary {
  const content = rippleGitIgnoreBlock();
  const existed = fs.existsSync(targetPath);
  if (!existed) {
    fs.writeFileSync(targetPath, content, "utf8");
    return {
      path: RIPPLE_GITIGNORE_PATH,
      status: "written",
      written: true,
      overwritten: false,
    };
  }

  const existing = fs.readFileSync(targetPath, "utf8");
  if (gitIgnoreContainsRippleCache(existing)) {
    return {
      path: RIPPLE_GITIGNORE_PATH,
      status: "exists",
      written: false,
      overwritten: false,
    };
  }

  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(targetPath, `${existing}${separator}${content}`, "utf8");
  return {
    path: RIPPLE_GITIGNORE_PATH,
    status: "updated",
    written: true,
    overwritten: false,
  };
}

function gitIgnoreContainsRippleCache(contents: string): boolean {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/").replace(/^\/+/, ""))
    .some((line) =>
      line === RIPPLE_CACHE_GITIGNORE_ENTRY ||
      line === ".ripple/.cache" ||
      line === ".ripple/.cache/**"
    );
}

const RIPPLE_PRE_COMMIT_HOOK_START = "# >>> ripple pre-commit hook";
const RIPPLE_PRE_COMMIT_HOOK_END = "# <<< ripple pre-commit hook";
const RIPPLE_POST_COMMIT_HOOK_START = "# >>> ripple post-commit hook";
const RIPPLE_POST_COMMIT_HOOK_END = "# <<< ripple post-commit hook";

function ripplePreCommitHookBlock(): string {
  return [
    RIPPLE_PRE_COMMIT_HOOK_START,
    `# Policy is permanent. Intent is local. Git staged diff is truth.
ripple_previous_status=$?
if [ "$ripple_previous_status" -ne 0 ]; then
  exit "$ripple_previous_status"
fi

set +e

ripple_run() {
  if [ -x "./node_modules/.bin/ripple" ]; then
    "./node_modules/.bin/ripple" "$@"
  elif command -v ripple >/dev/null 2>&1; then
    ripple "$@"
  else
    npx -y ${rippleCliPackageSpec()} "$@"
  fi
}

if [ -f ".ripple/intents/latest.json" ]; then
  echo "[Ripple] Active local intent found. Checking staged changes against approved boundary..."
  ripple_run gate --staged --intent latest --agent --strict
  status=$?
  if [ "$status" -ne 0 ]; then
    cat <<'EOF'
[RIPPLE STOP] Commit blocked by Ripple active-intent boundary.

If you are an AI agent:
- DO NOT retry the commit.
- Repair the unauthorized change or ask the human to approve a wider scope.

If you are a human developer:
- Review the Ripple output above.
- To bypass this local hook intentionally, run: git commit --no-verify
EOF
    exit $status
  fi
else
  echo "[Ripple] No active local intent found. Running staged policy/contract awareness check..."
  ripple_run check --staged --agent
  status=$?
  if [ "$status" -ne 0 ]; then
    cat <<'EOF'
[RIPPLE WARNING] Ripple could not complete the no-intent staged check.

If you are an AI agent:
- Stop and ask the human before continuing.

If you are a human developer:
- Review the error above.
- To bypass this local hook intentionally, run: git commit --no-verify
EOF
    exit $status
  fi
fi`,
    RIPPLE_PRE_COMMIT_HOOK_END,
    "",
  ].join("\n");
}

function ripplePreCommitHookScript(): string {
  return [
    "#!/bin/sh",
    "# Ripple pre-commit hook - generated by `ripple hook install`.",
    ripplePreCommitHookBlock(),
    "exit 0",
    "",
  ].join("\n");
}

function ripplePostCommitHookBlock(): string {
  return [
    RIPPLE_POST_COMMIT_HOOK_START,
    `# Local intents are consumed after a successful commit to avoid ghost-intent blocks.
set +e

cleared=0
for intent_file in .ripple/.cache/latest-intent.json .ripple/intents/latest.json; do
  if [ -f "$intent_file" ]; then
    rm "$intent_file"
    cleared=1
  fi
done

if [ "$cleared" -eq 1 ]; then
  echo "[Ripple] Consumed and cleared local intent."
fi`,
    RIPPLE_POST_COMMIT_HOOK_END,
    "",
  ].join("\n");
}

function ripplePostCommitHookScript(): string {
  return [
    "#!/bin/sh",
    "# Ripple post-commit hook - generated by `ripple hook install`.",
    ripplePostCommitHookBlock(),
    "exit 0",
    "",
  ].join("\n");
}

function normalizeHookPathForOutput(workspaceRoot: string, hookPath: string): string {
  return path.relative(workspaceRoot, hookPath).split(path.sep).join("/");
}

function preferredHookPath(workspaceRoot: string, hookName: "pre-commit" | "post-commit"): string {
  const huskyDir = path.join(workspaceRoot, ".husky");
  if (fs.existsSync(huskyDir) && fs.statSync(huskyDir).isDirectory()) {
    return path.join(huskyDir, hookName);
  }
  return path.join(workspaceRoot, ".git", "hooks", hookName);
}

function installRippleHookBlock(input: {
  hookPath: string;
  fullScript: string;
  block: string;
  marker: string;
}): RippleHookInstallAction {
  const { hookPath, fullScript, block, marker } = input;
  if (!fs.existsSync(hookPath)) {
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, fullScript, { encoding: "utf8", mode: 0o755 });
    try {
      fs.chmodSync(hookPath, 0o755);
    } catch {
      // chmod is best-effort on Windows.
    }
    return "created";
  }

  const existing = fs.readFileSync(hookPath, "utf8");
  if (existing.includes(marker)) {
    return "already-present";
  }

  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(hookPath, `${existing}${separator}\n${block}\n`, "utf8");
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // chmod is best-effort on Windows.
  }
  return "appended";
}

function installRippleHooks(workspaceRoot: string): RippleHookInstallSummary {
  if (!fs.existsSync(path.join(workspaceRoot, ".git"))) {
    throw new Error("Cannot install Ripple hook because .git was not found. Run this inside a Git worktree.");
  }

  const hookPath = preferredHookPath(workspaceRoot, "pre-commit");
  const postCommitHookPath = preferredHookPath(workspaceRoot, "post-commit");
  const content = ripplePreCommitHookScript();
  const postCommitContent = ripplePostCommitHookScript();
  const preCommitAction = installRippleHookBlock({
    hookPath,
    fullScript: content,
    block: ripplePreCommitHookBlock(),
    marker: RIPPLE_PRE_COMMIT_HOOK_START,
  });
  const postCommitAction = installRippleHookBlock({
    hookPath: postCommitHookPath,
    fullScript: postCommitContent,
    block: ripplePostCommitHookBlock(),
    marker: RIPPLE_POST_COMMIT_HOOK_START,
  });
  const wroteSomething = preCommitAction !== "already-present" || postCommitAction !== "already-present";

  return {
    protocol: "ripple-hook-install",
    version: 1,
    workspace: workspaceRoot,
    path: normalizeHookPathForOutput(workspaceRoot, hookPath),
    postCommitPath: normalizeHookPathForOutput(workspaceRoot, postCommitHookPath),
    status: wroteSomething ? "written" : "exists",
    written: wroteSomething,
    overwritten: false,
    preCommitAction,
    postCommitAction,
    nextSteps: [
      "Run ripple plan --file <file> --task \"<task>\" --mode file --agent --save before AI edits.",
      "Commit normally; Ripple will block active-intent drift and clear consumed local intents after successful commits.",
    ],
  };
}

function hookInstallCommand(subcommand: string | undefined, options: CliOptions): void {
  if (subcommand !== "install") {
    throw new Error("Usage: ripple hook install [--print] [--force]");
  }

  const workspaceRoot = resolveWorkspaceRoot(".");
  const hookPath = preferredHookPath(workspaceRoot, "pre-commit");
  const postCommitHookPath = preferredHookPath(workspaceRoot, "post-commit");
  const relativeHookPath = normalizeHookPathForOutput(workspaceRoot, hookPath);
  const relativePostCommitHookPath = normalizeHookPathForOutput(workspaceRoot, postCommitHookPath);
  const content = ripplePreCommitHookScript();
  const postCommitContent = ripplePostCommitHookScript();

  if (options.print) {
    const summary: RippleHookInstallSummary = {
      protocol: "ripple-hook-install",
      version: 1,
      workspace: workspaceRoot,
      path: relativeHookPath,
      postCommitPath: relativePostCommitHookPath,
      status: "printed",
      written: false,
      overwritten: false,
      content: [content, postCommitContent].join("\n--- ripple-post-commit ---\n"),
      preCommitContent: content,
      postCommitContent,
      nextSteps: ["Review the hook scripts, then run ripple hook install to write them."],
    };
    if (options.json) {
      printJson(summary);
    } else {
      process.stdout.write(content);
      process.stdout.write("\n--- ripple-post-commit ---\n");
      process.stdout.write(postCommitContent);
    }
    return;
  }

  if (!fs.existsSync(path.join(workspaceRoot, ".git"))) {
    throw new Error("Cannot install Ripple hook because .git was not found. Run this inside a Git worktree.");
  }

  const preCommitAction = installRippleHookBlock({
    hookPath,
    fullScript: content,
    block: ripplePreCommitHookBlock(),
    marker: RIPPLE_PRE_COMMIT_HOOK_START,
  });
  const postCommitAction = installRippleHookBlock({
    hookPath: postCommitHookPath,
    fullScript: postCommitContent,
    block: ripplePostCommitHookBlock(),
    marker: RIPPLE_POST_COMMIT_HOOK_START,
  });
  const wroteSomething = preCommitAction !== "already-present" || postCommitAction !== "already-present";

  const summary: RippleHookInstallSummary = {
    protocol: "ripple-hook-install",
    version: 1,
    workspace: workspaceRoot,
    path: relativeHookPath,
    postCommitPath: relativePostCommitHookPath,
    status: wroteSomething ? "written" : "exists",
    written: wroteSomething,
    overwritten: false,
    preCommitAction,
    postCommitAction,
    nextSteps: [
      "Commit normally. Ripple will check staged changes before each commit.",
      "After a successful commit, Ripple clears consumed local intents to prevent ghost-intent blocks.",
      "Humans can intentionally bypass local hooks with git commit --no-verify.",
    ],
  };

  if (options.json) {
    printJson(summary);
  } else {
    console.log(wroteSomething ? "Ripple Git hooks integrated" : "Ripple Git hooks already integrated");
    console.log(`Pre-commit: ${relativeHookPath} (${preCommitAction})`);
    console.log(`Post-commit: ${relativePostCommitHookPath} (${postCommitAction})`);
    console.log("Active intent: blocks staged drift against latest local plan.");
    console.log("No intent: warns with staged policy/contract awareness and lets humans stay in control.");
    console.log("Post-commit: clears consumed local intents to prevent ghost-intent blocks.");
  }
}

function initCiCommand(options: CliOptions): void {
  const workflow = githubActionsWorkflow();
  const workspaceRoot = resolveWorkspaceRoot(".");
  const targetPath = path.join(workspaceRoot, GITHUB_ACTIONS_WORKFLOW_PATH);
  const relativeTargetPath = GITHUB_ACTIONS_WORKFLOW_PATH.split(path.sep).join("/");

  if (options.print) {
    if (options.json) {
      printJson({
        path: relativeTargetPath,
        workflow,
        written: false,
      });
    } else {
      process.stdout.write(workflow);
    }
    return;
  }

  const existed = fs.existsSync(targetPath);
  if (existed && !options.force) {
    throw new Error(`${relativeTargetPath} already exists. Re-run with --force to overwrite it.`);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, workflow, "utf8");

  if (options.json) {
    printJson({
      path: relativeTargetPath,
      written: true,
      overwritten: existed,
    });
    return;
  }

  console.log(existed ? "Ripple CI workflow overwritten" : "Ripple CI workflow written");
  console.log(`Path: ${relativeTargetPath}`);
  console.log(`Command: npx -y ${rippleCliPackageSpec()} ci --base origin/\${{ github.base_ref }} --github-annotations`);
}

function policyCommand(args: string[], options: CliOptions): void {
  const subcommand = args[0];
  if (subcommand === "init") {
    policyInitCommand(options);
    return;
  }
  if (subcommand === "sync") {
    policySyncCommand(options);
    return;
  }
  if (subcommand === "explain") {
    policyExplainCommand(options);
    return;
  }
  throw new Error("Usage: ripple policy init [--print] [--force], ripple policy sync [--json], or ripple policy explain --file <file>");
}

function policyInitCommand(options: CliOptions): void {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const { policy, detections } = buildSmartRipplePolicy(workspaceRoot);
  const targetPath = ripplePolicyPath(workspaceRoot);
  const relativeTargetPath = RIPPLE_POLICY_PATH.split(path.sep).join("/");
  const contents = formatRipplePolicy(policy);

  if (options.print) {
    if (options.json) {
      printJson({
        path: relativeTargetPath,
        policy,
        detections,
        written: false,
      });
    } else {
      process.stdout.write(contents);
    }
    return;
  }

  const existed = fs.existsSync(targetPath);
  if (existed && !options.force) {
    throw new Error(`${relativeTargetPath} already exists. Re-run with --force to overwrite it.`);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents, "utf8");

  if (options.json) {
    printJson({
      path: relativeTargetPath,
      written: true,
      overwritten: existed,
      policy,
      detections,
    });
    return;
  }

  console.log(existed ? "Ripple policy overwritten" : "Ripple policy written");
  console.log(`Path: ${relativeTargetPath}`);
  console.log(`Default mode: ${policy.defaultMode ?? "file"}`);
  console.log(`Risk rules: ${policy.riskRules?.length ?? 0}`);
  if (detections.length > 0) {
    console.log("Smart detections:");
    detections.forEach((detection) => {
      console.log(`- ${detection.kind}: ${detection.evidence.join(", ")}`);
    });
  }
}


function policySyncCommand(options: CliOptions): void {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const summary = buildPolicySyncSummary(workspaceRoot);

  if (options.json) {
    printJson(summary);
    return;
  }

  printPolicySyncSummary(summary);
}

function buildPolicySyncSummary(workspaceRoot: string): RipplePolicySyncSummary {
  const loadedPolicy = loadRipplePolicy(workspaceRoot);
  const { policy: smartPolicy, detections } = buildSmartRipplePolicy(workspaceRoot);
  const existingRules = loadedPolicy.policy.riskRules ?? [];
  const missingRules: RipplePolicySyncMissingRule[] = [];
  const missingRuleKeys = new Set<string>();

  const detectionSummaries = detections.map((detection) => {
    let missingForDetection = 0;
    detection.rules.forEach((rule) => {
      if (policyRuleIsCovered(rule, existingRules)) {
        return;
      }
      const key = policyRuleKey(rule);
      if (missingRuleKeys.has(key)) {
        return;
      }
      missingRuleKeys.add(key);
      missingForDetection += 1;
      missingRules.push({
        ...clonePolicyRule(rule),
        reason: `${detection.kind}: ${detection.evidence.join(", ")}`,
      });
    });
    return {
      kind: detection.kind,
      evidence: detection.evidence,
      missingRules: missingForDetection,
    };
  });

  if (!loadedPolicy.exists) {
    (smartPolicy.riskRules ?? []).forEach((rule) => {
      const key = policyRuleKey(rule);
      if (missingRuleKeys.has(key)) {
        return;
      }
      missingRuleKeys.add(key);
      missingRules.push({
        ...clonePolicyRule(rule),
        reason: "policy file missing",
      });
    });
  }

  const status: RipplePolicySyncStatus = missingRules.length > 0 ? "update-available" : "up-to-date";
  return {
    protocol: "ripple-policy-sync",
    version: 1,
    workspace: workspaceRoot,
    policyPath: RIPPLE_POLICY_PATH.split(path.sep).join("/"),
    policyExists: loadedPolicy.exists,
    status,
    missingRules,
    detections: detectionSummaries,
    nextSteps: policySyncNextSteps(status, loadedPolicy.exists),
  };
}

function clonePolicyRule(rule: RipplePolicyRiskRule): RipplePolicyRiskRule {
  return {
    paths: [...rule.paths],
    ...(rule.risk ? { risk: rule.risk } : {}),
    ...(rule.requireHumanBeforeEdit === true ? { requireHumanBeforeEdit: true } : {}),
    ...(rule.requireHumanBeforeMerge === true ? { requireHumanBeforeMerge: true } : {}),
    ...(rule.allowPrMode === true ? { allowPrMode: true } : {}),
  };
}

function policyRuleIsCovered(suggested: RipplePolicyRiskRule, existingRules: RipplePolicyRiskRule[]): boolean {
  return existingRules.some((existing) => {
    if (!suggested.paths.every((suggestedPath) => existing.paths.some((existingPath) => policyPathPatternCovers(existingPath, suggestedPath)))) {
      return false;
    }
    if (suggested.risk && comparePolicyRisk(existing.risk, suggested.risk) < 0) {
      return false;
    }
    if (suggested.requireHumanBeforeEdit === true && existing.requireHumanBeforeEdit !== true) {
      return false;
    }
    if (suggested.requireHumanBeforeMerge === true && existing.requireHumanBeforeMerge !== true) {
      return false;
    }
    return true;
  });
}

function policyPathPatternCovers(existingPattern: string, suggestedPattern: string): boolean {
  const existing = normalizePolicyPattern(existingPattern);
  const suggested = normalizePolicyPattern(suggestedPattern);
  if (existing === suggested) {
    return true;
  }
  if (existing === "**" || existing === "**/*") {
    return true;
  }
  if (existing.endsWith("/**")) {
    const base = existing.slice(0, -3);
    return suggested === base || suggested.startsWith(`${base}/`);
  }
  if (!suggested.includes("*") && policyGlobToRegExp(existing).test(suggested)) {
    return true;
  }
  return false;
}

function normalizePolicyPattern(pattern: string): string {
  return pattern.replace(/\\\\/g, "/").replace(/^\.\//, "");
}

function policyGlobToRegExp(pattern: string): RegExp {
  const normalized = normalizePolicyPattern(pattern);
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function comparePolicyRisk(existing: RipplePolicyRiskRule["risk"], suggested: RipplePolicyRiskRule["risk"]): number {
  const levels = ["low", "medium", "high", "critical"];
  return levels.indexOf(existing ?? "low") - levels.indexOf(suggested ?? "low");
}

function policyRuleKey(rule: RipplePolicyRiskRule): string {
  return JSON.stringify({
    paths: rule.paths.map(normalizePolicyPattern).sort(),
    risk: rule.risk ?? "",
    requireHumanBeforeEdit: rule.requireHumanBeforeEdit === true,
    requireHumanBeforeMerge: rule.requireHumanBeforeMerge === true,
    allowPrMode: rule.allowPrMode === true,
  });
}

function policySyncNextSteps(status: RipplePolicySyncStatus, policyExists: boolean): string[] {
  if (!policyExists) {
    return [
      "Run ripple policy init to create .ripple/policy.json from the current repository shape.",
      "Review the suggested risk rules before committing the policy.",
    ];
  }
  if (status === "up-to-date") {
    return ["No policy update is required right now."];
  }
  return [
    "Review the suggested missing rules with a human maintainer.",
    "Update .ripple/policy.json only after approving the new trust boundaries.",
  ];
}

function printPolicySyncSummary(summary: RipplePolicySyncSummary): void {
  console.log("Ripple policy sync");
  console.log(`Policy: ${summary.policyPath}${summary.policyExists ? "" : " (missing)"}`);
  console.log(`Status: ${summary.status}`);
  if (summary.missingRules.length > 0) {
    console.log("");
    console.log("Detected risky paths not covered by policy:");
    summary.missingRules.forEach((rule) => {
      console.log(`- ${rule.paths.join(", ")} risk=${rule.risk ?? "medium"}${rule.requireHumanBeforeEdit ? " human-before-edit" : ""}${rule.requireHumanBeforeMerge ? " human-before-merge" : ""}`);
      console.log(`  reason: ${rule.reason}`);
    });
  } else {
    console.log("Policy is up to date with current smart detections.");
  }
  console.log("");
  console.log("Next:");
  summary.nextSteps.forEach((step) => console.log(`- ${step}`));
}


function policyExplainCommand(options: CliOptions): void {
  if (!options.file) {
    throw new Error("Missing target file. Usage: ripple policy explain --file <file>");
  }

  const workspaceRoot = resolveWorkspaceRoot(".");
  const loadedPolicy = loadRipplePolicy(workspaceRoot);
  const explanation = explainRipplePolicyForTarget(loadedPolicy, normalizeProjectPath(options.file));

  if (options.json) {
    printJson(explanation);
    return;
  }

  if (options.agent) {
    printAgentPolicyExplanation(explanation);
    return;
  }

  console.log("Ripple policy explanation");
  console.log(`File: ${explanation.targetFile}`);
  console.log(`Policy source: ${explanation.policySource}`);
  console.log(`Policy exists: ${explanation.policyExists}`);
  console.log(`Effective mode: ${explanation.effectiveMode}`);
  console.log(`Policy risk: ${explanation.policyRisk}`);
  console.log(`Human gate: ${explanation.humanGate}`);
  console.log(`Human required: ${explanation.humanRequired}`);
  console.log(`Allow PR mode: ${explanation.allowPrMode}`);
  console.log("");
  console.log("Matched rules:");
  if (explanation.matchedRules.length === 0) {
    console.log("  - none");
  } else {
    explanation.matchedRules.forEach((rule) => console.log(`  - ${rule}`));
  }
  console.log("");
  console.log("Why:");
  explanation.why.forEach((reason) => console.log(`  - ${reason}`));
  console.log("");
  console.log("Next steps:");
  explanation.nextSteps.forEach((step) => console.log(`  - ${step}`));
}

function printAgentPolicyExplanation(
  explanation: ReturnType<typeof explainRipplePolicyForTarget>
): void {
  console.log("RIPPLE_POLICY_EXPLAIN");
  console.log(`target: ${explanation.targetFile}`);
  console.log(`policy_source: ${explanation.policySource}`);
  console.log(`policy_exists: ${explanation.policyExists}`);
  console.log(`effective_mode: ${explanation.effectiveMode}`);
  console.log(`policy_risk: ${explanation.policyRisk}`);
  console.log(`human_gate: ${explanation.humanGate}`);
  console.log(`human_required: ${explanation.humanRequired}`);
  console.log(`allow_pr_mode: ${explanation.allowPrMode}`);
  console.log("");
  printAgentList("matched_rules", explanation.matchedRules);
  console.log("");
  printAgentList("why", explanation.why);
  console.log("");
  printAgentList("next_steps", explanation.nextSteps);
}

async function repairCommand(options: CliOptions): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const stagedFiles = listGitStagedFiles(workspaceRoot);
  const intent = loadChangeIntent(workspaceRoot, options.intent ?? "latest");
  const engine = createFastCheckEngine(workspaceRoot);

  try {
    await runWithQuietEngine(() =>
      engine.fastCheckScan(fastCheckCandidateFiles(stagedFiles, intent))
    );
    const stagedSummary = buildStagedCheckSummary(engine, {
      workspaceRoot,
      stagedFiles,
      tokenBudget: options.budget,
    });
    const summary = validateStagedCheckAgainstIntent(
      stagedSummary,
      intent,
      {
        currentPolicyExplanation: currentPolicyExplanationForIntent(workspaceRoot, intent),
        currentReadinessSnapshot: currentReadinessSnapshotForEngine(workspaceRoot, engine),
      }
    );
    const repairPlan = buildIntentDriftRepairPlan(summary);

    if (options.json) {
      printJson(repairPlan);
    } else if (options.agent) {
      printAgentIntentDriftRepairPlan(repairPlan);
    } else {
      printIntentDriftRepairPlan(repairPlan);
    }
    applyStrictExit(options.strict && strictRepairShouldFail(repairPlan));
  } finally {
    engine.dispose();
  }
}

async function historyCommand(options: CliOptions): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const engine = createCliEngine(workspaceRoot);

  try {
    await runWithQuietEngine(() => engine.initialScan());
    const summary = engine.getRecentHistorySummary(options.last);

    if (options.json) {
      printJson(summary);
    } else {
      printHistorySummary(summary);
    }
  } finally {
    engine.dispose();
  }
}

async function callersCommand(symbolId: string | undefined, options: CliOptions): Promise<void> {
  if (!symbolId) {
    throw new Error("Missing symbol id. Usage: ripple callers <file>::<symbol>");
  }
  if (!symbolId.includes("::")) {
    throw new Error("Symbol id must use <file>::<symbol>, for example src/auth.ts::validateToken");
  }

  const workspaceRoot = resolveWorkspaceRoot(".");
  const engine = createCliEngine(workspaceRoot);

  try {
    await runWithQuietEngine(() => engine.initialScan());
    const summary = engine.getSymbolCallersSummary(symbolId);

    if (!summary) {
      throw new Error(`Symbol is not in the Ripple graph: ${symbolId}`);
    }

    if (options.json) {
      printJson(summary);
    } else {
      printSymbolCallersSummary(summary);
    }
  } finally {
    engine.dispose();
  }
}

async function scanCommand(targetPath: string | undefined, options: CliOptions): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot(targetPath);
  const engine = createCliEngine(workspaceRoot);

  try {
    await runWithQuietEngine(() => engine.initialScan());

    const cachePath = path.join(workspaceRoot, ".ripple", ".cache", "graph.cache.json");
    const workflowPath = path.join(workspaceRoot, ".ripple", "WORKFLOW.md");
    const summary: ScanSummary = {
      workspace: workspaceRoot,
      files: engine.graph.files.size,
      symbols: engine.graph.symbols.size,
      callEdges: countCallEdges(engine),
      contextMode: "lean",
      cacheGenerated: fs.existsSync(cachePath),
      cachePath,
      contextGenerated: false,
      contextPath: workflowPath,
    };

    if (options.json) {
      printJson(summary);
    } else {
      printScanSummary(summary);
    }
  } finally {
    engine.dispose();
  }
}

async function workflowCommand(options: CliOptions): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot(".");
  const engine = createCliEngine(workspaceRoot, "full");

  try {
    await runWithQuietEngine(() => engine.initialScan());

    const workflowPath = path.join(workspaceRoot, ".ripple", "WORKFLOW.md");
    const contextDir = path.join(workspaceRoot, ".ripple", ".cache");
    const contextFiles = [
      ".ripple/.cache/context.json",
      ".ripple/.cache/context.files.json",
      ".ripple/.cache/context.symbols.json",
    ];
    const focusDir = path.join(contextDir, "focus");
    const focusFileCount = countJsonFiles(focusDir);
    const summary: RippleWorkflowSummary = {
      protocol: "ripple-workflow",
      version: 1,
      workspace: workspaceRoot,
      path: ".ripple/WORKFLOW.md",
      written: fs.existsSync(workflowPath),
      contextGenerated: contextFiles.every((filePath) =>
        fs.existsSync(path.join(workspaceRoot, filePath))
      ),
      contextFiles,
      focusFileCount,
      nextSteps: [
        "Copy .ripple/WORKFLOW.md into your agent instruction file if your agent does not use MCP.",
        "For MCP-capable agents, prefer ripple_plan_context and ripple_gate over reading generated files.",
        "Run ripple scan for a lean graph refresh when you do not need file-based agent instructions.",
      ],
    };

    if (!summary.written) {
      throw new Error("WORKFLOW.md was not generated. Check that the workspace has supported source files.");
    }

    if (options.json) {
      printJson(summary);
    } else {
      printWorkflowSummary(summary);
    }
  } finally {
    engine.dispose();
  }
}

function countJsonFiles(directoryPath: string): number {
  try {
    return fs
      .readdirSync(directoryPath)
      .filter((fileName) => fileName.endsWith(".json"))
      .length;
  } catch {
    return 0;
  }
}

async function symbolsCommand(filePath: string | undefined, options: CliOptions): Promise<void> {
  if (!filePath) {
    throw new Error("Missing file path. Usage: ripple symbols <file>");
  }

  const workspaceRoot = resolveWorkspaceRoot(".");
  const engine = createCliEngine(workspaceRoot);

  try {
    await runWithQuietEngine(() => engine.initialScan());
    const summary = engine.getFileSymbolsSummary(filePath);

    if (!summary) {
      throw new Error(`File is not in the Ripple graph: ${filePath}`);
    }

    if (options.json) {
      printJson(summary);
    } else {
      printFileSymbolsSummary(summary);
    }
  } finally {
    engine.dispose();
  }
}

async function blastCommand(filePath: string | undefined, options: CliOptions): Promise<void> {
  if (!filePath) {
    throw new Error("Missing file path. Usage: ripple blast <file>");
  }

  const workspaceRoot = resolveWorkspaceRoot(".");
  const engine = createCliEngine(workspaceRoot);

  try {
    await runWithQuietEngine(() => engine.initialScan());
    const summary = engine.getBlastRadiusSummary(filePath);

    if (!summary) {
      throw new Error(`File is not in the Ripple graph: ${filePath}`);
    }

    if (options.json) {
      printJson(summary);
    } else {
      printBlastRadiusSummary(summary);
    }
  } finally {
    engine.dispose();
  }
}

async function dependencyCommand(
  filePath: string | undefined,
  direction: "imports" | "importers",
  options: CliOptions
): Promise<void> {
  if (!filePath) {
    throw new Error(`Missing file path. Usage: ripple ${direction} <file>`);
  }

  const workspaceRoot = resolveWorkspaceRoot(".");
  const engine = createCliEngine(workspaceRoot);

  try {
    await runWithQuietEngine(() => engine.initialScan());
    const summary = engine.getFileDependencySummary(filePath);

    if (!summary) {
      throw new Error(`File is not in the Ripple graph: ${filePath}`);
    }

    const output = direction === "imports"
      ? { ...summary, importers: undefined }
      : { ...summary, imports: undefined };

    if (options.json) {
      printJson(output);
    } else {
      printDependencySummary(summary, direction);
    }
  } finally {
    engine.dispose();
  }
}

async function focusCommand(filePath: string | undefined, options: CliOptions): Promise<void> {
  if (!filePath) {
    throw new Error("Missing file path. Usage: ripple focus <file>");
  }

  const workspaceRoot = resolveWorkspaceRoot(".");
  const engine = createCliEngine(workspaceRoot, "on-demand");

  try {
    await runWithQuietEngine(() => engine.initialScan());
    const summary = engine.getFileFocusSummary(filePath);

    if (!summary) {
      throw new Error(`File is not in the Ripple graph: ${filePath}`);
    }
    engine.writeFileFocus(filePath);

    if (options.json) {
      printJson(summary);
    } else {
      printFocusSummary(summary);
    }
  } finally {
    engine.dispose();
  }
}

async function main(): Promise<void> {
  const { command, args, options } = parseCliArgs(process.argv.slice(2));
  const [arg] = args;

  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  if (command === "--version" || command === "-v") {
    console.log(version());
    return;
  }

  if (command === "agent") {
    if (arg === "setup") {
      agentSetupCommand(options);
      return;
    }
    if (arg && arg !== "setup") {
      throw new Error("Usage: ripple agent or ripple agent setup [--print] [--force]");
    }
    if (options.json) {
      printJson(getAgentWorkflowSummary());
    } else {
      console.log(agentWorkflowGuide());
    }
    return;
  }

  if (command === "hook") {
    hookInstallCommand(arg, options);
    return;
  }

  if (command === "init") {
    await initCommand(options);
    return;
  }

  if (command === "scan") {
    await scanCommand(arg, options);
    return;
  }

  if (command === "workflow") {
    await workflowCommand(options);
    return;
  }

  if (command === "doctor") {
    await doctorCommand(options);
    return;
  }

  if (command === "focus") {
    await focusCommand(arg, options);
    return;
  }

  if (command === "blast") {
    await blastCommand(arg, options);
    return;
  }

  if (command === "imports") {
    await dependencyCommand(arg, "imports", options);
    return;
  }

  if (command === "importers") {
    await dependencyCommand(arg, "importers", options);
    return;
  }

  if (command === "symbols") {
    await symbolsCommand(arg, options);
    return;
  }

  if (command === "callers") {
    await callersCommand(arg, options);
    return;
  }

  if (command === "history") {
    await historyCommand(options);
    return;
  }

  if (command === "plan") {
    await planCommand(options);
    return;
  }

  if (command === "intent") {
    intentCommand(arg, options);
    return;
  }

  if (command === "check") {
    await checkCommand(options);
    return;
  }

  if (command === "audit") {
    await auditCommand(options);
    return;
  }

  if (command === "gate") {
    await gateCommand(options);
    return;
  }

  if (command === "verify") {
    verifyCommand(options);
    return;
  }

  if (command === "approval") {
    approvalCommand(options);
    return;
  }

  if (command === "approve") {
    approveCommand(options);
    return;
  }

  if (command === "ci") {
    await ciCommand(options);
    return;
  }

  if (command === "init-ci") {
    initCiCommand(options);
    return;
  }

  if (command === "policy") {
    policyCommand(args, options);
    return;
  }

  if (command === "repair") {
    await repairCommand(options);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Ripple CLI error: ${message}`);
  process.exitCode = 1;
});
