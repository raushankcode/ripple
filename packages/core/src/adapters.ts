import * as fs from "fs";
import * as path from "path";
import {
  RippleAdapterCapabilities,
  RippleAdapterCapability,
  RippleAdapterLanguage,
} from "./types";

export type RippleAdapterSupportLevel = "deep" | "generic";

export type RippleAdapterCapabilityStatus = "available" | "partial" | "unavailable";

export type RippleAdapterAgentUse = "trust" | "verify" | "manual";

export type RippleAdapterCapabilityConfidence = {
  capability: RippleAdapterCapability;
  status: RippleAdapterCapabilityStatus;
  confidence: number;
  reason: string;
  agentUse: RippleAdapterAgentUse;
};

export type RippleAdapterAgentPolicy = {
  canTrust: string[];
  beCarefulWith: string[];
  mustFallbackToManual: string[];
  planningGuidance: string[];
};

export type RippleDetectedAdapter = {
  id: string;
  supportLevel: RippleAdapterSupportLevel;
  confidence: number;
  capabilities: RippleAdapterCapabilities;
  capabilityProfile: RippleAdapterCapabilityConfidence[];
  agentPolicy: RippleAdapterAgentPolicy;
  matchedFiles: number;
  reason: string;
};

export type RippleAdapterDetectionSummary = {
  workspace: string;
  supportLevel: RippleAdapterSupportLevel;
  primaryAdapter: RippleDetectedAdapter;
  adapters: RippleDetectedAdapter[];
};

const JS_TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const PYTHON_EXTENSIONS = [".py"];
const ALL_ADAPTER_CAPABILITIES: RippleAdapterCapability[] = [
  "files",
  "dependencies",
  "reverse-dependencies",
  "symbols",
  "call-edges",
  "tests",
  "configs",
];
const GENERIC_IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".ripple",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

export const JS_TS_ADAPTER_CAPABILITIES: RippleAdapterCapabilities = {
  language: "typescript",
  displayName: "JavaScript / TypeScript",
  extensions: JS_TS_EXTENSIONS,
  capabilities: [
    "files",
    "dependencies",
    "reverse-dependencies",
    "symbols",
    "call-edges",
    "tests",
    "configs",
  ],
};

export const PYTHON_ADAPTER_CAPABILITIES: RippleAdapterCapabilities = {
  language: "python",
  displayName: "Python",
  extensions: PYTHON_EXTENSIONS,
  capabilities: [
    "files",
    "dependencies",
    "reverse-dependencies",
    "symbols",
    "call-edges",
    "tests",
    "configs",
  ],
};

export const GENERIC_ADAPTER_CAPABILITIES: RippleAdapterCapabilities = {
  language: "generic",
  displayName: "Generic repository",
  extensions: ["*"],
  capabilities: ["files", "configs"],
};

export function detectWorkspaceAdapters(workspaceRoot: string): RippleAdapterDetectionSummary {
  const extensionCounts = countExtensions(workspaceRoot);
  const jsTsCount = JS_TS_EXTENSIONS.reduce(
    (total, extension) => total + (extensionCounts.get(extension) ?? 0),
    0
  );
  const pythonCount = PYTHON_EXTENSIONS.reduce(
    (total, extension) => total + (extensionCounts.get(extension) ?? 0),
    0
  );
  const totalFiles = Array.from(extensionCounts.values()).reduce(
    (total, count) => total + count,
    0
  );
  const adapters: RippleDetectedAdapter[] = [];

  if (jsTsCount > 0) {
    adapters.push({
      id: "builtin-js-ts",
      supportLevel: "deep",
      confidence: 0.94,
      capabilities: {
        ...JS_TS_ADAPTER_CAPABILITIES,
        language: preferredJsTsLanguage(extensionCounts),
      },
      capabilityProfile: jsTsCapabilityProfile(),
      agentPolicy: jsTsAgentPolicy(),
      matchedFiles: jsTsCount,
      reason: "Detected JavaScript or TypeScript source files.",
    });
  }

  if (pythonCount > 0) {
    adapters.push({
      id: "builtin-python",
      supportLevel: "deep",
      confidence: 0.86,
      capabilities: PYTHON_ADAPTER_CAPABILITIES,
      capabilityProfile: pythonCapabilityProfile(),
      agentPolicy: pythonAgentPolicy(),
      matchedFiles: pythonCount,
      reason: "Detected Python source files.",
    });
  }

  const hasDeepAdapter = jsTsCount > 0 || pythonCount > 0;
  adapters.push({
    id: "builtin-generic",
    supportLevel: "generic",
    confidence: hasDeepAdapter ? 0.55 : 0.45,
    capabilities: GENERIC_ADAPTER_CAPABILITIES,
    capabilityProfile: genericCapabilityProfile(),
    agentPolicy: genericAgentPolicy(),
    matchedFiles: totalFiles,
    reason: hasDeepAdapter
      ? "Generic fallback remains available for files outside the active language adapters."
      : "No deep language adapter matched; using generic repository support.",
  });

  const primaryAdapter =
    adapters
      .filter((adapter) => adapter.supportLevel === "deep")
      .sort((a, b) => b.matchedFiles - a.matchedFiles || b.confidence - a.confidence)[0] ??
    adapters[0];

  return {
    workspace: workspaceRoot,
    supportLevel: primaryAdapter.supportLevel,
    primaryAdapter,
    adapters,
  };
}

