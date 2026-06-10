import * as fs from "fs";
import * as path from "path";
import { RippleAdapterDetectionSummary, detectWorkspaceAdapters } from "./adapters";
import { defaultChangeIntentPath } from "./change-intent";
import { execGit } from "./git";
import { GraphEngine } from "./graph";

export const RIPPLE_CI_WORKFLOW_PATH = ".github/workflows/ripple.yml";
export const RIPPLE_GITIGNORE_PATH = ".gitignore";
export const RIPPLE_CACHE_GITIGNORE_ENTRY = ".ripple/.cache/";

export type RippleReadinessCheck = {
  ok: boolean;
  detail: string;
  fix?: string;
};

export type RippleEnforcementLevel =
  | "none"
  | "advisory"
  | "drift-check-ready"
  | "ci-gate-ready";

export type RippleEnforcementReadiness = {
  level: RippleEnforcementLevel;
  summary: string;
  canGuideAgents: boolean;
  canDetectDrift: boolean;
  canBlockInCi: boolean;
  explicitPolicy: RippleReadinessCheck;
  gaps: string[];
};

export type RippleReadinessDecision = "continue" | "setup-required";

export type RippleReadinessSummary = {
  status: "ready" | "needs_setup";
  decision: RippleReadinessDecision;
  canContinue: boolean;
  mustStop: boolean;
  nextRequiredAction: string;
  why: string[];
  fixNow: string[];
  workspace: string;
  sourceFiles: number;
  symbols: number;
  callEdges: number;
  adapterSupport: RippleAdapterDetectionSummary;
  enforcement: RippleEnforcementReadiness;
  checks: {
    graph: RippleReadinessCheck;
    git: RippleReadinessCheck;
    gitIgnore: RippleReadinessCheck;
    ciWorkflow: RippleReadinessCheck;
    latestIntent: RippleReadinessCheck;
  };
  nextSteps: string[];
};

export function buildRippleReadinessSummary(
  workspaceRoot: string,
  engine: GraphEngine
): RippleReadinessSummary {
  const sourceFiles = engine.graph.files.size;
  const symbols = engine.graph.symbols.size;
  const callEdges = countCallEdges(engine);
  const adapterSupport = detectWorkspaceAdapters(workspaceRoot);
  const workflowPath = path.join(workspaceRoot, RIPPLE_CI_WORKFLOW_PATH);
  const latestIntentPath = defaultChangeIntentPath(workspaceRoot);
  const policyPath = path.join(workspaceRoot, ".ripple", "policy.json");
  const graphOk = sourceFiles > 0;
  const gitCheck = gitWorktreeCheck(workspaceRoot);
  const gitOk = gitCheck.ok;
  const gitIgnoreCheck = rippleGitIgnoreCheck(workspaceRoot);
  const ciWorkflowOk = fs.existsSync(workflowPath);
  const latestIntentOk = fs.existsSync(latestIntentPath);
  const explicitPolicyOk = fs.existsSync(policyPath);
  const checks = {
    graph: {
      ok: graphOk,
      detail: graphOk
        ? `${sourceFiles} source files, ${symbols} symbols, ${callEdges} call edges`
        : "No supported source files were found",
      fix: graphOk ? undefined : "Run Ripple from a JavaScript, TypeScript, or Python repo root.",
    },
    git: gitCheck,
    gitIgnore: gitIgnoreCheck,
    ciWorkflow: {
      ok: ciWorkflowOk,
      detail: ciWorkflowOk
        ? RIPPLE_CI_WORKFLOW_PATH
        : "Missing .github/workflows/ripple.yml",
      fix: ciWorkflowOk ? undefined : "Run ripple init.",
    },
    latestIntent: {
      ok: latestIntentOk,
      detail: latestIntentOk
        ? formatWorkspacePath(workspaceRoot, latestIntentPath)
        : "No active local intent found; this is normal until an agent creates a saved plan.",
      fix: undefined,
    },
  };
  const enforcement = buildEnforcementReadiness({
    graphOk,
    gitOk,
    gitDetail: gitCheck.detail,
    gitIgnoreOk: gitIgnoreCheck.ok,
    ciWorkflowOk,
    latestIntentOk,
    explicitPolicyOk,
  });
  const nextSteps = Object.values(checks)
    .map((check) => check.fix)
    .filter((fix): fix is string => Boolean(fix));

  if (nextSteps.length === 0) {
    nextSteps.push("Run ripple ci --base origin/main --github-annotations.");
  }

  const requiredChecks = [checks.graph, checks.git, checks.gitIgnore, checks.ciWorkflow];
  const status = requiredChecks.every((check) => check.ok) ? "ready" : "needs_setup";
  const contract = readinessContract(status, enforcement, nextSteps);

  return {
    status,
    decision: contract.decision,
    canContinue: contract.canContinue,
    mustStop: contract.mustStop,
    nextRequiredAction: contract.nextRequiredAction,
    why: contract.why,
    fixNow: contract.fixNow,
    workspace: workspaceRoot,
    sourceFiles,
    symbols,
    callEdges,
    adapterSupport,
    enforcement,
    checks,
    nextSteps,
  };
}

