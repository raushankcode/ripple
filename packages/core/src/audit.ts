import type {
  ChangeIntent,
  ChangeIntentValidationSummary,
  ControlMode,
  IntentDriftRepairPlan,
  RippleAgentHandoffDecision,
  RippleAgentHandoffVerdict,
  StagedCheckWithIntentSummary,
} from "./change-intent";
import { buildAgentHandoffVerdict } from "./change-intent";
import { buildRippleRiskSummary, RippleRiskSummary } from "./risk";
import type { AgentRuntimeNextPhaseId } from "./agent-workflow";
import type { RipplePolicyExplanation } from "./policy";
import {
  RippleApprovalStatus,
  resolveRippleApprovalStatus,
} from "./approval";

export type RippleAuditMode = "staged" | "changed" | "worktree";
export type RippleAuditStatus = "pass" | "repair-required" | "human-review-required";
export type RippleAuditDecision = "continue" | "repair" | "human-review";
export type RippleGateStatus = "open" | "closed";

export type RippleAuditSummary = {
  protocol: "ripple-audit";
  version: 1;
  workspace: string;
  mode: RippleAuditMode;
  baseRef?: string;
  status: RippleAuditStatus;
  decision: RippleAuditDecision;
  canProceed: boolean;
  nextRequiredPhase: AgentRuntimeNextPhaseId;
  nextRequiredAction: string;
  recommendedAction: string;
  intent: {
    id: string;
    task: string;
    targetFile: string;
    controlMode: ControlMode;
    humanGate: ChangeIntent["humanGate"];
    boundaryRisk: ChangeIntent["boundaryRisk"];
  };
  savedPolicyExplanation: RipplePolicyExplanation;
  currentPolicyExplanation?: RipplePolicyExplanation;
  approvalStatus: RippleApprovalStatus;
  stagedCheck: StagedCheckWithIntentSummary;
  repairPlan: IntentDriftRepairPlan;
  blockingReasons: string[];
  nextSteps: string[];
  changedFiles: string[];
  verificationTargets: string[];
  risk: RippleRiskSummary;
  handoff: RippleAgentHandoffVerdict;
};

export type RippleGateSummary = {
  protocol: "ripple-gate";
  version: 1;
  workspace: string;
  mode: RippleAuditMode;
  baseRef?: string;
  status: RippleGateStatus;
  decision: RippleAgentHandoffVerdict["decision"];
  canContinue: boolean;
  mustStop: boolean;
  needsHuman: boolean;
  nextRequiredPhase: RippleAgentHandoffVerdict["nextRequiredPhase"];
  nextRequiredAction: string;
  summary: string;
  intent: RippleAuditSummary["intent"];
  auditStatus: RippleAuditStatus;
  auditDecision: RippleAuditDecision;
  approvalStatus: RippleApprovalStatus["status"];
  allowedFiles: string[];
  allowedSymbols: string[];
  changedOutsideBoundaryFiles: string[];
  changedOutsideBoundarySymbols: string[];
  changedFiles: string[];
  verificationTargets: string[];
  why: string[];
  fixNow: string[];
  askHuman: string[];
  commands: RippleAgentHandoffVerdict["commands"];
  risk: RippleRiskSummary;
};

export function buildRippleAuditSummary(input: {
  workspaceRoot: string;
  mode: RippleAuditMode;
  baseRef?: string;
  stagedCheck: StagedCheckWithIntentSummary;
  repairPlan: IntentDriftRepairPlan;
  intent: ChangeIntent;
  currentPolicyExplanation: RipplePolicyExplanation;
  approvalStatus?: RippleApprovalStatus;
}): RippleAuditSummary {
  const validation = input.stagedCheck.intentValidation;
  if (!validation) {
    throw new Error("Audit requires a validated saved intent.");
  }

  const approvalStatus = input.approvalStatus ??
    resolveRippleApprovalStatus(input.workspaceRoot, input.intent);
  const status = rippleAuditStatus(validation, input.repairPlan, approvalStatus);
  const decision = rippleAuditDecision(status);
  const nextRequiredPhase = rippleAuditNextRequiredPhase(
    validation,
    input.repairPlan,
    status,
    approvalStatus
  );
  const blockingReasons = approvalStatus.required && !approvalStatus.approved
    ? uniqueItems([...validation.blockingReasons, approvalStatus.summary])
    : validation.blockingReasons;
  const nextSteps = uniqueItems([
    ...(approvalStatus.required && !approvalStatus.approved ? approvalStatus.nextSteps : []),
    ...validation.nextSteps,
  ]);
  const canProceed = status === "pass";
  const nextRequiredAction = rippleAuditNextRequiredAction(nextRequiredPhase);
  const recommendedAction = rippleAuditRecommendedAction(
    validation,
    input.repairPlan,
    status,
    approvalStatus
  );
  const audit: Omit<RippleAuditSummary, "handoff"> = {
    protocol: "ripple-audit",
    version: 1,
    workspace: input.workspaceRoot,
    mode: input.mode,
    baseRef: input.baseRef,
    status,
    decision,
    canProceed,
    nextRequiredPhase,
    nextRequiredAction,
    recommendedAction,
    intent: {
      id: input.intent.id,
      task: input.intent.task,
      targetFile: input.intent.targetFile,
      controlMode: input.intent.controlMode,
      humanGate: input.intent.humanGate,
      boundaryRisk: input.intent.boundaryRisk,
    },
    savedPolicyExplanation: input.intent.policyExplanation,
    currentPolicyExplanation: input.currentPolicyExplanation,
    approvalStatus,
    stagedCheck: input.stagedCheck,
    repairPlan: input.repairPlan,
    blockingReasons,
    nextSteps,
    changedFiles: input.stagedCheck.files.map((file) => file.file),
    verificationTargets: input.repairPlan.verificationTargets,
    risk: buildRippleRiskSummary({
      boundaryRisk: input.intent.boundaryRisk,
      allowedFiles: validation.editableFiles,
      allowedSymbols: validation.allowedSymbols,
      changedFiles: input.stagedCheck.files.map((file) => file.file),
      changedOutsideBoundaryFiles: validation.boundaryVerdict.changedOutsideBoundaryFiles,
      changedOutsideBoundarySymbols: validation.boundaryVerdict.changedOutsideBoundarySymbols,
      unplannedFiles: validation.unplannedFiles,
      unplannedSymbols: validation.unplannedSymbols,
      verificationTargets: input.repairPlan.verificationTargets,
      nextSteps,
      stagedFiles: input.stagedCheck.files,
    }),
  };
  return {
    ...audit,
    handoff: buildAuditHandoff(audit),
  };
}

