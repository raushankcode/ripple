/**
 * graph.ts — Ripple
 * Core dependency graph engine for Ripple.
 *
 * This file owns the local architectural model that powers:
 * - Impact Lens file relationships
 * - CodeLens caller counts
 * - Safety Check blast-radius warnings
 * - AI-agent context files under .ripple/
 *
 * Design constraints:
 * - Keep generated machine-readable files in .ripple/.cache/.
 * - Keep human-readable workflow/history files in .ripple/.
 * - Treat the first scan as a baseline, not as user-created file events.
 * - Preserve reverse edges when repairing stale cache entries.
 * - Update agent instruction files only inside Ripple-managed markers.
 * - Queue file events that arrive while a scan is already running.
 *
 * Path invariant:
 * - graph.files keys use OS-native separators.
 * - graph.symbols keys contain an OS-native file path followed by "::symbol".
 * - ts-morph APIs use forward slash paths.
 * - Use toTsMorphPath() before ts-morph calls.
 * - Use toGraphPath() before storing normalized import paths.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import {
  Project,
  SourceFile,
  SyntaxKind,
  Node,
  ImportDeclaration,
  ExportedDeclarations,
} from "ts-morph";

import {
  FileNode,
  SymbolNode,
  ChangeEvent,
  SystemGraph,
  HistoryLog,
} from "./types";

import { normalizeImportPath } from "./normalizer";

type FocusRisk = "dangerous" | "caution" | "safe";

type FocusLookupMatch = {
  path: string;
  focus: string;
  risk: FocusRisk;
  importers: number;
};

type FocusFileByBasename =
  | ({ status: "unique" } & FocusLookupMatch)
  | { status: "ambiguous"; matches: FocusLookupMatch[] };

// ────────────────────────────────────────────────────────────────────────────
// PERSISTENCE AND GENERATED CONTEXT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Handles durable project state:
 * - .ripple/history.json for human-auditable change history
 * - .ripple/.cache/graph.cache.json for fast startup
 * - .ripple/.cache/context*.json and focus files for AI agents
 * - .ripple/WORKFLOW.md for agent operating rules
 */
class GraphPersistence {
  private persistPath: string;
  private cachePath: string;
  private workspaceRoot: string;

  contextGenerationEnabled: boolean = true;

  private patternCache: {
    prefersArrowFunctions: boolean;
    hasClassComponents: boolean;
  } | null = null;

  /**
   * Pattern hints are derived from source files and cached between context
   * generations. File changes and project-config rebuilds invalidate them.
   */
  invalidatePatternCache(): void {
    this.patternCache = null;
  }

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    const rippleDir = path.join(workspaceRoot, ".ripple");
    if (!fs.existsSync(rippleDir)) {
      fs.mkdirSync(rippleDir, { recursive: true });
    }

    const cacheDir = path.join(rippleDir, ".cache");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Human-auditable files stay in .ripple/ root
    this.persistPath = path.join(rippleDir, "history.json");

