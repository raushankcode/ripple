import * as path from "path";
import {
  AgentWorkflowSummary,
  ChangeIntent,
  ControlMode,
  ContextPlanSummary,
  FileBlastRadiusSummary,
  FileFocusSummary,
  GraphEngine,
  IntentDriftRepairPlan,
  RippleApprovalGate,
  RippleApprovalStatus,
  RippleAuditMode,
  RippleAuditSummary,
  RippleGateSummary,
  RipplePolicyExplanation,
  RecentHistorySummary,
  RippleReadinessSummary,
  StagedCheckSummary,
  StagedCheckWithIntentSummary,
  buildChangeIntent,
  buildChangeIntentReadinessSnapshot,
  buildIntentDriftRepairPlan,
  buildRippleAuditSummary,
  buildRippleGateSummary,
  buildRippleReadinessSummary,
  buildStagedCheckSummary,
  getAgentWorkflowSummary,
  explainRipplePolicyForIntent,
  explainRipplePolicyForTarget,
  listGitChangedFiles,
  listGitStagedFiles,
  loadRipplePolicy,
  loadChangeIntent,
  resolveRippleApprovalStatus,
  resolveRipplePolicyForTarget,
  saveChangeIntent,
  validateStagedCheckAgainstIntent,
} from "@getripple/core";

// MCP exposes the same control-boundary contract as the CLI for agent runtimes.
export type RippleMcpToolName =
  | "ripple_doctor"
  | "ripple_check_changed"
  | "ripple_check_staged"
  | "ripple_audit_change"
  | "ripple_gate"
  | "ripple_get_approval_status"
  | "ripple_get_agent_workflow"
  | "ripple_repair_intent_drift"
  | "ripple_get_focus"
  | "ripple_get_blast_radius"
  | "ripple_explain_policy"
  | "ripple_plan_context"
  | "ripple_get_recent_changes";

export type RippleMcpToolDefinition = {
  name: RippleMcpToolName;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
};

export type RippleMcpToolHostOptions = {
  workspaceRoot: string;
};

export type RippleMcpToolCallArgs = Record<string, unknown>;

export type RippleMcpToolData =
  | AgentWorkflowSummary
  | RippleReadinessSummary
  | FileFocusSummary
  | FileBlastRadiusSummary
  | ContextPlanSummary
  | ContextPlanWithIntentSummary
  | RipplePolicyExplanation
  | ApprovalStatusWithIntentSummary
  | RippleAuditSummary
  | RippleGateSummary
  | IntentDriftRepairPlan
  | RecentHistorySummary
  | StagedCheckSummary
  | StagedCheckWithIntentSummary;

export type RippleMcpToolResult<T = RippleMcpToolData> = {
  tool: RippleMcpToolName;
  data: T;
};

type PlanContextArgs = {
  task?: string;
  filePath?: string;
  targetFile?: string;
  tokenBudget?: number;
  mode?: ControlMode;
  controlMode?: ControlMode;
  symbol?: string;
  allowedSymbols?: string[];
  saveIntent?: boolean;
  intentPath?: string;
};

const MCP_CONTROL_MODES: ControlMode[] = ["brainstorm", "function", "file", "task", "pr"];
const MCP_AUDIT_MODES: RippleAuditMode[] = ["staged", "changed"];
const MCP_APPROVAL_GATES: RippleApprovalGate[] = ["before-risky-edit", "before-merge"];

export type ContextPlanWithIntentSummary = ContextPlanSummary & {
  policyExplanation: RipplePolicyExplanation;
  changeIntent?: ChangeIntent;
  changeIntentPath?: string;
};

export type ApprovalStatusWithIntentSummary = RippleApprovalStatus & {
  intent: {
    id: string;
    task: string;
    targetFile: string;
    controlMode: ChangeIntent["controlMode"];
    humanGate: ChangeIntent["humanGate"];
    boundaryRisk: ChangeIntent["boundaryRisk"];
  };
};

