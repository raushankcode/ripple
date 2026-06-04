import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  Node,
  Project,
  SyntaxKind,
} from "ts-morph";
import {
  ContextPlanAdapterSignal,
  FileFocusSummary,
  GraphEngine,
} from "./graph";
import { RippleAdapterCapability, SymbolNode } from "./types";
import type { RippleAdapterDetectionSummary } from "./adapters";

export type StagedCheckChangedLineRange = {
  start: number;
  end: number;
  lineCount: number;
};

export type StagedCheckSymbolChangeKind =
  | "implementation"
  | "signature-or-contract"
  | "return-shape-review";

export type StagedCheckSymbolContractRisk = "none" | "review" | "high";
export type StagedCheckSymbolStatus = "created" | "modified";

export type StagedCheckChangedSymbol = {
  symbol: string;
  file: string;
  name: string;
  kind: SymbolNode["kind"];
  layer: SymbolNode["layer"];
  exported: boolean;
  callers: number;
  calls: number;
  symbolStatus: StagedCheckSymbolStatus;
  changeKind: StagedCheckSymbolChangeKind;
  contractRisk: StagedCheckSymbolContractRisk;
  signatureTouched: boolean;
  signatureChanged: boolean;
  contractChanged: boolean;
  returnLineChanged: boolean;
  changedLines: number[];
  lineRange: {
    start: number;
    end: number;
  };
  reason: string;
  adapterSignals: ContextPlanAdapterSignal[];
};

export type StagedCheckContractRisk = {
  file: string;
  symbol: string;
  risk: Exclude<StagedCheckSymbolContractRisk, "none">;
  reason: string;
  callers: number;
  exported: boolean;
  verificationTargets: string[];
  adapterSignals: ContextPlanAdapterSignal[];
};

export type StagedCheckFileSummary = {
  file: string;
  focus: string;
  modificationRisk: FileFocusSummary["modificationRisk"];
  importerCount: number;
  symbolCount: number;
  changedLineRanges: StagedCheckChangedLineRange[];
  changedSymbols: StagedCheckChangedSymbol[];
  contractRisks: StagedCheckContractRisk[];
  readFirst: string[];
  symbolFocus: string[];
  verificationTargets: string[];
  adapterSignals: ContextPlanAdapterSignal[];
};

export type StagedCheckAgentActions = {
  trustedFindings: string[];
  verifyBeforeCommit: string[];
  manualReviewRequired: string[];
};

export type StagedCheckSummary = {
  workspace: string;
  mode: "staged" | "changed";
  baseRef?: string;
  stagedFiles: number;
  checkedFiles: number;
  skippedFiles: string[];
  missingFiles: string[];
  highestRisk: FileFocusSummary["modificationRisk"] | "none";
  requiresAttention: boolean;
  adapterSupport: RippleAdapterDetectionSummary;
  agentActions: StagedCheckAgentActions;
  changedSymbols: StagedCheckChangedSymbol[];
  contractRisks: StagedCheckContractRisk[];
  files: StagedCheckFileSummary[];
};

export type BuildStagedCheckSummaryOptions = {
  workspaceRoot: string;
  stagedFiles: string[];
  mode?: "staged" | "changed";
  baseRef?: string;
  stagedDiff?: string;
  task?: string;
  tokenBudget?: number;
};

type ParsedStagedFileDiff = {
  file: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
  changedLineRanges: StagedCheckChangedLineRange[];
  changedLines: Array<{
    line: number;
    text: string;
    kind: "added" | "removed";
  }>;
};

type ParsedSymbolRange = {
  symbol: string;
  file: string;
  name: string;
  kind: SymbolNode["kind"];
  layer: SymbolNode["layer"];
  exported: boolean;
  callers: number;
  calls: number;
  startLine: number;
  endLine: number;
  signatureStartLine: number;
  signatureEndLine: number;
  signatureText: string;
};

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|py)$/i;
const DEFAULT_STAGED_CHECK_TASK = "Review staged change before commit";
const RISK_RANK: Record<FileFocusSummary["modificationRisk"], number> = {
  safe: 1,
  caution: 2,
  dangerous: 3,
};
const TEST_FILE_RE = /(^|[\\/])(__tests__|tests?|specs?)([\\/])|(\.test|\.spec)\.(ts|tsx|js|jsx|py)$/i;

