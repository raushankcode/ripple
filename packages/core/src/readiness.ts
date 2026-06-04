import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { RippleAdapterDetectionSummary, detectWorkspaceAdapters } from "./adapters";
import { defaultChangeIntentPath } from "./change-intent";
import { GraphEngine } from "./graph";

export const RIPPLE_CI_WORKFLOW_PATH = ".github/workflows/ripple.yml";

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

export type RippleReadinessSummary = {
  status: "ready" | "needs_setup";
  workspace: string;
  sourceFiles: number;
  symbols: number;
  callEdges: number;
  adapterSupport: RippleAdapterDetectionSummary;
  enforcement: RippleEnforcementReadiness;
  checks: {
    graph: RippleReadinessCheck;
    git: RippleReadinessCheck;
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
  const gitOk = isGitWorktree(workspaceRoot);
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
    git: {
      ok: gitOk,
      detail: gitOk ? "Inside a git worktree" : "Not inside a git worktree",
      fix: gitOk ? undefined : "Run Ripple inside a git repository.",
    },
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
        : "Missing .ripple/intents/latest.json",
      fix: latestIntentOk
        ? undefined
        : "Run ripple plan --file <file> --task \"<task>\" --save before CI.",
    },
  };
  const enforcement = buildEnforcementReadiness({
    graphOk,
    gitOk,
    ciWorkflowOk,
    latestIntentOk,
    explicitPolicyOk,
  });
  const nextSteps = Object.values(checks)
    .map((check) => check.fix)
    .filter((fix): fix is string => Boolean(fix));

  if (nextSteps.length === 0) {
    nextSteps.push("Run ripple ci --base origin/main --intent latest --github-annotations.");
  }

  return {
    status: Object.values(checks).every((check) => check.ok) ? "ready" : "needs_setup",
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

function buildEnforcementReadiness(input: {
  graphOk: boolean;
  gitOk: boolean;
  ciWorkflowOk: boolean;
  latestIntentOk: boolean;
  explicitPolicyOk: boolean;
}): RippleEnforcementReadiness {
  const canGuideAgents = input.graphOk;
  const canDetectDrift = input.graphOk && input.gitOk && input.latestIntentOk;
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
  ciWorkflowOk: boolean;
  latestIntentOk: boolean;
  explicitPolicyOk: boolean;
}): string[] {
  const gaps: string[] = [];
  if (!input.graphOk) {
    gaps.push("No supported source graph is available.");
  }
  if (!input.gitOk) {
    gaps.push("Git worktree is required for changed-file and CI drift checks.");
  }
  if (!input.latestIntentOk) {
    gaps.push("No latest saved intent exists, so Ripple cannot compare agent work to a plan.");
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

function isGitWorktree(workspaceRoot: string): boolean {
  try {
    const output = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim() === "true";
  } catch {
    return false;
  }
}

function formatWorkspacePath(workspaceRoot: string, filePath: string): string {
  const relative = path.relative(workspaceRoot, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return filePath;
}