export const RIPPLE_MCP_TOOLS: RippleMcpToolDefinition[] = [
  {
    name: "ripple_doctor",
    description:
      "Return Ripple readiness diagnostics for graph scanning, git, CI workflow, and latest change intent.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "ripple_check_changed",
    description:
      "Return Ripple's changed-file safety check for JS/TS changes against a base git ref.",
    inputSchema: {
      type: "object",
      properties: {
        baseRef: {
          type: "string",
          description: "Git base ref to diff against, for example HEAD or origin/main.",
        },
        tokenBudget: {
          type: "number",
          description: "Maximum context token budget per changed file.",
        },
        intentPath: {
          type: "string",
          description: "Optional saved Ripple change intent path, id, or latest.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ripple_check_staged",
    description: "Return Ripple's staged-file safety check for currently staged JS/TS changes.",
    inputSchema: {
      type: "object",
      properties: {
        tokenBudget: {
          type: "number",
          description: "Maximum context token budget per staged file.",
        },
        intentPath: {
          type: "string",
          description: "Optional saved Ripple change intent path, id, or latest.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ripple_audit_change",
    description:
      "Return one compact audit report: saved intent, current policy, drift check, repair plan, and final decision.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: MCP_AUDIT_MODES,
          description: "Audit staged files by default, or changed files against baseRef.",
        },
        baseRef: {
          type: "string",
          description: "Git base ref for mode=changed, for example HEAD or origin/main.",
        },
        tokenBudget: {
          type: "number",
          description: "Maximum context token budget per audited file.",
        },
        intentPath: {
          type: "string",
          description: "Saved Ripple change intent path, id, or latest. Defaults to latest.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ripple_gate",
    description:
      "Return the compact continue/stop gate decision for a saved Ripple intent without the full audit report.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: MCP_AUDIT_MODES,
          description: "Gate staged files by default, or changed files against baseRef.",
        },
        baseRef: {
          type: "string",
          description: "Git base ref for mode=changed, for example HEAD or origin/main.",
        },
        tokenBudget: {
          type: "number",
          description: "Maximum context token budget per gated file.",
        },
        intentPath: {
          type: "string",
          description: "Saved Ripple change intent path, id, or latest. Defaults to latest.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ripple_get_approval_status",
    description:
      "Return whether the saved Ripple change intent has a valid, missing, stale, or not-required human approval record.",
    inputSchema: {
      type: "object",
      properties: {
        intentPath: {
          type: "string",
          description: "Saved Ripple change intent path, id, or latest. Defaults to latest.",
        },
        gate: {
          type: "string",
          enum: MCP_APPROVAL_GATES,
          description: "Optional approval gate override.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ripple_repair_intent_drift",
    description:
      "Return a concrete repair plan for staged changes that drifted from a saved Ripple change intent.",
    inputSchema: {
      type: "object",
      properties: {
        tokenBudget: {
          type: "number",
          description: "Maximum context token budget per staged file.",
        },
        intentPath: {
          type: "string",
          description: "Saved Ripple change intent path, id, or latest.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ripple_get_agent_workflow",
    description: "Return the Ripple agent workflow protocol and command/output contracts.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "ripple_get_focus",
    description: "Return focused architectural context for one target file.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Project-relative or absolute path to a JS/TS file.",
        },
      },
      required: ["filePath"],
      additionalProperties: false,
    },
  },
  {
    name: "ripple_get_blast_radius",
    description: "Return direct downstream files affected by changing one file.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Project-relative or absolute path to a JS/TS file.",
        },
      },
      required: ["filePath"],
      additionalProperties: false,
    },
  },
  {
    name: "ripple_explain_policy",
    description:
      "Return the repo trust-boundary policy that applies to one target file before an agent plans or edits.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Project-relative or absolute target file path.",
        },
        targetFile: {
          type: "string",
          description: "Alias for filePath.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ripple_plan_context",
    description:
      "Return a token-budgeted read plan for a task and target file, optionally saving an agent control boundary.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Short description of the coding task.",
        },
        filePath: {
          type: "string",
          description: "Project-relative or absolute target file path.",
        },
        targetFile: {
          type: "string",
          description: "Alias for filePath.",
        },
        tokenBudget: {
          type: "number",
          description: "Maximum context token budget.",
        },
        mode: {
          type: "string",
          enum: MCP_CONTROL_MODES,
          description: "Agent control boundary for the saved intent. Defaults to file.",
        },
        controlMode: {
          type: "string",
          enum: MCP_CONTROL_MODES,
          description: "Alias for mode.",
        },
        symbol: {
          type: "string",
          description: "Allowed symbol name for function mode.",
        },
        allowedSymbols: {
          type: "array",
          items: { type: "string" },
          description: "Allowed symbol ids or names for function mode.",
        },
        saveIntent: {
          type: "boolean",
          description: "When true, save a Ripple change intent for later staged-check validation.",
        },
        intentPath: {
          type: "string",
          description: "Optional path or id for the saved change intent. Defaults to latest.",
        },
      },
      required: ["task"],
      additionalProperties: false,
    },
  },
  {
    name: "ripple_get_recent_changes",
    description: "Return recent Ripple history groups for this workspace.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of history groups to return.",
        },
      },
      additionalProperties: false,
    },
  },
];