export function hasAdapterCapability(
  adapter: RippleDetectedAdapter,
  capability: RippleAdapterCapability
): boolean {
  return adapter.capabilities.capabilities.includes(capability);
}

export function adapterCapabilityConfidence(
  adapter: RippleDetectedAdapter,
  capability: RippleAdapterCapability
): RippleAdapterCapabilityConfidence | undefined {
  return adapter.capabilityProfile.find((item) => item.capability === capability);
}

function jsTsCapabilityProfile(): RippleAdapterCapabilityConfidence[] {
  return [
    {
      capability: "files",
      status: "available",
      confidence: 0.99,
      reason: "JS/TS file discovery is extension based and excludes generated/cache folders.",
      agentUse: "trust",
    },
    {
      capability: "dependencies",
      status: "available",
      confidence: 0.94,
      reason: "Static import/export and require edges are parsed from JS/TS source.",
      agentUse: "trust",
    },
    {
      capability: "reverse-dependencies",
      status: "available",
      confidence: 0.94,
      reason: "Reverse edges are derived from the same static dependency graph.",
      agentUse: "trust",
    },
    {
      capability: "symbols",
      status: "available",
      confidence: 0.9,
      reason: "Functions, classes, methods, variables, and exported symbols are parsed with TypeScript AST support.",
      agentUse: "trust",
    },
    {
      capability: "call-edges",
      status: "partial",
      confidence: 0.74,
      reason: "Direct call references are useful, but dynamic dispatch, reflection, and framework wiring can hide edges.",
      agentUse: "verify",
    },
    {
      capability: "tests",
      status: "partial",
      confidence: 0.72,
      reason: "Test links use imports and naming conventions; framework-specific behavior may need manual confirmation.",
      agentUse: "verify",
    },
    {
      capability: "configs",
      status: "partial",
      confidence: 0.68,
      reason: "Common JS/TS config files are detected, but project-specific runtime config can be custom.",
      agentUse: "verify",
    },
  ];
}

function genericCapabilityProfile(): RippleAdapterCapabilityConfidence[] {
  return ALL_ADAPTER_CAPABILITIES.map((capability) => {
    if (capability === "files") {
      return {
        capability,
        status: "available",
        confidence: 0.72,
        reason: "Generic support can discover repository files while ignoring common generated folders.",
        agentUse: "trust",
      };
    }
    if (capability === "configs") {
      return {
        capability,
        status: "partial",
        confidence: 0.42,
        reason: "Generic support can notice config-like files, but cannot interpret every stack-specific setting.",
        agentUse: "verify",
      };
    }
    return {
      capability,
      status: "unavailable",
      confidence: 0,
      reason: "No deep language adapter is active for this capability.",
      agentUse: "manual",
    };
  });
}