    // All machine-generated files stay in .ripple/.cache/
    this.cachePath = path.join(cacheDir, "graph.cache.json");
  }

  // ── HISTORY ───────────────────────────────────────────────────────────────

  /**
   * Loads historical change events from disk. Corrupt history should not block
   * the extension from starting, so parse failures fall back to an empty log.
   */
  load(log: HistoryLog): void {
    if (!fs.existsSync(this.persistPath)) {return;}
    try {
      const raw = fs.readFileSync(this.persistPath, "utf8");
      const events = JSON.parse(raw) as ChangeEvent[];
      events.forEach((e) => {
        log.log({
          ...e,
          source: this.historyEntityFromDisk(e.source) ?? e.source,
          target: this.historyEntityFromDisk(e.target),
        });
      });
    } catch {
      console.warn("[Ripple] history.json could not be parsed — starting fresh.");
    }
  }

  /**
   * Persists bounded history. The baseline event is retained when possible so
   * agents and users can distinguish initial project state from later edits.
   */
  flush(log: HistoryLog): void {
    try {
      const MAX_EVENTS = 10000;
      let eventsToWrite = log.events;
      if (eventsToWrite.length > MAX_EVENTS) {
        const baseline = eventsToWrite.find((e) => e.type === "baseline_snapshot");
        const recent = eventsToWrite
          .filter((e) => e.type !== "baseline_snapshot")
          .slice(-(MAX_EVENTS - 1));
        eventsToWrite = baseline ? [baseline, ...recent] : recent;
      }
      const serializedEvents = eventsToWrite.map((event) => ({
        ...event,
        source: this.historyEntityToDisk(event.source) ?? event.source,
        target: this.historyEntityToDisk(event.target),
      }));
      fs.writeFileSync(this.persistPath, JSON.stringify(serializedEvents, null, 2));
    } catch (err) {
      console.error("[Ripple] HistoryLog flush failed:", err);
    }
  }

  // ── GRAPH CACHE ────────────────────────────────────────────────────────────

  /**
   * Stores the in-memory graph in a compact cache file. Sets are serialized as
   * arrays and rebuilt during loadCache().
   */
  saveCache(graph: SystemGraph): void {
    try {
      const files: Record<string, any> = {};
      graph.files.forEach((node, filePath) => {
        files[filePath] = {
          path: node.path,
          imports: Array.from(node.imports),
          importedBy: Array.from(node.importedBy),
          symbols: Array.from(node.symbols),
          hash: node.hash,
          createdAt: node.createdAt,
          lastModifiedAt: node.lastModifiedAt,
          changeCount: node.changeCount,
          hasParseError: node.hasParseError ?? false,
        };
      });

      const symbols: Record<string, any> = {};
      graph.symbols.forEach((sym, symbolId) => {
        symbols[symbolId] = {
          id: sym.id,
          name: sym.name,
          file: sym.file,
          kind: sym.kind,
          layer: sym.layer,
          containsLayers: sym.containsLayers,
          symbolHash: sym.symbolHash,
          calls: Array.from(sym.calls),
          calledBy: Array.from(sym.calledBy),
          createdAt: sym.createdAt,
          lastModifiedAt: sym.lastModifiedAt,
        };
      });

      fs.writeFileSync(
        this.cachePath,
        JSON.stringify({ files, symbols, savedAt: Date.now() }, null, 0)
      );
    } catch (err) {
      console.warn("[Ripple] Cache save failed:", err);
    }
  }

  /**
   * Restores graph nodes from cache and returns files whose content hash changed
   * since the cache was written. Stale files are repaired by the scan phase.
   */
  loadCache(graph: SystemGraph): string[] {
    try {
      if (!fs.existsSync(this.cachePath)) {return [];}

      const raw = fs.readFileSync(this.cachePath, "utf8");
      const data = JSON.parse(raw);

      const staleFiles: string[] = [];
      const loadedFilePaths = new Set<string>();

      Object.entries(data.files).forEach(([filePath, node]: [string, any]) => {
        if (!fs.existsSync(filePath)) {return;}

        const currentContent = (() => {
          try { return fs.readFileSync(filePath, "utf8"); }
          catch { return null; }
        })();
        if (currentContent === null) {return;}

        const currentHash = crypto
          .createHash("sha1")
          .update(currentContent)
          .digest("hex");

        const fileNode: FileNode = {
          path: node.path,
          imports: new Set(node.imports as string[]),
          importedBy: new Set(node.importedBy as string[]),
          symbols: new Set(node.symbols as string[]),
          hash: node.hash,
          createdAt: node.createdAt,
          lastModifiedAt: node.lastModifiedAt,
          changeCount: node.changeCount,
          hasParseError: node.hasParseError ?? false,
        };

        graph.files.set(filePath, fileNode);
        loadedFilePaths.add(filePath);

        if (currentHash !== node.hash) {
          staleFiles.push(filePath);
        }
      });

      Object.entries(data.symbols).forEach(([symbolId, sym]: [string, any]) => {
        if (!loadedFilePaths.has(sym.file)) {return;}

        const symbolNode: SymbolNode = {
          id: sym.id,
          name: sym.name,
          file: sym.file,
          kind: sym.kind,
          layer: sym.layer,
          containsLayers: sym.containsLayers,
          symbolHash: sym.symbolHash,
          calls: new Set(
            (sym.calls as string[]).filter((id: string) =>
              loadedFilePaths.has(id.split("::")[0])
            )
          ),
          calledBy: new Set(
            (sym.calledBy as string[]).filter((id: string) =>
              loadedFilePaths.has(id.split("::")[0])
            )
          ),
          createdAt: sym.createdAt,
          lastModifiedAt: sym.lastModifiedAt,
        };
        graph.symbols.set(symbolId, symbolNode);
      });

      console.log(
        `[Ripple] Cache loaded — ${graph.files.size} files, ${staleFiles.length} stale`
      );
      return staleFiles;
    } catch (err) {
      console.warn("[Ripple] Cache load failed — full scan required:", err);
      graph.files.clear();
      graph.symbols.clear();
      return [];
    }
  }

  private toProjectPath(filePath: string): string {
    return path.relative(this.workspaceRoot, filePath).split(path.sep).join("/");
  }

  /**
   * History stays absolute in memory so graph comparisons are exact, but is
   * written project-relative on disk to avoid leaking local workspace paths.
   */
  private historyEntityToDisk(entity: string | undefined): string | undefined {
    if (!entity) {return entity;}

    const separator = entity.indexOf("::");
    const filePath = separator === -1 ? entity : entity.slice(0, separator);
    const suffix = separator === -1 ? "" : entity.slice(separator);

    if (filePath === "initial_scan") {return entity;}
    if (!path.isAbsolute(filePath)) {return `${filePath.split(path.sep).join("/")}${suffix}`;}

    return `${this.toProjectPath(filePath)}${suffix}`;
  }

  private historyEntityFromDisk(entity: string | undefined): string | undefined {
    if (!entity) {return entity;}

    const separator = entity.indexOf("::");
    const filePath = separator === -1 ? entity : entity.slice(0, separator);
    const suffix = separator === -1 ? "" : entity.slice(separator);

    if (filePath === "initial_scan" || path.isAbsolute(filePath)) {return entity;}

    return `${path.join(this.workspaceRoot, filePath.split(/[\\/]/).join(path.sep))}${suffix}`;
  }

  /**
   * Filters generated folders and build output from agent-facing context.
   * The graph may know about some of these nodes, but agents should not treat
   * them as source files to inspect or edit.
   */
  private isContextSourceFile(filePath: string): boolean {
    return (
      !filePath.includes("node_modules") &&
      !filePath.includes(".ripple") &&
      !filePath.includes(".next") &&
      !filePath.includes(`${path.sep}dist${path.sep}`) &&
      !filePath.includes(`${path.sep}out${path.sep}`) &&
      !filePath.includes(".turbo")
    );
  }

  /**
   * Converts dependency fan-out, edit churn, and parse quality into the risk
   * vocabulary used consistently by focus files, WORKFLOW.md, and Safety Check.
   */
  private modificationRiskFor(node: FileNode): FocusRisk {
    const blastSize = node.importedBy.size;
    if (blastSize >= DANGEROUS_BLAST_RADIUS || node.changeCount > DANGEROUS_CHURN) {
      return "dangerous";
    }
    if (
      blastSize >= CAUTION_BLAST_RADIUS ||
      node.changeCount > CAUTION_CHURN ||
      node.hasParseError
    ) {
      return "caution";
    }
    return "safe";
  }

  private focusPathFor(filePath: string, graph: SystemGraph): string {
    return `.ripple/.cache/focus/${makeFocusKey(filePath, graph)}.json`;
  }

  /**
   * Entry points often sit at the boundary of a feature or framework route.
   * Marking them helps agents decide which callers deserve extra verification.
   */
  private isEntryPointFile(filePath: string): boolean {
    const base = path.basename(filePath);
    return (
      base === "route.ts" ||
      base === "route.tsx" ||
      base === "page.tsx" ||
      base === "page.ts" ||
      filePath.includes(`${path.sep}pages${path.sep}api${path.sep}`) ||
      filePath.includes(`${path.sep}app${path.sep}api${path.sep}`)
    );
  }

  /**
   * Builds both basename and full-path focus lookups. Basename lookups are only
   * exposed when unambiguous; duplicate names in monorepos must use full paths.
   */
  private buildFocusLookup(graph: SystemGraph): {
    availableFocusFiles: Record<string, string>;
    availableFocusFilesByPath: Record<string, string>;
    availableFocusFilesByBasename: Record<string, FocusFileByBasename>;
    ambiguousFocusFileNames: Record<string, string[]>;
    ambiguousFocusFileMatches: Record<string, FocusLookupMatch[]>;
  } {
    const candidates: Array<{
      basename: string;
      relativePath: string;
      focusPath: string;
      risk: FocusRisk;
      importers: number;
    }> = [];

    graph.files.forEach((node, filePath) => {
      if (!this.isContextSourceFile(filePath)) {
        return;
      }
      if (node.imports.size === 0 && node.importedBy.size === 0 && node.symbols.size === 0) {
        return;
      }
      candidates.push({
        basename: path.basename(filePath),
        relativePath: this.toProjectPath(filePath),
        focusPath: this.focusPathFor(filePath, graph),
        risk: this.modificationRiskFor(node),
        importers: node.importedBy.size,
      });
    });

    candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const candidatesByPath = new Map(candidates.map((candidate) => [candidate.relativePath, candidate]));

    const basenameBuckets = new Map<string, string[]>();
    candidates.forEach((candidate) => {
      const bucket = basenameBuckets.get(candidate.basename) ?? [];
      bucket.push(candidate.relativePath);
      basenameBuckets.set(candidate.basename, bucket);
    });

    const availableFocusFiles: Record<string, string> = {};
    const availableFocusFilesByPath: Record<string, string> = {};
    const availableFocusFilesByBasename: Record<string, FocusFileByBasename> = {};
    const ambiguousFocusFileNames: Record<string, string[]> = {};
    const ambiguousFocusFileMatches: Record<string, FocusLookupMatch[]> = {};

    candidates.forEach((candidate) => {
      const value = `${candidate.focusPath} [${candidate.risk}]`;
      availableFocusFilesByPath[candidate.relativePath] = value;

      const bucket = basenameBuckets.get(candidate.basename) ?? [];
      if (bucket.length === 1) {
        availableFocusFiles[candidate.basename] = value;
      }
    });

    basenameBuckets.forEach((relativePaths, basename) => {
      const sortedPaths = relativePaths.sort();
      const matches = sortedPaths.map((relativePath) => {
        const candidate = candidatesByPath.get(relativePath)!;
        return {
          path: candidate.relativePath,
          focus: candidate.focusPath,
          risk: candidate.risk,
          importers: candidate.importers,
        };
      });

      if (relativePaths.length > 1) {
        ambiguousFocusFileNames[basename] = sortedPaths;
        ambiguousFocusFileMatches[basename] = matches;
        availableFocusFilesByBasename[basename] = {
          status: "ambiguous",
          matches,
        };
      } else if (matches[0]) {
        availableFocusFilesByBasename[basename] = {
          status: "unique",
          ...matches[0],
        };
      }
    });

    return {
      availableFocusFiles,
      availableFocusFilesByPath,
      availableFocusFilesByBasename,
      ambiguousFocusFileNames,
      ambiguousFocusFileMatches,
    };
  }

  /**
   * Creates the compact, file-specific context document agents should read
   * before editing a target file. Large caller lists are intentionally truncated
   * and paired with neighbor focus-file pointers to keep prompts manageable.
   */
  private buildFocusedContext(graph: SystemGraph, filePath: string): any | null {
    const node = graph.files.get(filePath);
    if (!node) {
      return null;
    }
    if (!this.isContextSourceFile(filePath)) {
      return null;
    }
    if (node.imports.size === 0 && node.importedBy.size === 0 && node.symbols.size === 0) {
      return null;
    }

    const focusKey = makeFocusKey(filePath, graph);
    const relativePath = this.toProjectPath(filePath);
    const modificationRisk = this.modificationRiskFor(node);
    const blastSize = node.importedBy.size;
    const MAX_IMPORTEDBY = 10;
    const MAX_CALLERS = 10;

    const byRiskThenName = (a: string, b: string): number => {
      const aNode = graph.files.get(a);
      const bNode = graph.files.get(b);
      const aBlast = aNode?.importedBy.size ?? 0;
      const bBlast = bNode?.importedBy.size ?? 0;
      if (aBlast !== bBlast) {
        return bBlast - aBlast;
      }
      return this.toProjectPath(a).localeCompare(this.toProjectPath(b));
    };

    const allImportedBy = Array.from(node.importedBy)
      .filter((f) => this.isContextSourceFile(f))
      .sort(byRiskThenName);

    const importedBy = allImportedBy.slice(0, MAX_IMPORTEDBY).map((f) => {
      const importerNode = graph.files.get(f);
      return {
        file: this.toProjectPath(f),
        focus: this.focusPathFor(f, graph),
        modificationRisk: importerNode ? this.modificationRiskFor(importerNode) : "safe",
        ...(this.isEntryPointFile(f) ? { isEntryPoint: true } : {}),
      };
    });

    const allImports = Array.from(node.imports)
      .filter((f) => this.isContextSourceFile(f))
      .sort((a, b) => this.toProjectPath(a).localeCompare(this.toProjectPath(b)));

    const imports = allImports.map((f) => this.toProjectPath(f));

    const isBarrel = ["index.ts", "index.tsx", "index.js", "index.jsx"].includes(path.basename(filePath));
    const reExports = isBarrel ? imports : [];

    const toRelSymbol = (id: string) => {
      const p = id.split("::");
      if (p.length < 2) {
        return id;
      }
      return `${this.toProjectPath(p[0])}::${p[1]}`;
    };

    const symbols: any[] = [];
    node.symbols.forEach((symbolId) => {
      const sym = graph.symbols.get(symbolId);
      if (!sym) {
        return;
      }

      const allCalledBy = Array.from(sym.calledBy).sort();
      const allCalls = Array.from(sym.calls).sort();
      const callerCount = sym.calledBy.size;

      symbols.push({
        name: sym.name,
        kind: sym.kind,
        layer: sym.layer ?? "unknown",
        containsLayers: sym.containsLayers ?? [],
        callerCount,
        calledBy: allCalledBy.slice(0, MAX_CALLERS).map(toRelSymbol).filter(Boolean),
        ...(allCalledBy.length > MAX_CALLERS ? { calledByTruncated: true } : {}),
        calls: allCalls.slice(0, MAX_CALLERS).map(toRelSymbol).filter(Boolean),
        changeGuidance:
          callerCount >= HIGH_RISK_CALLER_COUNT
            ? "Preserve signature and behavior unless user explicitly requested a contract change."
            : "Check direct callers before changing signature or return shape.",
      });
    });
    symbols.sort((a, b) => b.callerCount - a.callerCount || a.name.localeCompare(b.name));

    const topImporterNames = importedBy.slice(0, 3).map((i: any) => i.file).join(", ");
    const decision =
      modificationRisk === "dangerous"
        ? "announce_risk_then_proceed_with_contract_guardrails"
        : modificationRisk === "caution"
        ? "proceed_only_after_callers_are_checked"
        : "proceed_with_targeted_checks";

    const neighborFocusFiles = {
      imports: allImports.slice(0, 6).map((f) => ({
        file: this.toProjectPath(f),
        focus: this.focusPathFor(f, graph),
      })),
      importedBy: allImportedBy.slice(0, 6).map((f) => ({
        file: this.toProjectPath(f),
        focus: this.focusPathFor(f, graph),
      })),
    };

    return {
      file: path.basename(filePath),
      relativePath,
      projectPath: relativePath,
      focusKey,
      focusPath: this.focusPathFor(filePath, graph),
      dataQuality: node.hasParseError ? "partial" : "complete",
      hasParseError: node.hasParseError ?? false,
      risk: {
        modificationRisk,
        decision,
        totalImporterCount: blastSize,
        changeCount: node.changeCount,
        importedByTruncated: allImportedBy.length > MAX_IMPORTEDBY,
      },
      agentPreflight: [
        "Read this focus file before editing this file.",
        modificationRisk === "dangerous"
          ? `DANGER: ${blastSize} importers. Announce the blast radius, keep the edit single-file and contract-preserving, and stop before public contract, behavior, or caller changes. Top importers: ${topImporterNames || "none listed"}.`
          : modificationRisk === "caution"
          ? `CAUTION: ${blastSize} importers. Inspect affected callers before editing.`
          : "Safe: low direct blast radius. Still preserve exports and symbol contracts.",
        "For every edited symbol, inspect calledBy and preserve the expected contract.",
        "Use layer and containsLayers to avoid touching unrelated UI, data, state, handler, or logic code.",
      ],
      changeContract: {
        preserve: [
          "Public exports",
          "Function signatures",
          "Return shapes",
          "Existing import style",
        ],
        askFirstWhen: [
          "A public export, function/type signature, return shape, type structure, or runtime behavior would change",
          "A symbol layer is mixed and the task targets only one layer",
          "A change requires touching callers or files outside the requested scope",
          "The needed focus file is missing or dataQuality is partial for the target",
        ],
        afterChange: [
          "Run the narrowest relevant test or compile check",
          "Verify listed importedBy files still satisfy the changed contract",
          "If verification is missing or incomplete, report the residual risk",
        ],
      },
      importedBy,
      imports,
      neighborFocusFiles,
      ...(isBarrel && reExports.length > 0 ? { isBarrel: true, reExports } : {}),
      symbols,
      verificationTargets: {
        files: importedBy.slice(0, 5).map((i: any) => i.file),
        symbols: symbols
          .filter((s: any) => s.callerCount > 0)
          .slice(0, 5)
          .map((s: any) => `${relativePath}::${s.name} (${s.callerCount} callers)`),
      },
    };
  }

  // ── CONTEXT GENERATION ─────────────────────────────────────────────────────

  /**
   * Writes the project-level AI context bundle:
   * - context.json for routing and risk policy
   * - context.files.json for file dependency details
   * - context.symbols.json for call graph details
   * - focus files and WORKFLOW.md for targeted agent workflows
   */
  generateContext(graph: SystemGraph, history: HistoryLog): void {
    if (!this.contextGenerationEnabled) {
      return;
    }
    try {
      const contextDir = path.join(path.dirname(this.persistPath), ".cache");

      // Entry points are usually framework routes or top-level modules. Agents
      // use this signal when deciding which files deserve extra verification.
      const entryPointFiles = new Set<string>();
      graph.files.forEach((node, filePath) => {
        const isSource =
          !filePath.includes("node_modules") &&
          !filePath.includes(".ripple") &&
          !filePath.includes(".next");
        if (isSource && node.importedBy.size === 0 && node.imports.size > 0) {
          entryPointFiles.add(filePath);
        }
      });

      // Generated JSON uses project-relative references so prompts remain
      // stable across machines and do not expose local workspace paths.
      const toContextFileRef = (filePath: string): string => {
        const normalized = filePath.split(path.sep).join("/");
        return path.isAbsolute(filePath) ? this.toProjectPath(filePath) : normalized;
      };
      const fileRefFromEntity = (entity: string): string => {
        const filePath = entity.includes("::") ? entity.split("::")[0] : entity;
        return toContextFileRef(filePath);
      };
      const symbolRefFromId = (symbolId: string): string => {
        const separator = symbolId.indexOf("::");
        if (separator === -1) {
          return symbolId;
        }
        const filePath = symbolId.slice(0, separator);
        const symbolName = symbolId.slice(separator + 2);
        return `${toContextFileRef(filePath)}::${symbolName}`;
      };

      // Small query hints let agents route themselves before loading heavier
      // files like context.files.json or context.symbols.json.
      const mostConnectedFiles: string[] = [];
      Array.from(graph.files.entries())
        .filter(([_, n]) => n.importedBy.size >= CAUTION_BLAST_RADIUS)
        .sort((a, b) => b[1].importedBy.size - a[1].importedBy.size)
        .slice(0, 10)
        .forEach(([filePath]) => mostConnectedFiles.push(this.toProjectPath(filePath)));

      const recentlyChangedFiles: string[] = [];
      const seenFiles = new Set<string>();
      for (let i = history.events.length - 1; i >= 0; i--) {
        const e = history.events[i];
        if (e.type !== "baseline_snapshot") {
          const fileRef = fileRefFromEntity(e.source);
          if (!seenFiles.has(fileRef)) {
            seenFiles.add(fileRef);
            recentlyChangedFiles.push(fileRef);
            if (recentlyChangedFiles.length >= 5) {break;}
          }
        }
      }

      const highRiskSymbols: string[] = [];
      graph.symbols.forEach((sym) => {
        if (sym.calledBy.size >= HIGH_RISK_CALLER_COUNT) {
          highRiskSymbols.push(symbolRefFromId(sym.id));
        }
      });

      const entryPoints: string[] = [];
      entryPointFiles.forEach((filePath) => {
        entryPoints.push(this.toProjectPath(filePath));
      });

      const lastChangeGroup: any = {
        id: null,
        filesChanged: [],
        symbolsChanged: [],
        message: "No changes recorded yet — Ripple was just installed",
      };

      const lastGroupId = (() => {
        for (let i = history.events.length - 1; i >= 0; i--) {
          if (history.events[i].changeGroup) {return history.events[i].changeGroup;}
        }
        return null;
      })();

      if (lastGroupId) {
        const groupEvents = history.getGroup(lastGroupId);
        const changedFiles = new Set<string>();
        const changedSymbols = new Set<string>();
        const relatedFiles = new Set<string>();
        groupEvents.forEach((e) => {
          const sourceFile = fileRefFromEntity(e.source);
          if (sourceFile) {
            changedFiles.add(sourceFile);
          }
          if (e.source.includes("::")) {
            changedSymbols.add(symbolRefFromId(e.source));
          }
          if (e.target) {
            const targetFile = fileRefFromEntity(e.target);
            if (targetFile && targetFile !== sourceFile) {
              relatedFiles.add(targetFile);
            }
          }
        });
        lastChangeGroup.id = lastGroupId;
        lastChangeGroup.filesChanged = Array.from(changedFiles).filter(Boolean);
        lastChangeGroup.relatedFiles = Array.from(relatedFiles)
          .filter((filePath) => filePath && !changedFiles.has(filePath));
        lastChangeGroup.symbolsChanged = Array.from(changedSymbols).filter(Boolean);
        delete lastChangeGroup.message;
        const ts = parseInt(lastGroupId.split("_")[1]);
        if (!isNaN(ts)) {lastChangeGroup.changedAt = new Date(ts).toISOString();}
      }

      const criticalFiles: any[] = [];
      graph.files.forEach((node, filePath) => {
        const blastRadius = node.importedBy.size;
        const isHighChurn = node.changeCount > HIGH_CHURN_CRITICAL;
        const isHighBlast = blastRadius >= HIGH_BLAST_CRITICAL;
        if (isHighBlast || isHighChurn) {
          criticalFiles.push({
            path: this.toProjectPath(filePath),
            importedBy: blastRadius,
            changeCount: node.changeCount,
            modificationRisk:
              blastRadius >= DANGEROUS_BLAST_RADIUS || node.changeCount > DANGEROUS_CHURN
                ? "dangerous" : "caution",
            reasons: [
              ...(isHighBlast ? [`imported by ${blastRadius} files`] : []),
              ...(isHighChurn ? [`modified ${node.changeCount} times`] : []),
            ],
          });
        }
      });
      criticalFiles.sort((a, b) => b.importedBy - a.importedBy);

      // Warnings are intentionally short and user-facing. They summarize the
      // most important files without duplicating the full context files.
      const warnings: any[] = [];
      criticalFiles.slice(0, 5).forEach((f) => {
        if (f.importedBy >= HIGH_BLAST_CRITICAL) {
          warnings.push({
            type: "high_blast_radius",
            file: f.path,
            message: `Imported by ${f.importedBy} files — verify all callers before changing`,
          });
        }
        if (f.changeCount > HIGH_CHURN_CRITICAL) {
          warnings.push({
            type: "high_churn",
            file: f.path,
            message: `Modified ${f.changeCount} times — frequently changed, high risk`,
          });
        }
      });

      // Stack detection is heuristic. The output should guide agents toward
      // local conventions without pretending to be a full framework analyzer.
      const techStack = {
        hasNextJs:
          fs.existsSync(path.join(this.workspaceRoot, "next.config.ts")) ||
          fs.existsSync(path.join(this.workspaceRoot, "next.config.js")),
        hasVite:
          fs.existsSync(path.join(this.workspaceRoot, "vite.config.ts")) ||
          fs.existsSync(path.join(this.workspaceRoot, "vite.config.js")),
        hasReactRouter:
          fs.existsSync(path.join(this.workspaceRoot, "react-router.config.ts")) ||
          fs.existsSync(path.join(this.workspaceRoot, "react-router.config.js")),
        hasTurborepo: fs.existsSync(path.join(this.workspaceRoot, "turbo.json")),
        hasTypeScript: fs.existsSync(path.join(this.workspaceRoot, "tsconfig.json")),
        hasTailwind:
          fs.existsSync(path.join(this.workspaceRoot, "tailwind.config.ts")) ||
          fs.existsSync(path.join(this.workspaceRoot, "tailwind.config.js")),
        hasTests:
          fs.existsSync(path.join(this.workspaceRoot, "jest.config.ts")) ||
          fs.existsSync(path.join(this.workspaceRoot, "jest.config.js")) ||
          fs.existsSync(path.join(this.workspaceRoot, "vitest.config.ts")),
        packageManager: fs.existsSync(path.join(this.workspaceRoot, "pnpm-lock.yaml"))
          ? "pnpm"
          : fs.existsSync(path.join(this.workspaceRoot, "yarn.lock"))
          ? "yarn"
          : "npm",
      };

      // Prefer directories that already exist in the project. This keeps agents
      // from inventing new architecture during file-creation tasks.
      const safeToCreateIn: string[] = [];
      const candidateDirs = [
        "app/components","src/components","components",
        "app/hooks","src/hooks","hooks",
        "app/lib","src/lib","lib",
        "app/utils","src/utils","utils",
        "app/types","src/types","types",
        "app/services","src/services","services",
      ];
      candidateDirs.forEach((dir) => {
        if (fs.existsSync(path.join(this.workspaceRoot, dir))) {safeToCreateIn.push(dir);}
      });
      ["apps","packages","web"].forEach((prefix) => {
        const prefixDir = path.join(this.workspaceRoot, prefix);
        if (!fs.existsSync(prefixDir)) {return;}
        try {
          if (prefix === "web") {
            ["core/components","core/hooks","core/store","core/services","core/lib",
             "components","hooks","store","services"].forEach((sub) => {
              const subPath = path.join(prefixDir, sub);
              if (fs.existsSync(subPath)) {
                const rel = `${prefix}/${sub}`;
                if (!safeToCreateIn.includes(rel)) {safeToCreateIn.push(rel);}
              }
            });
            return;
          }
          fs.readdirSync(prefixDir).forEach((pkg) => {
            const pkgPath = path.join(prefixDir, pkg);
            try { if (!fs.statSync(pkgPath).isDirectory()) {return;} } catch { return; }
            ["components","hooks","lib","store","services"].forEach((sub) => {
              const subPath = path.join(pkgPath, sub);
              if (fs.existsSync(subPath)) {
                const rel = `${prefix}/${pkg}/${sub}`;
                if (!safeToCreateIn.includes(rel)) {safeToCreateIn.push(rel);}
              }
            });
          });
        } catch { /* skip */ }
      });

      // Orphaned symbols are useful suggestions, not deletion instructions.
      // Entry points and imported files are excluded to avoid false positives.
      const orphanedSymbols: string[] = [];
      graph.symbols.forEach((sym) => {
        if (entryPointFiles.has(sym.file)) {return;}
        const fileNode = graph.files.get(sym.file);
        if (fileNode && fileNode.importedBy.size > 0) {return;}
        if (
          sym.calledBy.size === 0 && sym.kind === "function" &&
          !sym.name.startsWith("_") && sym.name !== "default"
        ) {
          orphanedSymbols.push(`${this.toProjectPath(sym.file)}::${sym.name}`);
        }
      });

      let rippleVersion = "1.0.1";
      try {
        const ripplePkg = JSON.parse(
          fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
        );
        if (ripplePkg.version) {rippleVersion = ripplePkg.version;}
      } catch { /* stay with fallback */ }

      let projectName = path.basename(this.workspaceRoot);
      let projectDescription = "";
      let importAlias = "";

      try {
        const pkgPath = path.join(this.workspaceRoot, "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
          if (pkg.name) {projectName = pkg.name;}
          if (pkg.description) {projectDescription = pkg.description;}
        }
      } catch { /* use directory name */ }

      try {
        const tsconfigPath = path.join(this.workspaceRoot, "tsconfig.json");
        if (fs.existsSync(tsconfigPath)) {
          const raw = fs.readFileSync(tsconfigPath, "utf8")
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/,\s*([}\]])/g, "$1");
          const tsconfig = JSON.parse(raw);
          const tsPaths = tsconfig?.compilerOptions?.paths ?? {};
          const firstAlias = Object.keys(tsPaths)[0];
          if (firstAlias) {importAlias = firstAlias.replace("/*", "");}
        }
      } catch { /* no alias */ }

      if (!this.patternCache) {
        // Coding style hints are cached because they require reading many files.
        // The cache is invalidated when a file or project config changes.
        let arrowFileCount = 0;
        let namedFileCount = 0;
        let hasClassComponents = false;

        graph.files.forEach((_, filePath) => {
          if (
            filePath.includes("node_modules") || filePath.includes(".next") ||
            filePath.includes(".ripple") || filePath.includes(".config.") ||
            filePath.includes(".setup.")
          ) {return;}
          try {
            const content = fs.readFileSync(filePath, "utf8");
            const namedFns = (content.match(/^(export\s+)?(async\s+)?function\s+\w+/gm) || []).length;
            const arrowFns = (content.match(/^(export\s+)?(const|let)\s+\w+\s*=\s*(async\s+)?\(/gm) || []).length;
            if (arrowFns > namedFns) {arrowFileCount++;}
            else if (namedFns > 0) {namedFileCount++;}
            if (/extends\s+(React\.)?Component/.test(content)) {hasClassComponents = true;}
            if (/^class\s+\w+Store/.test(content) || /makeObservable|makeAutoObservable/.test(content)) {hasClassComponents = true;}
          } catch { /* skip unreadable */ }
        });

        this.patternCache = {
          prefersArrowFunctions: arrowFileCount > namedFileCount,
          hasClassComponents,
        };
      }

      const { prefersArrowFunctions, hasClassComponents } = this.patternCache;

      const sourceImportPaths = Array.from(graph.files.entries())
        .filter(([fp]) =>
          !fp.includes("node_modules") && !fp.includes(".next") && !fp.includes(".ripple")
        )
        .flatMap(([_, node]) => Array.from(node.imports));

      const importBasenames = sourceImportPaths.map((i) =>
        path.basename(i, path.extname(i))
      );

      const stateManagement: string[] = [];
      if (importBasenames.some((i) => i.includes("zustand"))) {stateManagement.push("zustand");}
      if (importBasenames.some((i) => i.includes("redux"))) {stateManagement.push("redux");}
      if (importBasenames.some((i) => i.includes("jotai"))) {stateManagement.push("jotai");}
      if (importBasenames.some((i) => i.includes("recoil"))) {stateManagement.push("recoil");}
      if (importBasenames.some((i) => i === "mobx" || i.includes("mobx-react"))) {stateManagement.push("mobx");}
      try {
        const pkgRaw2 = fs.readFileSync(path.join(this.workspaceRoot, "package.json"), "utf8");
        const pkg2 = JSON.parse(pkgRaw2);
        const allDeps2 = { ...(pkg2.dependencies ?? {}), ...(pkg2.devDependencies ?? {}) };
        if (allDeps2["@tanstack/react-query"] || allDeps2["react-query"]) {stateManagement.push("react-query");}
        if (allDeps2["@trpc/client"] || allDeps2["@trpc/react-query"]) {stateManagement.push("trpc");}
        if (allDeps2["swr"]) {stateManagement.push("swr");}
        if (allDeps2["mobx"] && !stateManagement.includes("mobx")) {stateManagement.push("mobx");}
        if (allDeps2["mobx-state-tree"] && !stateManagement.includes("mobx-state-tree")) {stateManagement.push("mobx-state-tree");}
      } catch { /* no package.json */ }
      if (stateManagement.length === 0) {stateManagement.push("useState");}

      // Styling and state-management hints are merged from imports, package
      // dependencies, and config files to produce practical agent constraints.
      const stylingApproach: string[] = [];
      const cssImports = sourceImportPaths.filter(
        (i) => i.endsWith(".css") || i.endsWith(".scss")
      );
      if (cssImports.some((i) => i.includes("module"))) {stylingApproach.push("css-modules");}
      try {
        const pkgRaw = fs.readFileSync(path.join(this.workspaceRoot, "package.json"), "utf8");
        const pkg = JSON.parse(pkgRaw);
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        if (deps["styled-components"]) {stylingApproach.push("styled-components");}
        if (deps["@emotion/react"] || deps["@emotion/styled"]) {stylingApproach.push("emotion");}
      } catch { /* no package.json */ }
      if (techStack.hasTailwind) {stylingApproach.push("tailwind");}
      if (stylingApproach.length === 0 && cssImports.length > 0) {stylingApproach.push("css");}

      const testingFramework: string[] = [];
      if (
        fs.existsSync(path.join(this.workspaceRoot, "jest.config.ts")) ||
        fs.existsSync(path.join(this.workspaceRoot, "jest.config.js"))
      ) {testingFramework.push("jest");}
      if (fs.existsSync(path.join(this.workspaceRoot, "vitest.config.ts"))) {testingFramework.push("vitest");}
      if (fs.existsSync(path.join(this.workspaceRoot, "playwright.config.ts"))) {testingFramework.push("playwright");}

      const codingPatterns = {
        prefersArrowFunctions,
        stateManagement,
        stylingApproach,
        testingFramework,
        componentPattern: hasClassComponents ? "class or functional" : "functional only",
      };

      const detectedConstraints: string[] = [];
      if (!hasClassComponents) {
        detectedConstraints.push("No class components detected — use functional components only");
      }
      const hasApiDir =
        fs.existsSync(path.join(this.workspaceRoot, "app/api")) ||
        fs.existsSync(path.join(this.workspaceRoot, "pages/api"));
      if (hasApiDir) {
        detectedConstraints.push("API routes detected — use framework route handlers for external calls");
      }
      const hasDataFetching = stateManagement.some((s) => ["react-query","trpc","swr"].includes(s));
      const hasMobX = stateManagement.includes("mobx") || stateManagement.includes("mobx-state-tree");
      if (hasMobX) {
        detectedConstraints.push("State management uses MobX — add new state as MobX stores, not useState");
      } else if (stateManagement.length === 1 && stateManagement[0] === "useState" && !hasDataFetching) {
        detectedConstraints.push("State management uses useState only — do not introduce Redux, Zustand, or Jotai");
      } else if (hasDataFetching) {
        const dfLibs = stateManagement.filter((s) => ["react-query","trpc","swr"].includes(s)).join(", ");
        detectedConstraints.push(`Data fetching uses ${dfLibs} — use existing patterns for server state`);
      }

      // Public API contains exported symbols already used elsewhere. Agents can
      // use this list to reuse existing contracts before creating new ones.
      const publicApi: Record<string, string[]> = {};
      graph.files.forEach((node, filePath) => {
        const isSource =
          !filePath.includes("node_modules") && !filePath.includes(".ripple") && !filePath.includes(".next");
        if (!isSource) {return;}
        const exported: string[] = [];
        node.symbols.forEach((symbolId) => {
          const sym = graph.symbols.get(symbolId);
          if (sym && (node.importedBy.size > 0 || sym.calledBy.size > 0)) {
            exported.push(sym.name);
          }
        });
        if (exported.length > 0) {
          const key = path.relative(this.workspaceRoot, filePath).split(path.sep).join("/");
          publicApi[key] = exported;
        }
      });

      // Full file dependency map. Kept out of context.json so simple tasks can
      // start from a smaller routing file.
      const filesMap: Record<string, any> = {};
      graph.files.forEach((node, filePath) => {
        const isSource =
          !filePath.includes("node_modules") && !filePath.includes(".ripple") && !filePath.includes(".next");
        if (!isSource) {return;}

        const importedBy = Array.from(node.importedBy)
          .filter((f) => !f.includes("node_modules"))
          .map((f) => path.relative(this.workspaceRoot, f).split(path.sep).join("/"));
        const imports = Array.from(node.imports)
          .filter((f) => !f.includes("node_modules"))
          .map((f) => path.relative(this.workspaceRoot, f).split(path.sep).join("/"));
        const symbols = Array.from(node.symbols).map((id) => id.split("::")[1]).filter(Boolean);

        if (importedBy.length === 0 && imports.length === 0 && symbols.length === 0) {return;}

        const fileKey = path.relative(this.workspaceRoot, filePath).split(path.sep).join("/");
        const blastSize = node.importedBy.size;
        const modificationRisk =
          blastSize >= DANGEROUS_BLAST_RADIUS || node.changeCount > DANGEROUS_CHURN
            ? "dangerous"
            : blastSize >= CAUTION_BLAST_RADIUS || node.changeCount > CAUTION_CHURN
            ? "caution" : "safe";

        filesMap[fileKey] = {
          projectPath: fileKey,
          importedBy,
          imports,
          symbols,
          changeCount: node.changeCount,
          lastModified: node.lastModifiedAt,
          modificationRisk,
        };
      });

      // Full symbol call graph. This is the heavier context file used for
      // debugging, refactors, and caller/callee tracing.
      const symbolsMap: Record<string, any> = {};
      graph.symbols.forEach((sym) => {
        const toRelSymId = (id: string) => {
          const p = id.split("::");
          if (p.length < 2) {return id;}
          return `${path.relative(this.workspaceRoot, p[0]).split(path.sep).join("/")}::${p[1]}`;
        };
        const calledBy = Array.from(sym.calledBy).map(toRelSymId).filter(Boolean);
        const calls = Array.from(sym.calls).map(toRelSymId).filter(Boolean);
        if (calledBy.length === 0 && calls.length === 0) {return;}
        const symbolKey = `${path.relative(this.workspaceRoot, sym.file).split(path.sep).join("/")}::${sym.name}`;
        symbolsMap[symbolKey] = {
          file: path.basename(sym.file),
          kind: sym.kind,
          layer: sym.layer ?? "unknown",
          containsLayers: sym.containsLayers ?? [],
          calledBy,
          calls,
        };
      });

      const focusLookup = this.buildFocusLookup(graph);
      const {
        availableFocusFiles,
        availableFocusFilesByPath,
        availableFocusFilesByBasename,
        ambiguousFocusFileNames,
        ambiguousFocusFileMatches,
      } = focusLookup;
      const focusExamplesForContext = Object.entries(availableFocusFilesByPath)
        .slice(0, 3)
        .map(([file, focus]) => `${file} -> ${focus}`);

      const lightContext = {
        rippleVersion,
        projectName,
        projectDescription: projectDescription || "Add description to package.json for richer agent context",
        importAlias: importAlias
          ? `Use '${importAlias}/...' for imports (detected from tsconfig)`
          : "Use relative imports (no tsconfig alias detected)",
        generated: new Date().toISOString(),
        instructions: [
          "FASTEST: Look up your target relative path in availableFocusFilesByPath and read that path first.",
          focusExamplesForContext.length > 0
            ? `Real examples: ${focusExamplesForContext.join(" | ")}`
            : "Focus files generated after first scan.",
          "If the user gives only a basename, check availableFocusFilesByBasename. If status is 'ambiguous', ask which path they mean before reading or editing.",
          "Never choose among ambiguous basenames using top focus files, risk, recency, or perceived importance.",
          "Do not guess focus file names. Collision-safe focus keys may include a hash suffix.",
          "Check criticalFiles and warnings before touching any file.",
          "Use safeToCreateIn to know where to put new files.",
          "Never modify or delete files inside .ripple/ — these are Ripple internal files.",
        ],
        project: {
          totalFiles: graph.files.size,
          totalSymbols: graph.symbols.size,
          totalDependencies: Array.from(graph.files.values()).reduce(
            (sum, f) => sum + f.imports.size, 0
          ),
        },
        _tieredContext: {
          summary: "Read the smallest file that answers your question. Start with the target file's focus file.",
          decisionTree: {
            "I know which file to modify": "Look up relative path in availableFocusFilesByPath -> read that focus file",
            "I only know a filename like options.ts": "Check availableFocusFilesByBasename -> if ambiguous, ask user which path",
            "I need to add a new file": "Check safeToCreateIn and publicApi in this file",
            "I need to understand file connections": "Read .ripple/.cache/context.files.json",
            "I need to trace a call chain": "Read .ripple/.cache/context.symbols.json",
            "I am debugging across files": "Check lastChangeGroup → read .ripple/.cache/context.symbols.json",
          },
          files: {
            ".ripple/.cache/focus/{key}.json": "PRIMARY. Targeted file contract. Read for any targeted file change.",
            ".ripple/.cache/context.json": "Project routing, risk policy, and focus lookup.",
            ".ripple/.cache/context.files.json": "Full file map.",
            ".ripple/.cache/context.symbols.json": "Full call graph.",
          },
          tokenEstimates: {
            "focus file only": "~700-1500 tokens, depending on callers",
            "context.json only": "~1000-2000 tokens",
            "context.json + context.files.json": "project-size dependent",
            "all context files": "project-size dependent; avoid unless truly needed",
          },
        },
        agentOperatingMode: {
          mission: "Use Ripple as live architectural memory before changing code.",
          preflight: [
            "Classify the task: targeted edit, new file, debugging, or broad refactor.",
            "For targeted edits, read the target focus file before opening broad context.",
            "For new files, reuse publicApi and safeToCreateIn before inventing structure.",
            "For debugging, inspect lastChangeGroup, warnings, then symbol call chains.",
          ],
          stopConditions: [
            "The user named only a basename that is listed as ambiguous",
            "A dangerous file change would modify public exports, signatures, type structures, runtime behavior, callers, or multiple files",
            "calledBy shows callers outside the requested scope",
            "A mixed-layer symbol would require changing more layers than the user asked for",
            "The needed focus file is missing or dataQuality is partial for the target",
          ],
          verificationContract: [
            "After edits, verify direct callers or explain why they are unaffected.",
            "Prefer the narrowest compile/test command that covers touched files.",
            "Report residual risk when tests are missing or context is partial.",
          ],
        },
        riskPolicy: {
          safe: "Proceed with normal focused checks.",
          caution: "Inspect callers and imports before editing; mention verification.",
          dangerous: "Announce high blast radius. For exact paths, proceed only with single-file contract-preserving edits; stop before public contract, behavior, caller, or multi-file changes.",
        },
        queryHints: { mostConnectedFiles, recentlyChangedFiles, highRiskSymbols },
        entryPoints,
        lastChangeGroup,
        criticalFiles: criticalFiles.slice(0, 10),
        warnings,
        techStack,
        safeToCreateIn,
        orphanedSymbols: orphanedSymbols.slice(0, 20),
        availableFocusFiles,
        availableFocusFilesByPath,
        availableFocusFilesByBasename,
        ambiguousFocusFileNames,
        ambiguousFocusFileMatches,
        agentTasks: {
          addNewComponent: [
            "1. Check safeToCreateIn for the correct directory",
            `2. Use ${stylingApproach[0] ?? "detected styling"} for styling`,
            "3. Check publicApi and orphanedSymbols — reuse before creating new",
          ],
          modifyExistingFile: [
            "1. Resolve the target: relative path -> availableFocusFilesByPath; basename -> availableFocusFilesByBasename",
            "2. If basename resolution is ambiguous, ask which listed path the user means",
            "3. Read the resolved focus file",
            "4. If modificationRisk is dangerous, announce the importer count and proceed only within single-file contract-preserving bounds",
            "5. Stop and ask before public contract, behavior, caller, or multi-file changes",
            "6. Check each symbol's layer — only touch the layer the user requested",
            "7. Check calledBy — every caller must still work",
          ],
          debugBug: [
            "1. Check lastChangeGroup.changedAt — what changed and when",
            "2. Check warnings — high_churn files are most likely sources",
            "3. Read .ripple/.cache/context.symbols.json — trace full call chain",
          ],
        },
      };

      fs.writeFileSync(
        path.join(contextDir, "context.files.json"),
        JSON.stringify({
          rippleVersion,
          generated: new Date().toISOString(),
          description: "File dependency map. Read when modifying files, adding imports, or checking blast radius.",
          codingPatterns,
          detectedConstraints,
          publicApi,
          files: filesMap,
        }, null, 2)
      );

      fs.writeFileSync(
        path.join(contextDir, "context.symbols.json"),
        JSON.stringify({
          rippleVersion,
          generated: new Date().toISOString(),
          description: "Symbol call graph with layer classification. Read when modifying functions or tracing call chains.",
          symbols: symbolsMap,
        }, null, 2)
      );

      fs.writeFileSync(
        path.join(contextDir, "context.json"),
        JSON.stringify(lightContext, null, 2)
      );

      this.generateWorkflow(
        projectName, projectDescription, importAlias,
        safeToCreateIn, stateManagement, stylingApproach,
        testingFramework, entryPoints, graph, rippleVersion
      );

      this.generateFocusedContexts(graph);
    } catch (err) {
      console.warn("[Ripple] Context generation failed:", err);
    }
  }

  // ── FOCUSED CONTEXT ────────────────────────────────────────────────────────

  /**
   * Rewrites the focus directory from the current graph and removes stale focus
   * files for deleted or now-irrelevant source files.
   */
  private generateFocusedContexts(graph: SystemGraph): void {
    try {
      const focusDir = path.join(path.dirname(this.persistPath), ".cache", "focus");
      if (!fs.existsSync(focusDir)) {
        fs.mkdirSync(focusDir, { recursive: true });
      }

      const validFocusKeys = new Set<string>();
      graph.files.forEach((fnode, fp) => {
        if (!this.isContextSourceFile(fp)) {
          return;
        }
        if (fnode.imports.size === 0 && fnode.importedBy.size === 0 && fnode.symbols.size === 0) {
          return;
        }
        validFocusKeys.add(makeFocusKey(fp, graph));
      });

      try {
        fs.readdirSync(focusDir).forEach((fname) => {
          if (!fname.endsWith(".json")) {
            return;
          }
          if (!validFocusKeys.has(fname.slice(0, -5))) {
            fs.unlinkSync(path.join(focusDir, fname));
          }
        });
      } catch { /* focus dir may be empty */ }

      graph.files.forEach((_, filePath) => {
        const focused = this.buildFocusedContext(graph, filePath);
        if (!focused) {
          return;
        }

        fs.writeFileSync(
          path.join(focusDir, `${focused.focusKey}.json`),
          JSON.stringify(focused, null, 2)
        );
      });
    } catch (err) {
      console.warn("[Ripple] Focused context generation failed:", err);
    }
  }

  // ── WORKFLOW.MD ───────────────────────────────────────────────────────────

  /**
   * Generates the human-readable operating protocol for AI agents and refreshes
   * Ripple-managed sections in supported instruction files.
   */
  private generateWorkflow(
    projectName: string,
    projectDescription: string,
    importAlias: string,
    safeToCreateIn: string[],
    stateManagement: string[],
    stylingApproach: string[],
    testingFramework: string[],
    entryPoints: string[],
    graph: SystemGraph,
    rippleVersion: string
  ): void {
    try {
      const hasMobX = stateManagement.includes("mobx") || stateManagement.includes("mobx-state-tree");
      const techStack = {
        hasNextJs:
          fs.existsSync(path.join(this.workspaceRoot, "next.config.ts")) ||
          fs.existsSync(path.join(this.workspaceRoot, "next.config.js")),
        hasVite:
          fs.existsSync(path.join(this.workspaceRoot, "vite.config.ts")) ||
          fs.existsSync(path.join(this.workspaceRoot, "vite.config.js")),
        hasReactRouter:
          fs.existsSync(path.join(this.workspaceRoot, "react-router.config.ts")) ||
          fs.existsSync(path.join(this.workspaceRoot, "react-router.config.js")),
      };

      // WORKFLOW.md is meant for humans and agents, so it stays in .ripple/.
      const workflowPath = path.join(path.dirname(this.persistPath), "WORKFLOW.md");

      const dangerousFiles = Array.from(graph.files.values())
        .filter((node) => node.importedBy.size >= DANGEROUS_BLAST_RADIUS)
        .map((node) => ({
          projectPath: this.toProjectPath(node.path),
          importerCount: node.importedBy.size,
        }))
        .sort((a, b) =>
          b.importerCount - a.importerCount ||
          a.projectPath.localeCompare(b.projectPath)
        )
        .map((node) => `${node.projectPath} (${node.importerCount} importers)`);

      const riskPriority = { dangerous: 0, caution: 1, safe: 2 } as const;
      const focusExamples = Array.from(graph.files.values())
        .filter((node) => {
          const isSource =
            !node.path.includes("node_modules") &&
            !node.path.includes(".next") &&
            !node.path.includes(".ripple");
          return isSource && (node.imports.size > 0 || node.importedBy.size > 0);
        })
        .map((node) => {
          const blastSize = node.importedBy.size;
          const risk: keyof typeof riskPriority =
            blastSize >= DANGEROUS_BLAST_RADIUS || node.changeCount > DANGEROUS_CHURN ? "dangerous"
            : blastSize >= CAUTION_BLAST_RADIUS || node.changeCount > CAUTION_CHURN ? "caution" : "safe";
          const projectPath = this.toProjectPath(node.path);
          return {
            projectPath,
            blastSize,
            risk,
            line: `${projectPath} [${risk}] -> ${this.focusPathFor(node.path, graph)}`,
          };
        })
        .sort((a, b) =>
          riskPriority[a.risk] - riskPriority[b.risk] ||
          b.blastSize - a.blastSize ||
          a.projectPath.localeCompare(b.projectPath)
        )
        .slice(0, 10)
        .map((entry) => entry.line);
      const workflowFocusLookup = this.buildFocusLookup(graph);
      const ambiguousBasenameExamples = Object.entries(workflowFocusLookup.ambiguousFocusFileMatches)
        .slice(0, 6)
        .map(([basename, matches]) =>
          `${basename}: ${matches
            .map((match) => `${match.path} [${match.risk}, ${match.importers} importers]`)
            .join(", ")}`
        );

      const createDirs = safeToCreateIn.slice(0, 4).join(", ") ||
        "existing source directories after checking project structure";
      const stylingRule = stylingApproach[0] ?? "the existing styling approach";

      const content = `# ${projectName} — Ripple Workflow
*Auto-generated by Ripple v${rippleVersion} — always current*
*Use the setup panel to copy this into AGENTS.md, CLAUDE.md, or .cursorrules. Ripple keeps its managed section updated.*

---

## YOUR AUTOMATIC PROTOCOL

Run this before every task — automatically:

**Step 1:** Classify the task: targeted edit, new file, debugging, or broad refactor.
**Step 2:** If a file is involved, open \`.ripple/.cache/context.json\` and resolve the target before reading or editing:
  - If the user gave a relative path, look it up in \`availableFocusFilesByPath\`.
  - If the user gave only a basename such as \`options.ts\`, check \`availableFocusFilesByBasename\`.
  - If that basename is \`"ambiguous"\`, STOP and ask which listed path they mean.
  - Do not choose among ambiguous basenames using top focus files, risk, recency, or project importance.
  - Do not guess focus filenames. Collision-safe keys can include a hash suffix.
  - Use \`availableFocusFiles\` only for unique basename shortcuts.
**Step 3:** Read the target focus file before editing.
**Step 4:** Check \`risk.modificationRisk\`:
  - \`"safe"\` -> proceed with targeted checks
  - \`"caution"\` -> inspect callers/importers first
  - \`"dangerous"\` -> announce importer count and proceed only if the target path is exact, the edit stays single-file, and public contracts are preserved
**Step 5:** For every edited symbol, check \`calledBy\`, \`layer\`, and \`containsLayers\`.
**Step 6:** Preserve public exports, function signatures, return shapes, and import style unless the user explicitly asks for a contract change.

---

## DANGEROUS FILE PROTOCOL

Dangerous files need informed autonomy, not a blanket permission stop:

1. **Ambiguous path** — if the user gave only a basename and multiple files match, STOP and ask which listed path they mean.
2. **Exact path, dangerous file** — announce the blast radius, then proceed without waiting only when the edit is single-file and contract-preserving:
   - No public export changes
   - No function or type signature changes
   - No return-shape or type-structure changes
   - No runtime behavior changes
   - No caller updates required
3. **Contract change required** — STOP before editing. Tell the user exactly which contract, behavior, caller, or multi-file change is required and ask whether to proceed.

After any dangerous-file edit, run the narrowest relevant compile/test check, verify the listed importedBy files still satisfy the contract, and report residual risk when verification is missing or incomplete.

---

## PLANNING FOR COMPLEX TASKS

For any task touching more than one file, BEFORE writing any code:

**Step 1 — Find the starting file.** Read its focus file.
**Step 2 — Chain exploration (1-2 levels).** Look at imports and importedBy. Read focus files for relevant neighbors.
**Step 3 — Formulate the plan:**
\`\`\`
To implement [task]:
1. types/auth.ts       — add type  [caution, 3 importers]
2. lib/authService.ts  — update logic  [dangerous, 7 importers]
3. components/LoginButton.tsx — update UI  [safe, 0 importers]
Shall I proceed?
\`\`\`
**Step 4 — Wait for confirmation before writing any code.**

---

## TASK ROUTING

| User intent | First context to read | Then |
|-------------|----------------------|------|
| Modify one file | Target focus file | Verify \`calledBy\` and importedBy |
| Add a file | \`.ripple/.cache/context.json\` | Check \`safeToCreateIn\`, \`publicApi\`, existing patterns |
| Debug behavior | \`lastChangeGroup\` and warnings | Trace \`.ripple/.cache/context.symbols.json\` |
| Refactor shared code | Focus file + neighbor focus files | Announce danger; stop only for ambiguity, contract, behavior, caller, or multi-file changes |

---

## THIS PROJECT

${projectDescription ? `**What this project does:** ${projectDescription}\n` : ""}\
**Files tracked:** ${graph.files.size}
**Framework:** ${techStack.hasNextJs ? "Next.js" : techStack.hasVite ? "Vite" : techStack.hasReactRouter ? "React Router" : "Unknown"}
**Import style:** ${importAlias ? `Use '${importAlias}/...'` : "Use relative imports"}
**State management:** ${stateManagement.join(", ")}
**Styling:** ${stylingApproach.join(", ") || "see .ripple/.cache/context.files.json"}
**Testing:** ${testingFramework.length > 0 ? testingFramework.join(", ") : "none detected"}
**New files go in:** ${createDirs}${dangerousFiles.length > 0 ? `
**Top high-blast files (announce + guard contracts):** ${dangerousFiles.slice(0, 10).join(", ")}` : ""}

---

## TOP FOCUS FILES IN THIS PROJECT

${focusExamples.length > 0
  ? focusExamples.map(e => `- ${e}`).join("\n")
  : "- Save any file to generate focus files"}

${ambiguousBasenameExamples.length > 0 ? `## AMBIGUOUS FILE NAMES

If the user names only one of these basenames, ask which path they mean before reading or editing:
${ambiguousBasenameExamples.map(e => `- ${e}`).join("\n")}` : ""}

---

## LAYER TARGETING

| Layer | Touch when |
|-------|-----------|
| \`logic\` | "change the logic/algorithm" |
| \`ui\` | "update the UI/design/layout" |
| \`handler\` | "change what happens on click/submit" |
| \`state\` | "update the state management" |
| \`data\` | "change the data fetching" |
| \`mixed\` | ASK user before touching |

---

## ABSOLUTE RULES

1. Never modify \`.ripple/\` files
2. Never change a function signature without checking ALL calledBy callers
3. Never create files outside: ${createDirs}
4. ${hasMobX
  ? "New state goes in a MobX store — never introduce useState for shared state"
  : stateManagement[0] === "useState"
  ? "Never introduce Redux, Zustand, or Jotai without user confirmation"
  : `Use ${stateManagement.join(", ")} for state`}
5. Always use ${stylingRule} for new UI
6. If tests are missing, say what you verified manually and what risk remains

---
*Auto-generated by Ripple v${rippleVersion} — updates on every save*
`;

      fs.writeFileSync(workflowPath, content);

      // Section-based sync preserves user content outside Ripple markers.
      // Files without markers or a legacy Ripple signature are left untouched.
      const RIPPLE_START = "<!-- RIPPLE:START -->";
      const RIPPLE_END   = "<!-- RIPPLE:END -->";
      const rippleSection = `${RIPPLE_START}\n${content}\n${RIPPLE_END}`;

      const agentFiles = [
        { name: "AGENTS.md",      filePath: path.join(this.workspaceRoot, "AGENTS.md") },
        { name: "CLAUDE.md",      filePath: path.join(this.workspaceRoot, "CLAUDE.md") },
        { name: ".cursorrules",   filePath: path.join(this.workspaceRoot, ".cursorrules") },
      ];

      for (const agentFile of agentFiles) {
        try {
          if (!fs.existsSync(agentFile.filePath)) {continue;}

          const existing = fs.readFileSync(agentFile.filePath, "utf8");

          if (existing.includes(RIPPLE_START) && existing.includes(RIPPLE_END)) {
            // Replace only the Ripple section — preserve everything outside markers
            const before = existing.substring(0, existing.indexOf(RIPPLE_START));
            const after  = existing.substring(existing.indexOf(RIPPLE_END) + RIPPLE_END.length);
            fs.writeFileSync(agentFile.filePath, `${before}${rippleSection}${after}`);
          } else if (existing.includes("Auto-generated by Ripple")) {
            // Legacy file written before markers existed — migrate to marker format
            const signatureIndex = existing.indexOf("# ");
            const beforeRipple = signatureIndex > 0 ? existing.substring(0, signatureIndex) : "";
            fs.writeFileSync(agentFile.filePath, `${beforeRipple}${rippleSection}`);
          }
          // No markers and no legacy signature: developer-owned file, leave it unchanged.
        } catch { /* best-effort */ }
      }
    } catch { /* best-effort */ }
  }

  // ── SINGLE FILE FOCUS (per-save fast write) ────────────────────────────────

  /**
   * Fast path used after a single file update. The full context bundle is
   * debounced separately, but the target focus file should be fresh immediately.
   */
  generateSingleFocus(graph: SystemGraph, filePath: string): void {
    if (!this.contextGenerationEnabled) {
      return;
    }
    try {
      const focused = this.buildFocusedContext(graph, filePath);
      if (!focused) {
        return;
      }

      const focusDir = path.join(path.dirname(this.persistPath), ".cache", "focus");
      if (!fs.existsSync(focusDir)) {
        fs.mkdirSync(focusDir, { recursive: true });
      }

      fs.writeFileSync(
        path.join(focusDir, `${focused.focusKey}.json`),
        JSON.stringify(focused, null, 2)
      );
    } catch (err) {
      console.warn("[Ripple] Single focus write failed:", err);
    }
  }
} // end GraphPersistence

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

