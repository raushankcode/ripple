import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ContextPlanSummary } from "./graph";
import {
  StagedCheckChangedSymbol,
  StagedCheckAgentActions,
  StagedCheckSummary,
} from "./staged-check";
import type { AgentRuntimeNextPhaseId } from "./agent-workflow";
import type { RipplePolicyExplanation, RipplePolicyResolution } from "./policy";
import type { RippleEnforcementLevel, RippleReadinessSummary } from "./readiness";

// Change intents carry the agent control boundary used by post-edit drift checks.
export type ChangeIntent = {
  protocol: "ripple-change-intent";
  version: 1;
  id: string;
  createdAt: string;
  task: string;
  targetFile: string;
  risk: ContextPlanSummary["risk"];
  tokenBudget: number;
  controlMode: ControlMode;
  allowedSymbols: string[];
  humanGate: HumanGate;
  humanGateReason: string[];
  boundaryRisk: ControlBoundaryRisk;
  policySource: string;
  policyMatches: string[];
  policyExplanation: RipplePolicyExplanation;
  editableFiles: string[];
  contextFiles: string[];
  allowedFiles: string[];
  expectedFiles: string[];
  expectedSymbols: string[];
  protectedContracts: string[];
  verificationTargets: string[];
  verificationEvidence: RippleVerificationEvidence[];
  readinessSnapshot: ChangeIntentReadinessSnapshot;
  why: string;
  // Tamper-evidence fingerprint over the boundary-defining fields, stamped on
  // save and verified on load. It catches accidental corruption and naive
  // hand-editing of the saved boundary; it is not a defense against an agent
  // that can read this code and recompute it — that requires the server to be
  // authoritative over intents. See computeIntentFingerprint.
  integrity?: string;
};

export type RippleVerificationStatus = "passed" | "failed" | "skipped" | "unknown";

export type RippleVerificationEvidence = {
  command: string;
  status: RippleVerificationStatus;
  recordedAt: string;
  source: "reported" | "executed";
  changedFiles?: string[];
  changeMode?: StagedCheckSummary["mode"];
  changeFingerprint?: string;
  exitCode?: number;
  durationMs?: number;
  stdoutTail?: string;
  stderrTail?: string;
  note?: string;
};

export type VerificationVerdictStatus = "pass" | "failed" | "review" | "not-reported";
export type VerificationVerdictDecision = "continue" | "repair" | "human-review";

export type VerificationVerdictSummary = {
  status: VerificationVerdictStatus;
  decision: VerificationVerdictDecision;
  label: "PASS" | "FAILED" | "REVIEW" | "UNKNOWN";
  summary: string;
  why: string[];
  fix: string[];
  evidence: RippleVerificationEvidence[];
};

export type ChangeIntentReadinessSnapshot = {
  status: RippleReadinessSummary["status"];
  enforcementLevel: RippleEnforcementLevel;
  canGuideAgents: boolean;
  canDetectDrift: boolean;
  canBlockInCi: boolean;
  policyExplicit: boolean;
  graphOk: boolean;
  gitOk: boolean;
  gitIgnoreOk: boolean;
  ciWorkflowOk: boolean;
  latestIntentOk: boolean;
  gaps: string[];
  nextSteps: string[];
};

export type ChangeIntentVerdict = "matched" | "drifted" | "dangerous";
export type ChangeIntentScope = "matched" | "violated";
export type ControlMode = "brainstorm" | "function" | "file" | "task" | "pr";
export type HumanGate = "none" | "required-before-edit" | "required-before-merge";
export type ControlBoundaryRisk = "low" | "medium" | "high" | "critical";
export type DriftVerdictStatus = "pass" | "drift" | "danger" | "unknown";
export type DriftDecision =
  | "continue"
  | "fix-before-commit"
  | "stop-and-ask-human"
  | "create-intent-first";

export type DriftVerdictSummary = {
  status: DriftVerdictStatus;
  decision: DriftDecision;
  label: "PASS" | "DRIFT" | "DANGER" | "UNKNOWN";
  summary: string;
  why: string[];
  fix: string[];
};

export type PolicyDriftStatus = "unchecked" | "unchanged" | "changed";
export type PolicyDriftDecision =
  | "continue"
  | "compare-current-policy"
  | "review-current-policy";

export type PolicyDriftSummary = {
  status: PolicyDriftStatus;
  decision: PolicyDriftDecision;
  label: "UNKNOWN" | "PASS" | "DRIFT";
  summary: string;
  changedFields: string[];
  why: string[];
  fix: string[];
  currentPolicyExplanation?: RipplePolicyExplanation;
};

export type ReadinessDriftStatus = "unchecked" | "unchanged" | "weakened";
export type ReadinessDriftDecision =
  | "continue"
  | "compare-current-readiness"
  | "restore-readiness";

export type ReadinessDriftSummary = {
  status: ReadinessDriftStatus;
  decision: ReadinessDriftDecision;
  label: "UNKNOWN" | "PASS" | "DRIFT";
  summary: string;
  changedFields: string[];
  weakenedFields: string[];
  savedReadiness: ChangeIntentReadinessSnapshot;
  currentReadiness?: ChangeIntentReadinessSnapshot;
  why: string[];
  fix: string[];
};

export type RippleAgentHandoffSource = "check" | "repair" | "audit";
export type RippleAgentHandoffDecision =
  | "continue"
  | "audit"
  | "repair"
  | "human-review"
  | "restore-readiness"
  | "create-intent";

export type RippleAgentHandoffCommands = {
  doctor: string[];
  plan: string[];
  check: string[];
  audit: string[];
  repair: string[];
  approve: string[];
  unstage: string[];
  verify: string[];
};

export type RippleAgentHandoffVerdict = {
  protocol: "ripple-agent-handoff";
  version: 1;
  source: RippleAgentHandoffSource;
  canContinue: boolean;
  mustStop: boolean;
  needsHuman: boolean;
  decision: RippleAgentHandoffDecision;
  nextRequiredPhase: AgentRuntimeNextPhaseId;
  nextRequiredAction: string;
  summary: string;
  why: string[];
  fixNow: string[];
  askHuman: string[];
  commands: RippleAgentHandoffCommands;
};

export type RippleReviewPacket = {
  protocol: "ripple-review-packet";
  version: 1;
  intentId: string;
  originalTask: string;
  mode: StagedCheckSummary["mode"];
  declaredScope: {
    controlMode: ControlMode;
    targetFile: string;
    allowedFiles: string[];
    allowedSymbols: string[];
    humanGate: HumanGate;
    boundaryRisk: ControlBoundaryRisk;
  };
  actualChanges: {
    changedFiles: string[];
    changedSymbols: string[];
    contractRiskSymbols: string[];
    skippedFiles: string[];
    missingFiles: string[];
  };
  scopeFindings: {
    plannedFilesChanged: string[];
    contextFilesChanged: string[];
    outsideBoundaryFiles: string[];
    outsideBoundarySymbols: string[];
    protectedContractChanges: string[];
    unplannedContractChanges: string[];
  };
  verification: {
    expectedCommands: string[];
    testsRun: "unknown" | "reported" | "executed";
    status: VerificationVerdictStatus;
    decision: VerificationVerdictDecision;
    reportedCommands: string[];
    executedCommands: string[];
    evidence: RippleVerificationEvidence[];
    note: string;
  };
  decision: {
    canContinue: boolean;
    mustStop: boolean;
    needsHuman: boolean;
    verdict: ChangeIntentVerdict;
    nextRequiredAction: string;
    recommendedAction: string;
  };
  reviewerNotes: string[];
};

export type BoundaryVerdictStatus = "pass" | "drift" | "danger";
export type BoundaryDecision =
  | "continue"
  | "fix-before-commit"
  | "stop-and-ask-human";

export type BoundaryVerdictSummary = {
  status: BoundaryVerdictStatus;
  decision: BoundaryDecision;
  label: "PASS" | "DRIFT" | "DANGER";
  controlMode: ControlMode;
  humanRequired: boolean;
  humanGate: HumanGate;
  summary: string;
  why: string[];
  fix: string[];
  changedOutsideBoundaryFiles: string[];
  changedOutsideBoundarySymbols: string[];
};

export type ChangeIntentValidationSummary = {
  intentId: string;
  targetFile: string;
  task: string;
  verdict: ChangeIntentVerdict;
  driftVerdict: DriftVerdictSummary;
  boundaryVerdict: BoundaryVerdictSummary;
  controlMode: ControlMode;
  allowedFiles: string[];
  allowedSymbols: string[];
  humanGate: HumanGate;
  humanGateReason: string[];
  boundaryRisk: ControlBoundaryRisk;
  policyExplanation: RipplePolicyExplanation;
  policyDrift: PolicyDriftSummary;
  readinessDrift: ReadinessDriftSummary;
  verificationVerdict: VerificationVerdictSummary;
  plannedScope: ChangeIntentScope;
  editableFiles: string[];
  contextFiles: string[];
  plannedFilesChanged: string[];
  contextFilesChanged: string[];
  expectedSymbolsChanged: string[];
  unplannedFiles: string[];
  unplannedSymbols: string[];
  protectedContractChanges: string[];
  unplannedContractChanges: string[];
  reasons: string[];
  recommendedAction: string;
  nextRequiredPhase: AgentRuntimeNextPhaseId;
  nextRequiredAction: string;
  blockingReasons: string[];
  nextSteps: string[];
  requiresAttention: boolean;
  handoff: RippleAgentHandoffVerdict;
};

export type StagedCheckWithIntentSummary = StagedCheckSummary & {
  intentValidation?: ChangeIntentValidationSummary;
  reviewPacket?: RippleReviewPacket;
  nextRequiredPhase?: AgentRuntimeNextPhaseId;
  nextRequiredAction?: string;
};

export type IntentDriftRepairStatus =
  | "no-repair-needed"
  | "repair-required"
  | "human-review-required"
  | "contract-review-required"
  | "intent-required";

export type IntentDriftRepairActionType =
  | "proceed"
  | "unstage-file"
  | "review-symbol"
  | "review-contract"
  | "review-policy"
  | "review-readiness"
  | "replan"
  | "verify"
  | "create-intent";

export type IntentDriftRepairActionPriority = "blocker" | "required" | "recommended";

export type IntentDriftRepairAction = {
  type: IntentDriftRepairActionType;
  priority: IntentDriftRepairActionPriority;
  target?: string;
  command?: string;
  reason: string;
  instruction: string;
};

export type IntentDriftRepairPlan = {
  protocol: "ripple-intent-drift-repair";
  version: 1;
  intentId?: string;
  verdict: ChangeIntentVerdict | "missing-intent";
  driftVerdict: DriftVerdictSummary;
  boundaryVerdict?: BoundaryVerdictSummary;
  policyExplanation?: RipplePolicyExplanation;
  policyDrift?: PolicyDriftSummary;
  readinessDrift?: ReadinessDriftSummary;
  verificationVerdict?: VerificationVerdictSummary;
  status: IntentDriftRepairStatus;
  summary: string;
  recommendedAction: string;
  blockingReasons: string[];
  unstageFiles: string[];
  reviewContracts: string[];
  createNewIntent: boolean;
  verificationTargets: string[];
  fixActions: IntentDriftRepairAction[];
  agentActions: StagedCheckAgentActions;
  commands: {
    unstage: string[];
    replan: string[];
    verify: string[];
  };
  nextSteps: string[];
  handoff: RippleAgentHandoffVerdict;
};

const INTENT_PROTOCOL = "ripple-change-intent";
const INTENT_VERSION = 1;
const INTENTS_DIR = path.join(".ripple", "intents");
const LATEST_INTENT_FILE = "latest.json";
const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|py)$/i;

type RawChangeIntent = Omit<
  ChangeIntent,
  | "editableFiles"
  | "contextFiles"
  | "controlMode"
  | "allowedSymbols"
  | "humanGate"
  | "humanGateReason"
  | "boundaryRisk"
  | "policyExplanation"
  | "readinessSnapshot"
  | "verificationEvidence"
> & {
  editableFiles?: string[];
  contextFiles?: string[];
  controlMode?: ControlMode;
  allowedSymbols?: string[];
  humanGate?: HumanGate;
  humanGateReason?: string[];
  boundaryRisk?: ControlBoundaryRisk;
  policySource?: string;
  policyMatches?: string[];
  policyExplanation?: RipplePolicyExplanation;
  readinessSnapshot?: Partial<ChangeIntentReadinessSnapshot>;
  verificationEvidence?: RippleVerificationEvidence[];
};

export type BuildChangeIntentOptions = {
  controlMode?: ControlMode;
  allowedFiles?: string[];
  allowedSymbols?: string[];
  policy?: RipplePolicyResolution;
  policyExplanation?: RipplePolicyExplanation;
  readinessSnapshot?: ChangeIntentReadinessSnapshot;
};

export type ValidateChangeIntentOptions = {
  currentPolicyExplanation?: RipplePolicyExplanation;
  currentReadinessSnapshot?: ChangeIntentReadinessSnapshot;
};