export class RippleMcpToolHost {
  private readonly workspaceRoot: string;
  private readonly engine: GraphEngine;
  private scanned = false;

  constructor(options: RippleMcpToolHostOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.engine = new GraphEngine(this.workspaceRoot);
  }

  listTools(): RippleMcpToolDefinition[] {
    return RIPPLE_MCP_TOOLS;
  }

  async initialize(): Promise<void> {
    if (this.scanned) {
      return;
    }
    await runWithQuietConsoleLog(() => this.engine.initialScan());
    this.scanned = true;
  }

  dispose(): void {
    this.engine.dispose();
  }

  async callTool(
    name: RippleMcpToolName,
    args: RippleMcpToolCallArgs = {}
  ): Promise<RippleMcpToolResult> {
    if (name === "ripple_get_agent_workflow") {
      return {
        tool: name,
        data: getAgentWorkflowSummary(),
      };
    }

    if (name === "ripple_explain_policy") {
      return {
        tool: name,
        data: this.explainPolicy(args),
      };
    }

    if (name === "ripple_get_approval_status") {
      return {
        tool: name,
        data: this.getApprovalStatus(args),
      };
    }

    await this.initialize();

    if (name === "ripple_get_focus") {
      return {
        tool: name,
        data: this.getFocus(args),
      };
    }

    if (name === "ripple_doctor") {
      return {
        tool: name,
        data: this.getReadiness(),
      };
    }

    if (name === "ripple_get_blast_radius") {
      return {
        tool: name,
        data: this.getBlastRadius(args),
      };
    }

    if (name === "ripple_plan_context") {
      return {
        tool: name,
        data: this.planContext(args),
      };
    }

    if (name === "ripple_check_staged") {
      return {
        tool: name,
        data: this.checkStaged(args),
      };
    }

    if (name === "ripple_check_changed") {
      return {
        tool: name,
        data: this.checkChanged(args),
      };
    }

    if (name === "ripple_audit_change") {
      return {
        tool: name,
        data: this.auditChange(args),
      };
    }

    if (name === "ripple_gate") {
      return {
        tool: name,
        data: this.gateChange(args),
      };
    }

    if (name === "ripple_repair_intent_drift") {
      return {
        tool: name,
        data: this.repairIntentDrift(args),
      };
    }

    if (name === "ripple_get_recent_changes") {
      return {
        tool: name,
        data: this.getRecentChanges(args),
      };
    }

    const exhaustiveCheck: never = name;
    throw new Error(`Unknown Ripple MCP tool: ${exhaustiveCheck}`);
  }