export function isRippleSourceFile(filePath: string): boolean {
  return SOURCE_FILE_RE.test(filePath) && !filePath.endsWith(".d.ts");
}

export function listGitStagedFiles(workspaceRoot: string): string[] {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", "--cached", "--diff-filter=ACMR"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read staged files with git diff --cached: ${message}`);
  }
}

export function listGitStagedDiff(workspaceRoot: string): string {
  try {
    return execFileSync(
      "git",
      ["diff", "--cached", "--unified=0", "--no-ext-diff"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read staged diff with git diff --cached: ${message}`);
  }
}

export function listGitChangedFiles(workspaceRoot: string, baseRef: string): string[] {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMR", baseRef, "--"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .concat(listGitUntrackedSourceFiles(workspaceRoot))
      .filter(uniqueString);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read changed files with git diff ${baseRef}: ${message}`);
  }
}

function listGitUntrackedSourceFiles(workspaceRoot: string): string[] {
  try {
    const output = execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && isRippleSourceFile(line));
  } catch {
    return [];
  }
}

function uniqueString(value: string, index: number, values: string[]): boolean {
  return values.indexOf(value) === index;
}

export function listGitChangedDiff(workspaceRoot: string, baseRef: string): string {
  try {
    return execFileSync(
      "git",
      ["diff", "--unified=0", "--no-ext-diff", baseRef, "--"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read changed diff with git diff ${baseRef}: ${message}`);
  }
}

function adapterSignalFor(
  adapterSupport: RippleAdapterDetectionSummary,
  capability: RippleAdapterCapability
): ContextPlanAdapterSignal | null {
  const profile = adapterSupport.primaryAdapter.capabilityProfile.find(
    (item) => item.capability === capability
  );
  if (!profile) {return null;}
  return {
    capability,
    confidence: profile.confidence,
    agentUse: profile.agentUse,
    reason: profile.reason,
  };
}

function uniqueAdapterSignals(
  signals: Array<ContextPlanAdapterSignal | null | undefined>
): ContextPlanAdapterSignal[] {
  const byCapability = new Map<RippleAdapterCapability, ContextPlanAdapterSignal>();
  signals.forEach((signal) => {
    if (!signal) {return;}
    const existing = byCapability.get(signal.capability);
    if (!existing || signal.confidence > existing.confidence) {
      byCapability.set(signal.capability, signal);
    }
  });
  return Array.from(byCapability.values()).sort((a, b) =>
    a.capability.localeCompare(b.capability)
  );
}

function adapterSignalsForChangedSymbol(
  adapterSupport: RippleAdapterDetectionSummary,
  symbol: Omit<StagedCheckChangedSymbol, "adapterSignals">
): ContextPlanAdapterSignal[] {
  return uniqueAdapterSignals([
    adapterSignalFor(adapterSupport, "symbols"),
    symbol.callers > 0 || symbol.calls > 0
      ? adapterSignalFor(adapterSupport, "call-edges")
      : null,
  ]);
}

function adapterSignalsForContractRisk(
  adapterSupport: RippleAdapterDetectionSummary,
  symbol: StagedCheckChangedSymbol,
  verificationTargets: string[]
): ContextPlanAdapterSignal[] {
  return uniqueAdapterSignals([
    ...symbol.adapterSignals,
    verificationTargets.some((target) => TEST_FILE_RE.test(target))
      ? adapterSignalFor(adapterSupport, "tests")
      : null,
  ]);
}

function adapterSignalsFromPlan(
  plan: ReturnType<GraphEngine["planContext"]>
): ContextPlanAdapterSignal[] {
  if (!plan) {return [];}
  return uniqueAdapterSignals([
    ...plan.readFirst.flatMap((file) => file.adapterSignals ?? []),
    ...plan.readIfNeeded.flatMap((file) => file.adapterSignals ?? []),
  ]);
}

function adapterSignalLabel(signal: ContextPlanAdapterSignal): string {
  return `${signal.capability} ${signal.agentUse}/${Math.round(signal.confidence * 100)}%`;
}

function findAdapterSignal(
  signals: ContextPlanAdapterSignal[],
  capability: RippleAdapterCapability
): ContextPlanAdapterSignal | undefined {
  return signals.find((signal) => signal.capability === capability);
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

function buildStagedCheckAgentActions(
  files: StagedCheckFileSummary[],
  missingFiles: string[],
  adapterSupport: RippleAdapterDetectionSummary
): StagedCheckAgentActions {
  const trustedFindings: string[] = [];
  const verifyBeforeCommit: string[] = [];
  const manualReviewRequired: string[] = [];

  files.forEach((file) => {
    const fileSignal = findAdapterSignal(file.adapterSignals, "files");
    const dependencySignal =
      findAdapterSignal(file.adapterSignals, "dependencies") ??
      findAdapterSignal(file.adapterSignals, "reverse-dependencies");
    if (fileSignal?.agentUse === "trust") {
      trustedFindings.push(
        `${file.file}: changed source file detection is trusted (${adapterSignalLabel(fileSignal)}).`
      );
    }
    if (dependencySignal?.agentUse === "trust") {
      trustedFindings.push(
        `${file.file}: import/read-first neighborhood is trusted (${adapterSignalLabel(dependencySignal)}).`
      );
    }

    file.changedSymbols.forEach((symbol) => {
      const symbolSignal = findAdapterSignal(symbol.adapterSignals, "symbols");
      const callSignal = findAdapterSignal(symbol.adapterSignals, "call-edges");
      if (symbolSignal?.agentUse === "trust") {
        trustedFindings.push(
          `${symbol.symbol}: symbol/export detection is trusted (${adapterSignalLabel(symbolSignal)}).`
        );
      }
      if (callSignal?.agentUse === "verify") {
        verifyBeforeCommit.push(
          `${symbol.symbol}: verify callers manually because call edges are partial (${adapterSignalLabel(callSignal)}).`
        );
      }
    });

    file.verificationTargets.forEach((target) => {
      const testSignal = TEST_FILE_RE.test(target)
        ? findAdapterSignal(file.adapterSignals, "tests")
        : undefined;
      if (testSignal?.agentUse === "verify") {
        verifyBeforeCommit.push(
          `${target}: run or inspect this verification target; test mapping is verify-only (${adapterSignalLabel(testSignal)}).`
        );
      } else {
        verifyBeforeCommit.push(`${target}: verify this target before commit.`);
      }
    });

    file.contractRisks.forEach((risk) => {
      manualReviewRequired.push(
        `${risk.symbol}: ${risk.risk} contract risk; review public contract and callers before commit.`
      );
    });
  });

  missingFiles.forEach((file) => {
    manualReviewRequired.push(`${file}: missing from graph; inspect manually before commit.`);
  });

  adapterSupport.primaryAdapter.capabilityProfile
    .filter((capability) => capability.agentUse === "manual")
    .forEach((capability) => {
      manualReviewRequired.push(
        `${capability.capability}: adapter cannot provide this signal; inspect manually.`
      );
    });

  return {
    trustedFindings: uniqueItems(trustedFindings).slice(0, 24),
    verifyBeforeCommit: uniqueItems(verifyBeforeCommit).slice(0, 24),
    manualReviewRequired: uniqueItems(manualReviewRequired).slice(0, 24),
  };
}

export function buildStagedCheckSummary(
  engine: GraphEngine,
  options: BuildStagedCheckSummaryOptions
): StagedCheckSummary {
  const mode = options.mode ?? "staged";
  const baseRef = mode === "changed" ? options.baseRef ?? "HEAD" : undefined;
  const sourceFiles = options.stagedFiles.filter(isRippleSourceFile);
  const skippedFiles = options.stagedFiles.filter((file) => !isRippleSourceFile(file));
  const stagedDiff = parseStagedDiff(
    options.stagedDiff ??
      (mode === "changed"
        ? listGitChangedDiff(options.workspaceRoot, baseRef ?? "HEAD")
        : listGitStagedDiff(options.workspaceRoot))
  );
  const files: StagedCheckFileSummary[] = [];
  const missingFiles: string[] = [];
  const task = options.task ?? DEFAULT_STAGED_CHECK_TASK;
  const tokenBudget = options.tokenBudget ?? 4000;
  const adapterSupport = engine.getAdapterSupport();

  sourceFiles.forEach((filePath) => {
    const focus = engine.getFileFocusSummary(filePath);
    if (!focus) {
      missingFiles.push(filePath);
      return;
    }

    const plan = engine.planContext(task, filePath, tokenBudget);
    const projectPath = focus.projectPath;
    const fileDiff = stagedDiff.get(projectPath) ?? emptyFileDiff(projectPath);
    const changedSymbols = getChangedSymbolsForFile(
      engine,
      options.workspaceRoot,
      projectPath,
      fileDiff,
      mode,
      baseRef
    ).map((symbol) => ({
      ...symbol,
      adapterSignals: adapterSignalsForChangedSymbol(adapterSupport, symbol),
    }));
    const contractRisks = changedSymbols
      .filter((symbol) => symbol.contractRisk !== "none")
      .map((symbol) => {
        const verificationTargets = plan?.verificationTargets.slice(0, 8) ?? [];
        return {
          file: symbol.file,
          symbol: symbol.symbol,
          risk: symbol.contractRisk as Exclude<StagedCheckSymbolContractRisk, "none">,
          reason: symbol.reason,
          callers: symbol.callers,
          exported: symbol.exported,
          verificationTargets,
          adapterSignals: adapterSignalsForContractRisk(
            adapterSupport,
            symbol,
            verificationTargets
          ),
        };
      });

    files.push({
      file: projectPath,
      focus: focus.focusPath,
      modificationRisk: focus.modificationRisk,
      importerCount: focus.importedBy.length,
      symbolCount: focus.symbols.length,
      changedLineRanges: fileDiff.changedLineRanges,
      changedSymbols,
      contractRisks,
      readFirst: plan?.readFirst.map((item) => item.file).slice(0, 6) ?? [],
      symbolFocus: plan?.symbolFocus.map((symbol) => symbol.symbol).slice(0, 6) ?? [],
      verificationTargets: plan?.verificationTargets.slice(0, 8) ?? [],
      adapterSignals: uniqueAdapterSignals([
        ...adapterSignalsFromPlan(plan),
        ...changedSymbols.flatMap((symbol) => symbol.adapterSignals),
        ...contractRisks.flatMap((risk) => risk.adapterSignals),
      ]),
    });
  });

  files.sort((a, b) => {
    const riskDelta = RISK_RANK[b.modificationRisk] - RISK_RANK[a.modificationRisk];
    return riskDelta || a.file.localeCompare(b.file);
  });

  const risk = highestStagedRisk(files);
  const changedSymbols = files.flatMap((file) => file.changedSymbols);
  const contractRisks = files.flatMap((file) => file.contractRisks);
  const agentActions = buildStagedCheckAgentActions(files, missingFiles, adapterSupport);

  return {
    workspace: path.resolve(options.workspaceRoot),
    mode,
    baseRef,
    stagedFiles: sourceFiles.length,
    checkedFiles: files.length,
    skippedFiles,
    missingFiles,
    highestRisk: risk,
    requiresAttention:
      risk === "dangerous" ||
      risk === "caution" ||
      missingFiles.length > 0 ||
      contractRisks.length > 0,
    adapterSupport,
    agentActions,
    changedSymbols,
    contractRisks,
    files,
  };
}

export function highestStagedRisk(
  files: StagedCheckFileSummary[]
): FileFocusSummary["modificationRisk"] | "none" {
  let result: FileFocusSummary["modificationRisk"] | "none" = "none";
  files.forEach((file) => {
    if (result === "none" || RISK_RANK[file.modificationRisk] > RISK_RANK[result]) {
      result = file.modificationRisk;
    }
  });
  return result;
}

function parseStagedDiff(diff: string): Map<string, ParsedStagedFileDiff> {
  const result = new Map<string, ParsedStagedFileDiff>();
  let current: ParsedStagedFileDiff | undefined;
  let currentRange: StagedCheckChangedLineRange | undefined;
  let currentNewLine = 0;

  diff.split(/\r?\n/).forEach((line) => {
    if (line.startsWith("diff --git ")) {
      current = undefined;
      currentRange = undefined;
      currentNewLine = 0;
      return;
    }

    if (line === "new file mode" || line.startsWith("new file mode ")) {
      if (current) {
        current.isNewFile = true;
      }
      return;
    }

    if (line === "deleted file mode" || line.startsWith("deleted file mode ")) {
      if (current) {
        current.isDeletedFile = true;
      }
      return;
    }

    if (line.startsWith("+++ ")) {
      const file = parseDiffFilePath(line.slice(4));
      if (!file) {
        current = undefined;
        return;
      }
      current = ensureParsedDiffFile(result, file);
      return;
    }

    if (!current) {
      return;
    }

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      currentNewLine = start;
      currentRange = {
        start,
        end: count > 0 ? start + count - 1 : start,
        lineCount: count,
      };
      current.changedLineRanges.push(currentRange);
      return;
    }

    if (!currentRange) {
      return;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.changedLines.push({
        line: currentNewLine,
        text: line.slice(1),
        kind: "added",
      });
      currentNewLine++;
      return;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      current.changedLines.push({
        line: currentRange.start,
        text: line.slice(1),
        kind: "removed",
      });
      return;
    }

    if (line.startsWith(" ")) {
      currentNewLine++;
    }
  });

  return result;
}

function parseDiffFilePath(rawPath: string): string | null {
  if (rawPath === "/dev/null") {
    return null;
  }

  const withoutPrefix = rawPath.startsWith("b/") ? rawPath.slice(2) : rawPath;
  return withoutPrefix.replace(/\\/g, "/");
}

function ensureParsedDiffFile(
  files: Map<string, ParsedStagedFileDiff>,
  file: string
): ParsedStagedFileDiff {
  const existing = files.get(file);
  if (existing) {
    return existing;
  }

  const created: ParsedStagedFileDiff = {
    file,
    isNewFile: false,
    isDeletedFile: false,
    changedLineRanges: [],
    changedLines: [],
  };
  files.set(file, created);
  return created;
}

function emptyFileDiff(file: string): ParsedStagedFileDiff {
  return {
    file,
    isNewFile: false,
    isDeletedFile: false,
    changedLineRanges: [],
    changedLines: [],
  };
}

function getChangedSymbolsForFile(
  engine: GraphEngine,
  workspaceRoot: string,
  projectPath: string,
  diff: ParsedStagedFileDiff,
  mode: "staged" | "changed",
  baseRef?: string
): StagedCheckChangedSymbol[] {
  if (diff.changedLineRanges.length === 0) {
    return [];
  }

  const content = mode === "changed"
    ? readWorkingTreeFileContent(workspaceRoot, projectPath)
    : readStagedFileContent(workspaceRoot, projectPath);
  if (content === null) {
    return [];
  }

  const symbols = parseSymbolRanges(engine, workspaceRoot, projectPath, content);
  const previousContent = mode === "changed" && baseRef
    ? readGitRefFileContent(workspaceRoot, baseRef, projectPath)
    : readHeadFileContent(workspaceRoot, projectPath);
  const previousSymbols = previousContent === null
    ? new Map<string, ParsedSymbolRange>()
    : symbolsByName(parseSymbolRanges(engine, workspaceRoot, projectPath, previousContent));

  return symbols
    .filter((symbol) => rangesIntersectSymbol(diff.changedLineRanges, symbol))
    .map((symbol) => buildChangedSymbol(symbol, diff, previousSymbols.get(symbol.name)))
    .sort((a, b) => {
      const riskDelta = contractRiskRank(b.contractRisk) - contractRiskRank(a.contractRisk);
      return riskDelta || a.symbol.localeCompare(b.symbol);
    });
}

function readWorkingTreeFileContent(workspaceRoot: string, projectPath: string): string | null {
  const absolutePath = path.resolve(workspaceRoot, projectPath);
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch {
    return null;
  }
}

function readStagedFileContent(workspaceRoot: string, projectPath: string): string | null {
  try {
    return execFileSync("git", ["show", `:${projectPath}`], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    const absolutePath = path.resolve(workspaceRoot, projectPath);
    try {
      return fs.readFileSync(absolutePath, "utf8");
    } catch {
      return null;
    }
  }
}

function readGitRefFileContent(
  workspaceRoot: string,
  ref: string,
  projectPath: string
): string | null {
  try {
    return execFileSync("git", ["show", `${ref}:${projectPath}`], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function readHeadFileContent(workspaceRoot: string, projectPath: string): string | null {
  return readGitRefFileContent(workspaceRoot, "HEAD", projectPath);
}

function parseSymbolRanges(
  engine: GraphEngine,
  workspaceRoot: string,
  projectPath: string,
  content: string
): ParsedSymbolRange[] {
  if (projectPath.toLowerCase().endsWith(".py")) {
    return parsePythonSymbolRanges(engine, workspaceRoot, projectPath, content);
  }

  const project = new Project({
    compilerOptions: {
      allowJs: true,
      jsx: 4,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      moduleResolution: 2,
      target: 99,
      strict: false,
    },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.createSourceFile(projectPath, content, { overwrite: true });
  const exportedNames = exportedSymbolNames(sourceFile);
  const graphSymbols = graphSymbolsByName(engine, workspaceRoot, projectPath);
  const ranges: ParsedSymbolRange[] = [];
  const seen = new Set<string>();

  const addRange = (
    name: string | undefined,
    kind: SymbolNode["kind"],
    node: Node
  ) => {
    if (!name || name.includes("{") || name.includes("[")) {
      return;
    }
    const key = `${name}:${kind}:${node.getStart()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    const graphSymbol = graphSymbols.get(name);
    const nodeRange = lineRangeForNode(node);
    ranges.push({
      symbol: `${projectPath}::${name}`,
      file: projectPath,
      name,
      kind: graphSymbol?.kind ?? kind,
      layer: graphSymbol?.layer,
      exported: exportedNames.has(name),
      callers: graphSymbol?.calledBy.size ?? 0,
      calls: graphSymbol?.calls.size ?? 0,
      startLine: nodeRange.start,
      endLine: nodeRange.end,
      signatureStartLine: nodeRange.signatureStart,
      signatureEndLine: nodeRange.signatureEnd,
      signatureText: signatureTextForNode(node),
    });
  };

  sourceFile.getFunctions().forEach((funcDecl) => {
    addRange(funcDecl.getName(), "function", funcDecl);
  });

  sourceFile.getClasses().forEach((classDecl) => {
    addRange(classDecl.getName(), "class", classDecl);
    classDecl.getMethods().forEach((methodDecl) => {
      addRange(methodDecl.getName(), "method", methodDecl);
    });
  });

  sourceFile.getVariableDeclarations().forEach((varDecl) => {
    const initializer = varDecl.getInitializer();
    const kind =
      initializer &&
      (initializer.getKind() === SyntaxKind.ArrowFunction ||
        initializer.getKind() === SyntaxKind.FunctionExpression)
        ? "function"
        : "variable";
    addRange(varDecl.getName(), kind, varDecl);
  });

  return ranges;
}

function parsePythonSymbolRanges(
  engine: GraphEngine,
  workspaceRoot: string,
  projectPath: string,
  content: string
): ParsedSymbolRange[] {
  const graphSymbols = graphSymbolsByName(engine, workspaceRoot, projectPath);
  const lines = content.split(/\r?\n/);
  const ranges: ParsedSymbolRange[] = [];
  const seen = new Set<string>();

  lines.forEach((line, index) => {
    const functionMatch = /^(\s*)(?:async\s+def|def)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    const classMatch = /^(\s*)class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|:)/.exec(line);
    const match = functionMatch ?? classMatch;
    if (!match) {return;}

    const indent = pythonIndent(match[1]);
    const name = match[2];
    const kind: SymbolNode["kind"] = classMatch
      ? "class"
      : indent > 0
      ? "method"
      : "function";
    const key = `${name}:${kind}:${index}`;
    if (seen.has(key)) {return;}
    seen.add(key);

    const graphSymbol = graphSymbols.get(name);
    const startLine = index + 1;
    const endLine = pythonBlockEndLine(lines, index, indent);
    ranges.push({
      symbol: `${projectPath}::${name}`,
      file: projectPath,
      name,
      kind: graphSymbol?.kind ?? kind,
      layer: graphSymbol?.layer,
      exported: indent === 0 && !name.startsWith("_"),
      callers: graphSymbol?.calledBy.size ?? 0,
      calls: graphSymbol?.calls.size ?? 0,
      startLine,
      endLine,
      signatureStartLine: startLine,
      signatureEndLine: startLine,
      signatureText: normalizeSignatureText(line.trim()),
    });
  });

  return ranges;
}

function pythonBlockEndLine(lines: string[], startIndex: number, indent: number): number {
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#") || line.trimStart().startsWith("@")) {
      continue;
    }
    const lineIndent = pythonIndent(line.match(/^\s*/)?.[0] ?? "");
    if (lineIndent <= indent) {
      return i;
    }
  }
  return lines.length;
}