export function buildChangeIntent(
  plan: ContextPlanSummary,
  options: BuildChangeIntentOptions = {}
): ChangeIntent {
  const controlMode = options.controlMode ?? options.policy?.defaultMode ?? "file";
  assertControlMode(controlMode);
  const editableFiles = editableFilesForControlMode(plan, controlMode, options);
  const contextFiles = uniqueItems([
    ...plan.readFirst.map((file) => file.file),
    ...plan.readIfNeeded.map((file) => file.file),
    ...plan.verificationTargets.filter(isSourceFilePath),
  ].filter((file) => !editableFiles.includes(file)));
  const allowedFiles = uniqueItems([...editableFiles, ...contextFiles]);
  const allowedSymbols = allowedSymbolsForControlMode(plan, controlMode, options);
  const expectedSymbols = uniqueItems(
    allowedSymbols.length > 0
      ? allowedSymbols
      : plan.symbolFocus
          .filter((symbol) => symbol.file === plan.targetFile || symbol.signals.includes("task-match"))
          .map((symbol) => symbol.symbol)
  );
  const protectedContracts = uniqueItems(
    plan.symbolFocus
      .filter((symbol) => symbol.callers > 0 || symbol.file === plan.targetFile)
      .map((symbol) => symbol.symbol)
  );
  const boundaryRisk = strongestBoundaryRisk(controlBoundaryRisk(plan), options.policy?.risk);
  const humanGate = humanGateForPlan(plan, controlMode, boundaryRisk, options.policy);
  const humanGateReason = humanGateReasons(plan, controlMode, boundaryRisk, options.policy);
  const policySource = policySourceLabel(options.policy);
  const policyMatches = options.policy?.matchedRules ?? [];
  const policyExplanation = normalizePolicyExplanationSnapshot(options.policyExplanation, {
    targetFile: plan.targetFile,
    controlMode,
    boundaryRisk,
    humanGate,
    policySource,
    policyMatches,
    policyRisk: options.policy?.risk ?? "none",
  });
  const createdAt = new Date().toISOString();

  return {
    protocol: INTENT_PROTOCOL,
    version: INTENT_VERSION,
    id: makeIntentId(plan, createdAt),
    createdAt,
    task: plan.task,
    targetFile: plan.targetFile,
    risk: plan.risk,
    tokenBudget: plan.tokenBudget,
    controlMode,
    allowedSymbols,
    humanGate,
    humanGateReason,
    boundaryRisk,
    policySource,
    policyMatches,
    policyExplanation,
    editableFiles,
    contextFiles,
    allowedFiles,
    expectedFiles: editableFiles,
    expectedSymbols,
    protectedContracts,
    verificationTargets: plan.verificationTargets,
    verificationEvidence: [],
    readinessSnapshot: options.readinessSnapshot ?? fallbackReadinessSnapshot(),
    why: plan.why,
  };
}

export function buildChangeIntentReadinessSnapshot(
  readiness: RippleReadinessSummary
): ChangeIntentReadinessSnapshot {
  return {
    status: readiness.status,
    enforcementLevel: readiness.enforcement.level,
    canGuideAgents: readiness.enforcement.canGuideAgents,
    canDetectDrift: readiness.enforcement.canDetectDrift,
    canBlockInCi: readiness.enforcement.canBlockInCi,
    policyExplicit: readiness.enforcement.explicitPolicy.ok,
    graphOk: readiness.checks.graph.ok,
    gitOk: readiness.checks.git.ok,
    gitIgnoreOk: readiness.checks.gitIgnore.ok,
    ciWorkflowOk: readiness.checks.ciWorkflow.ok,
    latestIntentOk: readiness.checks.latestIntent.ok,
    gaps: readiness.enforcement.gaps,
    nextSteps: readiness.nextSteps,
  };
}

export function buildAgentHandoffVerdict(input: {
  source: RippleAgentHandoffSource;
  canContinue: boolean;
  needsHuman: boolean;
  decision: RippleAgentHandoffDecision;
  nextRequiredPhase: AgentRuntimeNextPhaseId;
  nextRequiredAction: string;
  summary: string;
  why: string[];
  fixNow: string[];
  askHuman?: string[];
  commands?: Partial<RippleAgentHandoffCommands>;
  mustStop?: boolean;
}): RippleAgentHandoffVerdict {
  return {
    protocol: "ripple-agent-handoff",
    version: 1,
    source: input.source,
    canContinue: input.canContinue,
    mustStop: input.mustStop ?? !input.canContinue,
    needsHuman: input.needsHuman,
    decision: input.decision,
    nextRequiredPhase: input.nextRequiredPhase,
    nextRequiredAction: input.nextRequiredAction,
    summary: input.summary,
    why: uniqueItems(input.why),
    fixNow: uniqueItems(input.fixNow),
    askHuman: uniqueItems(input.askHuman ?? []),
    commands: {
      doctor: uniqueItems(input.commands?.doctor ?? []),
      plan: uniqueItems(input.commands?.plan ?? []),
      check: uniqueItems(input.commands?.check ?? []),
      audit: uniqueItems(input.commands?.audit ?? []),
      repair: uniqueItems(input.commands?.repair ?? []),
      approve: uniqueItems(input.commands?.approve ?? []),
      unstage: uniqueItems(input.commands?.unstage ?? []),
      verify: uniqueItems(input.commands?.verify ?? []),
    },
  };
}

export function buildVerificationCommandSuggestions(
  verificationVerdict: VerificationVerdictSummary
): string[] {
  if (
    verificationVerdict.status !== "failed" &&
    verificationVerdict.status !== "review"
  ) {
    return [];
  }

  const latestEvidence = latestVerificationEvidenceByCommand(verificationVerdict.evidence);
  const blockingEvidence = latestEvidence.filter((evidence) => evidence.status !== "passed");
  const evidenceToRerun = blockingEvidence.length > 0 ? blockingEvidence : latestEvidence;

  return evidenceToRerun
    .map((evidence) => `ripple verify --run ${quoteCliArgument(evidence.command)} --intent latest`);
}

function quoteCliArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function validateStagedCheckAgainstIntent(
  staged: StagedCheckSummary,
  intent: ChangeIntent,
  options: ValidateChangeIntentOptions = {}
): StagedCheckWithIntentSummary {
  const validation = buildIntentValidation(staged, intent, options);
  return {
    ...staged,
    requiresAttention: staged.requiresAttention || validation.requiresAttention,
    intentValidation: validation,
    reviewPacket: buildRippleReviewPacket(staged, intent, validation),
    nextRequiredPhase: validation.nextRequiredPhase,
    nextRequiredAction: validation.nextRequiredAction,
  };
}

export function buildRippleReviewPacket(
  staged: StagedCheckSummary,
  intent: ChangeIntent,
  validation: ChangeIntentValidationSummary
): RippleReviewPacket {
  const changedFiles = uniqueItems([
    ...staged.files.map((file) => file.file),
    ...staged.skippedFiles,
    ...staged.missingFiles,
  ]);
  const changedSymbols = uniqueItems(staged.changedSymbols.map((symbol) => symbol.symbol));
  const contractRiskSymbols = uniqueItems(staged.contractRisks.map((risk) => risk.symbol));
  const outsideBoundaryFiles = uniqueItems([
    ...validation.unplannedFiles,
    ...validation.boundaryVerdict.changedOutsideBoundaryFiles,
  ]);
  const outsideBoundarySymbols = uniqueItems([
    ...validation.unplannedSymbols,
    ...validation.boundaryVerdict.changedOutsideBoundarySymbols,
  ]);
  const verificationTargets = uniqueItems([
    ...intent.verificationTargets,
    ...staged.files.flatMap((file) => file.verificationTargets),
  ]);
  const mustStop = validation.handoff.mustStop;
  const verificationEvidence = normalizeVerificationEvidence(intent.verificationEvidence);
  const reportedVerificationCommands = verificationEvidence
    .filter((evidence) => evidence.source === "reported")
    .map((evidence) => evidence.command);
  const executedVerificationCommands = verificationEvidence
    .filter((evidence) => evidence.source === "executed")
    .map((evidence) => evidence.command);

  return {
    protocol: "ripple-review-packet",
    version: 1,
    intentId: intent.id,
    originalTask: intent.task,
    mode: staged.mode,
    declaredScope: {
      controlMode: intent.controlMode,
      targetFile: intent.targetFile,
      allowedFiles: validation.editableFiles,
      allowedSymbols: validation.allowedSymbols,
      humanGate: validation.humanGate,
      boundaryRisk: validation.boundaryRisk,
    },
    actualChanges: {
      changedFiles,
      changedSymbols,
      contractRiskSymbols,
      skippedFiles: staged.skippedFiles,
      missingFiles: staged.missingFiles,
    },
    scopeFindings: {
      plannedFilesChanged: validation.plannedFilesChanged,
      contextFilesChanged: validation.contextFilesChanged,
      outsideBoundaryFiles,
      outsideBoundarySymbols,
      protectedContractChanges: validation.protectedContractChanges,
      unplannedContractChanges: validation.unplannedContractChanges,
    },
    verification: {
      expectedCommands: verificationTargets,
      testsRun: verificationEvidence.length > 0
        ? executedVerificationCommands.length > 0
          ? "executed"
          : "reported"
        : "unknown",
      status: validation.verificationVerdict.status,
      decision: validation.verificationVerdict.decision,
      reportedCommands: reportedVerificationCommands,
      executedCommands: executedVerificationCommands,
      evidence: verificationEvidence,
      note: verificationEvidence.length > 0
        ? executedVerificationCommands.length > 0
          ? "Ripple executed at least one verification command and recorded its exit code."
          : "Ripple recorded reported verification evidence; it did not independently execute these commands."
        : verificationTargets.length > 0
        ? "Ripple found verification targets, but it cannot prove they were run from this packet alone."
        : "Ripple found no verification target; use the narrowest manual check before handoff.",
    },
    decision: {
      canContinue: validation.handoff.canContinue,
      mustStop,
      needsHuman: validation.handoff.needsHuman,
      verdict: validation.verdict,
      nextRequiredAction: validation.nextRequiredAction,
      recommendedAction: validation.recommendedAction,
    },
    reviewerNotes: buildReviewPacketNotes(validation, verificationTargets),
  };
}

export function buildIntentDriftRepairPlan(
  staged: StagedCheckWithIntentSummary
): IntentDriftRepairPlan {
  const validation = staged.intentValidation;
  const verificationTargets = uniqueItems(
    staged.files.flatMap((file) => file.verificationTargets)
  );

  if (!validation) {
    const missingIntentPlan: Omit<IntentDriftRepairPlan, "handoff"> = {
      protocol: "ripple-intent-drift-repair",
      version: 1,
      verdict: "missing-intent",
      driftVerdict: missingIntentDriftVerdict(),
      status: "intent-required",
      summary: "No saved change intent was provided, so Ripple cannot repair plan drift yet.",
      recommendedAction:
        "Run staged check with a saved intent before asking Ripple to repair drift.",
      blockingReasons: ["Missing intent validation"],
      unstageFiles: [],
      reviewContracts: [],
      createNewIntent: false,
      verificationTargets,
      fixActions: missingIntentRepairActions(),
      agentActions: staged.agentActions,
      commands: {
        unstage: [],
        replan: ["Run ripple_plan_context with saveIntent: true, then run ripple_check_staged with intentPath."],
        verify: verificationTargets,
      },
      nextSteps: [
        "Create or load a saved change intent.",
        "Run staged check against that intent.",
      ],
    };
    return {
      ...missingIntentPlan,
      handoff: buildRepairHandoff(missingIntentPlan),
    };
  }

  const reviewContracts = uniqueItems([
    ...validation.protectedContractChanges,
    ...validation.unplannedContractChanges,
  ]);
  const unstageFiles = validation.driftVerdict.status === "pass"
    ? []
    : uniqueItems([
        ...validation.unplannedFiles,
        ...validation.boundaryVerdict.changedOutsideBoundaryFiles,
      ]);
  const fixActions = buildRepairActions({
    validation,
    unstageFiles,
    reviewContracts,
    verificationTargets,
  });

  const repairPlan: Omit<IntentDriftRepairPlan, "handoff"> = {
    protocol: "ripple-intent-drift-repair",
    version: 1,
    intentId: validation.intentId,
    verdict: validation.verdict,
    driftVerdict: validation.driftVerdict,
    boundaryVerdict: validation.boundaryVerdict,
    policyExplanation: validation.policyExplanation,
    policyDrift: validation.policyDrift,
    readinessDrift: validation.readinessDrift,
    verificationVerdict: validation.verificationVerdict,
    status: repairStatus(validation),
    summary: repairSummary(validation),
    recommendedAction: validation.recommendedAction,
    blockingReasons: validation.blockingReasons,
    unstageFiles,
    reviewContracts,
    createNewIntent: validation.driftVerdict.status !== "pass",
    verificationTargets,
    fixActions,
    agentActions: staged.agentActions,
    commands: {
      unstage: unstageFiles.map((file) => `git restore --staged -- ${file}`),
      replan: validation.driftVerdict.status === "pass"
        ? []
        : ["Run ripple_plan_context with saveIntent: true for the broader intended scope."],
      verify: verificationTargets,
    },
    nextSteps: validation.nextSteps,
  };

  return {
    ...repairPlan,
    handoff: buildRepairHandoff(repairPlan),
  };
}

function missingIntentDriftVerdict(): DriftVerdictSummary {
  return {
    status: "unknown",
    decision: "create-intent-first",
    label: "UNKNOWN",
    summary: "UNKNOWN: no saved change intent is available, so Ripple cannot judge drift.",
    why: ["No saved change intent was provided for comparison."],
    fix: [
      "Run ripple plan --file <file> --task \"<task>\" --agent --save.",
      "Stage the intended files, then run ripple check --staged --agent --intent latest.",
    ],
  };
}

function missingIntentRepairActions(): IntentDriftRepairAction[] {
  return [
    {
      type: "create-intent",
      priority: "blocker",
      command: "ripple plan --file <file> --task \"<task>\" --agent --save",
      reason: "No saved change intent was available for drift comparison.",
      instruction:
        "Create a saved change intent before relying on Ripple to judge whether edits stayed in scope.",
    },
  ];
}

