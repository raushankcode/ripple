import * as fs from "fs";
import * as path from "path";
import type { ChangeIntent, ControlBoundaryRisk, ControlMode, HumanGate } from "./change-intent";

export const RIPPLE_POLICY_PATH = ".ripple/policy.json";

export type RipplePolicyRiskRule = {
  paths: string[];
  risk?: ControlBoundaryRisk;
  requireHumanBeforeEdit?: boolean;
  requireHumanBeforeMerge?: boolean;
  allowPrMode?: boolean;
};

export type RipplePolicy = {
  protocol?: "ripple-policy";
  version?: 1;
  defaultMode?: ControlMode;
  riskRules?: RipplePolicyRiskRule[];
};

export type SmartRipplePolicyDetection = {
  kind: string;
  evidence: string[];
  rules: RipplePolicyRiskRule[];
};

export type LoadedRipplePolicy = {
  policy: RipplePolicy;
  path: string;
  exists: boolean;
};

export type RipplePolicyResolution = {
  source: "file" | "built-in";
  sourcePath?: string;
  defaultMode?: ControlMode;
  risk?: ControlBoundaryRisk;
  requireHumanBeforeEdit: boolean;
  requireHumanBeforeMerge: boolean;
  allowPrMode?: boolean;
  matchedRules: string[];
};

export type RipplePolicyExplanation = {
  protocol: "ripple-policy-explanation";
  version: 1;
  targetFile: string;
  policySource: string;
  policyExists: boolean;
  effectiveMode: ControlMode;
  policyRisk: ControlBoundaryRisk | "none";
  humanGate: HumanGate;
  humanRequired: boolean;
  allowPrMode: boolean;
  matchedRules: string[];
  why: string[];
  nextSteps: string[];
};

export type RipplePolicyExplanationOptions = {
  controlMode?: ControlMode;
};

const CONTROL_MODES: ControlMode[] = ["brainstorm", "function", "file", "task", "pr"];
const RISK_LEVELS: ControlBoundaryRisk[] = ["low", "medium", "high", "critical"];

export function defaultRipplePolicy(): RipplePolicy {
  return {
    protocol: "ripple-policy",
    version: 1,
    defaultMode: "file",
    riskRules: [
      {
        paths: ["src/auth/**", "src/security/**", "src/session/**"],
        risk: "high",
        requireHumanBeforeEdit: true,
      },
      {
        paths: ["src/payments/**", "migrations/**", "database/**", "db/**"],
        risk: "critical",
        requireHumanBeforeEdit: true,
        requireHumanBeforeMerge: true,
      },
      {
        paths: ["docs/**", "**/*.md"],
        risk: "low",
        allowPrMode: true,
      },
    ],
  };
}

export function buildSmartRipplePolicy(workspaceRoot: string): {
  policy: RipplePolicy;
  detections: SmartRipplePolicyDetection[];
} {
  const base = defaultRipplePolicy();
  const detections = detectSmartRipplePolicyRules(workspaceRoot);
  const riskRules = mergeRippleRiskRules([
    ...(base.riskRules ?? []),
    ...detections.flatMap((detection) => detection.rules),
  ]);

  return {
    policy: {
      ...base,
      riskRules,
    },
    detections,
  };
}

export function formatRipplePolicy(policy: RipplePolicy = defaultRipplePolicy()): string {
  return `${JSON.stringify(policy, null, 2)}\n`;
}

export function ripplePolicyPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, RIPPLE_POLICY_PATH);
}

export function loadRipplePolicy(workspaceRoot: string): LoadedRipplePolicy {
  const policyPath = ripplePolicyPath(workspaceRoot);
  if (!fs.existsSync(policyPath)) {
    return {
      policy: {},
      path: policyPath,
      exists: false,
    };
  }

  const parsed = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  return {
    policy: normalizeRipplePolicy(parsed, policyPath),
    path: policyPath,
    exists: true,
  };
}