  private getFocus(args: RippleMcpToolCallArgs): FileFocusSummary {
    const filePath = requiredString(args, "filePath");
    const focus = this.engine.getFileFocusSummary(filePath);
    if (!focus) {
      throw new Error(`File is not in the Ripple graph: ${filePath}`);
    }
    return focus;
  }

  private getReadiness(): RippleReadinessSummary {
    return buildRippleReadinessSummary(this.workspaceRoot, this.engine);
  }

  private getBlastRadius(args: RippleMcpToolCallArgs): FileBlastRadiusSummary {
    const filePath = requiredString(args, "filePath");
    const blastRadius = this.engine.getBlastRadiusSummary(filePath);
    if (!blastRadius) {
      throw new Error(`File is not in the Ripple graph: ${filePath}`);
    }
    return blastRadius;
  }

  private explainPolicy(args: RippleMcpToolCallArgs): RipplePolicyExplanation {
    const filePath = optionalString(args, "filePath") ?? optionalString(args, "targetFile");
    if (!filePath) {
      throw new Error("ripple_explain_policy requires filePath or targetFile.");
    }
    return explainRipplePolicyForTarget(
      loadRipplePolicy(this.workspaceRoot),
      normalizeProjectPath(filePath)
    );
  }

  private planContext(args: RippleMcpToolCallArgs): ContextPlanWithIntentSummary {
    const parsed = parsePlanContextArgs(args);
    const targetFile = parsed.filePath ?? parsed.targetFile;
    if (!targetFile) {
      throw new Error("ripple_plan_context requires filePath or targetFile.");
    }

    const plan = this.engine.planContext(
      parsed.task ?? "",
      targetFile,
      parsed.tokenBudget
    );
    if (!plan) {
      throw new Error(`File is not in the Ripple graph: ${targetFile}`);
    }
    const loadedPolicy = loadRipplePolicy(this.workspaceRoot);
    const policyExplanation = explainRipplePolicyForTarget(loadedPolicy, plan.targetFile, {
      controlMode: parsed.controlMode ?? parsed.mode,
    });
    if (!parsed.saveIntent) {
      return {
        ...plan,
        policyExplanation,
      };
    }

    const policy = resolveRipplePolicyForTarget(loadedPolicy, plan.targetFile);
    const changeIntent = buildChangeIntent(plan, {
      controlMode: parsed.controlMode ?? parsed.mode,
      allowedSymbols: uniqueItems([
        ...(parsed.allowedSymbols ?? []),
        ...(parsed.symbol ? [parsed.symbol] : []),
      ]),
      policy,
      policyExplanation,
    });
    const savedPath = saveChangeIntent(this.workspaceRoot, changeIntent, parsed.intentPath);
    const readiness = buildRippleReadinessSummary(this.workspaceRoot, this.engine);
    changeIntent.readinessSnapshot = buildChangeIntentReadinessSnapshot(readiness);
    saveChangeIntent(this.workspaceRoot, changeIntent, savedPath);
    return {
      ...plan,
      policyExplanation,
      changeIntent,
      changeIntentPath: formatWorkspacePath(this.workspaceRoot, savedPath),
    };
  }

  private getRecentChanges(args: RippleMcpToolCallArgs): RecentHistorySummary {
    return this.engine.getRecentHistorySummary(optionalPositiveInteger(args, "limit", 10));
  }

  private getApprovalStatus(args: RippleMcpToolCallArgs): ApprovalStatusWithIntentSummary {
    const intentPath = optionalString(args, "intentPath") ?? "latest";
    const intent = loadChangeIntent(this.workspaceRoot, intentPath);
    return approvalStatusWithIntent(
      intent,
      resolveRippleApprovalStatus(
        this.workspaceRoot,
        intent,
        optionalApprovalGate(args, "gate")
      )
    );
  }