export function buildRippleGateSummary(audit: RippleAuditSummary): RippleGateSummary {
  const handoff = audit.handoff;
  const validation = audit.stagedCheck.intentValidation;
  return {
    protocol: "ripple-gate",
    version: 1,
    workspace: audit.workspace,
    mode: audit.mode,
    baseRef: audit.baseRef,
    status: handoff.canContinue ? "open" : "closed",
    decision: handoff.decision,
    canContinue: handoff.canContinue,
    mustStop: handoff.mustStop,
    needsHuman: handoff.needsHuman,
    nextRequiredPhase: handoff.nextRequiredPhase,
    nextRequiredAction: handoff.nextRequiredAction,
    summary: handoff.summary,
    intent: audit.intent,
    auditStatus: audit.status,
    auditDecision: audit.decision,
    approvalStatus: audit.approvalStatus.status,
    allowedFiles: validation?.editableFiles ?? [],
    allowedSymbols: validation?.allowedSymbols ?? [],
    changedOutsideBoundaryFiles:
      validation?.boundaryVerdict.changedOutsideBoundaryFiles ?? [],
    changedOutsideBoundarySymbols:
      validation?.boundaryVerdict.changedOutsideBoundarySymbols ?? [],
    changedFiles: audit.changedFiles,
    verificationTargets: audit.verificationTargets,
    why: handoff.why,
    fixNow: handoff.fixNow,
    askHuman: handoff.askHuman,
    commands: handoff.commands,
    risk: audit.risk,
  };
}

function buildAuditHandoff(
  audit: Omit<RippleAuditSummary, "handoff">
): RippleAgentHandoffVerdict {
  const validation = audit.stagedCheck.intentValidation;
  if (!validation) {
    throw new Error("Audit handoff requires a validated saved intent.");
  }

  const needsHuman =
    audit.status === "human-review-required" ||
    (audit.approvalStatus.required && !audit.approvalStatus.approved);

  return buildAgentHandoffVerdict({
    source: "audit",
    canContinue: audit.canProceed,
    needsHuman,
    decision: auditHandoffDecision(audit, needsHuman),
    nextRequiredPhase: audit.nextRequiredPhase,
    nextRequiredAction: audit.nextRequiredAction,
    summary: audit.recommendedAction,
    why: audit.blockingReasons.length > 0
      ? audit.blockingReasons
      : validation.driftVerdict.why,
    fixNow: auditHandoffFixNow(audit),
    askHuman: auditHandoffAskHuman(audit),
    commands: {
      doctor: validation.readinessDrift.status === "weakened"
        ? ["ripple doctor --agent --strict"]
        : [],
      plan: audit.repairPlan.commands.replan,
      check: audit.canProceed ? [] : ["ripple check --staged --agent --intent latest"],
      audit: audit.canProceed ? [] : ["ripple audit --agent --intent latest"],
      repair: audit.canProceed ? [] : ["ripple repair --agent --intent latest"],
      approve: audit.approvalStatus.required && !audit.approvalStatus.approved
        ? [
            "ripple approval --intent latest --agent",
            `ripple approve --intent latest --gate ${approvalGateForAudit(audit.intent.humanGate)}`,
          ]
        : [],
      unstage: audit.repairPlan.commands.unstage,
      verify: audit.verificationTargets,
    },
  });
}

function auditHandoffDecision(
  audit: Omit<RippleAuditSummary, "handoff">,
  needsHuman: boolean
): RippleAgentHandoffDecision {
  const validation = audit.stagedCheck.intentValidation;
  if (validation?.readinessDrift.status === "weakened") {
    return "restore-readiness";
  }
  if (audit.canProceed) {
    return "continue";
  }
  if (needsHuman) {
    return "human-review";
  }
  return "repair";
}