export function resolveRipplePolicyForTarget(
  loaded: LoadedRipplePolicy,
  targetFile: string
): RipplePolicyResolution {
  const policy = loaded.policy;
  const source = loaded.exists ? "file" : "built-in";
  const matchedRules: string[] = [];
  let risk: ControlBoundaryRisk | undefined;
  let requireHumanBeforeEdit = false;
  let requireHumanBeforeMerge = false;
  let allowPrMode: boolean | undefined;

  (policy.riskRules ?? []).forEach((rule, index) => {
    if (!rule.paths.some((pattern) => matchesPolicyPath(pattern, targetFile))) {
      return;
    }

    matchedRules.push(describeRiskRule(rule, index));
    if (rule.risk) {
      risk = strongestRisk(risk, rule.risk);
    }
    requireHumanBeforeEdit = requireHumanBeforeEdit || rule.requireHumanBeforeEdit === true;
    requireHumanBeforeMerge = requireHumanBeforeMerge || rule.requireHumanBeforeMerge === true;
    if (rule.allowPrMode !== undefined) {
      allowPrMode = allowPrMode === undefined ? rule.allowPrMode : allowPrMode || rule.allowPrMode;
    }
  });

  return {
    source,
    sourcePath: loaded.exists ? RIPPLE_POLICY_PATH : undefined,
    defaultMode: policy.defaultMode,
    risk,
    requireHumanBeforeEdit,
    requireHumanBeforeMerge,
    allowPrMode,
    matchedRules,
  };
}

export function explainRipplePolicyForTarget(
  loaded: LoadedRipplePolicy,
  targetFile: string,
  options: RipplePolicyExplanationOptions = {}
): RipplePolicyExplanation {
  const resolution = resolveRipplePolicyForTarget(loaded, targetFile);
  const policyDefaultMode = resolution.defaultMode ?? "file";
  const effectiveMode = options.controlMode ?? policyDefaultMode;
  const humanGate = policyHumanGate(resolution, effectiveMode);
  const policySource = resolution.sourcePath ?? "built-in default";
  const why: string[] = [];
  const nextSteps: string[] = [];

  if (loaded.exists) {
    why.push(`Trust policy loaded from ${policySource}.`);
  } else {
    why.push("No .ripple/policy.json found; Ripple will use built-in defaults.");
    nextSteps.push("Run ripple policy init to create repo-level trust defaults.");
  }

  if (resolution.defaultMode) {
    why.push(`Default control mode: ${resolution.defaultMode}.`);
  } else {
    why.push("No defaultMode set; Ripple will default to file mode.");
  }

  if (options.controlMode && options.controlMode !== policyDefaultMode) {
    why.push(`Requested control mode overrides policy default: ${options.controlMode}.`);
  }

  if (resolution.matchedRules.length > 0) {
    why.push(`Matched policy rules: ${resolution.matchedRules.join("; ")}.`);
  } else {
    why.push("No path-specific policy rule matched this file.");
    if (loaded.exists) {
      nextSteps.push("Add a riskRules entry if this path needs a stronger trust boundary.");
    }
  }

  if (resolution.risk) {
    why.push(`Policy risk: ${resolution.risk}.`);
  }
  if (resolution.requireHumanBeforeEdit) {
    why.push("Policy requires human approval before editing.");
  }
  if (resolution.requireHumanBeforeMerge) {
    why.push("Policy requires human approval before merge.");
  }
  if (effectiveMode === "brainstorm") {
    why.push("Brainstorm mode means no file edits are allowed.");
  }
  if (effectiveMode === "pr") {
    why.push("PR mode still requires human review before merge.");
  }

  if (humanGate === "required-before-edit") {
    nextSteps.push("Ask the human to approve before the agent edits this file.");
  } else if (humanGate === "required-before-merge") {
    nextSteps.push("Require human review before merging this change.");
  } else {
    nextSteps.push("Use ripple plan to create a saved intent before editing.");
  }

  return {
    protocol: "ripple-policy-explanation",
    version: 1,
    targetFile,
    policySource,
    policyExists: loaded.exists,
    effectiveMode,
    policyRisk: resolution.risk ?? "none",
    humanGate,
    humanRequired: humanGate !== "none",
    allowPrMode: resolution.allowPrMode === true,
    matchedRules: resolution.matchedRules,
    why: uniqueItems(why),
    nextSteps: uniqueItems(nextSteps),
  };
}

export function explainRipplePolicyForIntent(
  loaded: LoadedRipplePolicy,
  intent: ChangeIntent
): RipplePolicyExplanation {
  const explanation = explainRipplePolicyForTarget(loaded, intent.targetFile, {
    controlMode: intent.controlMode,
  });
  const boundaryGate = humanGateFromIntentBoundary(intent);
  const humanGate = strongestHumanGate(explanation.humanGate, boundaryGate);

  if (humanGate === explanation.humanGate) {
    return explanation;
  }

  return {
    ...explanation,
    humanGate,
    humanRequired: humanGate !== "none",
    why: uniqueItems([
      ...explanation.why,
      ...boundaryGateWhy(intent, boundaryGate),
    ]),
    nextSteps: uniqueItems([
      ...humanGateNextSteps(humanGate),
      ...explanation.nextSteps,
    ]),
  };
}