  private checkStaged(args: RippleMcpToolCallArgs): StagedCheckWithIntentSummary {
    const stagedSummary = buildStagedCheckSummary(this.engine, {
      workspaceRoot: this.workspaceRoot,
      stagedFiles: listGitStagedFiles(this.workspaceRoot),
      tokenBudget: optionalPositiveInteger(args, "tokenBudget", 4000),
    });
    const intentPath = optionalString(args, "intentPath");
    if (!intentPath) {
      return stagedSummary;
    }
    const intent = loadChangeIntent(this.workspaceRoot, intentPath);
    return validateStagedCheckAgainstIntent(
      stagedSummary,
      intent,
      {
        currentPolicyExplanation: this.currentPolicyExplanationForIntent(intent),
        currentReadinessSnapshot: this.currentReadinessSnapshot(),
      }
    );
  }

  private checkChanged(args: RippleMcpToolCallArgs): StagedCheckWithIntentSummary {
    const baseRef = optionalString(args, "baseRef") ?? "HEAD";
    const changedSummary = buildStagedCheckSummary(this.engine, {
      workspaceRoot: this.workspaceRoot,
      stagedFiles: listGitChangedFiles(this.workspaceRoot, baseRef),
      mode: "changed",
      baseRef,
      tokenBudget: optionalPositiveInteger(args, "tokenBudget", 4000),
    });
    const intentPath = optionalString(args, "intentPath");
    if (!intentPath) {
      return changedSummary;
    }
    const intent = loadChangeIntent(this.workspaceRoot, intentPath);
    return validateStagedCheckAgainstIntent(
      changedSummary,
      intent,
      {
        currentPolicyExplanation: this.currentPolicyExplanationForIntent(intent),
        currentReadinessSnapshot: this.currentReadinessSnapshot(),
      }
    );
  }

  private auditChange(args: RippleMcpToolCallArgs): RippleAuditSummary {
    const mode = optionalAuditMode(args, "mode") ?? "staged";
    const baseRef = optionalString(args, "baseRef") ?? "HEAD";
    const intentPath = optionalString(args, "intentPath") ?? "latest";
    const intent = loadChangeIntent(this.workspaceRoot, intentPath);
    const currentPolicyExplanation = this.currentPolicyExplanationForIntent(intent);
    const stagedCheck = buildStagedCheckSummary(this.engine, {
      workspaceRoot: this.workspaceRoot,
      stagedFiles: mode === "changed"
        ? listGitChangedFiles(this.workspaceRoot, baseRef)
        : listGitStagedFiles(this.workspaceRoot),
      mode,
      baseRef: mode === "changed" ? baseRef : undefined,
      tokenBudget: optionalPositiveInteger(args, "tokenBudget", 4000),
    });
    const validatedCheck = validateStagedCheckAgainstIntent(stagedCheck, intent, {
      currentPolicyExplanation,
      currentReadinessSnapshot: this.currentReadinessSnapshot(),
    });
    const repairPlan = buildIntentDriftRepairPlan(validatedCheck);
    return buildRippleAuditSummary({
      workspaceRoot: this.workspaceRoot,
      mode,
      baseRef: mode === "changed" ? baseRef : undefined,
      stagedCheck: validatedCheck,
      repairPlan,
      intent,
      currentPolicyExplanation,
    });
  }

  private gateChange(args: RippleMcpToolCallArgs): RippleGateSummary {
    return buildRippleGateSummary(this.auditChange(args));
  }

  private repairIntentDrift(args: RippleMcpToolCallArgs): IntentDriftRepairPlan {
    const intentPath = optionalString(args, "intentPath") ?? "latest";
    const stagedSummary = this.checkStaged({
      tokenBudget: optionalPositiveInteger(args, "tokenBudget", 4000),
      intentPath,
    });
    return buildIntentDriftRepairPlan(stagedSummary);
  }