function readinessContract(
  status: RippleReadinessSummary["status"],
  enforcement: RippleEnforcementReadiness,
  nextSteps: string[]
): Pick<
  RippleReadinessSummary,
  "decision" | "canContinue" | "mustStop" | "nextRequiredAction" | "why" | "fixNow"
> {
  if (status === "ready") {
    return {
      decision: "continue",
      canContinue: true,
      mustStop: false,
      nextRequiredAction:
        "Continue with the saved-intent workflow and keep the Ripple CI gate enabled.",
      why: [enforcement.summary],
      fixNow: [],
    };
  }

  return {
    decision: "setup-required",
    canContinue: false,
    mustStop: true,
    nextRequiredAction:
      "Stop autonomous agent work until Ripple readiness gaps are fixed.",
    why: enforcement.gaps,
    fixNow: nextSteps,
  };
}

function buildEnforcementReadiness(input: {
  graphOk: boolean;
  gitOk: boolean;
  gitDetail: string;
  gitIgnoreOk: boolean;
  ciWorkflowOk: boolean;
  latestIntentOk: boolean;
  explicitPolicyOk: boolean;
}): RippleEnforcementReadiness {
  const canGuideAgents = input.graphOk;
  const canDetectDrift = input.graphOk && input.gitOk;
  const canBlockInCi = canDetectDrift && input.ciWorkflowOk;
  const level = enforcementLevel({
    canGuideAgents,
    canDetectDrift,
    canBlockInCi,
  });
  const gaps = enforcementGaps(input);

  return {
    level,
    summary: enforcementSummary(level),
    canGuideAgents,
    canDetectDrift,
    canBlockInCi,
    explicitPolicy: {
      ok: input.explicitPolicyOk,
      detail: input.explicitPolicyOk
        ? ".ripple/policy.json"
        : "Using built-in policy defaults",
      fix: input.explicitPolicyOk
        ? undefined
        : "Run ripple policy init to make repo trust boundaries explicit.",
    },
    gaps,
  };
}

function enforcementLevel(input: {
  canGuideAgents: boolean;
  canDetectDrift: boolean;
  canBlockInCi: boolean;
}): RippleEnforcementLevel {
  if (input.canBlockInCi) {
    return "ci-gate-ready";
  }
  if (input.canDetectDrift) {
    return "drift-check-ready";
  }
  if (input.canGuideAgents) {
    return "advisory";
  }
  return "none";
}

function enforcementSummary(level: RippleEnforcementLevel): string {
  if (level === "ci-gate-ready") {
    return "Ripple can guide agents, detect drift, and fail CI when the saved intent or boundary is violated.";
  }
  if (level === "drift-check-ready") {
    return "Ripple can guide agents and detect drift locally, but CI blocking is not installed yet.";
  }
  if (level === "advisory") {
    return "Ripple can provide context, but saved-intent drift checks or CI blocking are not fully ready.";
  }
  return "Ripple cannot enforce or guide safely until a supported repo graph is available.";
}

