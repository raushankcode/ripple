import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type {
  ChangeIntent,
  ControlBoundaryRisk,
  ControlMode,
  HumanGate,
} from "./change-intent";

export type RippleApprovalGate = "before-risky-edit" | "before-merge";
export type RippleApprovalStatusValue = "not-required" | "missing" | "approved" | "stale";
export type RippleApprovalDecision = "continue" | "human-review";

export type RippleApprovalRecord = {
  protocol: "ripple-approval";
  version: 1;
  id: string;
  intentId: string;
  gate: RippleApprovalGate;
  approvedAt: string;
  approvedBy: string;
  targetFile: string;
  task: string;
  controlMode: ControlMode;
  humanGate: HumanGate;
  boundaryRisk: ControlBoundaryRisk;
  intentFingerprint: string;
  policyFingerprint: string;
  reason: string;
};

export type RippleApprovalStatus = {
  protocol: "ripple-approval-status";
  version: 1;
  required: boolean;
  approved: boolean;
  status: RippleApprovalStatusValue;
  decision: RippleApprovalDecision;
  gate?: RippleApprovalGate;
  summary: string;
  approval?: RippleApprovalRecord;
  approvalPath?: string;
  why: string[];
  nextSteps: string[];
};

export type RecordRippleApprovalOptions = {
  gate?: RippleApprovalGate;
  approvedBy?: string;
  reason?: string;
  approvedAt?: string;
};

const APPROVAL_PROTOCOL = "ripple-approval";
const APPROVAL_STATUS_PROTOCOL = "ripple-approval-status";
const APPROVAL_VERSION = 1;
const APPROVALS_DIR = path.join(".ripple", "approvals");

export function approvalGateForHumanGate(
  humanGate: HumanGate
): RippleApprovalGate | undefined {
  if (humanGate === "required-before-edit") {
    return "before-risky-edit";
  }
  if (humanGate === "required-before-merge") {
    return "before-merge";
  }
  return undefined;
}