function pythonIndent(value: string): number {
  return value.replace(/\t/g, "    ").length;
}

function symbolsByName(symbols: ParsedSymbolRange[]): Map<string, ParsedSymbolRange> {
  const result = new Map<string, ParsedSymbolRange>();
  symbols.forEach((symbol) => {
    result.set(symbol.name, symbol);
  });
  return result;
}

function exportedSymbolNames(sourceFile: import("ts-morph").SourceFile): Set<string> {
  const exported = new Set<string>();
  sourceFile.getExportedDeclarations().forEach((declarations, exportName) => {
    declarations.forEach((decl) => {
      const declaredName = (decl as { getName?: () => string | undefined }).getName?.();
      exported.add(declaredName ?? exportName);
    });
  });
  return exported;
}

function graphSymbolsByName(
  engine: GraphEngine,
  workspaceRoot: string,
  projectPath: string
): Map<string, SymbolNode> {
  const symbols = new Map<string, SymbolNode>();
  engine.graph.symbols.forEach((symbol) => {
    if (toProjectPath(workspaceRoot, symbol.file) === projectPath) {
      symbols.set(symbol.name, symbol);
    }
  });
  return symbols;
}

function lineRangeForNode(node: Node): {
  start: number;
  end: number;
  signatureStart: number;
  signatureEnd: number;
} {
  const sourceFile = node.getSourceFile();
  const start = sourceFile.getLineAndColumnAtPos(node.getStart()).line;
  const end = sourceFile.getLineAndColumnAtPos(node.getEnd()).line;
  const body = bodyNodeFor(node);
  const bodyStart = body
    ? sourceFile.getLineAndColumnAtPos(body.getStart()).line
    : start;

  return {
    start,
    end,
    signatureStart: start,
    signatureEnd: Math.max(start, Math.min(bodyStart, end)),
  };
}