function buildRepairHandoff(
  plan: Omit<IntentDriftRepairPlan, "handoff">
): RippleAgentHandoffVerdict {
  const canContinue = plan.status === "no-repair-needed";
  const needsHuman =
    plan.status === "human-review-required" ||
    plan.status === "contract-review-required";
  const nextRequiredPhase = repairHandoffNextRequiredPhase(plan);
  const nextRequiredAction = repairHandoffNextRequiredAction(plan, nextRequiredPhase);

  return buildAgentHandoffVerdict({
    source: "repair",
    canContinue,
    needsHuman,
    decision: repairHandoffDecision(plan, canContinue, needsHuman),
    nextRequiredPhase,
    nextRequiredAction,
    summary: plan.summary,
    why: plan.blockingReasons.length > 0 ? plan.blockingReasons : plan.driftVerdict.why,
    fixNow: repairHandoffFixNow(plan),
    askHuman: repairHandoffAskHuman(plan),
    commands: {
      doctor: plan.readinessDrift?.status === "weakened"
        ? ["ripple doctor --agent --strict"]
        : [],
      plan: plan.commands.replan,
      check: plan.status === "intent-required"
        ? ["ripple check --staged --agent --intent latest"]
        : [],
      audit: canContinue ? ["ripple audit --agent --intent latest"] : [],
      repair: canContinue ? [] : ["ripple repair --agent --intent latest"],
      approve: plan.boundaryVerdict?.humanRequired
        ? [
            "ripple approval --intent latest --agent",
            `ripple approve --intent latest --gate ${approvalGateForHumanGate(plan.boundaryVerdict.humanGate)} --reason "<why this boundary is safe>"`,
          ]
        : [],
      unstage: plan.commands.unstage,
      verify: plan.commands.verify,
    },
  });
}

function repairHandoffDecision(
  plan: Omit<IntentDriftRepairPlan, "handoff">,
  canContinue: boolean,
  needsHuman: boolean
): RippleAgentHandoffDecision {
  if (plan.status === "intent-required") {
    return "create-intent";
  }
  if (plan.readinessDrift?.status === "weakened") {
    return "restore-readiness";
  }
  if (plan.verificationVerdict?.status === "review") {
    return "human-review";
  }
  if (plan.verificationVerdict?.status === "failed") {
    return "repair";
  }
  if (needsHuman) {
    return "human-review";
  }
  if (!canContinue) {
    return "repair";
  }
  return "audit";
}

function repairHandoffNextRequiredPhase(
  plan: Omit<IntentDriftRepairPlan, "handoff">
): AgentRuntimeNextPhaseId {
  if (plan.status === "intent-required") {
    return "plan_before_edit";
  }
  if (plan.status === "no-repair-needed") {
    return "audit_after_change";
  }
  return "repair_or_handoff";
}

function repairHandoffNextRequiredAction(
  plan: Omit<IntentDriftRepairPlan, "handoff">,
  phase: AgentRuntimeNextPhaseId
): string {
  if (phase === "plan_before_edit") {
    return "Create a saved Ripple plan, then run staged check against that intent.";
  }
  if (phase === "audit_after_change") {
    return "Run ripple audit --agent --intent latest before final handoff.";
  }
  if (plan.readinessDrift?.status === "weakened") {
    return "Restore Ripple readiness with the listed commands or ask the human before continuing.";
  }
  if (plan.verificationVerdict?.status === "failed") {
    return "Repair failed verification evidence, record a passing rerun, then run Ripple again.";
  }
  if (plan.verificationVerdict?.status === "review") {
    return "Ask the human to review incomplete verification evidence before continuing.";
  }
  if (plan.status === "human-review-required" || plan.status === "contract-review-required") {
    return "Ask the human to review the blockers before keeping this change.";
  }
  return "Apply the repair actions, then rerun ripple check --staged --agent --intent latest.";
}

function repairHandoffFixNow(plan: Omit<IntentDriftRepairPlan, "handoff">): string[] {
  if (plan.status === "no-repair-needed") {
    return plan.verificationTargets.length > 0
      ? plan.verificationTargets.map((target) => `Verify before handoff: ${target}`)
      : plan.nextSteps;
  }

  return uniqueItems([
    ...plan.fixActions
      .filter((action) => action.priority === "blocker" || action.priority === "required")
      .map((action) => action.instruction),
    ...plan.nextSteps,
  ]);
}

function repairHandoffAskHuman(plan: Omit<IntentDriftRepairPlan, "handoff">): string[] {
  const askHuman: string[] = [];
  if (plan.status === "human-review-required") {
    askHuman.push(plan.summary);
  }
  if (plan.status === "contract-review-required") {
    askHuman.push("Review protected or unplanned contract changes before keeping this change.");
  }
  if (plan.readinessDrift?.status === "weakened") {
    askHuman.push("Approve continuing only if weaker Ripple readiness is intentional.");
  }
  if (plan.verificationVerdict?.status === "review") {
    askHuman.push(plan.verificationVerdict.summary);
  }
  if (plan.boundaryVerdict?.humanRequired) {
    askHuman.push(
      `Human gate '${plan.boundaryVerdict.humanGate}' applies to this saved intent.`
    );
  }
  return askHuman;
}

function buildRepairActions(input: {
  validation: ChangeIntentValidationSummary;
  unstageFiles: string[];
  reviewContracts: string[];
  verificationTargets: string[];
}): IntentDriftRepairAction[] {
  const actions: IntentDriftRepairAction[] = [];

  if (
    input.validation.verificationVerdict.status === "failed" ||
    input.validation.verificationVerdict.status === "review"
  ) {
    input.validation.verificationVerdict.evidence
      .filter((evidence) => evidence.status !== "passed")
      .forEach((evidence) => {
        actions.push({
          type: "verify",
          priority: "blocker",
          target: evidence.command,
          command: evidence.command,
          reason: `Reported verification status was ${evidence.status}.`,
          instruction: verificationEvidenceFix(evidence),
        });
      });

    if (actions.length === 0) {
      input.validation.verificationVerdict.fix.forEach((instruction) => {
        actions.push({
          type: "verify",
          priority: "blocker",
          reason: input.validation.verificationVerdict.summary,
          instruction,
        });
      });
    }

    return uniqueRepairActions(actions);
  }

  if (input.validation.driftVerdict.status === "pass") {
    input.verificationTargets.slice(0, 8).forEach((target) => {
      actions.push({
        type: "verify",
        priority: "required",
        target,
        reason: "Staged changes match the saved intent; verification is the remaining handoff step.",
        instruction: `Run or inspect ${target} before handing off the change.`,
      });
    });

    if (actions.length === 0) {
      actions.push({
        type: "proceed",
        priority: "recommended",
        reason: "Staged changes match the saved intent and Ripple found no verification targets.",
        instruction:
          "Proceed only after doing the narrowest manual check that fits the changed file.",
      });
    }

    return actions;
  }
// Ripple readiness snapshot is saved with the intent.

  if (input.validation.policyDrift.status === "changed") {
    actions.push({
      type: "review-policy",
      priority: "blocker",
      target: input.validation.targetFile,
      command: `ripple policy explain --file ${input.validation.targetFile} --agent`,
      reason: "Current repo policy differs from the policy snapshot saved with this intent.",
      instruction:
        "Ask the human to review the current policy and create a new saved intent if the trust boundary should change.",
    });
  }

  if (input.validation.readinessDrift.status === "weakened") {
    actions.push({
      type: "review-readiness",
      priority: "blocker",
      target: input.validation.targetFile,
      command: "ripple doctor --agent --strict",
      reason: "Current Ripple readiness is weaker than the readiness snapshot saved with this intent.",
      instruction:
        "Restore the missing Ripple readiness layer or ask the human to approve continuing with weaker protection.",
    });
  }

  const contextOnlyFiles = new Set(input.validation.contextFilesChanged);
  input.unstageFiles.forEach((file) => {
    const isContextOnlyFile = contextOnlyFiles.has(file);
    actions.push({
      type: "unstage-file",
      priority: "blocker",
      target: file,
      command: `git restore --staged -- ${file}`,
      reason: isContextOnlyFile
        ? "This file was provided as read or verification context, not editable scope."
        : "This file is outside the saved change intent.",
      instruction:
        `Unstage ${file}, or create a new saved intent if editing this file is intentional.`,
    });
  });

  input.validation.unplannedSymbols.forEach((symbol) => {
    actions.push({
      type: "review-symbol",
      priority: "blocker",
      target: symbol,
      reason: "This symbol changed outside the expected symbol focus.",
      instruction:
        `Undo the accidental change to ${symbol}, or replan with a saved intent that includes it.`,
    });
  });

  input.validation.boundaryVerdict.changedOutsideBoundarySymbols.forEach((symbol) => {
    actions.push({
      type: "review-symbol",
      priority: "blocker",
      target: symbol,
      reason: "This symbol changed outside the selected agent control boundary.",
      instruction:
        `Undo the accidental change to ${symbol}, or ask the human to approve a wider boundary.`,
    });
  });

  input.reviewContracts.forEach((symbol) => {
    actions.push({
      type: "review-contract",
      priority: "blocker",
      target: symbol,
      reason: "A protected or unplanned contract changed.",
      instruction:
        `Inspect callers for ${symbol}; preserve its contract or create a broader saved intent before continuing.`,
    });
  });

  actions.push({
    type: "replan",
    priority: input.validation.driftVerdict.status === "danger" ? "blocker" : "required",
    command: `ripple plan --file ${input.validation.targetFile} --task "<updated task>" --mode ${input.validation.controlMode} --agent --save`,
    reason: "The staged change no longer matches the saved plan or selected control boundary.",
    instruction:
      "If the broader scope is intentional, create a new saved intent with the human-approved boundary and run the staged check again.",
  });

  input.verificationTargets.slice(0, 8).forEach((target) => {
    actions.push({
      type: "verify",
      priority: "recommended",
      target,
      reason: "Use after drift is repaired or explicitly replanned.",
      instruction: `Run or inspect ${target} after the staged scope matches intent.`,
    });
  });

  return uniqueRepairActions(actions);
}

function uniqueRepairActions(actions: IntentDriftRepairAction[]): IntentDriftRepairAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = [
      action.type,
      action.priority,
      action.target ?? "",
      action.command ?? "",
      action.instruction,
    ].join("\0");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Canonical serialization of the boundary-defining fields of an intent. This is
 * deliberately narrow: it excludes verificationEvidence (which legitimately
 * mutates via `ripple verify`) and the integrity field itself, so that
 * re-saving after recording evidence does not invalidate the fingerprint.
 */
function intentIntegrityPayload(source: {
  id?: unknown;
  createdAt?: unknown;
  controlMode?: unknown;
  targetFile?: unknown;
  humanGate?: unknown;
  boundaryRisk?: unknown;
  allowedSymbols?: unknown;
  allowedFiles?: unknown;
  editableFiles?: unknown;
  expectedFiles?: unknown;
  expectedSymbols?: unknown;
  protectedContracts?: unknown;
  contextFiles?: unknown;
}): string {
  return JSON.stringify({
    id: source.id ?? null,
    createdAt: source.createdAt ?? null,
    controlMode: source.controlMode ?? null,
    targetFile: source.targetFile ?? null,
    humanGate: source.humanGate ?? null,
    boundaryRisk: source.boundaryRisk ?? null,
    allowedSymbols: source.allowedSymbols ?? [],
    allowedFiles: source.allowedFiles ?? [],
    editableFiles: source.editableFiles ?? [],
    expectedFiles: source.expectedFiles ?? [],
    expectedSymbols: source.expectedSymbols ?? [],
    protectedContracts: source.protectedContracts ?? [],
    contextFiles: source.contextFiles ?? [],
  });
}

export function computeIntentFingerprint(source: Parameters<typeof intentIntegrityPayload>[0]): string {
  return crypto.createHash("sha256").update(intentIntegrityPayload(source)).digest("hex");
}

export function saveChangeIntent(
  workspaceRoot: string,
  intent: ChangeIntent,
  intentPath?: string
): string {
  const targetPath = intentPath
    ? resolveIntentPath(workspaceRoot, intentPath)
    : defaultChangeIntentPath(workspaceRoot);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const stamped: ChangeIntent = { ...intent, integrity: computeIntentFingerprint(intent) };
  fs.writeFileSync(targetPath, `${JSON.stringify(stamped, null, 2)}\n`, "utf8");
  return targetPath;
}

export function loadChangeIntent(
  workspaceRoot: string,
  intentPath: string = "latest"
): ChangeIntent {
  const targetPath = resolveIntentPath(workspaceRoot, intentPath);
  let raw: string;
  try {
    raw = fs.readFileSync(targetPath, "utf8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      throw new Error(
        `No active Ripple change intent found at ${targetPath}. Run ripple plan --file <file> --task "<task>" --agent --save before an agent edits.`
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(
      `Invalid Ripple change intent JSON at ${targetPath}. Ask the human to inspect or recreate the saved boundary before continuing. ${errorMessage(err)}`
    );
  }
  return assertChangeIntent(parsed, targetPath);
}

export function defaultChangeIntentPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, INTENTS_DIR, LATEST_INTENT_FILE);
}

