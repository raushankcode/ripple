import type { ControlBoundaryRisk } from "./change-intent";
import type {
  StagedCheckFileSummary,
  StagedCheckSymbolContractRisk,
} from "./staged-check";

export type RippleRiskLevel = "low" | "medium" | "high" | "critical";

export type RippleRiskReasonKind =
  | "boundary-crossed"
  | "intent-drift"
  | "approval-missing"
  | "risky-path"
  | "blast-radius"
  | "public-contract"
  | "test-gap"
  | "policy-rule"
  | "readiness-drift";

export type RippleRiskReason = {
  kind: RippleRiskReasonKind;
  severity: RippleRiskLevel;
  message: string;
  evidence: string[];
};

export type RippleRiskSummary = {
  level: RippleRiskLevel;
  score: number;
  summary: string;
  reasons: RippleRiskReason[];
  affectedFiles: string[];
  affectedSymbols: string[];
  requiredActions: string[];
};

export type BuildRippleRiskSummaryInput = {
  boundaryRisk: ControlBoundaryRisk;
  allowedFiles: string[];
  allowedSymbols: string[];
  changedFiles: string[];
  changedOutsideBoundaryFiles: string[];
  changedOutsideBoundarySymbols: string[];
  unplannedFiles?: string[];
  unplannedSymbols?: string[];
  /** Saved intent requires human sign-off that has not been recorded yet. */
  humanGateUnsatisfied?: boolean;
  verificationTargets: string[];
  nextSteps: string[];
  stagedFiles: StagedCheckFileSummary[];
};

type WeightedRiskReason = RippleRiskReason & { weight: number };

const GRAPH_RISK_WEIGHT: Record<StagedCheckFileSummary["modificationRisk"], number> = {
  safe: 0,
  caution: 16,
  dangerous: 32,
};

const CONTRACT_RISK_WEIGHT: Record<Exclude<StagedCheckSymbolContractRisk, "none">, number> = {
  review: 16,
  high: 28,
};

const RISKY_PATH_RULES: Array<{
  pattern: RegExp;
  label: string;
  severity: RippleRiskLevel;
  weight: number;
}> = [
  {
    pattern: /(^|[\\/])(auth|security|permissions?)([\\/]|$)/i,
    label: "auth/security/permission code",
    severity: "high",
    weight: 24,
  },
  {
    pattern: /(^|[\\/])(payments?|billing|checkout)([\\/]|$)/i,
    label: "payment/billing code",
    severity: "critical",
    weight: 36,
  },
  {
    pattern: /(^|[\\/])(migrations?|schema|database|db)([\\/]|$)/i,
    label: "database/schema/migration code",
    severity: "critical",
    weight: 36,
  },
  {
    pattern: /(^|[\\/])(infra|deploy|deployment|terraform|k8s|kubernetes|docker)([\\/]|$)/i,
    label: "infra/deployment code",
    severity: "high",
    weight: 26,
  },
  {
    pattern: /(^|[\\/])\.github[\\/]workflows[\\/]|(^|[\\/])(config|configs)([\\/]|$)|\.(env|ya?ml|toml|ini)$/i,
    label: "config/CI code",
    severity: "high",
    weight: 22,
  },
];

export function buildRippleRiskSummary(input: BuildRippleRiskSummaryInput): RippleRiskSummary {
  const reasons: WeightedRiskReason[] = [];
  const affectedFiles = new Set(input.changedFiles);
  const affectedSymbols = new Set<string>([
    ...input.changedOutsideBoundarySymbols,
    ...(input.unplannedSymbols ?? []),
  ]);

  addBoundaryReasons(input, reasons);
  addIntentReasons(input, reasons);
  addApprovalReason(input, reasons);
  addPolicyReason(input, reasons);
  addFileRiskReasons(input, reasons, affectedFiles);
  addContractReasons(input, reasons, affectedSymbols);
  addVerificationReason(input, reasons);

  const score = rippleRiskScore(reasons);
  const level = riskLevelForScore(score);
  const requiredActions = buildRequiredActions(input, reasons);

  return {
    level,
    score,
    summary: buildRiskSummary(level, score, reasons),
    reasons: reasons.map(({ weight: _weight, ...reason }) => reason),
    affectedFiles: Array.from(affectedFiles).sort(),
    affectedSymbols: Array.from(affectedSymbols).sort(),
    requiredActions,
  };
}

/**
 * Reasons that mean "the agent did something it was not authorized to do", as
 * opposed to "this code is sensitive". Only these can push a change into the
 * high/critical bands.
 */
const VIOLATION_REASON_KINDS: ReadonlySet<RippleRiskReasonKind> = new Set([
  "boundary-crossed",
  "intent-drift",
  // Not yet a breach, but keeping the change would be unauthorized, so it
  // belongs on the violation axis rather than the "this code is sensitive" one.
  "approval-missing",
]);