function pythonCapabilityProfile(): RippleAdapterCapabilityConfidence[] {
  return [
    {
      capability: "files",
      status: "available",
      confidence: 0.98,
      reason: "Python file discovery is extension based and excludes generated/cache folders.",
      agentUse: "trust",
    },
    {
      capability: "dependencies",
      status: "partial",
      confidence: 0.78,
      reason: "Static import and from-import statements are parsed, but dynamic imports can hide edges.",
      agentUse: "verify",
    },
    {
      capability: "reverse-dependencies",
      status: "partial",
      confidence: 0.78,
      reason: "Reverse edges are derived from parsed Python imports and package-relative resolution.",
      agentUse: "verify",
    },
    {
      capability: "symbols",
      status: "available",
      confidence: 0.82,
      reason: "Python functions, async functions, classes, and methods are detected from source structure.",
      agentUse: "trust",
    },
    {
      capability: "call-edges",
      status: "partial",
      confidence: 0.58,
      reason: "Name-based Python call edges catch direct calls but cannot prove dynamic dispatch or monkey patching.",
      agentUse: "verify",
    },
    {
      capability: "tests",
      status: "partial",
      confidence: 0.7,
      reason: "Pytest/unittest-style test files are linked through imports and naming conventions.",
      agentUse: "verify",
    },
    {
      capability: "configs",
      status: "partial",
      confidence: 0.62,
      reason: "Common Python config files can be detected, but runtime behavior may live in custom settings.",
      agentUse: "verify",
    },
  ];
}

function jsTsAgentPolicy(): RippleAdapterAgentPolicy {
  return {
    canTrust: [
      "JS/TS source file discovery",
      "static imports and reverse importers",
      "declared symbols and exported contracts",
      "direct test files found through imports",
    ],
    beCarefulWith: [
      "dynamic import paths",
      "runtime framework routing",
      "dependency injection or reflection",
      "generated files and build artifacts",
      "indirect tests discovered only by naming conventions",
    ],
    mustFallbackToManual: [
      "non-JS/TS services in the same repo",
      "runtime behavior hidden behind external configuration",
      "call paths created by strings, decorators, or framework metadata",
    ],
    planningGuidance: [
      "Use readFirst, symbolFocus, importers, and verificationTargets as primary planning signals.",
      "For call-edge-only risk, verify direct callers before assuming the graph is complete.",
      "If a task touches runtime routing or generated code, inspect framework config manually.",
    ],
  };
}

function pythonAgentPolicy(): RippleAdapterAgentPolicy {
  return {
    canTrust: [
      "Python source file discovery",
      "declared functions, classes, and methods",
      "top-level static import statements",
      "direct test files found through imports",
    ],
    beCarefulWith: [
      "dynamic imports through importlib or __import__",
      "runtime monkey patching and dependency injection",
      "framework routing through decorators or external config",
      "namespace packages without explicit local files",
      "tests discovered only by naming convention",
    ],
    mustFallbackToManual: [
      "metaclass behavior and decorators that rewrite call paths",
      "runtime plugin loading",
      "package imports resolved only through virtual environments",
      "behavior controlled by deployment-specific config",
    ],
    planningGuidance: [
      "Use readFirst, importers, symbolFocus, and verificationTargets as structural planning signals.",
      "Verify call-edge and test-target findings before relying on them for commit safety.",
      "Inspect decorators, framework routes, and dynamic imports manually when they are part of the task.",
    ],
  };
}

function genericAgentPolicy(): RippleAdapterAgentPolicy {
  return {
    canTrust: [
      "repository file discovery",
      "git changed-file scope",
      "basic config and documentation presence",
    ],
    beCarefulWith: [
      "all dependency relationships",
      "all symbol and function-level conclusions",
      "test target recommendations",
    ],
    mustFallbackToManual: [
      "callers and blast radius",
      "public contracts",
      "language-specific tests",
      "framework routes and runtime wiring",
    ],
    planningGuidance: [
      "Use Ripple as a file-level and git-scope guide only.",
      "Read language-specific entry points and tests manually before editing.",
      "Treat missing symbols or call edges as unknown, not safe.",
    ],
  };
}

function preferredJsTsLanguage(extensionCounts: Map<string, number>): RippleAdapterLanguage {
  const typeScriptCount =
    (extensionCounts.get(".ts") ?? 0) + (extensionCounts.get(".tsx") ?? 0);
  return typeScriptCount > 0 ? "typescript" : "javascript";
}

function countExtensions(workspaceRoot: string): Map<string, number> {
  const counts = new Map<string, number>();
  walkWorkspace(workspaceRoot, (filePath) => {
    const extension = path.extname(filePath).toLowerCase();
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  });
  return counts;
}

function walkWorkspace(root: string, visitFile: (filePath: string) => void): void {
  if (!fs.existsSync(root)) {
    return;
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  entries.forEach((entry) => {
    if (entry.isDirectory()) {
      if (GENERIC_IGNORE_DIRS.has(entry.name)) {
        return;
      }
      walkWorkspace(path.join(root, entry.name), visitFile);
      return;
    }

    if (entry.isFile()) {
      visitFile(path.join(root, entry.name));
    }
  });
}