function buildIntentValidation(
  staged: StagedCheckSummary,
  intent: ChangeIntent,
  options: ValidateChangeIntentOptions
): ChangeIntentValidationSummary {
  const editableFiles = changeIntentEditableFiles(intent);
  const contextFiles = changeIntentContextFiles(intent, editableFiles);
  const editableFileSet = new Set(editableFiles);
  const contextFileSet = new Set(contextFiles);
  const expectedSymbols = new Set(intent.expectedSymbols);
  const protectedContracts = new Set(intent.protectedContracts);
  const changedFiles = staged.files.map((file) => file.file);
  const changedSymbols = staged.changedSymbols.map((symbol) => symbol.symbol);
  const plannedFilesChanged = changedFiles.filter((file) => editableFileSet.has(file));
  const contextFilesChanged = changedFiles.filter((file) =>
    contextFileSet.has(file) && !editableFileSet.has(file)
  );
  const unplannedFiles = changedFiles.filter((file) => !editableFileSet.has(file));
  const expectedSymbolsChanged = changedSymbols.filter((symbol) => expectedSymbols.has(symbol));
  const unplannedSymbols = staged.changedSymbols
    .filter((symbol) => !expectedSymbols.has(symbol.symbol) && !editableFileSet.has(symbol.file))
    .map((symbol) => symbol.symbol);
  const protectedContractChanges = contractChangedSymbols(staged.changedSymbols)
    .filter((symbol) => protectedContracts.has(symbol.symbol))
    .map((symbol) => symbol.symbol);
  const unplannedContractChanges = contractChangedSymbols(staged.changedSymbols)
    .filter((symbol) => !protectedContracts.has(symbol.symbol))
    .map((symbol) => symbol.symbol);
  const reasons = validationReasons({
    unplannedFiles,
    contextFilesChanged,
    unplannedSymbols,
    protectedContractChanges,
    unplannedContractChanges,
  });
  const verdict = validationVerdict({
    unplannedFiles,
    unplannedSymbols,
    protectedContractChanges,
    unplannedContractChanges,
  });
  const guidance = validationGuidance({
    verdict,
    unplannedFiles,
    contextFilesChanged,
    unplannedSymbols,
    protectedContractChanges,
    unplannedContractChanges,
  });
  const verificationTargets = uniqueItems(
    staged.files.flatMap((file) => file.verificationTargets)
  );
  const boundaryVerdict = buildBoundaryVerdict({
    intent,
    editableFiles,
    changedFiles,
    changedSymbols: staged.changedSymbols,
  });
  const policyDrift = buildPolicyDriftSummary(
    intent.policyExplanation,
    options.currentPolicyExplanation
  );
  const readinessDrift = buildReadinessDriftSummary(
    intent.readinessSnapshot,
    options.currentReadinessSnapshot
  );
  const verificationVerdict = buildVerificationVerdict(
    intent.verificationEvidence,
    changedFiles,
    staged.changeFingerprint,
    staged.mode
  );
  const boundaryGuidance = mergeBoundaryGuidance(guidance, boundaryVerdict);
  const policyGuidance = mergePolicyDriftGuidance(boundaryGuidance, policyDrift);
  const readinessGuidance = mergeReadinessDriftGuidance(policyGuidance, readinessDrift);
  const effectiveGuidance = mergeVerificationGuidance(
    readinessGuidance,
    verificationVerdict
  );
  const driftVerdict = buildDriftVerdict({
    verdict,
    boundaryVerdict,
    policyDrift,
    readinessDrift,
    reasons,
    blockingReasons: effectiveGuidance.blockingReasons,
    nextSteps: effectiveGuidance.nextSteps,
    verificationTargets,
    contextFilesChanged,
    unplannedFiles,
    unplannedSymbols,
    protectedContractChanges,
    unplannedContractChanges,
  });
  const nextRequiredPhase = validationNextRequiredPhase({
    driftVerdict,
    boundaryVerdict,
    policyDrift,
    readinessDrift,
    verificationVerdict,
  });
  const nextRequiredAction = validationNextRequiredAction(nextRequiredPhase);

  const validation: Omit<ChangeIntentValidationSummary, "handoff"> = {
    intentId: intent.id,
    targetFile: intent.targetFile,
    task: intent.task,
    verdict,
    driftVerdict,
    boundaryVerdict,
    controlMode: intent.controlMode,
    allowedFiles: editableFiles,
    allowedSymbols: intent.allowedSymbols,
    humanGate: intent.humanGate,
    humanGateReason: intent.humanGateReason,
    boundaryRisk: intent.boundaryRisk,
    policyExplanation: intent.policyExplanation,
    policyDrift,
    readinessDrift,
    verificationVerdict,
    plannedScope: unplannedFiles.length === 0 ? "matched" : "violated",
    editableFiles,
    contextFiles,
    plannedFilesChanged,
    contextFilesChanged,
    expectedSymbolsChanged,
    unplannedFiles,
    unplannedSymbols,
    protectedContractChanges,
    unplannedContractChanges,
    reasons,
    recommendedAction: effectiveGuidance.recommendedAction,
    nextRequiredPhase,
    nextRequiredAction,
    blockingReasons: effectiveGuidance.blockingReasons,
    nextSteps: effectiveGuidance.nextSteps,
    requiresAttention:
      driftVerdict.status !== "pass" ||
      boundaryVerdict.humanRequired ||
      policyDrift.status === "changed" ||
      readinessDrift.status === "weakened" ||
      verificationVerdict.status === "failed" ||
      verificationVerdict.status === "review",
  };

  return {
    ...validation,
    handoff: buildValidationHandoff(validation),
  };
}

function buildReviewPacketNotes(
  validation: ChangeIntentValidationSummary,
  verificationTargets: string[]
): string[] {
  const notes: string[] = [];
  if (validation.boundaryVerdict.changedOutsideBoundaryFiles.length > 0) {
    notes.push("Patch scope crossed: review files outside the declared boundary before keeping this change.");
  }
  if (validation.boundaryVerdict.changedOutsideBoundarySymbols.length > 0) {
    notes.push("Function scope crossed: review changed symbols outside the declared function boundary.");
  }
  if (validation.contextFilesChanged.length > 0) {
    notes.push("Context-only files changed: approve a wider intent if those edits are valid.");
  }
  if (
    validation.protectedContractChanges.length > 0 ||
    validation.unplannedContractChanges.length > 0
  ) {
    notes.push("Behavior scope requires review: protected or unplanned contracts changed.");
  }
  if (validation.verificationVerdict.status === "failed") {
    notes.push("Verification failed: repair the failed reported check before handoff.");
  } else if (validation.verificationVerdict.status === "review") {
    notes.push("Verification incomplete: ask the human to review skipped or unknown reported evidence.");
  } else if (validation.verificationVerdict.status === "pass") {
    notes.push("Verification reported: all recorded verification evidence was reported as passed.");
  } else if (verificationTargets.length > 0) {
    notes.push("Verification evidence is required before handoff; this packet records expected checks, not proof that they ran.");
  } else {
    notes.push("No automated verification target was found; require a focused manual reviewer pass.");
  }
  if (validation.humanGate !== "none") {
    notes.push(`Human gate applies: ${validation.humanGate}.`);
  }
  return uniqueItems(notes);
}

function validationNextRequiredPhase(input: {
  driftVerdict: DriftVerdictSummary;
  boundaryVerdict: BoundaryVerdictSummary;
  policyDrift: PolicyDriftSummary;
  readinessDrift?: ReadinessDriftSummary;
  verificationVerdict?: VerificationVerdictSummary;
}): AgentRuntimeNextPhaseId {
  if (
    input.policyDrift.status === "changed" ||
    input.readinessDrift?.status === "weakened" ||
    input.verificationVerdict?.status === "failed" ||
    input.verificationVerdict?.status === "review" ||
    input.boundaryVerdict.status !== "pass" ||
    input.driftVerdict.status !== "pass"
  ) {
    return "repair_or_handoff";
  }
  return "audit_after_change";
}

function validationNextRequiredAction(phase: AgentRuntimeNextPhaseId): string {
  if (phase === "repair_or_handoff") {
    return "Run ripple repair --agent --intent latest, then repair or ask the human before continuing.";
  }
  if (phase === "audit_after_change") {
    return "Run ripple audit --agent --intent latest before final handoff; audit checks approval status and final proceed/stop decision.";
  }
  return "No staged-check follow-up is required.";
}

function buildValidationHandoff(
  validation: Omit<ChangeIntentValidationSummary, "handoff">
): RippleAgentHandoffVerdict {
  const needsHuman =
    validation.boundaryVerdict.humanRequired ||
    validation.driftVerdict.decision === "stop-and-ask-human" ||
    validation.policyDrift.status === "changed" ||
    validation.readinessDrift.status === "weakened" ||
    validation.verificationVerdict.status === "review" ||
    validation.verdict === "dangerous";
  const canContinue =
    validation.driftVerdict.status === "pass" &&
    !validation.requiresAttention;
  const decision = validationHandoffDecision(validation, canContinue, needsHuman);

  return buildAgentHandoffVerdict({
    source: "check",
    canContinue,
    needsHuman,
    decision,
    nextRequiredPhase: validation.nextRequiredPhase,
    nextRequiredAction: validation.nextRequiredAction,
    summary: validation.recommendedAction,
    why: validation.blockingReasons.length > 0
      ? validation.blockingReasons
      : validation.driftVerdict.why,
    fixNow: validationHandoffFixNow(validation),
    askHuman: validationHandoffAskHuman(validation),
    commands: validationHandoffCommands(validation),
  });
}

function validationHandoffDecision(
  validation: Omit<ChangeIntentValidationSummary, "handoff">,
  canContinue: boolean,
  needsHuman: boolean
): RippleAgentHandoffDecision {
  if (validation.readinessDrift.status === "weakened") {
    return "restore-readiness";
  }
  if (validation.verificationVerdict.status === "review") {
    return "human-review";
  }
  if (validation.verificationVerdict.status === "failed") {
    return "repair";
  }
  if (needsHuman) {
    return "human-review";
  }
  if (!canContinue) {
    return "repair";
  }
  if (validation.nextRequiredPhase === "audit_after_change") {
    return "audit";
  }
  return "continue";
}

function validationHandoffFixNow(
  validation: Omit<ChangeIntentValidationSummary, "handoff">
): string[] {
  if (validation.driftVerdict.status === "pass" && !validation.requiresAttention) {
    return validation.nextSteps;
  }
  return uniqueItems([
    ...validation.driftVerdict.fix,
    ...validation.boundaryVerdict.fix,
    ...(validation.policyDrift.status === "changed" ? validation.policyDrift.fix : []),
    ...(validation.readinessDrift.status === "weakened" ? validation.readinessDrift.fix : []),
    ...(validation.verificationVerdict.status === "failed" ||
    validation.verificationVerdict.status === "review"
      ? validation.verificationVerdict.fix
      : []),
  ]);
}

function validationHandoffAskHuman(
  validation: Omit<ChangeIntentValidationSummary, "handoff">
): string[] {
  const askHuman: string[] = [];
  if (validation.boundaryVerdict.humanRequired) {
    askHuman.push(
      `Human gate '${validation.humanGate}' applies to ${validation.targetFile}.`
    );
  }
  if (validation.policyDrift.status === "changed") {
    askHuman.push("Review the saved plan against the current repo policy before continuing.");
  }
  if (validation.readinessDrift.status === "weakened") {
    askHuman.push("Approve continuing only if the weaker Ripple readiness is intentional.");
  }
  if (validation.verificationVerdict.status === "review") {
    askHuman.push(validation.verificationVerdict.summary);
  }
  if (validation.verdict === "dangerous") {
    askHuman.push("Review contract drift before keeping the staged change.");
  }
  if (validation.driftVerdict.decision === "stop-and-ask-human") {
    askHuman.push(validation.driftVerdict.summary);
  }
  return askHuman;
}

function validationHandoffCommands(
  validation: Omit<ChangeIntentValidationSummary, "handoff">
): Partial<RippleAgentHandoffCommands> {
  return {
    doctor: validation.readinessDrift.status === "weakened"
      ? ["ripple doctor --agent --strict"]
      : [],
    plan: validation.verdict === "matched"
      ? []
      : [`ripple plan --file ${validation.targetFile} --task "<updated task>" --mode ${validation.controlMode} --agent --save`],
    audit: validation.nextRequiredPhase === "audit_after_change"
      ? ["ripple audit --agent --intent latest"]
      : [],
    repair: validation.nextRequiredPhase === "repair_or_handoff"
      ? ["ripple repair --agent --intent latest"]
      : [],
    approve: validation.boundaryVerdict.humanRequired
      ? [
          "ripple approval --intent latest --agent",
          `ripple approve --intent latest --gate ${approvalGateForHumanGate(validation.humanGate)} --reason "<why this boundary is safe>"`,
        ]
      : [],
    unstage: uniqueItems([
      ...validation.unplannedFiles,
      ...validation.contextFilesChanged,
      ...validation.boundaryVerdict.changedOutsideBoundaryFiles,
    ]).map((file) => `git restore --staged -- ${file}`),
    verify: validation.verificationVerdict.status === "failed" ||
      validation.verificationVerdict.status === "review"
      ? buildVerificationCommandSuggestions(validation.verificationVerdict)
      : validation.driftVerdict.status === "pass"
      ? validation.driftVerdict.fix
      : validation.nextSteps,
  };
}

function approvalGateForHumanGate(humanGate: HumanGate): string {
  if (humanGate === "required-before-merge") {
    return "before-merge";
  }
  return "before-risky-edit";
}

function mergeBoundaryGuidance(
  guidance: {
    recommendedAction: string;
    blockingReasons: string[];
    nextSteps: string[];
  },
  boundaryVerdict: BoundaryVerdictSummary
): {
  recommendedAction: string;
  blockingReasons: string[];
  nextSteps: string[];
} {
  if (boundaryVerdict.status === "pass") {
    return guidance;
  }

  const hasIntentBlockingReason = guidance.blockingReasons.length > 0;
  return {
    recommendedAction: boundaryVerdict.status === "danger"
      ? "Stop and ask the human to approve the crossed control boundary before keeping these changes."
      : hasIntentBlockingReason
      ? guidance.recommendedAction
      : "Repair boundary drift by undoing changes outside the selected control boundary or save a wider human-approved intent.",
    blockingReasons: uniqueItems([
      ...guidance.blockingReasons,
      ...boundaryVerdict.why,
    ]),
    nextSteps: uniqueItems([
      ...boundaryVerdict.fix,
      ...guidance.nextSteps,
    ]),
  };
}

function mergePolicyDriftGuidance(
  guidance: {
    recommendedAction: string;
    blockingReasons: string[];
    nextSteps: string[];
  },
  policyDrift: PolicyDriftSummary
): {
  recommendedAction: string;
  blockingReasons: string[];
  nextSteps: string[];
} {
  if (policyDrift.status !== "changed") {
    return guidance;
  }

  return {
    recommendedAction: guidance.blockingReasons.length > 0
      ? guidance.recommendedAction
      : "Ask the human to review the saved intent against the current repo policy before continuing.",
    blockingReasons: uniqueItems([
      ...guidance.blockingReasons,
      ...policyDrift.why,
    ]),
    nextSteps: uniqueItems([
      ...policyDrift.fix,
      ...guidance.nextSteps,
    ]),
  };
}