/** Highest score a change with no boundary violation may reach (stays MEDIUM). */
const NO_VIOLATION_SCORE_CAP = 50;
/** Lowest score a change with a boundary violation may report (at least HIGH). */
const VIOLATION_SCORE_FLOOR = 51;

/**
 * Risk is scored on two axes so the number discriminates.
 *
 * Exposure (how sensitive this code is: policy risk, risky path, blast radius,
 * contracts, missing tests) is real signal, but on its own it is not a finding —
 * editing a payments file correctly is not the same as breaching a boundary.
 * Summing both axes made an authorized edit to a sensitive file score the same
 * as an unauthorized one, so the score carried no information.
 *
 * Clean changes are therefore capped in the medium band, and any boundary or
 * intent violation floors into the high band before exposure is added on top.
 */
function rippleRiskScore(reasons: WeightedRiskReason[]): number {
  let violation = 0;
  let exposure = 0;
  for (const reason of reasons) {
    if (VIOLATION_REASON_KINDS.has(reason.kind)) {
      violation += reason.weight;
    } else {
      exposure += reason.weight;
    }
  }

  if (violation === 0) {
    return Math.min(NO_VIOLATION_SCORE_CAP, exposure);
  }
  return Math.min(100, Math.max(VIOLATION_SCORE_FLOOR, violation + exposure));
}

function addBoundaryReasons(input: BuildRippleRiskSummaryInput, reasons: WeightedRiskReason[]): void {
  if (input.changedOutsideBoundaryFiles.length > 0) {
    reasons.push({
      kind: "boundary-crossed",
      severity: "high",
      weight: 34,
      message: "Agent changed files outside the approved Ripple boundary.",
      evidence: [
        ...input.allowedFiles.map((file) => `allowed file: ${file}`),
        ...input.changedOutsideBoundaryFiles.map((file) => `changed outside boundary: ${file}`),
      ],
    });
  }

  if (input.changedOutsideBoundarySymbols.length > 0) {
    reasons.push({
      kind: "boundary-crossed",
      severity: "high",
      weight: 36,
      message: "Agent changed symbols outside the approved Ripple boundary.",
      evidence: [
        ...input.allowedSymbols.map((symbol) => `allowed symbol: ${symbol}`),
        ...input.changedOutsideBoundarySymbols.map((symbol) => `changed outside boundary: ${symbol}`),
      ],
    });
  }
}

function addIntentReasons(input: BuildRippleRiskSummaryInput, reasons: WeightedRiskReason[]): void {
  const unplannedFiles = input.unplannedFiles ?? [];
  const unplannedSymbols = input.unplannedSymbols ?? [];

  if (unplannedFiles.length > 0) {
    reasons.push({
      kind: "intent-drift",
      severity: "medium",
      weight: 22,
      message: "Agent changed files outside the saved task plan.",
      evidence: unplannedFiles.map((file) => `unplanned file: ${file}`),
    });
  }

  if (unplannedSymbols.length > 0) {
    reasons.push({
      kind: "intent-drift",
      severity: "medium",
      weight: 20,
      message: "Agent changed symbols outside the saved task plan.",
      evidence: unplannedSymbols.map((symbol) => `unplanned symbol: ${symbol}`),
    });
  }
}

function addApprovalReason(input: BuildRippleRiskSummaryInput, reasons: WeightedRiskReason[]): void {
  if (!input.humanGateUnsatisfied) {
    return;
  }
  reasons.push({
    kind: "approval-missing",
    severity: "high",
    weight: 30,
    message: "Saved intent requires human approval that has not been recorded.",
    evidence: ["human approval: missing"],
  });
}

function addPolicyReason(input: BuildRippleRiskSummaryInput, reasons: WeightedRiskReason[]): void {
  if (input.boundaryRisk === "high" || input.boundaryRisk === "critical") {
    reasons.push({
      kind: "policy-rule",
      severity: input.boundaryRisk,
      weight: input.boundaryRisk === "critical" ? 55 : 35,
      message: `Saved intent is marked ${input.boundaryRisk} risk by Ripple policy/boundary analysis.`,
      evidence: [`boundary risk: ${input.boundaryRisk}`],
    });
  }
}