function bodyNodeFor(node: Node): Node | undefined {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node)
  ) {
    return node.getBody();
  }

  if (Node.isClassDeclaration(node)) {
    return node;
  }

  if (Node.isVariableDeclaration(node)) {
    const initializer = node.getInitializer();
    if (
      initializer &&
      (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
    ) {
      return initializer.getBody();
    }
  }

  return undefined;
}

function signatureTextForNode(node: Node): string {
  const sourceFile = node.getSourceFile();
  const fullText = sourceFile.getFullText();
  const body = bodyNodeFor(node);

  if (body && !Node.isClassDeclaration(node)) {
    const start = node.getStart();
    const bodyStart = body.getStart();
    if (bodyStart > start) {
      return normalizeSignatureText(fullText.slice(start, bodyStart));
    }
  }

  const text = node.getText();
  if (Node.isClassDeclaration(node)) {
    const braceIndex = text.indexOf("{");
    if (braceIndex >= 0) {
      return normalizeSignatureText(text.slice(0, braceIndex));
    }
  }

  return normalizeSignatureText(text);
}

function normalizeSignatureText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function rangesIntersectSymbol(
  ranges: StagedCheckChangedLineRange[],
  symbol: ParsedSymbolRange
): boolean {
  return ranges.some((range) => {
    return range.start <= symbol.endLine && range.end >= symbol.startLine;
  });
}