function mergeReadinessDriftGuidance(
  guidance: {
    recommendedAction: string;
    blockingReasons: string[];
    nextSteps: string[];
  },
  readinessDrift: ReadinessDriftSummary
): {
  recommendedAction: string;
  blockingReasons: string[];
  nextSteps: string[];
} {
  if (readinessDrift.status !== "weakened") {
    return guidance;
  }

  return {
    recommendedAction: guidance.blockingReasons.length > 0
      ? guidance.recommendedAction
      : "Restore Ripple readiness or ask the human to approve continuing with weaker protection.",
    blockingReasons: uniqueItems([
      ...guidance.blockingReasons,
      ...readinessDrift.why,
    ]),
    nextSteps: uniqueItems([
      ...readinessDrift.fix,
      ...guidance.nextSteps,
    ]),
  };
}

function mergeVerificationGuidance(
  guidance: {
    recommendedAction: string;
    blockingReasons: string[];
    nextSteps: string[];
  },
  verificationVerdict: VerificationVerdictSummary
): {
  recommendedAction: string;
  blockingReasons: string[];
  nextSteps: string[];
} {
  if (
    verificationVerdict.status !== "failed" &&
    verificationVerdict.status !== "review"
  ) {
    return guidance;
  }

  return {
    recommendedAction: guidance.blockingReasons.length > 0
      ? guidance.recommendedAction
      : verificationVerdict.status === "failed"
      ? "Repair failed verification before continuing."
      : "Ask the human to review incomplete verification evidence before continuing.",
    blockingReasons: uniqueItems([
      ...guidance.blockingReasons,
      ...verificationVerdict.why,
    ]),
    nextSteps: uniqueItems([
      ...verificationVerdict.fix,
      ...guidance.nextSteps,
    ]),
  };
}

function buildVerificationVerdict(
  value: unknown,
  changedFiles: string[] = [],
  changeFingerprint?: string,
  changeMode: StagedCheckSummary["mode"] = "staged"
): VerificationVerdictSummary {
  const evidence = normalizeVerificationEvidence(value);
  const latestEvidence = latestVerificationEvidenceByCommand(evidence);
  if (evidence.length === 0) {
    return {
      status: "not-reported",
      decision: "continue",
      label: "UNKNOWN",
      summary: "UNKNOWN: no verification evidence has been reported.",
      why: [],
      fix: [],
      evidence,
    };
  }

  const failed = latestEvidence.filter((item) => item.status === "failed");
  if (failed.length > 0) {
    return {
      status: "failed",
      decision: "repair",
      label: "FAILED",
      summary: "FAILED: latest verification evidence includes failing checks.",
      why: failed.map((item) => verificationEvidenceWhy(item)),
      fix: failed.map((item) => verificationEvidenceFix(item)),
      evidence,
    };
  }

  const incomplete = latestEvidence.filter((item) =>
    item.status === "skipped" || item.status === "unknown"
  );
  if (incomplete.length > 0) {
    return {
      status: "review",
      decision: "human-review",
      label: "REVIEW",
      summary:
        "REVIEW: latest verification evidence is skipped or unknown, so a human must review before handoff.",
      why: incomplete.map((item) => verificationEvidenceWhy(item)),
      fix: incomplete.map((item) => verificationEvidenceFix(item)),
      evidence,
    };
  }

  const staleEvidence = staleVerificationEvidence(latestEvidence, {
    changedFiles,
    changeFingerprint,
    changeMode,
  });
  if (staleEvidence.length > 0) {
    return {
      status: "review",
      decision: "human-review",
      label: "REVIEW",
      summary:
        "REVIEW: latest verification evidence was recorded for a different change snapshot, so the agent must rerun verification before handoff.",
      why: staleEvidence.map((item) =>
        staleVerificationWhy(item, changedFiles, changeFingerprint)
      ),
      fix: staleEvidence.map((item) =>
        `Rerun verification against the current changed files: ${item.command}`
      ),
      evidence,
    };
  }

  return {
    status: "pass",
    decision: "continue",
    label: "PASS",
    summary: "PASS: latest verification evidence for every command was marked passed.",
    why: latestEvidence.map((item) => verificationEvidenceWhy(item)),
    fix: ["Keep the passing verification evidence with the final handoff."],
    evidence,
  };
}

function latestVerificationEvidenceByCommand(
  evidence: RippleVerificationEvidence[]
): RippleVerificationEvidence[] {
  const latest = new Map<string, RippleVerificationEvidence>();
  evidence.forEach((item) => {
    latest.set(item.command, item);
  });
  return Array.from(latest.values());
}

function staleVerificationEvidence(
  evidence: RippleVerificationEvidence[],
  current: {
    changedFiles: string[];
    changeFingerprint?: string;
    changeMode: StagedCheckSummary["mode"];
  }
): RippleVerificationEvidence[] {
  const currentChangedFiles = normalizeVerificationChangedFiles(current.changedFiles);
  if (currentChangedFiles.length === 0) {
    return [];
  }
  return evidence.filter((item) => {
    if (
      item.changeFingerprint &&
      current.changeFingerprint
    ) {
      return item.changeFingerprint !== current.changeFingerprint;
    }
    if (!item.changedFiles) {
      return false;
    }
    return !sameStringSet(item.changedFiles, currentChangedFiles);
  });
}

function staleVerificationWhy(
  evidence: RippleVerificationEvidence,
  changedFiles: string[],
  changeFingerprint?: string
): string {
  if (evidence.changeFingerprint && changeFingerprint) {
    return `Stale verification proof: ${evidence.command} covered change fingerprint ${evidence.changeFingerprint.slice(0, 12)}, current fingerprint is ${changeFingerprint.slice(0, 12)}.`;
  }
  return `Stale verification proof: ${evidence.command} covered ${formatVerificationFileSet(evidence.changedFiles ?? [])}, current changed files are ${formatVerificationFileSet(changedFiles)}.`;
}

function normalizeVerificationChangedFiles(files: string[]): string[] {
  return uniqueItems(files.map((file) => normalizeVerificationFilePath(file)));
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function formatVerificationFileSet(files: string[]): string {
  return files.length > 0 ? files.join(", ") : "no changed files";
}

function verificationEvidenceWhy(evidence: RippleVerificationEvidence): string {
  const note = evidence.note ? ` Note: ${evidence.note}` : "";
  const sourceLabel = evidence.source === "executed" ? "Executed" : "Reported";
  const exitCode = typeof evidence.exitCode === "number" ? ` exitCode=${evidence.exitCode}.` : "";
  const duration = typeof evidence.durationMs === "number" ? ` durationMs=${evidence.durationMs}.` : "";
  return `${sourceLabel} verification ${evidence.status}: ${evidence.command}.${exitCode}${duration}${note}`;
}

function verificationEvidenceFix(evidence: RippleVerificationEvidence): string {
  if (evidence.status === "failed") {
    return `Fix the failing verification, rerun it, then record a passing result: ${evidence.command}`;
  }
  if (evidence.status === "skipped") {
    return `Run the skipped verification or ask the human to approve the skip: ${evidence.command}`;
  }
  if (evidence.status === "unknown") {
    return `Resolve the unknown verification result or ask the human to review it: ${evidence.command}`;
  }
  return `Keep passing verification evidence in the handoff: ${evidence.command}`;
}

function buildPolicyDriftSummary(
  saved: RipplePolicyExplanation,
  current?: RipplePolicyExplanation
): PolicyDriftSummary {
  if (!current) {
    return {
      status: "unchecked",
      decision: "compare-current-policy",
      label: "UNKNOWN",
      summary:
        "UNKNOWN: current repo policy was not compared with the saved intent policy snapshot.",
      changedFields: [],
      why: ["No current policy explanation was provided during intent validation."],
      fix: ["Compare the saved intent policyExplanation with the current repo policy before final handoff."],
    };
  }

  const changedFields = policyExplanationChangedFields(saved, current);
  if (changedFields.length === 0) {
    return {
      status: "unchanged",
      decision: "continue",
      label: "PASS",
      summary: "PASS: current repo policy matches the saved intent policy snapshot.",
      changedFields: [],
      why: ["The effective repo policy for this target still matches the saved intent."],
      fix: ["Continue with normal staged-change and boundary validation."],
      currentPolicyExplanation: current,
    };
  }

  return {
    status: "changed",
    decision: "review-current-policy",
    label: "DRIFT",
    summary:
      "DRIFT: current repo policy differs from the policy snapshot saved with this intent.",
    changedFields,
    why: [
      "The saved intent was created under a different effective repo policy.",
      ...changedFields.map((field) => `Policy changed: ${field}`),
    ],
    fix: [
      "Ask the human to review the saved intent against the current repo policy.",
      "Create a new saved intent if the current policy requires a different trust boundary.",
    ],
    currentPolicyExplanation: current,
  };
}

function buildReadinessDriftSummary(
  saved: ChangeIntentReadinessSnapshot,
  current?: ChangeIntentReadinessSnapshot
): ReadinessDriftSummary {
  if (!current) {
    return {
      status: "unchecked",
      decision: "compare-current-readiness",
      label: "UNKNOWN",
      summary:
        "UNKNOWN: current Ripple readiness was not compared with the saved intent readiness snapshot.",
      changedFields: [],
      weakenedFields: [],
      savedReadiness: saved,
      why: ["No current readiness snapshot was provided during intent validation."],
      fix: ["Run ripple doctor --agent before final handoff."],
    };
  }

  const changedFields = readinessChangedFields(saved, current);
  const weakenedFields = readinessWeakenedFields(saved, current);

  if (weakenedFields.length === 0) {
    return {
      status: "unchanged",
      decision: "continue",
      label: "PASS",
      summary:
        "PASS: current Ripple readiness is the same as or stronger than the saved intent readiness snapshot.",
      changedFields,
      weakenedFields,
      savedReadiness: saved,
      currentReadiness: current,
      why: [
        `Saved enforcement level: ${saved.enforcementLevel}.`,
        `Current enforcement level: ${current.enforcementLevel}.`,
      ],
      fix: ["Continue with normal staged-change and boundary validation."],
    };
  }

  return {
    status: "weakened",
    decision: "restore-readiness",
    label: "DRIFT",
    summary:
      "DRIFT: current Ripple readiness is weaker than the readiness snapshot saved with this intent.",
    changedFields,
    weakenedFields,
    savedReadiness: saved,
    currentReadiness: current,
    why: readinessDriftWhy(saved, current, weakenedFields),
    fix: readinessDriftFix(current, weakenedFields),
  };
}

function readinessChangedFields(
  saved: ChangeIntentReadinessSnapshot,
  current: ChangeIntentReadinessSnapshot
): string[] {
  const fields: Array<keyof ChangeIntentReadinessSnapshot> = [
    "status",
    "enforcementLevel",
    "canGuideAgents",
    "canDetectDrift",
    "canBlockInCi",
    "policyExplicit",
    "graphOk",
    "gitOk",
    "gitIgnoreOk",
    "ciWorkflowOk",
    "latestIntentOk",
  ];

  return fields.filter((field) => saved[field] !== current[field]);
}

function readinessWeakenedFields(
  saved: ChangeIntentReadinessSnapshot,
  current: ChangeIntentReadinessSnapshot
): string[] {
  const weakened: string[] = [];
  if (readinessStatusRank(current.status) < readinessStatusRank(saved.status)) {
    weakened.push("status");
  }
  if (enforcementLevelRank(current.enforcementLevel) < enforcementLevelRank(saved.enforcementLevel)) {
    weakened.push("enforcementLevel");
  }

  const booleanFields: Array<keyof Pick<
    ChangeIntentReadinessSnapshot,
    | "canGuideAgents"
    | "canDetectDrift"
    | "canBlockInCi"
    | "policyExplicit"
    | "graphOk"
    | "gitOk"
    | "gitIgnoreOk"
    | "ciWorkflowOk"
    | "latestIntentOk"
  >> = [
    "canGuideAgents",
    "canDetectDrift",
    "canBlockInCi",
    "policyExplicit",
    "graphOk",
    "gitOk",
    "gitIgnoreOk",
    "ciWorkflowOk",
    "latestIntentOk",
  ];

  booleanFields.forEach((field) => {
    if (saved[field] && !current[field]) {
      weakened.push(field);
    }
  });

  return uniqueItems(weakened);
}

function readinessDriftWhy(
  saved: ChangeIntentReadinessSnapshot,
  current: ChangeIntentReadinessSnapshot,
  weakenedFields: string[]
): string[] {
  return [
    `Saved enforcement level: ${saved.enforcementLevel}.`,
    `Current enforcement level: ${current.enforcementLevel}.`,
    `Weakened readiness fields: ${weakenedFields.join(", ")}.`,
    ...current.gaps.map((gap) => `Current readiness gap: ${gap}`),
  ];
}

function readinessDriftFix(
  current: ChangeIntentReadinessSnapshot,
  weakenedFields: string[]
): string[] {
  const fixes = ["Run ripple doctor --agent --strict to inspect current readiness gaps."];

  if (weakenedFields.includes("ciWorkflowOk") || weakenedFields.includes("canBlockInCi")) {
    fixes.push("Run ripple init to restore setup files and CI gate readiness.");
  }
  if (weakenedFields.includes("policyExplicit")) {
    fixes.push("Restore .ripple/policy.json or run ripple init before continuing.");
  }
  if (weakenedFields.includes("latestIntentOk") || weakenedFields.includes("canDetectDrift")) {
    fixes.push("Create or restore the saved intent with ripple plan --agent --save.");
  }
  if (weakenedFields.includes("gitOk")) {
    fixes.push("Run Ripple inside a git worktree so changed-file drift checks can work.");
  }
  if (weakenedFields.includes("gitIgnoreOk")) {
    fixes.push("Restore the .gitignore entry for .ripple/.cache/ before committing Ripple audit files.");
  }
  if (weakenedFields.includes("graphOk") || weakenedFields.includes("canGuideAgents")) {
    fixes.push("Run Ripple from a supported source repo so the graph can be scanned.");
  }

  current.nextSteps.forEach((step) => fixes.push(step));
  return uniqueItems(fixes);
}

function readinessStatusRank(status: ChangeIntentReadinessSnapshot["status"]): number {
  return status === "ready" ? 1 : 0;
}

function enforcementLevelRank(level: RippleEnforcementLevel): number {
  if (level === "ci-gate-ready") {
    return 3;
  }
  if (level === "drift-check-ready") {
    return 2;
  }
  if (level === "advisory") {
    return 1;
  }
  return 0;
}

function policyExplanationChangedFields(
  saved: RipplePolicyExplanation,
  current: RipplePolicyExplanation
): string[] {
  const changed: string[] = [];
  pushPolicyFieldChange(changed, "policy_source", saved.policySource, current.policySource);
  pushPolicyFieldChange(changed, "policy_exists", saved.policyExists, current.policyExists);
  pushPolicyFieldChange(changed, "policy_risk", saved.policyRisk, current.policyRisk);
  pushPolicyFieldChange(changed, "human_gate", saved.humanGate, current.humanGate);
  pushPolicyFieldChange(changed, "human_required", saved.humanRequired, current.humanRequired);
  pushPolicyFieldChange(changed, "allow_pr_mode", saved.allowPrMode, current.allowPrMode);

  if (!sameStringList(saved.matchedRules, current.matchedRules)) {
    changed.push(
      `matched_rules saved=${formatPolicyValue(saved.matchedRules)} current=${formatPolicyValue(current.matchedRules)}`
    );
  }

  return changed;
}

function pushPolicyFieldChange(
  changed: string[],
  field: string,
  saved: string | boolean,
  current: string | boolean
): void {
  if (saved !== current) {
    changed.push(
      `${field} saved=${formatPolicyValue(saved)} current=${formatPolicyValue(current)}`
    );
  }
}

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

function formatPolicyValue(value: string | boolean | string[]): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? `[${value.join("; ")}]` : "[]";
  }
  return String(value);
}

