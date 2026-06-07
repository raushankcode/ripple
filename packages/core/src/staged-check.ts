import * as fs from "fs";
import * as path from "path";
import {
  ts,
} from "ts-morph";
import {
  ContextPlanAdapterSignal,
  FileFocusSummary,
  GraphEngine,
} from "./graph";
import { execGit } from "./git";
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
    const output = execGit(workspaceRoot, [
      "diff",
      "--name-only",
      "--cached",
      "--diff-filter=ACMR",
    ]);
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
    return execGit(workspaceRoot, [
      "diff",
      "--cached",
      "--unified=0",
      "--no-ext-diff",
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read staged diff with git diff --cached: ${message}`);
  }
}

export function listGitChangedFiles(workspaceRoot: string, baseRef: string): string[] {
  try {
    const output = execGit(workspaceRoot, [
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      baseRef,
      "--",
    ]);
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
    const output = execGit(workspaceRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
    ]);
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
    return execGit(workspaceRoot, [
      "diff",
      "--unified=0",
      "--no-ext-diff",
      baseRef,
      "--",
    ]);
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
    return execGit(workspaceRoot, ["show", `:${projectPath}`]);
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
    return execGit(workspaceRoot, ["show", `${ref}:${projectPath}`]);
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

  const sourceFile = ts.createSourceFile(
    projectPath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(projectPath)
  );
  const exportedNames = exportedSymbolNames(sourceFile);
  const graphSymbols = graphSymbolsByName(engine, workspaceRoot, projectPath);
  const ranges: ParsedSymbolRange[] = [];
  const seen = new Set<string>();

  const addRange = (
    name: string | undefined,
    kind: SymbolNode["kind"],
    node: ts.Node
  ) => {
    if (!name || name.includes("{") || name.includes("[")) {
      return;
    }
    const key = `${name}:${kind}:${node.getStart(sourceFile)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    const graphSymbol = graphSymbols.get(name);
    const nodeRange = lineRangeForNode(sourceFile, node);
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
      signatureText: signatureTextForNode(sourceFile, node),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      addRange(node.name?.text, "function", node);
    } else if (ts.isClassDeclaration(node)) {
      addRange(node.name?.text, "class", node);
      node.members.forEach((member) => {
        if (ts.isMethodDeclaration(member)) {
          addRange(propertyNameText(member.name, sourceFile), "method", member);
        }
      });
      return;
    } else if (ts.isVariableDeclaration(node) && isTopLevelVariableDeclaration(node)) {
      const initializer = node.initializer;
      const kind =
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
          ? "function"
          : "variable";
      addRange(bindingNameText(node.name, sourceFile), kind, node);
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

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

function scriptKindForPath(projectPath: string): ts.ScriptKind {
  const ext = path.extname(projectPath).toLowerCase();
  if (ext === ".tsx") {return ts.ScriptKind.TSX;}
  if (ext === ".jsx") {return ts.ScriptKind.JSX;}
  if (ext === ".js") {return ts.ScriptKind.JS;}
  if (ext === ".json") {return ts.ScriptKind.JSON;}
  return ts.ScriptKind.TS;
}

function exportedSymbolNames(sourceFile: ts.SourceFile): Set<string> {
  const exported = new Set<string>();

  sourceFile.statements.forEach((statement) => {
    if (ts.isFunctionDeclaration(statement)) {
      addExportedName(exported, statement.name?.text, statement);
      return;
    }
    if (ts.isClassDeclaration(statement)) {
      addExportedName(exported, statement.name?.text, statement);
      return;
    }
    if (!ts.isVariableStatement(statement)) {return;}
    if (!isExportedNode(statement)) {return;}
    statement.declarationList.declarations.forEach((declaration) => {
      const name = bindingNameText(declaration.name, sourceFile);
      if (name) {exported.add(name);}
    });
  });

  sourceFile.statements.forEach((statement) => {
    if (!ts.isExportDeclaration(statement)) {return;}
    const exportClause = statement.exportClause;
    if (!exportClause || !ts.isNamedExports(exportClause)) {return;}
    exportClause.elements.forEach((namedExport) => {
      exported.add(namedExport.propertyName?.text ?? namedExport.name.text);
    });
  });

  return exported;
}

function addExportedName(
  exported: Set<string>,
  name: string | undefined,
  node: ts.Node
): void {
  if (name && isExportedNode(node)) {
    exported.add(name);
  }
}

function isExportedNode(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) =>
      modifier.kind === ts.SyntaxKind.ExportKeyword
    );
}

function bindingNameText(name: ts.BindingName, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isIdentifier(name)) {return name.text;}
  return name.getText(sourceFile);
}

function propertyNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return name.getText(sourceFile);
}

function isTopLevelVariableDeclaration(node: ts.VariableDeclaration): boolean {
  const declarationList = node.parent;
  const statement = declarationList.parent;
  return ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent);
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

function lineRangeForNode(sourceFile: ts.SourceFile, node: ts.Node): {
  start: number;
  end: number;
  signatureStart: number;
  signatureEnd: number;
} {
  const start = lineForPosition(sourceFile, node.getStart(sourceFile));
  const end = lineForPosition(sourceFile, node.getEnd());
  const body = bodyNodeFor(node);
  const bodyStart = body
    ? lineForPosition(sourceFile, body.getStart(sourceFile))
    : start;

  return {
    start,
    end,
    signatureStart: start,
    signatureEnd: Math.max(start, Math.min(bodyStart, end)),
  };
}

function lineForPosition(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function bodyNodeFor(node: ts.Node): ts.Node | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  ) {
    return node.body;
  }

  if (ts.isClassDeclaration(node)) {
    return node;
  }

  if (ts.isVariableDeclaration(node)) {
    const initializer = node.initializer;
    if (
      initializer &&
      (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ) {
      return initializer.body;
    }
  }

  return undefined;
}

function signatureTextForNode(sourceFile: ts.SourceFile, node: ts.Node): string {
  const fullText = sourceFile.text;
  const body = bodyNodeFor(node);

  if (body && !ts.isClassDeclaration(node)) {
    const start = node.getStart(sourceFile);
    const bodyStart = body.getStart(sourceFile);
    if (bodyStart > start) {
      return normalizeSignatureText(fullText.slice(start, bodyStart));
    }
  }

  const text = node.getText(sourceFile);
  if (ts.isClassDeclaration(node)) {
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