function buildChangedSymbol(
  symbol: ParsedSymbolRange,
  diff: ParsedStagedFileDiff,
  previousSymbol: ParsedSymbolRange | undefined
): StagedCheckChangedSymbol {
  const changedLines = uniqueSortedNumbers(
    diff.changedLines
      .filter((line) => line.line >= symbol.startLine && line.line <= symbol.endLine)
      .map((line) => line.line)
  );
  const symbolStatus: StagedCheckSymbolStatus = previousSymbol ? "modified" : "created";
  const signatureTouched = diff.changedLineRanges.some((range) => {
    return range.start <= symbol.signatureEndLine && range.end >= symbol.signatureStartLine;
  });
  const signatureChanged = previousSymbol
    ? previousSymbol.signatureText !== symbol.signatureText
    : false;
  const contractChanged = previousSymbol
    ? signatureChanged ||
      previousSymbol.kind !== symbol.kind ||
      previousSymbol.exported !== symbol.exported
    : symbolStatus === "created" && (symbol.exported || symbol.callers > 0);
  const returnLineChanged = diff.changedLines.some((line) => {
    return (
      line.line >= symbol.startLine &&
      line.line <= symbol.endLine &&
      /\breturn\b/.test(line.text)
    );
  });
  const contractRisk = contractRiskForSymbol(
    symbol,
    symbolStatus,
    contractChanged,
    returnLineChanged
  );
  const changeKind: StagedCheckSymbolChangeKind = contractChanged
    ? "signature-or-contract"
    : returnLineChanged
      ? "return-shape-review"
      : "implementation";

  return {
    symbol: symbol.symbol,
    file: symbol.file,
    name: symbol.name,
    kind: symbol.kind,
    layer: symbol.layer,
    exported: symbol.exported,
    callers: symbol.callers,
    calls: symbol.calls,
    symbolStatus,
    changeKind,
    contractRisk,
    signatureTouched,
    signatureChanged,
    contractChanged,
    returnLineChanged,
    changedLines,
    lineRange: {
      start: symbol.startLine,
      end: symbol.endLine,
    },
    reason: changedSymbolReason(
      symbol,
      symbolStatus,
      signatureTouched,
      signatureChanged,
      contractChanged,
      returnLineChanged,
      contractRisk
    ),
    adapterSignals: [],
  };
}