function detectSmartRipplePolicyRules(workspaceRoot: string): SmartRipplePolicyDetection[] {
  const detections: SmartRipplePolicyDetection[] = [];
  const addDetection = (
    kind: string,
    evidence: string[],
    rules: RipplePolicyRiskRule[]
  ): void => {
    const cleanEvidence = uniqueItems(evidence.filter(Boolean));
    if (cleanEvidence.length === 0) {
      return;
    }
    detections.push({ kind, evidence: cleanEvidence, rules });
  };

  const has = (relativePath: string): boolean => pathExists(workspaceRoot, relativePath);
  const hasAny = (relativePaths: string[]): string[] =>
    relativePaths.filter((relativePath) => has(relativePath));

  const packageJson = readPackageJson(workspaceRoot);
  const dependencies = packageJsonDependencies(packageJson);

  const nextEvidence = [
    ...hasAny(["next.config.js", "next.config.mjs", "next.config.ts", "app", "pages"]),
    ...(dependencies.has("next") ? ["package.json dependency: next"] : []),
  ];
  addDetection("nextjs", nextEvidence, [
    {
      paths: ["app/api/**", "pages/api/**", "middleware.ts", "middleware.js"],
      risk: "high",
      requireHumanBeforeEdit: true,
      requireHumanBeforeMerge: true,
    },
  ]);

  const prismaEvidence = [
    ...hasAny(["prisma/schema.prisma", "prisma/migrations"]),
    ...(dependencies.has("prisma") || dependencies.has("@prisma/client")
      ? ["package.json dependency: prisma"]
      : []),
  ];
  addDetection("prisma", prismaEvidence, [
    {
      paths: ["prisma/schema.prisma", "prisma/migrations/**"],
      risk: "critical",
      requireHumanBeforeEdit: true,
      requireHumanBeforeMerge: true,
    },
  ]);

  const drizzleEvidence = [
    ...hasAny(["drizzle", "drizzle.config.ts", "drizzle.config.js"]),
    ...(dependencies.has("drizzle-orm") ? ["package.json dependency: drizzle-orm"] : []),
  ];
  addDetection("drizzle", drizzleEvidence, [
    {
      paths: ["drizzle/**", "drizzle.config.*"],
      risk: "critical",
      requireHumanBeforeEdit: true,
      requireHumanBeforeMerge: true,
    },
  ]);

  const envEvidence = hasAny([".env", ".env.local", ".env.production", ".env.example"]);
  addDetection("env", envEvidence, [
    {
      paths: [".env", ".env.*"],
      risk: "critical",
      requireHumanBeforeEdit: true,
      requireHumanBeforeMerge: true,
    },
  ]);

  const githubEvidence = findGithubWorkflowEvidence(workspaceRoot);
  addDetection("github-actions", githubEvidence, [
    {
      paths: [".github/workflows/**"],
      risk: "high",
      requireHumanBeforeEdit: true,
      requireHumanBeforeMerge: true,
    },
  ]);

  const lockfileEvidence = hasAny(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"]);
  addDetection("lockfiles", lockfileEvidence, [
    {
      paths: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"],
      risk: "medium",
      requireHumanBeforeMerge: true,
    },
  ]);

  const infraEvidence = hasAny(["Dockerfile", "docker-compose.yml", "docker-compose.yaml", "terraform", "infra"]);
  addDetection("infra", infraEvidence, [
    {
      paths: ["Dockerfile", "docker-compose.*", "terraform/**", "infra/**"],
      risk: "high",
      requireHumanBeforeEdit: true,
      requireHumanBeforeMerge: true,
    },
  ]);

  const appRiskEvidence = findDirectoriesMatching(workspaceRoot, [
    "auth",
    "security",
    "session",
    "payment",
    "payments",
    "billing",
    "db",
    "database",
    "migration",
    "migrations",
  ]);
  const appRiskRules = appRiskEvidence.flatMap((relativePath) => {
    const name = path.basename(relativePath).toLowerCase();
    const isCritical = ["payment", "payments", "billing", "db", "database", "migration", "migrations"].includes(name);
    return [
      {
        paths: [`${relativePath}/**`],
        risk: isCritical ? "critical" as const : "high" as const,
        requireHumanBeforeEdit: true,
        requireHumanBeforeMerge: isCritical,
      },
    ];
  });
  addDetection("risky-directories", appRiskEvidence, appRiskRules);

  return detections;
}

function mergeRippleRiskRules(rules: RipplePolicyRiskRule[]): RipplePolicyRiskRule[] {
  const merged = new Map<string, RipplePolicyRiskRule>();
  rules.forEach((rule) => {
    const key = rule.paths.join("\u0000");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...rule, paths: [...rule.paths] });
      return;
    }
    const allowPrMode = existing.allowPrMode === true || rule.allowPrMode === true ? true : undefined;
    merged.set(key, {
      paths: existing.paths,
      risk: mergeRisk(existing.risk, rule.risk),
      requireHumanBeforeEdit: existing.requireHumanBeforeEdit === true || rule.requireHumanBeforeEdit === true,
      requireHumanBeforeMerge: existing.requireHumanBeforeMerge === true || rule.requireHumanBeforeMerge === true,
      ...(allowPrMode === true ? { allowPrMode } : {}),
    });
  });
  return [...merged.values()];
}