function enforcementGaps(input: {
  graphOk: boolean;
  gitOk: boolean;
  gitDetail: string;
  gitIgnoreOk: boolean;
  ciWorkflowOk: boolean;
  latestIntentOk: boolean;
  explicitPolicyOk: boolean;
}): string[] {
  const gaps: string[] = [];
  if (!input.graphOk) {
    gaps.push("No supported source graph is available.");
  }
  if (!input.gitOk) {
    gaps.push(`${input.gitDetail} Git is required for changed-file and CI drift checks.`);
  }
  if (!input.gitIgnoreOk) {
    gaps.push("Missing .gitignore hygiene for .ripple/.cache/; generated cache files may be committed accidentally.");
  }
  if (!input.ciWorkflowOk) {
    gaps.push("Ripple setup is missing the CI workflow, so unsafe changes cannot be blocked in PR checks.");
  }
  if (!input.explicitPolicyOk) {
    gaps.push("No explicit .ripple/policy.json exists; Ripple is using built-in policy defaults.");
  }
  return gaps;
}

function countCallEdges(engine: GraphEngine): number {
  let count = 0;
  engine.graph.symbols.forEach((symbol) => {
    count += symbol.calls.size;
  });
  return count;
}

function gitWorktreeCheck(workspaceRoot: string): RippleReadinessCheck {
  try {
    const output = execGit(
      workspaceRoot,
      ["rev-parse", "--is-inside-work-tree"],
      ["ignore", "pipe", "ignore"]
    );
    const insideWorktree = output.trim() === "true";
    return {
      ok: insideWorktree,
      detail: insideWorktree
        ? "Inside a git worktree"
        : "Git command ran, but this directory is not inside a git worktree",
      fix: insideWorktree
        ? undefined
        : "Run Ripple from the repository root or initialize git first.",
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      detail,
      fix: gitFixFor(detail),
    };
  }
}

function gitFixFor(detail: string): string {
  if (/could not be started|EPERM|EACCES/i.test(detail)) {
    return "Run Ripple from a normal terminal, or allow Node.js to execute git in this environment.";
  }
  if (/not found|ENOENT/i.test(detail)) {
    return "Install Git and make sure git is available on PATH.";
  }
  return "Run Ripple from the repository root or initialize git first.";
}

function rippleGitIgnoreCheck(workspaceRoot: string): RippleReadinessCheck {
  const gitignorePath = path.join(workspaceRoot, RIPPLE_GITIGNORE_PATH);
  if (!fs.existsSync(gitignorePath)) {
    return {
      ok: false,
      detail: "Missing .gitignore entry for .ripple/.cache/",
      fix: "Run ripple init or add .ripple/.cache/ to .gitignore.",
    };
  }

  const lines = fs
    .readFileSync(gitignorePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const broadRippleIgnore = lines.some(isBroadRippleIgnore);
  if (broadRippleIgnore) {
    return {
      ok: false,
      detail: "Overbroad .ripple/ ignore may hide policy, history, intents, or approvals",
      fix: "Ignore only .ripple/.cache/ so Ripple audit files can be committed intentionally.",
    };
  }

  const cacheIgnored = lines.some(isRippleCacheIgnore);
  return {
    ok: cacheIgnored,
    detail: cacheIgnored
      ? ".ripple/.cache/ is ignored; Ripple audit files remain commit-able"
      : "Missing .gitignore entry for .ripple/.cache/",
    fix: cacheIgnored
      ? undefined
      : "Run ripple init or add .ripple/.cache/ to .gitignore.",
  };
}

function isRippleCacheIgnore(line: string): boolean {
  const normalized = line.replace(/\\/g, "/").replace(/^\/+/, "");
  return (
    normalized === RIPPLE_CACHE_GITIGNORE_ENTRY ||
    normalized === ".ripple/.cache" ||
    normalized === ".ripple/.cache/**"
  );
}

function isBroadRippleIgnore(line: string): boolean {
  const normalized = line.replace(/\\/g, "/").replace(/^\/+/, "");
  return (
    normalized === ".ripple" ||
    normalized === ".ripple/" ||
    normalized === ".ripple/**"
  );
}

function formatWorkspacePath(workspaceRoot: string, filePath: string): string {
  const relative = path.relative(workspaceRoot, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return filePath;
}