function contractRiskForSymbol(
  symbol: ParsedSymbolRange,
  symbolStatus: StagedCheckSymbolStatus,
  contractChanged: boolean,
  returnLineChanged: boolean
): StagedCheckSymbolContractRisk {
  if (symbolStatus === "created" && (symbol.exported || symbol.callers > 0)) {
    return "review";
  }
  if (contractChanged && symbol.exported && symbol.callers > 0) {
    return "high";
  }
  if (contractChanged && (symbol.exported || symbol.callers > 0)) {
    return "review";
  }
  if (returnLineChanged && symbol.exported) {
    return "review";
  }
  return "none";
}

function changedSymbolReason(
  symbol: ParsedSymbolRange,
  symbolStatus: StagedCheckSymbolStatus,
  signatureTouched: boolean,
  signatureChanged: boolean,
  contractChanged: boolean,
  returnLineChanged: boolean,
  contractRisk: StagedCheckSymbolContractRisk
): string {
  const signals: string[] = [];
  if (symbolStatus === "created") {
    signals.push("new symbol in staged changes");
  }
  if (signatureChanged) {
    signals.push("signature changed compared with HEAD");
  } else if (contractChanged) {
    signals.push("public contract changed compared with HEAD");
  } else if (signatureTouched) {
    signals.push("declaration/signature lines touched without signature change");
  }
  if (returnLineChanged) {
    signals.push("changed return line");
  }
  if (symbol.exported) {
    signals.push("exported symbol");
  }
  if (symbol.callers > 0) {
    signals.push(`${symbol.callers} caller(s)`);
  }
  if (signals.length === 0) {
    signals.push("implementation lines changed");
  }

  return contractRisk === "none"
    ? signals.join("; ")
    : `${signals.join("; ")}; contract review recommended`;
}

function contractRiskRank(risk: StagedCheckSymbolContractRisk): number {
  if (risk === "high") {
    return 2;
  }
  if (risk === "review") {
    return 1;
  }
  return 0;
}

function uniqueSortedNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function toProjectPath(workspaceRoot: string, filePath: string): string {
  const relativePath = path.isAbsolute(filePath)
    ? path.relative(workspaceRoot, filePath)
    : filePath;
  return relativePath.split(path.sep).join("/");
}