function buildBoundaryVerdict(input: {
  intent: ChangeIntent;
  editableFiles: string[];
  changedFiles: string[];
  changedSymbols: StagedCheckChangedSymbol[];
}): BoundaryVerdictSummary {
  const allowedFileSet = new Set(input.editableFiles);
  const allowedSymbolSet = new Set(input.intent.allowedSymbols);
  const humanRequired = input.intent.humanGate !== "none";
  const changedOutsideBoundaryFiles = uniqueItems(
    input.changedFiles.filter((file) => !allowedFileSet.has(file))
  );
  const changedOutsideBoundarySymbols = uniqueItems(
    input.changedSymbols
      .filter((symbol) => {
        if (input.intent.controlMode === "brainstorm") {
          return true;
        }
        if (input.intent.controlMode !== "function") {
          return false;
        }
        // A symbol is outside the boundary if it isn't an approved symbol —
        // whether because its file was never approved at all, or because it's
        // an unapproved symbol inside an approved file. Previously this only
        // checked the latter, so a changed symbol in a wholly unauthorized
        // file (a stronger violation, not a weaker one) was silently omitted
        // from this list even though changedOutsideBoundaryFiles caught the
        // file itself.
        return !allowedSymbolSet.has(symbol.symbol);
      })
      .map((symbol) => symbol.symbol)
  );
  const crossedBoundary =
    changedOutsideBoundaryFiles.length > 0 ||
    changedOutsideBoundarySymbols.length > 0;

  if (!crossedBoundary) {
    return {
      status: "pass",
      decision: "continue",
      label: "PASS",
      controlMode: input.intent.controlMode,
      humanRequired,
      humanGate: input.intent.humanGate,
      summary: humanRequired
        ? "PASS: staged changes stayed inside the selected boundary; the saved human gate still applies."
        : "PASS: staged changes stayed inside the selected boundary.",
      why: boundaryPassReasons(input.intent, input.editableFiles),
      fix: humanRequired
        ? [`Respect human gate: ${input.intent.humanGate}.`]
        : ["Continue only if the staged change still matches the task intent."],
      changedOutsideBoundaryFiles: [],
      changedOutsideBoundarySymbols: [],
    };
  }

  const status: BoundaryVerdictStatus = humanRequired ? "danger" : "drift";
  const decision: BoundaryDecision =
    status === "danger" ? "stop-and-ask-human" : "fix-before-commit";
  const why = uniqueItems([
    ...boundaryPassReasons(input.intent, input.editableFiles),
    ...changedOutsideBoundaryFiles.map((file) => {
      return `Changed file outside ${input.intent.controlMode} boundary: ${file}`;
    }),
    ...changedOutsideBoundarySymbols.map((symbol) => {
      return `Changed symbol outside ${input.intent.controlMode} boundary: ${symbol}`;
    }),
    ...input.intent.humanGateReason,
  ]);
  const fix = uniqueItems([
    ...changedOutsideBoundaryFiles.map((file) => {
      return `Unstage file outside boundary: ${file}`;
    }),
    ...changedOutsideBoundarySymbols.map((symbol) => {
      return `Undo or replan unapproved symbol: ${symbol}`;
    }),
    "Ask the human to approve a wider boundary before keeping these changes.",
  ]);

  return {
    status,
    decision,
    label: status === "danger" ? "DANGER" : "DRIFT",
    controlMode: input.intent.controlMode,
    humanRequired,
    humanGate: input.intent.humanGate,
    summary: status === "danger"
      ? "DANGER: staged changes crossed a human-gated control boundary."
      : "DRIFT: staged changes crossed the selected control boundary.",
    why,
    fix,
    changedOutsideBoundaryFiles,
    changedOutsideBoundarySymbols,
  };
}

function boundaryPassReasons(intent: ChangeIntent, editableFiles: string[]): string[] {
  if (intent.controlMode === "brainstorm") {
    return ["Control mode 'brainstorm' allows no file edits."];
  }

  const allowedFiles = editableFiles.length > 0
    ? editableFiles.join(", ")
    : "no files";
  const reasons = [
    `Control mode '${intent.controlMode}' allows edits to ${allowedFiles}.`,
  ];

  if (intent.controlMode === "function") {
    reasons.push(
      intent.allowedSymbols.length > 0
        ? `Allowed symbols: ${intent.allowedSymbols.join(", ")}.`
        : "No allowed symbols were saved for function mode."
    );
  }

  return reasons;
}

function buildDriftVerdict(input: {
  verdict: ChangeIntentVerdict;
  boundaryVerdict: BoundaryVerdictSummary;
  policyDrift: PolicyDriftSummary;
  readinessDrift: ReadinessDriftSummary;
  reasons: string[];
  blockingReasons: string[];
  nextSteps: string[];
  verificationTargets: string[];
  contextFilesChanged: string[];
  unplannedFiles: string[];
  unplannedSymbols: string[];
  protectedContractChanges: string[];
  unplannedContractChanges: string[];
}): DriftVerdictSummary {
  const boundaryVerdict = input.boundaryVerdict;
  const policyDrift = input.policyDrift;
  const readinessDrift = input.readinessDrift;

  if (
    input.verdict === "matched" &&
    boundaryVerdict.status === "pass" &&
    policyDrift.status !== "changed" &&
    readinessDrift.status !== "weakened"
  ) {
    const fix = input.verificationTargets.length > 0
      ? input.verificationTargets
          .slice(0, 8)
          .map((target) => `Verify before commit: ${target}`)
      : ["Proceed after the narrowest manual check for the staged change."];

    return {
      status: "pass",
      decision: "continue",
      label: "PASS",
      summary: "PASS: staged changes stayed inside the saved Ripple plan.",
      why: input.reasons,
      fix,
    };
  }

  if (
    input.verdict === "matched" &&
    boundaryVerdict.status === "pass" &&
    policyDrift.status === "changed"
  ) {
    return {
      status: "drift",
      decision: "stop-and-ask-human",
      label: "DRIFT",
      summary: policyDrift.summary,
      why: policyDrift.why,
      fix: policyDrift.fix,
    };
  }

  if (
    input.verdict === "matched" &&
    boundaryVerdict.status === "pass" &&
    readinessDrift.status === "weakened"
  ) {
    return {
      status: "drift",
      decision: "stop-and-ask-human",
      label: "DRIFT",
      summary: readinessDrift.summary,
      why: readinessDrift.why,
      fix: readinessDrift.fix,
    };
  }

  if (input.verdict === "matched") {
    return {
      status: boundaryVerdict.status,
      decision: boundaryVerdict.decision,
      label: boundaryVerdict.label,
      summary: boundaryVerdict.summary,
      why: boundaryVerdict.why,
      fix: boundaryVerdict.fix,
    };
  }

  const contextFilesChanged = new Set(input.contextFilesChanged);
  const outsideIntentFiles = input.unplannedFiles.filter((file) => {
    return !contextFilesChanged.has(file);
  });
  const intentWhy = input.blockingReasons.length > 0
    ? input.blockingReasons
    : input.reasons;
  const policyWhy = policyDrift.status === "changed" ? policyDrift.why : [];
  const readinessWhy = readinessDrift.status === "weakened" ? readinessDrift.why : [];
  const why = uniqueItems([...intentWhy, ...boundaryVerdict.why, ...policyWhy, ...readinessWhy]);
  const fileFixes = [
    ...input.contextFilesChanged.map((file) => {
      return `Unstage context-only file: ${file}`;
    }),
    ...outsideIntentFiles.map((file) => {
      return `Unstage unplanned file: ${file}`;
    }),
  ];
  const symbolFixes = input.unplannedSymbols.map((symbol) => {
    return `Review or undo unplanned symbol change: ${symbol}`;
  });
  const boundaryFixes = boundaryVerdict.status === "pass" ? [] : boundaryVerdict.fix;
  const policyFixes = policyDrift.status === "changed" ? policyDrift.fix : [];
  const readinessFixes = readinessDrift.status === "weakened" ? readinessDrift.fix : [];

  if (input.verdict === "dangerous" || boundaryVerdict.status === "danger") {
    const contractFixes = [
      ...input.protectedContractChanges.map((symbol) => {
        return `Stop and review protected contract change: ${symbol}`;
      }),
      ...input.unplannedContractChanges.map((symbol) => {
        return `Stop and review unplanned contract change: ${symbol}`;
      }),
    ];

    return {
      status: "danger",
      decision: "stop-and-ask-human",
      label: "DANGER",
      summary: boundaryVerdict.status === "danger" && input.verdict !== "dangerous"
        ? "DANGER: staged changes crossed the human-selected control boundary."
        : "DANGER: staged changes include contract drift or unsafe scope expansion.",
      why,
      fix: uniqueItems([
        ...fileFixes,
        ...symbolFixes,
        ...boundaryFixes,
        ...policyFixes,
        ...readinessFixes,
        ...contractFixes,
        "Ask the human before keeping any public contract change.",
        "Create a new saved intent only after the broader contract change is approved.",
      ]),
    };
  }

  return {
    status: "drift",
    decision: "fix-before-commit",
    label: "DRIFT",
    summary: "DRIFT: staged changes left the saved Ripple plan.",
    why,
    fix: uniqueItems([
      ...fileFixes,
      ...symbolFixes,
      ...boundaryFixes,
      ...policyFixes,
      ...readinessFixes,
      "Create a new saved intent if the broader scope is intentional.",
      ...input.nextSteps,
    ]),
  };
}

function validationVerdict(input: {
  unplannedFiles: string[];
  unplannedSymbols: string[];
  protectedContractChanges: string[];
  unplannedContractChanges: string[];
}): ChangeIntentVerdict {
  if (
    input.protectedContractChanges.length > 0 ||
    input.unplannedContractChanges.length > 0
  ) {
    return "dangerous";
  }
  if (input.unplannedFiles.length > 0 || input.unplannedSymbols.length > 0) {
    return "drifted";
  }
  return "matched";
}

function repairStatus(validation: ChangeIntentValidationSummary): IntentDriftRepairStatus {
  if (validation.verificationVerdict.status === "failed") {
    return "repair-required";
  }
  if (validation.verificationVerdict.status === "review") {
    return "human-review-required";
  }
  if (validation.driftVerdict.status === "pass") {
    return "no-repair-needed";
  }
  if (validation.policyDrift.status === "changed") {
    return "human-review-required";
  }
  if (validation.readinessDrift.status === "weakened") {
    return "human-review-required";
  }
  if (
    validation.boundaryVerdict.status === "danger" &&
    validation.verdict !== "dangerous"
  ) {
    return "human-review-required";
  }
  if (validation.verdict === "dangerous") {
    return "contract-review-required";
  }
  return "repair-required";
}

function repairSummary(validation: ChangeIntentValidationSummary): string {
  if (validation.verificationVerdict.status === "failed") {
    return "Reported verification failed; repair the failing check and record a passing rerun before continuing.";
  }
  if (validation.verificationVerdict.status === "review") {
    return "Reported verification is skipped or unknown; ask the human to review before continuing.";
  }
  if (validation.driftVerdict.status === "pass") {
    return "Staged changes match the saved intent; no drift repair is needed.";
  }
  if (validation.policyDrift.status === "changed") {
    return "Current repo policy differs from the saved intent policy snapshot; ask the human before continuing.";
  }
  if (validation.readinessDrift.status === "weakened") {
    return "Current Ripple readiness is weaker than the saved intent readiness snapshot; restore readiness or ask the human before continuing.";
  }
  if (
    validation.boundaryVerdict.status === "danger" &&
    validation.verdict !== "dangerous"
  ) {
    return "Staged changes crossed a human-gated control boundary; ask the human before continuing.";
  }
  if (validation.verdict === "dangerous") {
    return "Staged changes include contract drift; review contracts before continuing.";
  }
  return "Staged changes drifted outside the saved intent; unstage extra files or create a new intent.";
}