  private currentPolicyExplanationForIntent(intent: ChangeIntent): RipplePolicyExplanation {
    return explainRipplePolicyForIntent(loadRipplePolicy(this.workspaceRoot), intent);
  }

  private currentReadinessSnapshot(): ChangeIntent["readinessSnapshot"] {
    return buildChangeIntentReadinessSnapshot(
      buildRippleReadinessSummary(this.workspaceRoot, this.engine)
    );
  }
}

export function createRippleMcpToolHost(
  options: RippleMcpToolHostOptions
): RippleMcpToolHost {
  return new RippleMcpToolHost(options);
}

function requiredString(args: RippleMcpToolCallArgs, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(args: RippleMcpToolCallArgs, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }
  return value;
}

function optionalControlMode(args: RippleMcpToolCallArgs, key: string): ControlMode | undefined {
  const value = optionalString(args, key);
  if (value === undefined) {
    return undefined;
  }
  if (MCP_CONTROL_MODES.includes(value as ControlMode)) {
    return value as ControlMode;
  }
  throw new Error(`${key} must be one of: ${MCP_CONTROL_MODES.join(", ")}.`);
}

function optionalAuditMode(
  args: RippleMcpToolCallArgs,
  key: string
): RippleAuditMode | undefined {
  const value = optionalString(args, key);
  if (value === undefined) {
    return undefined;
  }
  if (MCP_AUDIT_MODES.includes(value as RippleAuditMode)) {
    return value as RippleAuditMode;
  }
  throw new Error(`${key} must be one of: ${MCP_AUDIT_MODES.join(", ")}.`);
}

function optionalApprovalGate(
  args: RippleMcpToolCallArgs,
  key: string
): RippleApprovalGate | undefined {
  const value = optionalString(args, key);
  if (value === undefined) {
    return undefined;
  }
  if (MCP_APPROVAL_GATES.includes(value as RippleApprovalGate)) {
    return value as RippleApprovalGate;
  }
  throw new Error(`${key} must be one of: ${MCP_APPROVAL_GATES.join(", ")}.`);
}

function optionalStringArray(args: RippleMcpToolCallArgs, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${key} must be an array of strings.`);
  }
  return value;
}

function optionalPositiveInteger(
  args: RippleMcpToolCallArgs,
  key: string,
  fallback: number
): number {
  const value = args[key];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return value;
}

function optionalBoolean(
  args: RippleMcpToolCallArgs,
  key: string,
  fallback: boolean
): boolean {
  const value = args[key];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean.`);
  }
  return value;
}

function parsePlanContextArgs(args: RippleMcpToolCallArgs): PlanContextArgs {
  return {
    task: optionalString(args, "task"),
    filePath: optionalString(args, "filePath"),
    targetFile: optionalString(args, "targetFile"),
    tokenBudget: optionalPositiveInteger(args, "tokenBudget", 4000),
    mode: optionalControlMode(args, "mode"),
    controlMode: optionalControlMode(args, "controlMode"),
    symbol: optionalString(args, "symbol"),
    allowedSymbols: optionalStringArray(args, "allowedSymbols"),
    saveIntent: optionalBoolean(args, "saveIntent", false),
    intentPath: optionalString(args, "intentPath"),
  };
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

function approvalStatusWithIntent(
  intent: ChangeIntent,
  status: RippleApprovalStatus
): ApprovalStatusWithIntentSummary {
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

function formatWorkspacePath(workspaceRoot: string, filePath: string): string {
  const relative = path.relative(workspaceRoot, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return filePath;
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

async function runWithQuietConsoleLog<T>(task: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalStdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write as unknown as typeof process.stdout.write;
  console.log = (...args: unknown[]) => {
    console.error(...args);
  };
  process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) => {
    return stderrWrite.apply(process.stderr, args);
  }) as typeof process.stdout.write;
  try {
    return await task();
  } finally {
    console.log = originalLog;
    process.stdout.write = originalStdoutWrite;
  }
}