function mergeRisk(
  first: ControlBoundaryRisk | undefined,
  second: ControlBoundaryRisk | undefined
): ControlBoundaryRisk | undefined {
  if (!second) {
    return first;
  }
  if (!first) {
    return second;
  }
  return strongestRisk(first, second);
}


function findGithubWorkflowEvidence(workspaceRoot: string): string[] {
  const workflowsRoot = path.join(workspaceRoot, ".github", "workflows");
  if (!fs.existsSync(workflowsRoot) || !fs.statSync(workflowsRoot).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(workflowsRoot)
    .filter((entry) => entry !== "ripple.yml")
    .filter((entry) => /\.(ya?ml)$/i.test(entry))
    .map((entry) => path.join(".github", "workflows", entry).split(path.sep).join("/"));
}

function pathExists(workspaceRoot: string, relativePath: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, relativePath));
}

function readPackageJson(workspaceRoot: string): unknown {
  const packagePath = path.join(workspaceRoot, "package.json");
  if (!fs.existsSync(packagePath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    return undefined;
  }
}

function packageJsonDependencies(value: unknown): Set<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Set();
  }
  const record = value as Record<string, unknown>;
  const names = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
    .flatMap((field) => {
      const dependencies = record[field];
      if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
        return [];
      }
      return Object.keys(dependencies as Record<string, unknown>);
    });
  return new Set(names);
}

function findDirectoriesMatching(workspaceRoot: string, names: string[]): string[] {
  const targets = new Set(names.map((name) => name.toLowerCase()));
  const results: string[] = [];
  const ignored = new Set([".git", ".ripple", "node_modules", "dist", "build", "out", "coverage", ".next"]);
  const visit = (absoluteDir: string, depth: number): void => {
    if (depth > 4) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.forEach((entry) => {
      if (!entry.isDirectory() || ignored.has(entry.name)) {
        return;
      }
      const absolutePath = path.join(absoluteDir, entry.name);
      const relativePath = normalizePolicyPath(path.relative(workspaceRoot, absolutePath));
      if (targets.has(entry.name.toLowerCase())) {
        results.push(relativePath);
      }
      visit(absolutePath, depth + 1);
    });
  };

  visit(workspaceRoot, 0);
  return uniqueItems(results).sort();
}

function policyHumanGate(
  resolution: RipplePolicyResolution,
  effectiveMode: ControlMode
): HumanGate {
  if (resolution.requireHumanBeforeEdit || effectiveMode === "brainstorm") {
    return "required-before-edit";
  }
  if (resolution.requireHumanBeforeMerge || effectiveMode === "pr") {
    return "required-before-merge";
  }
  return "none";
}

function humanGateFromIntentBoundary(intent: ChangeIntent): HumanGate {
  if (intent.controlMode === "brainstorm") {
    return "required-before-edit";
  }
  if (intent.boundaryRisk === "critical" || intent.boundaryRisk === "high") {
    return "required-before-edit";
  }
  if (intent.controlMode === "pr") {
    return "required-before-merge";
  }
  return "none";
}

function strongestHumanGate(first: HumanGate, second: HumanGate): HumanGate {
  return humanGateRank(second) > humanGateRank(first) ? second : first;
}