function validationGuidance(input: {
  verdict: ChangeIntentVerdict;
  unplannedFiles: string[];
  contextFilesChanged: string[];
  unplannedSymbols: string[];
  protectedContractChanges: string[];
  unplannedContractChanges: string[];
}): {
  recommendedAction: string;
  blockingReasons: string[];
  nextSteps: string[];
} {
  if (input.verdict === "matched") {
    return {
      recommendedAction: "Proceed with the saved plan and run the planned verification targets before handoff.",
      blockingReasons: [],
      nextSteps: [
        "Run the narrowest verification target(s) from the staged check.",
        "Keep the staged set scoped to the saved change intent.",
      ],
    };
  }

  const contextFilesChanged = new Set(input.contextFilesChanged);
  const outsideIntentFiles = input.unplannedFiles.filter((file) => !contextFilesChanged.has(file));

  if (input.verdict === "dangerous") {
    return {
      recommendedAction:
        "Stop and review contract drift; preserve the contract or create a new intent that explicitly allows the contract change.",
      blockingReasons: [
        ...input.contextFilesChanged.map((file) => {
          return `Context-only file changed: ${file}`;
        }),
        ...outsideIntentFiles.map((file) => {
          return `Unplanned file changed: ${file}`;
        }),
        ...input.protectedContractChanges.map((symbol) => {
          return `Protected contract changed: ${symbol}`;
        }),
        ...input.unplannedContractChanges.map((symbol) => {
          return `Unplanned contract changed: ${symbol}`;
        }),
      ],
      nextSteps: [
        "Review callers for every contract-drift symbol.",
        "Either adjust the edit to preserve the contract or create a new intent for the broader contract change.",
      ],
    };
  }

  return {
    recommendedAction:
      "Unstage unplanned files or create a new intent that includes the broader scope before continuing.",
    blockingReasons: [
      ...input.contextFilesChanged.map((file) => {
        return `Context-only file changed: ${file}`;
      }),
      ...outsideIntentFiles.map((file) => {
        return `Unplanned file changed: ${file}`;
      }),
      ...input.unplannedSymbols.map((symbol) => {
        return `Unplanned symbol changed: ${symbol}`;
      }),
    ],
    nextSteps: [
      "Unstage files that are outside the saved edit scope.",
      "If the broader edit is intentional, create a new plan and save a new intent for that scope.",
    ],
  };
}

function validationReasons(input: {
  unplannedFiles: string[];
  contextFilesChanged: string[];
  unplannedSymbols: string[];
  protectedContractChanges: string[];
  unplannedContractChanges: string[];
}): string[] {
  const reasons: string[] = [];
  const contextFilesChanged = new Set(input.contextFilesChanged);
  const outsideIntentFiles = input.unplannedFiles.filter((file) => !contextFilesChanged.has(file));
  if (input.contextFilesChanged.length > 0) {
    reasons.push(`${input.contextFilesChanged.length} context-only file(s) were edited`);
  }
  if (outsideIntentFiles.length > 0) {
    reasons.push(`${outsideIntentFiles.length} staged file(s) were outside the saved plan`);
  }
  if (input.unplannedSymbols.length > 0) {
    reasons.push(`${input.unplannedSymbols.length} changed symbol(s) were outside expected symbol focus`);
  }
  if (input.protectedContractChanges.length > 0) {
    reasons.push(`${input.protectedContractChanges.length} protected contract(s) changed`);
  }
  if (input.unplannedContractChanges.length > 0) {
    reasons.push(`${input.unplannedContractChanges.length} unplanned contract change(s) found`);
  }
  if (reasons.length === 0) {
    reasons.push("staged changes stayed inside the saved change intent");
  }
  return reasons;
}

function contractChangedSymbols(symbols: StagedCheckChangedSymbol[]): StagedCheckChangedSymbol[] {
  return symbols.filter((symbol) => {
    return symbol.symbolStatus !== "created" && symbol.contractChanged;
  });
}

function changeIntentEditableFiles(intent: ChangeIntent): string[] {
  if (intent.controlMode === "brainstorm") {
    return [];
  }
  return uniqueItems(
    intent.editableFiles && intent.editableFiles.length > 0
      ? intent.editableFiles
      : intent.expectedFiles.length > 0
      ? intent.expectedFiles
      : [intent.targetFile]
  );
}

function changeIntentContextFiles(intent: ChangeIntent, editableFiles: string[]): string[] {
  const editableFileSet = new Set(editableFiles);
  const contextFiles =
    intent.contextFiles && intent.contextFiles.length > 0
      ? intent.contextFiles
      : intent.allowedFiles.filter((file) => !editableFileSet.has(file));

  return uniqueItems(contextFiles.filter((file) => !editableFileSet.has(file)));
}

function resolveIntentPath(workspaceRoot: string, intentPath: string): string {
  const normalized = intentPath.trim();
  if (normalized.length === 0 || normalized === "latest") {
    return defaultChangeIntentPath(workspaceRoot);
  }
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  if (normalized.endsWith(".json") || normalized.includes("/") || normalized.includes("\\")) {
    return path.resolve(workspaceRoot, normalized);
  }
  return path.join(workspaceRoot, INTENTS_DIR, `${normalized}.json`);
}

function assertChangeIntent(value: unknown, sourcePath: string): ChangeIntent {
  if (!isRecord(value)) {
    throw new Error(
      `Invalid Ripple change intent at ${sourcePath}. Ask the human to inspect or recreate the saved boundary before continuing.`
    );
  }
  if (value.protocol === "ripple-closed-intent") {
    throw new Error(closedIntentErrorMessage(value, sourcePath));
  }
  if (value.protocol !== INTENT_PROTOCOL || value.version !== INTENT_VERSION) {
    throw new Error(
      `No active Ripple change intent found at ${sourcePath}. Found protocol ${String(value.protocol)} instead of ${INTENT_PROTOCOL}. Run ripple intent status, then create a new saved plan before the agent continues.`
    );
  }
  if (
    typeof value.id !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.task !== "string" ||
    typeof value.targetFile !== "string" ||
    typeof value.tokenBudget !== "number" ||
    !Array.isArray(value.allowedFiles) ||
    !Array.isArray(value.expectedFiles) ||
    (value.editableFiles !== undefined && !Array.isArray(value.editableFiles)) ||
    (value.contextFiles !== undefined && !Array.isArray(value.contextFiles)) ||
    !Array.isArray(value.expectedSymbols) ||
    !Array.isArray(value.protectedContracts) ||
    !Array.isArray(value.verificationTargets) ||
    typeof value.why !== "string"
  ) {
    throw new Error(
      `Malformed Ripple change intent at ${sourcePath}. Ask the human to inspect or recreate the saved boundary before continuing.`
    );
  }
  assertIntentIntegrity(value, sourcePath);
  return normalizeChangeIntent(value as RawChangeIntent);
}

function assertIntentIntegrity(value: Record<string, unknown>, sourcePath: string): void {
  const expected = computeIntentFingerprint(value);
  if (typeof value.integrity !== "string" || value.integrity !== expected) {
    throw new Error(
      `Tampered or unverifiable Ripple change intent at ${sourcePath}. The saved boundary's integrity fingerprint does not match its contents, so Ripple cannot prove it is the boundary a human approved. Create a fresh plan with ripple plan --file <file> --task "<task>" --agent --save before the agent continues.`
    );
  }
}

function closedIntentErrorMessage(value: Record<string, unknown>, sourcePath: string): string {
  const reason = typeof value.reason === "string" && value.reason.trim().length > 0
    ? ` Reason: ${value.reason.trim()}`
    : "";
  const closedBy = typeof value.closedBy === "string" && value.closedBy.trim().length > 0
    ? ` Closed by: ${value.closedBy.trim()}.`
    : "";
  return [
    `No active Ripple change intent found at ${sourcePath}; the saved boundary is closed.`,
    `${closedBy}${reason}`,
    "Agents must not continue from a closed boundary.",
    "Run ripple intent status, then create a new saved plan with ripple plan --file <file> --task \"<task>\" --agent --save before editing.",
  ].filter(Boolean).join(" ");
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeChangeIntent(intent: RawChangeIntent): ChangeIntent {
  const controlMode = isControlMode(intent.controlMode) ? intent.controlMode : "file";
  const editableFiles = uniqueItems(
    controlMode === "brainstorm"
      ? []
      : intent.editableFiles && intent.editableFiles.length > 0
      ? intent.editableFiles
      : intent.expectedFiles.length > 0
      ? intent.expectedFiles
      : [intent.targetFile]
  );
  const editableFileSet = new Set(editableFiles);
  const contextFiles = uniqueItems(
    (intent.contextFiles && intent.contextFiles.length > 0
      ? intent.contextFiles
      : intent.allowedFiles.filter((file) => !editableFileSet.has(file))
    ).filter((file) => !editableFileSet.has(file))
  );
  const allowedSymbols = uniqueItems(
    (intent.allowedSymbols ?? []).filter((symbol): symbol is string =>
      typeof symbol === "string" && symbol.trim().length > 0
    )
  );
  const boundaryRisk = isControlBoundaryRisk(intent.boundaryRisk)
    ? intent.boundaryRisk
    : riskFromPath(intent.targetFile);
  const humanGate = isHumanGate(intent.humanGate) ? intent.humanGate : "none";
  const humanGateReason = (intent.humanGateReason ?? []).filter((reason): reason is string =>
    typeof reason === "string" && reason.trim().length > 0
  );
  const policySource = typeof intent.policySource === "string"
    ? intent.policySource
    : "legacy-intent";
  const policyMatches = (intent.policyMatches ?? []).filter((match): match is string =>
    typeof match === "string" && match.trim().length > 0
  );
  const policyExplanation = normalizePolicyExplanationSnapshot(intent.policyExplanation, {
    targetFile: intent.targetFile,
    controlMode,
    boundaryRisk,
    humanGate,
    policySource,
    policyMatches,
    policyRisk: policySource !== "built-in default" && policySource !== "legacy-intent"
      ? boundaryRisk
      : "none",
  });
  const readinessSnapshot = normalizeReadinessSnapshot(intent.readinessSnapshot);

  return {
    ...intent,
    controlMode,
    allowedSymbols,
    humanGate,
    humanGateReason,
    boundaryRisk,
    policySource,
    policyMatches,
    policyExplanation,
    editableFiles,
    contextFiles,
    allowedFiles: uniqueItems([...editableFiles, ...contextFiles]),
    expectedFiles: uniqueItems(intent.expectedFiles.length > 0 ? intent.expectedFiles : editableFiles),
    verificationEvidence: normalizeVerificationEvidence(intent.verificationEvidence),
    readinessSnapshot,
  };
}

export function appendRippleVerificationEvidence(
  intent: ChangeIntent,
  evidence: Omit<RippleVerificationEvidence, "recordedAt" | "source"> & {
    recordedAt?: string;
    source?: RippleVerificationEvidence["source"];
  }
): ChangeIntent {
  const normalizedCommand = evidence.command.trim();
  if (normalizedCommand.length === 0) {
    throw new Error("Verification command cannot be empty.");
  }
  const normalizedEvidence: RippleVerificationEvidence = {
    command: normalizedCommand,
    status: isVerificationStatus(evidence.status) ? evidence.status : "unknown",
    recordedAt: evidence.recordedAt ?? new Date().toISOString(),
    source: evidence.source ?? "reported",
    changedFiles: Array.isArray(evidence.changedFiles)
      ? uniqueItems(evidence.changedFiles.filter((file): file is string =>
          typeof file === "string" && file.trim().length > 0
        ).map((file) => normalizeVerificationFilePath(file.trim())))
      : undefined,
    changeMode: isVerificationChangeMode(evidence.changeMode)
      ? evidence.changeMode
      : undefined,
    changeFingerprint: typeof evidence.changeFingerprint === "string" &&
      evidence.changeFingerprint.trim().length > 0
      ? evidence.changeFingerprint.trim()
      : undefined,
    exitCode: typeof evidence.exitCode === "number" && Number.isFinite(evidence.exitCode)
      ? Math.trunc(evidence.exitCode)
      : undefined,
    durationMs: typeof evidence.durationMs === "number" && Number.isFinite(evidence.durationMs)
      ? Math.max(0, Math.trunc(evidence.durationMs))
      : undefined,
    stdoutTail: typeof evidence.stdoutTail === "string" && evidence.stdoutTail.trim().length > 0
      ? evidence.stdoutTail
      : undefined,
    stderrTail: typeof evidence.stderrTail === "string" && evidence.stderrTail.trim().length > 0
      ? evidence.stderrTail
      : undefined,
    note: typeof evidence.note === "string" && evidence.note.trim().length > 0
      ? evidence.note.trim()
      : undefined,
  };
  return {
    ...intent,
    verificationEvidence: uniqueVerificationEvidence([
      ...normalizeVerificationEvidence(intent.verificationEvidence),
      normalizedEvidence,
    ]),
  };
}

function normalizeVerificationEvidence(value: unknown): RippleVerificationEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueVerificationEvidence(value.flatMap((item): RippleVerificationEvidence[] => {
    if (!isRecord(item) || typeof item.command !== "string") {
      return [];
    }
    const command = item.command.trim();
    if (command.length === 0) {
      return [];
    }
    const status = isVerificationStatus(item.status) ? item.status : "unknown";
    const recordedAt = typeof item.recordedAt === "string" && item.recordedAt.trim().length > 0
      ? item.recordedAt
      : new Date(0).toISOString();
    const source = item.source === "executed" ? "executed" : "reported";
    const changedFiles = Array.isArray(item.changedFiles)
      ? uniqueItems(item.changedFiles.filter((file): file is string =>
          typeof file === "string" && file.trim().length > 0
        ).map((file) => normalizeVerificationFilePath(file.trim())))
      : undefined;
    const changeMode = isVerificationChangeMode(item.changeMode)
      ? item.changeMode
      : undefined;
    const changeFingerprint = typeof item.changeFingerprint === "string" &&
      item.changeFingerprint.trim().length > 0
      ? item.changeFingerprint.trim()
      : undefined;
    const exitCode = typeof item.exitCode === "number" && Number.isFinite(item.exitCode)
      ? Math.trunc(item.exitCode)
      : undefined;
    const durationMs = typeof item.durationMs === "number" && Number.isFinite(item.durationMs)
      ? Math.max(0, Math.trunc(item.durationMs))
      : undefined;
    const stdoutTail = typeof item.stdoutTail === "string" && item.stdoutTail.trim().length > 0
      ? item.stdoutTail
      : undefined;
    const stderrTail = typeof item.stderrTail === "string" && item.stderrTail.trim().length > 0
      ? item.stderrTail
      : undefined;
    const note = typeof item.note === "string" && item.note.trim().length > 0
      ? item.note.trim()
      : undefined;
    return [{
      command,
      status,
      recordedAt,
      source,
      changedFiles,
      changeMode,
      changeFingerprint,
      exitCode,
      durationMs,
      stdoutTail,
      stderrTail,
      note,
    }];
  }));
}