export function recordRippleApproval(
  workspaceRoot: string,
  intent: ChangeIntent,
  options: RecordRippleApprovalOptions = {}
): RippleApprovalRecord {
  const gate = options.gate ?? approvalGateForHumanGate(intent.humanGate);
  if (!gate) {
    throw new Error(
      "This intent does not require a human approval gate. Pass --gate to record an explicit approval."
    );
  }

  const approvedAt = options.approvedAt ?? new Date().toISOString();
  const approvedBy = normalizeApprover(options.approvedBy);
  const reason = cleanOptionalText(options.reason);
  if (!reason) {
    throw new Error(
      "Human approval requires a reason. Run ripple approve with --reason explaining why this boundary is approved."
    );
  }
  const intentFingerprint = fingerprintChangeIntent(intent);
  const policyFingerprint = fingerprintJson(intent.policyExplanation);
  const approval: RippleApprovalRecord = {
    protocol: APPROVAL_PROTOCOL,
    version: APPROVAL_VERSION,
    id: approvalId(intent.id, gate, approvedAt, approvedBy),
    intentId: intent.id,
    gate,
    approvedAt,
    approvedBy,
    targetFile: intent.targetFile,
    task: intent.task,
    controlMode: intent.controlMode,
    humanGate: intent.humanGate,
    boundaryRisk: intent.boundaryRisk,
    intentFingerprint,
    policyFingerprint,
    reason,
  };
  const targetPath = rippleApprovalPath(workspaceRoot, intent.id, gate);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(approval, null, 2)}\n`, "utf8");
  return approval;
}

export function resolveRippleApprovalStatus(
  workspaceRoot: string,
  intent: ChangeIntent,
  gateOverride?: RippleApprovalGate
): RippleApprovalStatus {
  const gate = gateOverride ?? approvalGateForHumanGate(intent.humanGate);
  if (!gate) {
    return {
      protocol: APPROVAL_STATUS_PROTOCOL,
      version: APPROVAL_VERSION,
      required: false,
      approved: true,
      status: "not-required",
      decision: "continue",
      summary: "No human approval gate is required for this saved intent.",
      why: ["The saved intent has humanGate=none."],
      nextSteps: ["Continue only if the change still matches the saved intent."],
    };
  }

  const approvalPath = rippleApprovalPath(workspaceRoot, intent.id, gate);
  const relativePath = formatWorkspacePath(workspaceRoot, approvalPath);
  if (!fs.existsSync(approvalPath)) {
    return {
      protocol: APPROVAL_STATUS_PROTOCOL,
      version: APPROVAL_VERSION,
      required: true,
      approved: false,
      status: "missing",
      decision: "human-review",
      gate,
      summary: `Human approval missing for gate ${gate}.`,
      approvalPath: relativePath,
      why: [
        `Saved intent requires ${intent.humanGate}.`,
        `No approval record exists at ${relativePath}.`,
      ],
      nextSteps: [
        `Run ripple approve --intent latest --gate ${gate} --reason "<why this boundary is safe>" after the human reviews the plan.`,
      ],
    };
  }

  const approval = readRippleApprovalRecord(approvalPath);
  const expectedIntentFingerprint = fingerprintChangeIntent(intent);
  const expectedPolicyFingerprint = fingerprintJson(intent.policyExplanation);
  const staleReasons = approval
    ? approvalMismatchReasons(approval, intent, gate, expectedIntentFingerprint, expectedPolicyFingerprint)
    : ["Approval record is not valid JSON or does not match the Ripple approval protocol."];

  if (!approval || staleReasons.length > 0) {
    return {
      protocol: APPROVAL_STATUS_PROTOCOL,
      version: APPROVAL_VERSION,
      required: true,
      approved: false,
      status: "stale",
      decision: "human-review",
      gate,
      summary: `Human approval for gate ${gate} is stale or invalid.`,
      approval: approval ?? undefined,
      approvalPath: relativePath,
      why: staleReasons,
      nextSteps: [
        `Ask the human to review the current saved intent, then re-run ripple approve --intent latest --gate ${gate} --reason "<why this boundary is safe>".`,
      ],
    };
  }

  return {
    protocol: APPROVAL_STATUS_PROTOCOL,
    version: APPROVAL_VERSION,
    required: true,
    approved: true,
    status: "approved",
    decision: "continue",
    gate,
    summary: `Human approval recorded for gate ${gate}.`,
    approval,
    approvalPath: relativePath,
    why: [
      `${approval.approvedBy} approved ${intent.targetFile} for ${gate} at ${approval.approvedAt}.`,
    ],
    nextSteps: ["Continue only if drift, boundary, policy, and contract checks also pass."],
  };
}

export function rippleApprovalPath(
  workspaceRoot: string,
  intentId: string,
  gate: RippleApprovalGate
): string {
  return path.join(workspaceRoot, APPROVALS_DIR, sanitizePathPart(intentId), `${gate}.json`);
}

function readRippleApprovalRecord(filePath: string): RippleApprovalRecord | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<RippleApprovalRecord>;
    if (
      parsed.protocol !== APPROVAL_PROTOCOL ||
      parsed.version !== APPROVAL_VERSION ||
      typeof parsed.id !== "string" ||
      typeof parsed.intentId !== "string" ||
      !isApprovalGate(parsed.gate) ||
      typeof parsed.approvedAt !== "string" ||
      typeof parsed.approvedBy !== "string" ||
      typeof parsed.targetFile !== "string" ||
      typeof parsed.task !== "string" ||
      typeof parsed.controlMode !== "string" ||
      typeof parsed.humanGate !== "string" ||
      typeof parsed.boundaryRisk !== "string" ||
      typeof parsed.intentFingerprint !== "string" ||
      typeof parsed.policyFingerprint !== "string"
    ) {
      return undefined;
    }
    return parsed as RippleApprovalRecord;
  } catch {
    return undefined;
  }
}

function approvalMismatchReasons(
  approval: RippleApprovalRecord,
  intent: ChangeIntent,
  gate: RippleApprovalGate,
  expectedIntentFingerprint: string,
  expectedPolicyFingerprint: string
): string[] {
  const reasons: string[] = [];
  if (approval.intentId !== intent.id) {
    reasons.push(`Approval intent id ${approval.intentId} does not match current intent ${intent.id}.`);
  }
  if (approval.gate !== gate) {
    reasons.push(`Approval gate ${approval.gate} does not match required gate ${gate}.`);
  }
  if (approval.intentFingerprint !== expectedIntentFingerprint) {
    reasons.push("Saved intent changed after this approval was recorded.");
  }
  if (approval.policyFingerprint !== expectedPolicyFingerprint) {
    reasons.push("Saved policy explanation changed after this approval was recorded.");
  }
  return reasons;
}

function fingerprintChangeIntent(intent: ChangeIntent): string {
  return fingerprintJson({
    id: intent.id,
    task: intent.task,
    targetFile: intent.targetFile,
    controlMode: intent.controlMode,
    allowedSymbols: intent.allowedSymbols,
    humanGate: intent.humanGate,
    humanGateReason: intent.humanGateReason,
    boundaryRisk: intent.boundaryRisk,
    policySource: intent.policySource,
    policyMatches: intent.policyMatches,
    policyExplanation: intent.policyExplanation,
    editableFiles: intent.editableFiles,
    contextFiles: intent.contextFiles,
    allowedFiles: intent.allowedFiles,
    expectedFiles: intent.expectedFiles,
    expectedSymbols: intent.expectedSymbols,
    protectedContracts: intent.protectedContracts,
    verificationTargets: intent.verificationTargets,
  });
}

function fingerprintJson(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function approvalId(
  intentId: string,
  gate: RippleApprovalGate,
  approvedAt: string,
  approvedBy: string
): string {
  return crypto
    .createHash("sha256")
    .update(`${intentId}:${gate}:${approvedAt}:${approvedBy}`)
    .digest("hex")
    .slice(0, 16);
}

function normalizeApprover(value: string | undefined): string {
  const cleaned = cleanOptionalText(value);
  if (cleaned) {
    return cleaned;
  }
  return process.env.GIT_AUTHOR_NAME?.trim() ||
    process.env.USERNAME?.trim() ||
    process.env.USER?.trim() ||
    "human";
}

function cleanOptionalText(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function isApprovalGate(value: unknown): value is RippleApprovalGate {
  return value === "before-risky-edit" || value === "before-merge";
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function formatWorkspacePath(workspaceRoot: string, filePath: string): string {
  const relative = path.relative(workspaceRoot, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return filePath;
}