function humanGateRank(gate: HumanGate): number {
  if (gate === "required-before-edit") {
    return 2;
  }
  if (gate === "required-before-merge") {
    return 1;
  }
  return 0;
}

function boundaryGateWhy(intent: ChangeIntent, gate: HumanGate): string[] {
  if (gate === "required-before-edit") {
    if (intent.controlMode === "brainstorm") {
      return ["Ripple boundary requires human approval because brainstorm mode does not allow file edits."];
    }
    return [
      `Ripple boundary requires human approval before editing because the saved target is ${intent.boundaryRisk} risk.`,
    ];
  }
  if (gate === "required-before-merge") {
    return ["Ripple boundary requires human review before merge because PR mode was selected."];
  }
  return [];
}

function humanGateNextSteps(gate: HumanGate): string[] {
  if (gate === "required-before-edit") {
    return ["Ask the human to approve before the agent edits this file."];
  }
  if (gate === "required-before-merge") {
    return ["Require human review before merging this change."];
  }
  return ["Use ripple plan to create a saved intent before editing."];
}

function normalizeRipplePolicy(value: unknown, sourcePath: string): RipplePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${sourcePath} must contain a JSON object.`);
  }

  const raw = value as RipplePolicy;
  if (raw.protocol !== undefined && raw.protocol !== "ripple-policy") {
    throw new Error(`${sourcePath} has unsupported protocol: ${String(raw.protocol)}`);
  }
  if (raw.version !== undefined && raw.version !== 1) {
    throw new Error(`${sourcePath} has unsupported version: ${String(raw.version)}`);
  }
  if (raw.defaultMode !== undefined && !isControlMode(raw.defaultMode)) {
    throw new Error(`${sourcePath} defaultMode must be one of: ${CONTROL_MODES.join(", ")}`);
  }

  return {
    protocol: raw.protocol,
    version: raw.version,
    defaultMode: raw.defaultMode,
    riskRules: normalizeRiskRules(raw.riskRules, sourcePath),
  };
}

function normalizeRiskRules(
  value: RipplePolicyRiskRule[] | undefined,
  sourcePath: string
): RipplePolicyRiskRule[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath} riskRules must be an array.`);
  }

  return value.map((rule, index) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new Error(`${sourcePath} riskRules[${index}] must be an object.`);
    }
    if (!Array.isArray(rule.paths) || rule.paths.some((item) => typeof item !== "string")) {
      throw new Error(`${sourcePath} riskRules[${index}].paths must be a string array.`);
    }
    if (rule.risk !== undefined && !isRisk(rule.risk)) {
      throw new Error(`${sourcePath} riskRules[${index}].risk must be one of: ${RISK_LEVELS.join(", ")}`);
    }

    return {
      paths: rule.paths,
      risk: rule.risk,
      requireHumanBeforeEdit: rule.requireHumanBeforeEdit === true,
      requireHumanBeforeMerge: rule.requireHumanBeforeMerge === true,
      allowPrMode: rule.allowPrMode,
    };
  });
}

function describeRiskRule(rule: RipplePolicyRiskRule, index: number): string {
  const risk = rule.risk ? ` risk=${rule.risk}` : "";
  return `riskRules[${index}] paths=${rule.paths.join(",")}${risk}`;
}

function matchesPolicyPath(pattern: string, filePath: string): boolean {
  const normalizedPattern = normalizePolicyPath(pattern);
  const normalizedFile = normalizePolicyPath(filePath);
  const hasGlob = normalizedPattern.includes("*");

  if (!hasGlob) {
    return normalizedFile === normalizedPattern || normalizedFile.startsWith(`${normalizedPattern}/`);
  }

  return globPatternToRegExp(normalizedPattern).test(normalizedFile);
}

function normalizePolicyPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      source += ".*";
      i++;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    source += escapeRegExp(char);
  }
  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function strongestRisk(
  first: ControlBoundaryRisk | undefined,
  second: ControlBoundaryRisk
): ControlBoundaryRisk {
  if (!first) {
    return second;
  }
  return riskRank(second) > riskRank(first) ? second : first;
}

function riskRank(risk: ControlBoundaryRisk): number {
  return RISK_LEVELS.indexOf(risk);
}

function isControlMode(value: unknown): value is ControlMode {
  return CONTROL_MODES.includes(value as ControlMode);
}

function isRisk(value: unknown): value is ControlBoundaryRisk {
  return RISK_LEVELS.includes(value as ControlBoundaryRisk);
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