function sha1(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}

/**
 * Creates the readable portion of a focus-file key from nearby path segments.
 * The collision guard in makeFocusKey() appends a hash when this is not unique.
 */
function getBaseKey(filePath: string): string {
  const parts = filePath.split(path.sep);
  const base = path.basename(filePath, path.extname(filePath));
  if (parts.length >= 4) {return `${parts[parts.length - 3]}-${parts[parts.length - 2]}-${base}`;}
  if (parts.length >= 2) {return `${parts[parts.length - 2]}-${base}`;}
  return base;
}

/**
 * Creates a stable, unique focus-file key. Monorepos often contain many files
 * named index.ts or route.ts, so duplicate readable keys get a short path hash.
 */
function makeFocusKey(filePath: string, graph: SystemGraph): string {
  const key = getBaseKey(filePath);

  let collision = false;
  for (const otherPath of graph.files.keys()) {
    if (otherPath === filePath) {continue;}
    if (getBaseKey(otherPath) === key) {
      collision = true;
      break;
    }
  }

  if (collision) {
    const shortHash = crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 6);
    return `${key}-${shortHash}`;
  }

  return key;
}

function makeSymbolId(filePath: string, symbolName: string): string {
  return `${filePath}::${symbolName}`;
}

function makeChangeGroup(): string {
  return `save_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const TS_JS_GLOB = "**/*.{ts,tsx,js,jsx}";

// Risk thresholds are deliberately simple and visible. They are safety signals
// for users and agents, not proofs of semantic impact.
export const DANGEROUS_BLAST_RADIUS = 5;
export const CAUTION_BLAST_RADIUS   = 2;
export const DANGEROUS_CHURN        = 15;
export const CAUTION_CHURN          = 8;
const HIGH_BLAST_CRITICAL           = 3;
const HIGH_CHURN_CRITICAL           = 10;
export const HIGH_RISK_CALLER_COUNT = 3;

const IGNORE_DIRS = [
  "node_modules", ".git", "dist", "out", "build",
  ".next", ".ripple", ".turbo", ".vercel", "coverage",
];

function shouldIgnore(filePath: string): boolean {
  return IGNORE_DIRS.some(
    (dir) =>
      filePath.includes(`${path.sep}${dir}${path.sep}`) ||
      filePath.endsWith(`${path.sep}${dir}`)
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GRAPH ENGINE
// ────────────────────────────────────────────────────────────────────────────

export class GraphEngine {
  readonly graph: SystemGraph;
  readonly history: HistoryLog;
  private persistence: GraphPersistence;
  private project: Project;
  private workspaceRoot: string;

  // Scans rebuild a large part of the graph. File-system events that arrive
  // during a scan are queued and replayed afterward instead of mutating midway.
  isScanning = false;

  private pendingUpdates = new Set<string>();
  private pendingAdds    = new Set<string>();
  private pendingDeletes = new Set<string>();
  private pendingFullRescan = false;

  private sessionNewFiles = new Set<string>();
  private cacheWriteTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Disables writing .ripple/ context files while keeping the in-memory graph
   * available for editor features.
   */
  setContextGeneration(enabled: boolean): void {
    this.persistence.contextGenerationEnabled = enabled;
  }

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.graph = new SystemGraph();
    this.history = new HistoryLog();
    this.persistence = new GraphPersistence(workspaceRoot);
    this.persistence.load(this.history);

    this.project = this.createProject();
  }

  private createProject(): Project {
    return new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4,                          // JsxEmit.ReactJSX for .tsx files
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        moduleResolution: 2,             // NodeJs
        target: 99,                      // ESNext
        strict: false,                   // Analysis should survive user type errors
      },
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
  }

  dispose(): void {
    if (this.cacheWriteTimer) {
      clearTimeout(this.cacheWriteTimer);
      this.cacheWriteTimer = undefined;
      this.persistence.saveCache(this.graph);
      this.persistence.generateContext(this.graph, this.history);
    }
  }

  // ── PATH CONVERSION ───────────────────────────────────────────────────────
  // Keep this invariant strict: ts-morph receives forward slashes, while graph
  // Maps use OS-native paths so fs/path comparisons remain reliable.

  private toTsMorphPath(filePath: string): string {
    return filePath.split(path.sep).join("/");
  }

  private toGraphPath(filePath: string): string {
    return filePath.split("/").join(path.sep);
  }

  private getProjectSourceFile(filePath: string): SourceFile | undefined {
    const tsMorphPath = this.toTsMorphPath(filePath);
    return (
      this.project.getSourceFile(tsMorphPath) ??
      this.project.addSourceFileAtPathIfExists(tsMorphPath)
    );
  }

  private sourceFileImportsTarget(
    sourceFile: SourceFile,
    importerPath: string,
    targetPath: string
  ): boolean {
    // Used during incremental updates to determine whether a known importer
    // still points at a re-parsed target file.
    for (const decl of sourceFile.getImportDeclarations()) {
      const rawSpecifier = decl.getModuleSpecifierValue();
      const rawTarget =
        rawSpecifier.startsWith(".") &&
        (rawSpecifier.endsWith(".css") || rawSpecifier.endsWith(".scss") ||
         rawSpecifier.endsWith(".sass") || rawSpecifier.endsWith(".less"))
          ? path.join(path.dirname(importerPath), rawSpecifier).split(path.sep).join("/")
          : normalizeImportPath(rawSpecifier, importerPath, this.workspaceRoot);

      if (!rawTarget) {
        continue;
      }

      const graphTarget = this.toGraphPath(rawTarget);
      if (graphTarget === targetPath) {
        return true;
      }

      if (
        this.isBarrelFile(graphTarget) &&
        this.resolveBarrelSources(graphTarget).includes(targetPath)
      ) {
        return true;
      }
    }
    return false;
  }

  private debouncedCacheWrite(): void {
    if (this.cacheWriteTimer) {clearTimeout(this.cacheWriteTimer);}
    this.cacheWriteTimer = setTimeout(() => {
      this.cacheWriteTimer = undefined;
      this.persistence.saveCache(this.graph);
      this.persistence.generateContext(this.graph, this.history);
    }, 2000);
  }

  async rebuildFromDisk(
    onProgress?: (scanned: number, total: number) => void,
    priorityFile?: string
  ): Promise<void> {
    // Full rebuild is used when project configuration changes, such as
    // tsconfig paths or workspace package definitions.
    if (this.isScanning) {
      this.pendingFullRescan = true;
      return;
    }

    this.persistence.invalidatePatternCache();

    if (this.cacheWriteTimer) {
      clearTimeout(this.cacheWriteTimer);
      this.cacheWriteTimer = undefined;
    }

    this.isScanning = true;

    try {
      const files = await vscode.workspace.findFiles(
        TS_JS_GLOB,
        `**/{${IGNORE_DIRS.join(",")}}/**`
      );
      const validFiles = files.map((u) => u.fsPath).filter((p) => !shouldIgnore(p));

      validFiles.sort((a, b) => {
        const aBarrel = /[\/\\]index\.(ts|tsx|js|jsx)$/.test(a) ? 0 : 1;
        const bBarrel = /[\/\\]index\.(ts|tsx|js|jsx)$/.test(b) ? 0 : 1;
        return aBarrel - bBarrel;
      });

      if (priorityFile && !shouldIgnore(priorityFile)) {
        validFiles.sort((a, b) => (a === priorityFile ? -1 : b === priorityFile ? 1 : 0));
      }

      this.graph.files.clear();
      this.graph.symbols.clear();
      this.project = this.createProject();
      this.sessionNewFiles.clear();

      let scanned = 0;
      const total = validFiles.length * 2;

      for (const fp of validFiles) {this.ensureFileNode(fp);}

      for (const fp of validFiles) {
        try { this.parseImportsAndExports(fp, false); }
        catch { console.warn("[Ripple] Rebuild parse error:", fp); }
        scanned++;
        onProgress?.(scanned, total);
      }

      for (const fp of validFiles) {
        try { this.parseCallsOnly(fp); }
        catch { console.warn("[Ripple] Rebuild call parse error:", fp); }
        scanned++;
        onProgress?.(scanned, total);
      }

      this.isScanning = false;
      this.processPendingChanges();

      this.persistence.saveCache(this.graph);
      this.persistence.generateContext(this.graph, this.history);

      if (!this.history.hasBaseline()) {
        this.history.log({
          timestamp: Date.now(),
          type: "baseline_snapshot",
          source: "initial_scan",
          metadata: `files:${validFiles.length}|symbols:${this.graph.symbols.size}`,
        });
      }

      this.persistence.flush(this.history);
    } catch (err) {
      this.isScanning = false;
      throw err;
    }

    if (this.pendingFullRescan) {
      this.pendingFullRescan = false;
      await this.rebuildFromDisk(onProgress, priorityFile);
    }
  }

  // ── INITIAL SCAN ──────────────────────────────────────────────────────────

  /**
   * Starts from cache when possible and repairs only stale or newly discovered
   * files. With no cache, performs a full two-pass scan.
   */
  async initialScan(
    onProgress?: (scanned: number, total: number) => void,
    priorityFile?: string
  ): Promise<void> {
    this.isScanning = true;

    const files = await vscode.workspace.findFiles(
      TS_JS_GLOB,
      `**/{${IGNORE_DIRS.join(",")}}/**`
    );
    const validFiles = files.map((u) => u.fsPath).filter((p) => !shouldIgnore(p));

    const staleFiles = this.persistence.loadCache(this.graph);

    if (this.graph.files.size === 0) {
      console.log("[Ripple] No cache — full scan.");

      validFiles.sort((a, b) => {
        const aBarrel = /[\/\\]index\.(ts|tsx|js|jsx)$/.test(a) ? 0 : 1;
        const bBarrel = /[\/\\]index\.(ts|tsx|js|jsx)$/.test(b) ? 0 : 1;
        return aBarrel - bBarrel;
      });

      if (priorityFile && !shouldIgnore(priorityFile)) {
        validFiles.sort((a, b) => (a === priorityFile ? -1 : b === priorityFile ? 1 : 0));
      }

      for (const fp of validFiles) {this.ensureFileNode(fp);}

      // First install is a baseline, not a stream of file_created events.
      // Real file_created events come from addFile() and cache repair.
      let scanned = 0;
      const total = validFiles.length * 2;

      for (const fp of validFiles) {
        try {
          this.parseImportsAndExports(fp, false);
        } catch { console.warn("[Ripple] Parse error:", fp); }
        scanned++;
        onProgress?.(scanned, total);
      }

      for (const fp of validFiles) {
        try { this.parseCallsOnly(fp); }
        catch { console.warn("[Ripple] Call parse error:", fp); }
        scanned++;
        onProgress?.(scanned, total);
      }

    } else {
      const newFilesOnDisk = validFiles.filter((f) => !this.graph.files.has(f));
      const newFilesOnDiskSet = new Set(newFilesOnDisk);
      const repairSet = new Set<string>([...staleFiles, ...newFilesOnDisk]);

      // Expand to the connected neighborhood until stable. Partial repair is
      // risky because reverse edges can become stale if only one side is parsed.
      let expanded = true;
      while (expanded) {
        expanded = false;
        Array.from(repairSet).forEach((filePath) => {
          const node = this.graph.files.get(filePath);
          if (!node) {return;}
          node.importedBy.forEach((importerPath) => {
            if (!repairSet.has(importerPath)) {
              repairSet.add(importerPath);
              expanded = true;
            }
          });
          node.imports.forEach((importedPath) => {
            if (this.graph.files.has(importedPath) && !repairSet.has(importedPath)) {
              repairSet.add(importedPath);
              expanded = true;
            }
          });
        });
      }

      repairSet.forEach((filePath) => {
        const node = this.graph.files.get(filePath);
        if (!node) {return;}
        this.removeFileEdges(filePath, true);
        node.importedBy.forEach((importerPath) => {
          this.graph.files.get(importerPath)?.imports.delete(filePath);
        });
        node.importedBy.clear();
      });

      const repairArray = Array.from(repairSet).filter((f) => fs.existsSync(f));
      console.log(`[Ripple] Cache repair: ${staleFiles.length} stale + expanded to ${repairArray.length} files`);

      const knownFilePaths = new Set(
        this.history.events
          .filter(e => e.type === "file_created")
          .map(e => e.source)
      );

      let scanned = 0;
      const total = repairArray.length * 2;

      for (const fp of repairArray) {this.ensureFileNode(fp);}

      for (const fp of repairArray) {
        try {
          const isNew = newFilesOnDiskSet.has(fp) && !knownFilePaths.has(fp);
          this.parseImportsAndExports(fp, isNew);
        } catch { console.warn("[Ripple] Repair parse error:", fp); }
        scanned++;
        onProgress?.(scanned, total);
      }

      for (const fp of repairArray) {
        try { this.parseCallsOnly(fp); }
        catch { console.warn("[Ripple] Repair call error:", fp); }
        scanned++;
        onProgress?.(scanned, total);
      }

      const deleted = Array.from(this.graph.files.keys()).filter((fp) => !fs.existsSync(fp));
      deleted.forEach((fp) => this.removeFile(fp));
    }

    this.isScanning = false;

    this.processPendingChanges();

    this.persistence.saveCache(this.graph);
    this.persistence.generateContext(this.graph, this.history);

    if (!this.history.hasBaseline()) {
      this.history.log({
        timestamp: Date.now(),
        type: "baseline_snapshot",
        source: "initial_scan",
        metadata: `files:${validFiles.length}|symbols:${this.graph.symbols.size}`,
      });
    }

    this.persistence.flush(this.history);

    if (this.pendingFullRescan) {
      this.pendingFullRescan = false;
      await this.rebuildFromDisk(onProgress, priorityFile);
    }
  }

  // ── PENDING QUEUE PROCESSOR ───────────────────────────────────────────────

  /**
   * Replays file-system events that arrived while a scan was active. Deletes
   * run first, then adds, then updates so graph edges are removed before new
   * nodes and symbols are introduced.
   */
  private processPendingChanges(): void {
    if (
      this.pendingDeletes.size === 0 &&
      this.pendingAdds.size === 0 &&
      this.pendingUpdates.size === 0
    ) {return;}

    const total = this.pendingDeletes.size + this.pendingAdds.size + this.pendingUpdates.size;
    console.log(`[Ripple] Processing ${total} queued change(s) from scan window.`);

    const addedFiles = new Set(this.pendingAdds);

    this.pendingDeletes.forEach((fp) => {
      if (!addedFiles.has(fp)) {this.removeFile(fp);}
    });
    this.pendingDeletes.clear();

    this.pendingAdds.forEach((fp) => this.addFile(fp));
    this.pendingAdds.clear();

    this.pendingUpdates.forEach((fp) => {
      if (addedFiles.has(fp)) {return;}
      this.updateFile(fp);
    });
    this.pendingUpdates.clear();
  }

  // ── UPDATE FILE ───────────────────────────────────────────────────────────

  /**
   * Incrementally reparses one changed file and logs the semantic diff.
   * Existing importers are snapshotted before detach, then rechecked after the
   * target file is rebuilt. New importers are discovered by their own updates.
   */
  updateFile(filePath: string): void {
    if (this.isScanning) {
      this.pendingUpdates.add(filePath);
      return;
    }
    if (shouldIgnore(filePath)) {return;}

    const changeGroup = makeChangeGroup();
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      this.removeFile(filePath, changeGroup);
      return;
    }

    const newHash = sha1(content);
    const existing = this.graph.files.get(filePath);
    if (existing?.hash === newHash) {return;}

    const isNewFile = !existing && !this.sessionNewFiles.has(filePath);
    if (isNewFile) {this.sessionNewFiles.add(filePath);}

    // Capture the old graph state before removing edges so history can describe
    // exactly what changed.
    const oldImports = new Set(existing?.imports ?? []);
    const oldSymbols = new Set(existing?.symbols ?? []);
    const knownImporters = new Set(existing?.importedBy ?? []);
    const oldSymbolHashes = new Map<string, string>();
    const oldCalls = new Map<string, Set<string>>();
    const oldCalledBy = new Map<string, Set<string>>();

    const snapshotSourceFile = this.getProjectSourceFile(filePath);
    oldSymbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      if (!sym) {return;}
      oldCalls.set(symbolId, new Set(sym.calls));
      oldCalledBy.set(symbolId, new Set(sym.calledBy));
      if (sym.symbolHash) {
        oldSymbolHashes.set(symbolId, sym.symbolHash);
      } else if (snapshotSourceFile) {
        const symbolText = this.getSymbolText(snapshotSourceFile, sym.name);
        if (symbolText) {oldSymbolHashes.set(symbolId, sha1(symbolText));}
      }
    });

    // Remove the old target node and its edges before parsing the new version.
    this.persistence.invalidatePatternCache();
    this.removeFileEdges(filePath, true);
    knownImporters.forEach((importerPath) => {
      this.graph.files.get(importerPath)?.imports.delete(filePath);
    });
    this.graph.files.delete(filePath);

    // Parse the changed file in place and rebuild its imports, symbols, calls,
    // hash, and reverse edges.
    this.ensureFileNode(filePath);
    this.parseFile(filePath, content);
    const newFileNode = this.graph.files.get(filePath)!;

    // Reattach known importers only. This keeps updates bounded by the existing
    // blast radius instead of scanning every file in the project.
    knownImporters.forEach((importerPath) => {
      const importerNode = this.graph.files.get(importerPath);
      if (!importerNode || importerPath === filePath || !fs.existsSync(importerPath)) {return;}

      const sourceFile = this.getProjectSourceFile(importerPath);
      if (!sourceFile) {return;}

      if (this.sourceFileImportsTarget(sourceFile, importerPath, filePath)) {
        importerNode.imports.add(filePath);
        newFileNode.importedBy.add(importerPath);
      }

      this.parseCalls(importerPath, sourceFile);
    });

    // Diff old and new state into history events for agent context and audits.
    const now = Date.now();
    const newSourceFile = this.getProjectSourceFile(filePath);

    if (isNewFile) {
      this.history.log({
        timestamp: now,
        type: "file_created",
        source: filePath,
        fileHash: newFileNode.hash,
        changeGroup,
      });
    }

    oldImports.forEach((imp) => {
      if (!newFileNode.imports.has(imp)) {
        this.history.log({ timestamp: now, type: "import_removed", source: filePath, target: imp, changeGroup });
      }
    });
    newFileNode.imports.forEach((imp) => {
      if (!oldImports.has(imp)) {
        this.history.log({ timestamp: now, type: "import_added", source: filePath, target: imp, changeGroup });
      }
    });

    const removedCallEvents = new Set<string>();
    const logCallRemoved = (source: string, target: string) => {
      const key = `${source}\n${target}`;
      if (removedCallEvents.has(key)) {return;}
      removedCallEvents.add(key);
      this.history.log({ timestamp: now, type: "call_removed", source, target, changeGroup });
    };

    oldSymbols.forEach((symbolId) => {
      if (!newFileNode.symbols.has(symbolId)) {
        (oldCalls.get(symbolId) ?? new Set<string>()).forEach((targetId) => {
          logCallRemoved(symbolId, targetId);
        });
        (oldCalledBy.get(symbolId) ?? new Set<string>()).forEach((callerId) => {
          logCallRemoved(callerId, symbolId);
        });
        this.history.log({ timestamp: now, type: "symbol_deleted", source: symbolId, changeGroup });
      }
    });

    newFileNode.symbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      const symbolName = sym?.name ?? symbolId.split("::").slice(1).join("::");
      const symbolText = this.getSymbolText(newSourceFile, symbolName);
      const newSymbolHash = symbolText ? sha1(symbolText) : sym?.symbolHash;

      if (!oldSymbols.has(symbolId)) {
        this.history.log({
          timestamp: now,
          type: "symbol_created",
          source: symbolId,
          kind: sym?.kind,
          symbolHash: newSymbolHash,
          layer: sym?.layer,
          changeGroup,
        });
      } else {
        const oldHash = oldSymbolHashes.get(symbolId);
        if (oldHash && newSymbolHash && oldHash !== newSymbolHash) {
          this.history.log({
            timestamp: now,
            type: "symbol_modified",
            source: symbolId,
            kind: sym?.kind,
            symbolHash: newSymbolHash,
            previousHash: oldHash,
            layer: sym?.layer,
            changeGroup,
          });
        }
      }
    });

    newFileNode.symbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      if (!sym) {return;}
      const oldCallSet = oldCalls.get(symbolId) ?? new Set<string>();
      sym.calls.forEach((targetId) => {
        if (!oldCallSet.has(targetId)) {
          const targetNode = this.graph.symbols.get(targetId);
          this.history.log({ timestamp: now, type: "call_added", source: symbolId, target: targetId, targetCallerCount: targetNode?.calledBy.size, changeGroup });
        }
      });
      oldCallSet.forEach((targetId) => {
        if (!sym.calls.has(targetId)) {
          logCallRemoved(symbolId, targetId);
        }
      });
    });

    this.persistence.flush(this.history);
    this.persistence.generateSingleFocus(this.graph, filePath);
    this.debouncedCacheWrite();
  }

  // ── ADD FILE ──────────────────────────────────────────────────────────────

  /**
   * Adds a newly discovered source file and records its initial imports,
   * symbols, and call edges as a single change group.
   */
  addFile(filePath: string): void {
    if (this.isScanning) {
      this.pendingAdds.add(filePath);
      return;
    }
    if (shouldIgnore(filePath)) {return;}

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      // File may have been created and deleted before the watcher settled.
      return;
    }

    this.sessionNewFiles.add(filePath);
    this.persistence.invalidatePatternCache();
    this.ensureFileNode(filePath);
    this.parseFile(filePath, content);

    const fileNode = this.graph.files.get(filePath);
    if (!fileNode || fileNode.hash === "") {return;}

    const changeGroup = makeChangeGroup();
    const now = Date.now();
    const sourceFile = this.getProjectSourceFile(filePath);

    this.history.log({ timestamp: now, type: "file_created", source: filePath, fileHash: fileNode.hash, changeGroup });

    fileNode.symbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      const symbolText = sym ? this.getSymbolText(sourceFile, sym.name) : null;
      this.history.log({
        timestamp: now,
        type: "symbol_created",
        source: symbolId,
        kind: sym?.kind,
        symbolHash: symbolText ? sha1(symbolText) : sym?.symbolHash,
        layer: sym?.layer,
        changeGroup,
      });
    });

    fileNode.imports.forEach((importedPath) => {
      this.history.log({ timestamp: now, type: "import_added", source: filePath, target: importedPath, changeGroup });
    });

    fileNode.symbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      if (!sym) {return;}
      sym.calls.forEach((targetId) => {
        const targetNode = this.graph.symbols.get(targetId);
        this.history.log({
          timestamp: now,
          type: "call_added",
          source: symbolId,
          target: targetId,
          targetCallerCount: targetNode?.calledBy.size,
          changeGroup,
        });
      });
    });

    this.persistence.flush(this.history);
    this.persistence.generateSingleFocus(this.graph, filePath);
    this.debouncedCacheWrite();
  }

  // ── REMOVE FILE ───────────────────────────────────────────────────────────

  /**
   * Removes a source file from the graph and deletes all forward/reverse edges
   * that reference it.
   */
  removeFile(filePath: string, existingChangeGroup?: string): void {
    if (this.isScanning) {
      this.pendingDeletes.add(filePath);
      return;
    }
    if (!this.graph.files.has(filePath)) {return;}

    const changeGroup = existingChangeGroup ?? makeChangeGroup();
    const fileNodeToDelete = this.graph.files.get(filePath)!;
    this.persistence.invalidatePatternCache();

    fileNodeToDelete.importedBy.forEach((importerPath) => {
      const importerNode = this.graph.files.get(importerPath);
      if (importerNode) {importerNode.imports.delete(filePath);}
    });

    this.removeFileEdges(filePath, false, changeGroup);
    this.graph.files.delete(filePath);
    this.history.log({ timestamp: Date.now(), type: "file_deleted", source: filePath, changeGroup });
    this.persistence.flush(this.history);
    this.debouncedCacheWrite();
  }

  // ── PARSE PIPELINE ────────────────────────────────────────────────────────

  /**
   * First scan pass: imports, exports, and local symbols. Call edges are parsed
   * later after every file has had a chance to register its symbols.
   */
  private parseImportsAndExports(filePath: string, isNewFile: boolean = false): void {
    const src = (() => {
      try { return fs.readFileSync(filePath, "utf8"); }
      catch { return null; }
    })();
    if (src === null) {return;}

    const fileNode = this.ensureFileNode(filePath);
    fileNode.hash = sha1(src);
    fileNode.lastModifiedAt = Date.now();

    if (isNewFile) {
      this.history.log({ timestamp: Date.now(), type: "file_created", source: filePath });
    }

    const tsMorphPath = this.toTsMorphPath(filePath);
    let sourceFile = this.project.getSourceFile(tsMorphPath);
    if (sourceFile) {
      sourceFile.replaceWithText(src);
    } else {
      sourceFile = this.project.createSourceFile(tsMorphPath, src, { overwrite: true });
    }

    try {
      this.parseImports(filePath, sourceFile);
      this.parseExports(filePath, sourceFile);
      this.parseInternalSymbols(filePath, sourceFile);
      fileNode.hasParseError = false;
    } catch {
      fileNode.hasParseError = true;
    }
  }

  private parseCallsOnly(filePath: string): void {
    const sourceFile = this.project.getSourceFile(this.toTsMorphPath(filePath));
    if (!sourceFile) {return;}
    this.parseCalls(filePath, sourceFile);
  }

  private parseFile(filePath: string, content?: string): void {
    const src = content ?? (() => {
      try { return fs.readFileSync(filePath, "utf8"); }
      catch { return null; }
    })();
    if (src === null) {return;}

    const fileNode = this.ensureFileNode(filePath);
    fileNode.hash = sha1(src);
    fileNode.lastModifiedAt = Date.now();
    fileNode.changeCount += 1;

    const tsMorphPath = this.toTsMorphPath(filePath);
    let sourceFile = this.project.getSourceFile(tsMorphPath);
    if (sourceFile) {
      sourceFile.replaceWithText(src);
    } else {
      sourceFile = this.project.createSourceFile(tsMorphPath, src, { overwrite: true });
    }

    try {
      this.parseImports(filePath, sourceFile);
      this.parseExports(filePath, sourceFile);
      this.parseInternalSymbols(filePath, sourceFile);
      this.parseCalls(filePath, sourceFile);
      fileNode.hasParseError = false;
    } catch {
      fileNode.hasParseError = true;
      console.warn("[Ripple] Parse error in:", filePath);
    }
  }

  // ── IMPORTS ───────────────────────────────────────────────────────────────

  /**
   * Adds file-level dependency edges. Style imports are treated as local
   * dependencies, while external npm packages are ignored by normalizeImportPath.
   */
  private parseImports(filePath: string, sourceFile: SourceFile): void {
    const fileNode = this.graph.files.get(filePath)!;

    sourceFile.getImportDeclarations().forEach((decl: ImportDeclaration) => {
      const rawSpecifier = decl.getModuleSpecifierValue();
      let rawTarget: string | null = null;

      if (
        rawSpecifier.startsWith(".") &&
        (rawSpecifier.endsWith(".css") || rawSpecifier.endsWith(".scss") ||
         rawSpecifier.endsWith(".sass") || rawSpecifier.endsWith(".less"))
      ) {
        rawTarget = path.join(path.dirname(filePath), rawSpecifier).split(path.sep).join("/");
      } else {
        rawTarget = normalizeImportPath(rawSpecifier, filePath, this.workspaceRoot);
      }

      if (!rawTarget) {return;}

      const absoluteTarget = this.toGraphPath(rawTarget);

      fileNode.imports.add(absoluteTarget);
      this.ensureFileNode(absoluteTarget).importedBy.add(filePath);

      if (this.isBarrelFile(absoluteTarget)) {
        this.resolveBarrelSources(absoluteTarget).forEach((src) => {
          if (fileNode.imports.has(src)) {return;}
          fileNode.imports.add(src);
          this.ensureFileNode(src).importedBy.add(filePath);
        });
      }
    });
  }

  // ── EXPORTS / SYMBOLS ─────────────────────────────────────────────────────

  /**
   * Registers exported functions, classes, methods, and variables as graph
   * symbols. Exported functions and methods also get coarse layer classification.
   */
  private parseExports(filePath: string, sourceFile: SourceFile): void {
    const fileNode = this.graph.files.get(filePath)!;
    const exportedDeclarations: ReadonlyMap<string, ExportedDeclarations[]> =
      sourceFile.getExportedDeclarations();

    exportedDeclarations.forEach((declarations, exportName) => {
      declarations.forEach((decl) => {
        const kind = this.resolveSymbolKind(decl);
        if (!kind) {return;}

        // Prefer declared name over export key, including default exports.
        const actualName = (decl as any).getName?.() ?? exportName;
        const symbolId = makeSymbolId(filePath, actualName);
        const symbolHash = sha1(decl.getText());

        if (this.graph.symbols.has(symbolId)) {
          const existing = this.graph.symbols.get(symbolId)!;
          existing.lastModifiedAt = Date.now();
          existing.symbolHash = symbolHash;
          return;
        }

        const layerInfo =
          kind === "function" || kind === "method"
            ? this.detectSymbolLayer(decl, decl.getText())
            : { layer: "unknown" as SymbolNode["layer"], containsLayers: ["unknown"] };

        this.graph.symbols.set(symbolId, {
          id: symbolId,
          name: actualName,
          file: filePath,
          kind,
          layer: layerInfo.layer,
          containsLayers: layerInfo.containsLayers,
          symbolHash,
          calls: new Set(),
          calledBy: new Set(),
          createdAt: Date.now(),
          lastModifiedAt: Date.now(),
        });
        fileNode.symbols.add(symbolId);
      });
    });
  }

  // ── INTERNAL SYMBOLS ──────────────────────────────────────────────────────

  /**
   * Registers non-exported functions and function-valued variables. These
   * symbols make same-file call relationships and CodeLens hints more useful.
   */
  private parseInternalSymbols(filePath: string, sourceFile: SourceFile): void {
    const fileNode = this.graph.files.get(filePath)!;

    sourceFile.getFunctions().forEach((funcDecl) => {
      const name = funcDecl.getName();
      if (!name) {return;}
      const symbolId = makeSymbolId(filePath, name);
      if (this.graph.symbols.has(symbolId)) {return;}
      const layerInfo = this.detectSymbolLayer(funcDecl, funcDecl.getText());
      this.graph.symbols.set(symbolId, {
        id: symbolId, name, file: filePath, kind: "function",
        layer: layerInfo.layer, containsLayers: layerInfo.containsLayers,
        symbolHash: sha1(funcDecl.getText()),
        calls: new Set(), calledBy: new Set(),
        createdAt: Date.now(), lastModifiedAt: Date.now(),
      });
      fileNode.symbols.add(symbolId);
    });

    sourceFile.getVariableDeclarations().forEach((varDecl) => {
      const name = varDecl.getName();
      if (!name || name.includes("{") || name.includes("[")) {return;}
      const initializer = varDecl.getInitializer();
      if (!initializer) {return;}
      const kind = initializer.getKind();
      if (kind !== SyntaxKind.ArrowFunction && kind !== SyntaxKind.FunctionExpression) {return;}
      const symbolId = makeSymbolId(filePath, name);
      if (this.graph.symbols.has(symbolId)) {return;}
      const layerInfo = this.detectSymbolLayer(varDecl, varDecl.getText());
      this.graph.symbols.set(symbolId, {
        id: symbolId, name, file: filePath, kind: "function",
        layer: layerInfo.layer, containsLayers: layerInfo.containsLayers,
        symbolHash: sha1(varDecl.getText()),
        calls: new Set(), calledBy: new Set(),
        createdAt: Date.now(), lastModifiedAt: Date.now(),
      });
      fileNode.symbols.add(symbolId);
    });
  }

  // ── SYMBOL LAYER DETECTION ────────────────────────────────────────────────

  /**
   * Best-effort layer classifier used in agent guidance. It intentionally uses
   * simple syntax/call-name signals instead of requiring type-checking.
   */
  private detectSymbolLayer(
    funcNode: Node,
    funcText: string
  ): { layer: SymbolNode["layer"]; containsLayers: string[] } {
    const layers: string[] = [];

    const callNames = funcNode
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .map((c) => c.getExpression().getText().split(".").pop() ?? "")
      .filter(Boolean);

    let hasJsx = false;
    try {
      hasJsx =
        funcNode.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
        funcNode.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0 ||
        funcNode.getDescendantsOfKind(SyntaxKind.JsxFragment).length > 0;
    } catch {
      hasJsx =
        funcNode.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
        funcNode.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0;
    }
    if (hasJsx) {layers.push("ui");}

    if (callNames.some((n) =>
      ["useState","useReducer","useRef","useContext","useAtom","useSignal","createSignal"].includes(n)
    )) {layers.push("state");}

    if (callNames.some((n) =>
      ["useEffect","useLayoutEffect","useInsertionEffect","useMemo","useCallback"].includes(n)
    )) {layers.push("effect");}

    const dataPatterns = [
      "fetch","axios","useQuery","useMutation","useInfiniteQuery","trpc","supabase","prisma",
      "getServerSideProps","getStaticProps","findFirst","findMany","findUnique",
      "create","update","upsert","deleteMany",
    ];
    if (callNames.some((n) =>
      dataPatterns.some((p) => n.toLowerCase().includes(p.toLowerCase()))
    )) {layers.push("data");}

    const funcName = (funcNode as any).getName?.() ?? "";
    if (
      /^(handle[A-Z]|on[A-Z])/.test(funcName) ||
      /^(handle[A-Z]|on[A-Z])/.test(funcText.slice(0, 80))
    ) {layers.push("handler");}

    if (layers.length === 0) {
      const hasConditionals =
        funcNode.getDescendantsOfKind(SyntaxKind.IfStatement).length > 0 ||
        funcNode.getDescendantsOfKind(SyntaxKind.SwitchStatement).length > 0 ||
        funcNode.getDescendantsOfKind(SyntaxKind.ConditionalExpression).length > 0;
      if (hasConditionals || funcText.length > 50) {layers.push("logic");}
    }

    if (layers.length === 0) {layers.push("unknown");}

    const layer: SymbolNode["layer"] =
      layers.length > 1 ? "mixed" : (layers[0] as SymbolNode["layer"]);

    return { layer, containsLayers: layers };
  }

  // ── SYMBOL KIND RESOLVER ──────────────────────────────────────────────────

  /**
   * Converts ts-morph node kinds into Ripple's smaller symbol-kind vocabulary.
   */
  private resolveSymbolKind(decl: Node): SymbolNode["kind"] | null {
    const kind = decl.getKind();

    if (
      kind === SyntaxKind.FunctionDeclaration ||
      kind === SyntaxKind.FunctionExpression ||
      kind === SyntaxKind.ArrowFunction
    ) {
      return "function";
    }

    if (kind === SyntaxKind.ClassDeclaration || kind === SyntaxKind.ClassExpression) {
      return "class";
    }

    if (kind === SyntaxKind.MethodDeclaration) {
      return "method";
    }

    if (kind === SyntaxKind.VariableDeclaration) {
      // Function-valued variables should behave like functions for CodeLens and
      // caller tracking; ordinary values remain variables.
      const init = (decl as any).getInitializer?.();
      if (init) {
        const initKind = init.getKind();
        if (initKind === SyntaxKind.ArrowFunction || initKind === SyntaxKind.FunctionExpression) {
          return "function";
        }
      }
      return "variable";
    }

    if (kind === SyntaxKind.VariableStatement) {
      return "variable";
    }

    return null;
  }

  // ── FUNCTION CALLS ────────────────────────────────────────────────────────

  /**
   * Builds symbol-level call edges for direct function calls and JSX component
   * usage. Resolution is name-based within known imported/local symbols.
   */
  private parseCalls(filePath: string, sourceFile: SourceFile): void {
    const fileNode = this.graph.files.get(filePath)!;

    const importedSymbolNames = new Map<string, string>();
    fileNode.imports.forEach((importedPath) => {
      this.graph.files.get(importedPath)?.symbols.forEach((symbolId) => {
        const sym = this.graph.symbols.get(symbolId);
        if (sym) {importedSymbolNames.set(sym.name, symbolId);}
      });
    });
    fileNode.symbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      if (sym) {importedSymbolNames.set(sym.name, symbolId);}
    });

    if (importedSymbolNames.size === 0) {return;}

    const callerSymbolId = this.findComponentSymbol(filePath);

    sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((callExpr) => {
      const calledName = this.extractCalledName(callExpr.getExpression().getText());
      if (!calledName) {return;}
      const targetSymbolId = importedSymbolNames.get(calledName);
      if (!targetSymbolId) {return;}
      const enclosing = this.findEnclosingSymbol(callExpr, filePath);
      if (!enclosing) {return;}
      this.addCallEdge(enclosing, targetSymbolId);
    });

    sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).forEach((el) => {
      const name = el.getTagNameNode().getText();
      const targetSymbolId = importedSymbolNames.get(name);
      if (!targetSymbolId || !callerSymbolId) {return;}
      this.addCallEdge(callerSymbolId, targetSymbolId);
    });

    sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).forEach((el) => {
      const name = el.getTagNameNode().getText();
      const targetSymbolId = importedSymbolNames.get(name);
      if (!targetSymbolId || !callerSymbolId) {return;}
      this.addCallEdge(callerSymbolId, targetSymbolId);
    });
  }

  private addCallEdge(callerSymbolId: string, targetSymbolId: string): void {
    const callerNode = this.graph.symbols.get(callerSymbolId);
    const targetNode = this.graph.symbols.get(targetSymbolId);
    if (!callerNode || !targetNode) {return;}
    if (callerSymbolId === targetSymbolId) {return;} // No self-calls
    if (callerNode.calls.has(targetSymbolId)) {return;} // Idempotent
    callerNode.calls.add(targetSymbolId);
    targetNode.calledBy.add(callerSymbolId);
  }

  private findComponentSymbol(filePath: string): string | null {
    const fileNode = this.graph.files.get(filePath);
    if (!fileNode) {return null;}
    for (const symbolId of fileNode.symbols) {
      const sym = this.graph.symbols.get(symbolId);
      if (sym && (sym.kind === "function" || sym.kind === "variable")) {return symbolId;}
    }
    return null;
  }

  private extractCalledName(exprText: string): string | null {
    const parts = exprText.split(".");
    const name = parts[parts.length - 1];
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : null;
  }

  private findEnclosingSymbol(node: Node, filePath: string): string | null {
    let current: Node | undefined = node.getParent();
    while (current) {
      const kind = current.getKind();
      if (
        kind === SyntaxKind.FunctionDeclaration ||
        kind === SyntaxKind.ArrowFunction ||
        kind === SyntaxKind.FunctionExpression ||
        kind === SyntaxKind.MethodDeclaration
      ) {
        const nameNode = (current as any).getNameNode?.();
        const name: string | undefined = nameNode?.getText();
        if (name) {
          const symbolId = makeSymbolId(filePath, name);
          if (this.graph.symbols.has(symbolId)) {return symbolId;}
        }
        if (kind === SyntaxKind.ArrowFunction) {
          const parent = current.getParent();
          if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
            const varName = (parent as any).getNameNode?.()?.getText();
            if (varName) {
              const symbolId = makeSymbolId(filePath, varName);
              if (this.graph.symbols.has(symbolId)) {return symbolId;}
            }
          }
        }
      }
      current = current.getParent();
    }
    return null;
  }

  // ── SYMBOL TEXT EXTRACTION ────────────────────────────────────────────────

  /**
   * Returns source text for a named function or function-valued variable. Symbol
   * hashes are based on this text so history can distinguish real body changes
   * from unchanged symbol IDs.
   */
  private getSymbolText(sourceFile: SourceFile | undefined, symbolName: string): string | null {
    if (!sourceFile || !symbolName) {return null;}
    try {
      const funcDecl = sourceFile.getFunctions().find(f => f.getName() === symbolName);
      if (funcDecl) {return funcDecl.getText();}
      const varDecl = sourceFile.getVariableDeclarations().find(v => v.getName() === symbolName);
      if (varDecl) {return varDecl.getText();}
    } catch { return null; }
    return null;
  }

  // ── EDGE REMOVAL ──────────────────────────────────────────────────────────

  /**
   * Detaches all imports, symbols, calls, and reverse edges for a file. The
   * silent mode is used during reparsing, where updateFile logs a cleaner diff.
   */
  private removeFileEdges(
    filePath: string,
    silent: boolean,
    changeGroup?: string
  ): void {
    const fileNode = this.graph.files.get(filePath);
    if (!fileNode) {return;}
    const now = Date.now();

    fileNode.imports.forEach((importedPath) => {
      this.graph.files.get(importedPath)?.importedBy.delete(filePath);
      if (!silent) {
        this.history.log({ timestamp: now, type: "import_removed", source: filePath, target: importedPath, changeGroup });
      }
    });
    fileNode.imports.clear();

    fileNode.symbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      if (!sym) {return;}

      sym.calls.forEach((targetId) => {
        this.graph.symbols.get(targetId)?.calledBy.delete(symbolId);
        if (!silent) {
          this.history.log({ timestamp: now, type: "call_removed", source: symbolId, target: targetId, changeGroup });
        }
      });

      sym.calledBy.forEach((callerId) => {
        const callerNode = this.graph.symbols.get(callerId);
        if (!callerNode) {return;}
        callerNode.calls.delete(symbolId);
        if (!silent) {
          this.history.log({ timestamp: now, type: "call_removed", source: callerId, target: symbolId, changeGroup });
        }
      });

      this.graph.symbols.delete(symbolId);
      if (!silent) {
        this.history.log({ timestamp: now, type: "symbol_deleted", source: symbolId, changeGroup });
      }
    });

    fileNode.symbols.clear();
  }

  // ── NODE CREATION ─────────────────────────────────────────────────────────

  /**
   * Returns an existing FileNode or creates a placeholder node so imports can
   * point at files before those files are parsed.
   */
  private ensureFileNode(filePath: string): FileNode {
    if (!this.graph.files.has(filePath)) {
      this.graph.files.set(filePath, {
        path: filePath,
        imports: new Set(),
        importedBy: new Set(),
        symbols: new Set(),
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
        changeCount: 0,
        hash: "",
      });
    }
    return this.graph.files.get(filePath)!;
  }

  // ── BARREL FILE HELPERS ───────────────────────────────────────────────────

  private isBarrelFile(filePath: string): boolean {
    const base = path.basename(filePath);
    return base === "index.ts" || base === "index.tsx" ||
           base === "index.js" || base === "index.jsx";
  }

  private resolveBarrelSources(barrelPath: string): string[] {
    const sources: string[] = [];
    const sourceFile = this.project.getSourceFile(this.toTsMorphPath(barrelPath));
    if (!sourceFile) {return sources;}

    sourceFile.getExportDeclarations().forEach((exportDecl) => {
      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      if (!moduleSpecifier) {return;}
      const rawTarget = normalizeImportPath(moduleSpecifier, barrelPath, this.workspaceRoot);
      if (!rawTarget) {return;}
      const absoluteTarget = this.toGraphPath(rawTarget);
      if (this.isBarrelFile(absoluteTarget)) {return;}
      sources.push(absoluteTarget);
    });

    return sources;
  }

  // ── IMPACT QUERY FUNCTIONS ────────────────────────────────────────────────
  // Public query methods used by editor features. They are thin wrappers around
  // graph Sets, keeping UI code away from graph internals.

  downstreamFiles(filePath: string): string[] {
    return Array.from(this.graph.files.get(filePath)?.importedBy ?? []);
  }

  upstreamFiles(filePath: string): string[] {
    return Array.from(this.graph.files.get(filePath)?.imports ?? []);
  }

  focusKeyForFile(filePath: string): string {
    return makeFocusKey(filePath, this.graph);
  }

  symbolImpact(symbolId: string): string[] {
    return Array.from(this.graph.symbols.get(symbolId)?.calledBy ?? []);
  }

  blastRadius(filePaths: string[]): string[] {
    const affected = new Set<string>();
    for (const filePath of filePaths) {
      for (const downstream of this.downstreamFiles(filePath)) {
        affected.add(downstream);
      }
    }
    return Array.from(affected);
  }

  symbolAtPosition(filePath: string, line: number, character: number): string | null {
    const sourceFile = this.getProjectSourceFile(filePath);
    if (!sourceFile) {return null;}

    let offset: number;
    try {
      offset = sourceFile.compilerNode.getPositionOfLineAndCharacter(line, character);
    } catch { return null; }

    let current: Node | undefined = sourceFile.getDescendantAtPos(offset);
    while (current) {
      const kind = current.getKind();
      if (
        kind === SyntaxKind.FunctionDeclaration ||
        kind === SyntaxKind.FunctionExpression ||
        kind === SyntaxKind.MethodDeclaration
      ) {
        const nameNode = (current as any).getNameNode?.();
        const name: string | undefined = nameNode?.getText();
        if (name) {
          const symbolId = makeSymbolId(filePath, name);
          if (this.graph.symbols.has(symbolId)) {return symbolId;}
        }
      }
      if (kind === SyntaxKind.ArrowFunction) {
        const parent = current.getParent();
        if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
          const nameNode = (parent as any).getNameNode?.();
          const name: string | undefined = nameNode?.getText();
          if (name) {
            const symbolId = makeSymbolId(filePath, name);
            if (this.graph.symbols.has(symbolId)) {return symbolId;}
          }
        }
      }
      current = current.getParent();
    }
    return null;
  }

  getSymbolDeclarationLine(symbolId: string): number | null {
    const sym = this.graph.symbols.get(symbolId);
    if (!sym) {return null;}

    const sourceFile = this.getProjectSourceFile(sym.file);
    if (!sourceFile) {return null;}

    try {
      const funcDecl = sourceFile.getFunctions().find((f) => f.getName() === sym.name);
      if (funcDecl) {return Math.max(0, funcDecl.getStartLineNumber() - 1);}

      const varDecl = sourceFile.getVariableDeclarations().find((v) => v.getName() === sym.name);
      if (varDecl) {return Math.max(0, varDecl.getStartLineNumber() - 1);}
    } catch { return null; }

    return null;
  }
}