function auditHandoffFixNow(audit: Omit<RippleAuditSummary, "handoff">): string[] {
  if (audit.canProceed) {
    return audit.verificationTargets.length > 0
      ? audit.verificationTargets.map((target) => `Verify before handoff: ${target}`)
      : audit.nextSteps;
  }
  return uniqueItems([
    ...audit.repairPlan.handoff.fixNow,
    ...audit.nextSteps,
  ]);
}

function auditHandoffAskHuman(audit: Omit<RippleAuditSummary, "handoff">): string[] {
  const askHuman: string[] = [];
  if (audit.approvalStatus.required && !audit.approvalStatus.approved) {
    askHuman.push(audit.approvalStatus.summary);
  }
  if (audit.status === "human-review-required") {
    askHuman.push(audit.recommendedAction);
  }
  const validation = audit.stagedCheck.intentValidation;
  if (validation?.readinessDrift.status === "weakened") {
    askHuman.push("Approve continuing only if weaker Ripple readiness is intentional.");
  }
  return askHuman;
}

function approvalGateForAudit(humanGate: ChangeIntent["humanGate"]): string {
  if (humanGate === "required-before-merge") {
    return "before-merge";
  }
  return "before-risky-edit";
}

export function rippleAuditStatus(
  validation: ChangeIntentValidationSummary,
  repairPlan: IntentDriftRepairPlan,
  approvalStatus: RippleApprovalStatus
): RippleAuditStatus {
  if (
    validation.policyDrift.status === "changed" ||
    validation.readinessDrift.status === "weakened" ||
    validation.boundaryVerdict.status === "danger" ||
    validation.driftVerdict.status === "danger" ||
    repairPlan.status === "human-review-required" ||
    repairPlan.status === "contract-review-required"
  ) {
    return "human-review-required";
  }

  if (validation.boundaryVerdict.humanRequired && !approvalStatus.approved) {
    return "human-review-required";
  }

  if (
    validation.driftVerdict.status === "pass" &&
    validation.boundaryVerdict.status === "pass" &&
    repairPlan.status === "no-repair-needed" &&
    (!validation.boundaryVerdict.humanRequired || approvalStatus.approved)
  ) {
    return "pass";
  }

  return "repair-required";
}

export function rippleAuditDecision(status: RippleAuditStatus): RippleAuditDecision {
  if (status === "pass") {
    return "continue";
  }
  if (status === "human-review-required") {
    return "human-review";
  }
  return "repair";
}

export function rippleAuditRecommendedAction(
  validation: ChangeIntentValidationSummary,
  repairPlan: IntentDriftRepairPlan,
  status: RippleAuditStatus,
  approvalStatus: RippleApprovalStatus
): string {
  if (validation.policyDrift.status === "changed") {
    return "Ask the human to review the current repo policy against the saved intent before continuing.";
  }
  if (validation.readinessDrift.status === "weakened") {
    return "Restore Ripple readiness or ask the human to approve continuing with weaker protection.";
  }
  if (status === "pass") {
    return "Proceed after running the listed verification targets.";
  }
  if (validation.boundaryVerdict.humanRequired && !approvalStatus.approved) {
    return "Record or verify human approval for the saved gate before continuing.";
  }
  return repairPlan.recommendedAction;
}

export function rippleAuditNextRequiredPhase(
  validation: ChangeIntentValidationSummary,
  repairPlan: IntentDriftRepairPlan,
  status: RippleAuditStatus,
  approvalStatus: RippleApprovalStatus
): AgentRuntimeNextPhaseId {
  if (status === "pass") {
    return "done";
  }
  if (
    validation.policyDrift.status === "changed" ||
    validation.readinessDrift.status === "weakened" ||
    validation.boundaryVerdict.status === "danger" ||
    validation.driftVerdict.status === "danger" ||
    repairPlan.status === "human-review-required" ||
    repairPlan.status === "contract-review-required"
  ) {
    return "repair_or_handoff";
  }
  if (approvalStatus.required && !approvalStatus.approved) {
    return "approval_gate";
  }
  return "repair_or_handoff";
}

export function rippleAuditNextRequiredAction(phase: AgentRuntimeNextPhaseId): string {
  if (phase === "done") {
    return "Run or report the verification targets, then hand off the passed Ripple audit.";
  }
  if (phase === "approval_gate") {
    return "Stop editing and ask the human to record approval with ripple approve before continuing.";
  }
  if (phase === "repair_or_handoff") {
    return "Run ripple repair --agent --intent latest and follow blocker actions, or ask the human to review.";
  }
  if (phase === "audit_after_change") {
    return "Run ripple audit --agent --intent latest before final handoff.";
  }
  if (phase === "plan_before_edit") {
    return "Create a saved Ripple plan before editing.";
  }
  if (phase === "edit_inside_boundary") {
    return "Continue editing only inside the saved Ripple boundary.";
  }
  return "Read ripple_get_agent_workflow or ripple agent --json before continuing.";
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