function addFileRiskReasons(
  input: BuildRippleRiskSummaryInput,
  reasons: WeightedRiskReason[],
  affectedFiles: Set<string>
): void {
  for (const file of input.stagedFiles) {
    affectedFiles.add(file.file);

    const graphWeight = GRAPH_RISK_WEIGHT[file.modificationRisk];
    if (graphWeight > 0) {
      reasons.push({
        kind: "blast-radius",
        severity: file.modificationRisk === "dangerous" ? "high" : "medium",
        weight: graphWeight,
        message: `${file.file} is marked ${file.modificationRisk} by Ripple graph risk.`,
        // Prefixed with the file: two changed files sharing the same importer
        // or symbol count would otherwise produce identical evidence strings
        // that collide when the CLI later flattens/dedupes evidence across
        // every reason for the whole gate summary.
        evidence: [
          `${file.file} importer count: ${file.importerCount}`,
          `${file.file} symbol count: ${file.symbolCount}`,
        ],
      });
    }

    if (file.importerCount >= 5) {
      reasons.push({
        kind: "blast-radius",
        severity: "high",
        weight: 26,
        message: `${file.file} has a large downstream blast radius.`,
        evidence: [`${file.file}: ${file.importerCount} direct importers may be affected`],
      });
    } else if (file.importerCount >= 2) {
      reasons.push({
        kind: "blast-radius",
        severity: "medium",
        weight: 14,
        message: `${file.file} is shared by multiple downstream files.`,
        evidence: [`${file.file}: ${file.importerCount} direct importers may be affected`],
      });
    }

    const riskyPath = RISKY_PATH_RULES.find((rule) => rule.pattern.test(file.file));
    if (riskyPath) {
      reasons.push({
        kind: "risky-path",
        severity: riskyPath.severity,
        weight: riskyPath.weight,
        message: `${file.file} touches ${riskyPath.label}.`,
        evidence: [`changed file: ${file.file}`],
      });
    }
  }
}

function addContractReasons(
  input: BuildRippleRiskSummaryInput,
  reasons: WeightedRiskReason[],
  affectedSymbols: Set<string>
): void {
  const contractRisks = input.stagedFiles.flatMap((file) => file.contractRisks);
  if (contractRisks.length === 0) {
    return;
  }

  const highestRisk = contractRisks.some((contractRisk) => contractRisk.risk === "high")
    ? "high"
    : "review";

  for (const contractRisk of contractRisks) {
    affectedSymbols.add(contractRisk.symbol);
  }

  reasons.push({
    kind: "public-contract",
    severity: highestRisk === "high" ? "high" : "medium",
    weight: Math.max(...contractRisks.map((contractRisk) => CONTRACT_RISK_WEIGHT[contractRisk.risk])),
    message: "Changed exported/public symbols may affect callers or external contracts.",
    // Each line is prefixed with the symbol it describes. Two changed symbols
    // very commonly share the same caller count or exported flag — plain
    // `callers: 0` / `exported: true` strings would collide and get silently
    // dropped by uniqueItems below (and again by the CLI's own cross-reason
    // evidence dedup), making it look like only the first symbol has data.
    evidence: uniqueItems(
      contractRisks.flatMap((contractRisk) => [
        `symbol: ${contractRisk.symbol}`,
        `${contractRisk.symbol} callers: ${contractRisk.callers}`,
        `${contractRisk.symbol} exported: ${contractRisk.exported}`,
        `${contractRisk.symbol} reason: ${contractRisk.reason}`,
      ])
    ),
  });
}

function addVerificationReason(input: BuildRippleRiskSummaryInput, reasons: WeightedRiskReason[]): void {
  if (input.changedFiles.length > 0 && input.verificationTargets.length === 0) {
    reasons.push({
      kind: "test-gap",
      severity: "medium",
      weight: 10,
      message: "No verification target was detected for this change.",
      evidence: ["verification targets: none"],
    });
  }
}

function buildRequiredActions(
  input: BuildRippleRiskSummaryInput,
  reasons: WeightedRiskReason[]
): string[] {
  const actions: string[] = [];

  if (
    input.changedOutsideBoundaryFiles.length > 0 ||
    input.changedOutsideBoundarySymbols.length > 0
  ) {
    actions.push("Undo the outside-boundary change or create a wider human-approved intent.");
  }

  if (reasons.some((reason) => reason.kind === "blast-radius")) {
    actions.push("Review downstream callers/importers before continuing.");
  }

  if (reasons.some((reason) => reason.kind === "public-contract")) {
    actions.push("Review public contract changes before keeping this edit.");
  }

  if (input.verificationTargets.length > 0) {
    actions.push(...input.verificationTargets.map((target) => `Run verification target: ${target}`));
  } else if (input.changedFiles.length > 0) {
    actions.push("Run the narrowest relevant test/typecheck before handoff.");
  }

  if (actions.length === 0) {
    actions.push("Continue with normal verification and review for the saved intent.");
  }

  return uniqueItems(actions);
}

function buildRiskSummary(
  level: RippleRiskLevel,
  score: number,
  reasons: WeightedRiskReason[]
): string {
  if (reasons.length === 0) {
    return `LOW risk ${score}/100: no boundary, graph, policy, contract, or verification risk signals were detected.`;
  }
  const topReason = reasons.slice().sort((a, b) => b.weight - a.weight)[0];
  return `${level.toUpperCase()} risk ${score}/100: ${topReason.message}`;
}

function riskLevelForScore(score: number): RippleRiskLevel {
  if (score >= 81) {
    return "critical";
  }
  if (score >= 51) {
    return "high";
  }
  if (score >= 21) {
    return "medium";
  }
  return "low";
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