function uniqueVerificationEvidence(evidence: RippleVerificationEvidence[]): RippleVerificationEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = [
      item.command,
      item.status,
      item.source,
      String(item.exitCode ?? ""),
      (item.changedFiles ?? []).join(","),
      item.changeMode ?? "",
      item.changeFingerprint ?? "",
      item.recordedAt,
      item.note ?? "",
    ].join("\0");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeVerificationFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isVerificationStatus(value: unknown): value is RippleVerificationStatus {
  return value === "passed" || value === "failed" || value === "skipped" || value === "unknown";
}

function isVerificationChangeMode(value: unknown): value is StagedCheckSummary["mode"] {
  return value === "staged" || value === "changed" || value === "worktree";
}

function normalizeReadinessSnapshot(
  value: Partial<ChangeIntentReadinessSnapshot> | undefined
): ChangeIntentReadinessSnapshot {
  if (!isRecord(value)) {
    return fallbackReadinessSnapshot();
  }

  return {
    status: isReadinessStatus(value.status) ? value.status : "needs_setup",
    enforcementLevel: isRippleEnforcementLevel(value.enforcementLevel)
      ? value.enforcementLevel
      : "none",
    canGuideAgents: typeof value.canGuideAgents === "boolean" ? value.canGuideAgents : false,
    canDetectDrift: typeof value.canDetectDrift === "boolean" ? value.canDetectDrift : false,
    canBlockInCi: typeof value.canBlockInCi === "boolean" ? value.canBlockInCi : false,
    policyExplicit: typeof value.policyExplicit === "boolean" ? value.policyExplicit : false,
    graphOk: typeof value.graphOk === "boolean" ? value.graphOk : false,
    gitOk: typeof value.gitOk === "boolean" ? value.gitOk : false,
    gitIgnoreOk: typeof value.gitIgnoreOk === "boolean" ? value.gitIgnoreOk : false,
    ciWorkflowOk: typeof value.ciWorkflowOk === "boolean" ? value.ciWorkflowOk : false,
    latestIntentOk: typeof value.latestIntentOk === "boolean" ? value.latestIntentOk : false,
    gaps: stringList(value.gaps),
    nextSteps: stringList(value.nextSteps),
  };
}

function fallbackReadinessSnapshot(): ChangeIntentReadinessSnapshot {
  return {
    status: "needs_setup",
    enforcementLevel: "none",
    canGuideAgents: false,
    canDetectDrift: false,
    canBlockInCi: false,
    policyExplicit: false,
    graphOk: false,
    gitOk: false,
    gitIgnoreOk: false,
    ciWorkflowOk: false,
    latestIntentOk: false,
    gaps: ["Readiness snapshot was not captured when this intent was saved."],
    nextSteps: ["Run ripple doctor --agent."],
  };
}

function isReadinessStatus(value: unknown): value is RippleReadinessSummary["status"] {
  return value === "ready" || value === "needs_setup";
}

function isRippleEnforcementLevel(value: unknown): value is RippleEnforcementLevel {
  return (
    value === "none" ||
    value === "advisory" ||
    value === "drift-check-ready" ||
    value === "ci-gate-ready"
  );
}

type PolicyExplanationSnapshotDefaults = {
  targetFile: string;
  controlMode: ControlMode;
  boundaryRisk: ControlBoundaryRisk;
  humanGate: HumanGate;
  policySource: string;
  policyMatches: string[];
  policyRisk: ControlBoundaryRisk | "none";
};

function normalizePolicyExplanationSnapshot(
  value: unknown,
  defaults: PolicyExplanationSnapshotDefaults
): RipplePolicyExplanation {
  const raw = isRecord(value) ? value : undefined;
  const rawMatchedRules = raw ? stringList(raw.matchedRules) : [];
  const matchedRules = raw && Array.isArray(raw.matchedRules)
    ? rawMatchedRules
    : defaults.policyMatches;
  const rawWhy = raw ? stringList(raw.why) : [];
  const rawNextSteps = raw ? stringList(raw.nextSteps) : [];
  const rawPolicySource = raw?.policySource;
  const policySource = typeof rawPolicySource === "string" && rawPolicySource.trim().length > 0
    ? rawPolicySource
    : defaults.policySource;
  const rawPolicyRisk = raw?.policyRisk;
  const requiredGateNextSteps = defaults.humanGate !== "none"
    ? fallbackPolicyExplanationNextSteps(defaults.humanGate)
    : [];

  return {
    protocol: "ripple-policy-explanation",
    version: 1,
    targetFile: defaults.targetFile,
    policySource,
    policyExists: typeof raw?.policyExists === "boolean"
      ? raw.policyExists
      : policySource !== "built-in default" && policySource !== "legacy-intent",
    effectiveMode: defaults.controlMode,
    policyRisk: isPolicyExplanationRisk(rawPolicyRisk)
      ? rawPolicyRisk
      : defaults.policyRisk,
    humanGate: defaults.humanGate,
    humanRequired: defaults.humanGate !== "none",
    allowPrMode: typeof raw?.allowPrMode === "boolean" ? raw.allowPrMode : false,
    matchedRules,
    why: rawWhy.length > 0 ? rawWhy : fallbackPolicyExplanationWhy(defaults),
    nextSteps: rawNextSteps.length > 0
      ? uniqueItems([...requiredGateNextSteps, ...rawNextSteps])
      : fallbackPolicyExplanationNextSteps(defaults.humanGate),
  };
}

function fallbackPolicyExplanationWhy(defaults: PolicyExplanationSnapshotDefaults): string[] {
  const why = [
    `Saved control mode: ${defaults.controlMode}.`,
    `Policy source at plan time: ${defaults.policySource}.`,
  ];

  if (defaults.policyRisk !== "none") {
    why.push(`Policy risk at plan time: ${defaults.policyRisk}.`);
  }
  if (defaults.policyMatches.length > 0) {
    why.push(`Matched policy rules at plan time: ${defaults.policyMatches.join("; ")}.`);
  }

  return why;
}

function fallbackPolicyExplanationNextSteps(humanGate: HumanGate): string[] {
  if (humanGate === "required-before-edit") {
    return ["Agent must get human approval before editing this file."];
  }
  if (humanGate === "required-before-merge") {
    return ["Agent must get human approval before merging this change."];
  }
  return ["Check staged changes against this saved intent before handoff."];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueItems(
    value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  );
}

function editableFilesForControlMode(
  plan: ContextPlanSummary,
  controlMode: ControlMode,
  options: BuildChangeIntentOptions
): string[] {
  const explicitFiles = uniqueItems(options.allowedFiles ?? []);

  if (controlMode === "brainstorm") {
    return [];
  }
  if (controlMode === "task" || controlMode === "pr") {
    return explicitFiles.length > 0
      ? explicitFiles
      : [plan.targetFile];
  }
  return [plan.targetFile];
}

function allowedSymbolsForControlMode(
  plan: ContextPlanSummary,
  controlMode: ControlMode,
  options: BuildChangeIntentOptions
): string[] {
  const allowedSymbols = uniqueItems(
    (options.allowedSymbols ?? [])
      .map((symbol) => normalizeAllowedSymbol(plan.targetFile, symbol))
      .filter(Boolean)
  );

  if (controlMode === "function" && allowedSymbols.length === 0) {
    throw new Error("Function control mode requires --symbol or allowedSymbols.");
  }

  return allowedSymbols;
}

function normalizeAllowedSymbol(targetFile: string, symbol: string): string {
  const trimmed = symbol.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.includes("::") ? trimmed : `${targetFile}::${trimmed}`;
}

function controlBoundaryRisk(plan: ContextPlanSummary): ControlBoundaryRisk {
  const pathRisk = riskFromPath(plan.targetFile);
  if (pathRisk === "critical" || pathRisk === "high") {
    return pathRisk;
  }
  if (plan.risk === "dangerous") {
    return "high";
  }
  if (plan.risk === "caution") {
    return "medium";
  }
  return pathRisk;
}

function strongestBoundaryRisk(
  baseRisk: ControlBoundaryRisk,
  policyRisk: ControlBoundaryRisk | undefined
): ControlBoundaryRisk {
  if (!policyRisk) {
    return baseRisk;
  }
  return boundaryRiskRank(policyRisk) > boundaryRiskRank(baseRisk) ? policyRisk : baseRisk;
}

function boundaryRiskRank(risk: ControlBoundaryRisk): number {
  if (risk === "critical") {
    return 3;
  }
  if (risk === "high") {
    return 2;
  }
  if (risk === "medium") {
    return 1;
  }
  return 0;
}

function humanGateForPlan(
  plan: ContextPlanSummary,
  controlMode: ControlMode,
  boundaryRisk: ControlBoundaryRisk,
  policy?: RipplePolicyResolution
): HumanGate {
  if (policy?.requireHumanBeforeEdit) {
    return "required-before-edit";
  }
  if (controlMode === "brainstorm") {
    return "required-before-edit";
  }
  if (boundaryRisk === "critical" || boundaryRisk === "high" || plan.risk === "dangerous") {
    return "required-before-edit";
  }
  if (policy?.requireHumanBeforeMerge) {
    return "required-before-merge";
  }
  if (controlMode === "pr") {
    return "required-before-merge";
  }
  return "none";
}

function humanGateReasons(
  plan: ContextPlanSummary,
  controlMode: ControlMode,
  boundaryRisk: ControlBoundaryRisk,
  policy?: RipplePolicyResolution
): string[] {
  const reasons: string[] = [];
  if (policy?.source === "file") {
    reasons.push(`Trust policy loaded from ${policy.sourcePath ?? ".ripple/policy.json"}.`);
  }
  if (policy?.matchedRules.length) {
    reasons.push(`Trust policy matched: ${policy.matchedRules.join("; ")}.`);
  }
  if (policy?.requireHumanBeforeEdit) {
    reasons.push("Trust policy requires human approval before editing this path.");
  }
  if (policy?.requireHumanBeforeMerge) {
    reasons.push("Trust policy requires human approval before merge.");
  }
  if (controlMode === "brainstorm") {
    reasons.push("Brainstorm mode does not allow file edits.");
  }
  if (boundaryRisk === "critical" || boundaryRisk === "high") {
    reasons.push(`Target path is ${boundaryRisk} risk for agent autonomy.`);
  }
  if (plan.risk === "dangerous") {
    reasons.push("Ripple graph marks the target as dangerous because of blast radius or churn.");
  }
  if (controlMode === "pr") {
    reasons.push("PR mode still requires human review before merge.");
  }
  return uniqueItems(reasons);
}

function policySourceLabel(policy: RipplePolicyResolution | undefined): string {
  if (!policy) {
    return "built-in default";
  }
  if (policy.source === "file") {
    return policy.sourcePath ?? ".ripple/policy.json";
  }
  return "built-in default";
}

function riskFromPath(filePath: string): ControlBoundaryRisk {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split("/");
  const hasSegment = (names: string[]): boolean => {
    return segments.some((segment) => names.includes(segment));
  };

  if (
    hasSegment([
      "payment",
      "payments",
      "billing",
      "migrations",
      "migration",
      "database",
      "db",
      "schema",
      "secrets",
      "secret",
      "deploy",
      "deployment",
      "infra",
      "terraform",
      ".github",
      "ci",
    ]) ||
    /(^|[/.])(schema|migration|billing|payment|secret|deploy)([/.]|$)/i.test(normalized)
  ) {
    return "critical";
  }

  if (
    /(^|[/.])(auth|security|session|token|permission|permissions|role|roles|acl|oauth|jwt)([/.]|$)/i
      .test(normalized)
  ) {
    return "high";
  }

  return "low";
}

function assertControlMode(value: ControlMode): void {
  if (!isControlMode(value)) {
    throw new Error(`Unsupported control mode: ${String(value)}`);
  }
}

function isControlMode(value: unknown): value is ControlMode {
  return (
    value === "brainstorm" ||
    value === "function" ||
    value === "file" ||
    value === "task" ||
    value === "pr"
  );
}

function isHumanGate(value: unknown): value is HumanGate {
  return (
    value === "none" ||
    value === "required-before-edit" ||
    value === "required-before-merge"
  );
}

function isControlBoundaryRisk(value: unknown): value is ControlBoundaryRisk {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

function isPolicyExplanationRisk(value: unknown): value is ControlBoundaryRisk | "none" {
  return value === "none" || isControlBoundaryRisk(value);
}

function makeIntentId(plan: ContextPlanSummary, createdAt: string): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${createdAt}:${plan.targetFile}:${plan.task}`)
    .digest("hex")
    .slice(0, 10);
  return `intent-${Date.now().toString(36)}-${hash}`;
}

function isSourceFilePath(value: string): boolean {
  return SOURCE_FILE_RE.test(value) && !value.endsWith(".d.ts");
}

function uniqueItems<T>(items: T[]): T[] {
  const seen = new Set<T>();
  return items.filter((item) => {
    if (seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
