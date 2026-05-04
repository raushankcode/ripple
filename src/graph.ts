/**
 * graph.ts — Ripple
 * The Live System Graph: core engine for all three MVP features.
 *
 * WINDOWS PATH RULE (critical — never break this):
 *  - graph.files and graph.symbols keys → always OS-native backslashes
 *  - ts-morph API calls                 → always forward slashes
 *  - Use toTsMorphPath() before every ts-morph call
 *  - Use toGraphPath() after every normalizeImportPath() call
 *
 * LOGGING RULES:
 *  - initialScan()  → silent. One baseline_snapshot at the end.
 *  - updateFile()   → diff only. Log ONLY what actually changed.
 *  - addFile()      → log file_created + symbols + imports + calls.
 *  - removeFile()   → log file_deleted + all edge removals.
 *  - All events from one save share the same changeGroup string.
 *
 * TIERED CONTEXT DELIVERY:
 *  - context.json         → ~2KB summary. Always read. ~500 tokens.
 *  - context.files.json   → file dependency map + coding patterns.
 *  - context.symbols.json → symbol call graph with layer classification.
 *  Agents read context.json first. Instructions tell them which file to
 *  read next based on task type. Large projects stay fast and cheap.
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

// ────────────────────────────────────────────────────────────────────────────
// PERSISTENCE
// ────────────────────────────────────────────────────────────────────────────

class GraphPersistence {
  private persistPath: string;
  private cachePath: string;
  private workspaceRoot: string;

  // Set to false when ripple.generateContext setting is disabled.
  // Graph still builds (Impact Lens + CodeLens still work).
  // Only .ripple/ context file writes are suppressed.
  contextGenerationEnabled: boolean = true;

  // Cached after first generation — prevents O(n) disk reads on every save.
  // Both arrow function preference and class component detection happen in one
  // combined pass, cached together, invalidated when files change.
  private patternCache: {
    prefersArrowFunctions: boolean;
    hasClassComponents: boolean;
  } | null = null;

  invalidatePatternCache(): void {
    this.patternCache = null;
  }

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    const dir = path.join(workspaceRoot, ".ripple");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.persistPath = path.join(dir, "history.json");
    this.cachePath = path.join(dir, "graph.cache.json");
  }

  // ── HISTORY ───────────────────────────────────────────────────────────────

  load(log: HistoryLog): void {
    if (!fs.existsSync(this.persistPath)) return;
    try {
      const raw = fs.readFileSync(this.persistPath, "utf8");
      const events = JSON.parse(raw) as ChangeEvent[];
      events.forEach((e) => log.log(e));
    } catch {
      console.warn("[Ripple] history.json could not be parsed — starting fresh.");
    }
  }

  flush(log: HistoryLog): void {
    try {
      const MAX_EVENTS = 10000;
      let eventsToWrite = log.events;

      if (eventsToWrite.length > MAX_EVENTS) {
        const baseline = eventsToWrite.find(
          (e) => e.type === "baseline_snapshot"
        );
        // Filter baseline from recent slice FIRST to prevent duplication
        const recent = eventsToWrite
          .filter((e) => e.type !== "baseline_snapshot")
          .slice(-(MAX_EVENTS - 1));
        eventsToWrite = baseline ? [baseline, ...recent] : recent;
      }

      fs.writeFileSync(
        this.persistPath,
        JSON.stringify(eventsToWrite, null, 2)
      );
    } catch (err) {
      console.error("[Ripple] HistoryLog flush failed:", err);
    }
  }

  // ── GRAPH CACHE ────────────────────────────────────────────────────────────
  //
  // Serializes the in-memory graph to disk.
  // Next VS Code launch loads cache in ~200ms instead of 30s full scan.

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

  loadCache(graph: SystemGraph): string[] {
    try {
      if (!fs.existsSync(this.cachePath)) return [];

      const raw = fs.readFileSync(this.cachePath, "utf8");
      const data = JSON.parse(raw);

      const staleFiles: string[] = [];
      const loadedFilePaths = new Set<string>();

      Object.entries(data.files).forEach(([filePath, node]: [string, any]) => {
        if (!fs.existsSync(filePath)) return;

        const currentContent = (() => {
          try { return fs.readFileSync(filePath, "utf8"); }
          catch { return null; }
        })();
        if (!currentContent) return;

        const currentHash = crypto
          .createHash("sha1")
          .update(currentContent)
          .digest("hex");

        const fileNode: FileNode = {
          path: node.path,
          imports: new Set(node.imports),
          importedBy: new Set(node.importedBy),
          symbols: new Set(node.symbols),
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
        // Skip symbols from files that no longer exist — prevents phantom callers
        if (!loadedFilePaths.has(sym.file)) return;

        const symbolNode: SymbolNode = {
          id: sym.id,
          name: sym.name,
          file: sym.file,
          kind: sym.kind,
          layer: sym.layer,
          containsLayers: sym.containsLayers,
          // Filter out references to deleted files
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
      return [];
    }
  }

  // ── CONTEXT — TIERED AI AGENT INTERFACE ────────────────────────────────────
  //
  // Generates three files instead of one massive file.
  // This solves the token explosion problem on large projects.
  //
  //   context.json         ~2KB   always read  ~500 tokens
  //   context.files.json   varies read when modifying files
  //   context.symbols.json varies read when modifying functions
  //
  // Agent reads context.json first.
  // _tieredContext field tells agent exactly which file to read next.
  // Simple tasks use 500 tokens. Deep refactors use ~15,000 tokens.
  // Never 250,000 tokens for a 300-file project.

  generateContext(graph: SystemGraph, history: HistoryLog): void {
    if (!this.contextGenerationEnabled) return;
    try {
      const contextDir = path.dirname(this.persistPath);

      // ── Entry point files — built once, shared by multiple sections ────────
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

      // ── Query hints ────────────────────────────────────────────────────────

      const mostConnectedFiles: string[] = [];
      Array.from(graph.files.entries())
        .filter(([_, n]) => n.importedBy.size >= CAUTION_BLAST_RADIUS)
        .sort((a, b) => b[1].importedBy.size - a[1].importedBy.size)
        .slice(0, 10)
        .forEach(([filePath]) =>
          mostConnectedFiles.push(path.basename(filePath))
        );

      const recentlyChangedFiles: string[] = [];
      const seenFiles = new Set<string>();
      for (let i = history.events.length - 1; i >= 0; i--) {
        const e = history.events[i];
        if (
          e.type === "symbol_created" ||
          e.type === "symbol_modified" ||
          e.type === "import_added" ||
          e.type === "import_removed"
        ) {
          const fp = e.source.includes("::") ? e.source.split("::")[0] : e.source;
          const base = path.basename(fp);
          if (!seenFiles.has(base)) {
            seenFiles.add(base);
            recentlyChangedFiles.push(base);
            if (recentlyChangedFiles.length >= 5) break;
          }
        }
      }

      const highRiskSymbols: string[] = [];
      graph.symbols.forEach((sym) => {
        if (sym.calledBy.size >= HIGH_RISK_CALLER_COUNT) highRiskSymbols.push(sym.name);
      });

      // ── Entry points ───────────────────────────────────────────────────────

      const entryPoints: string[] = [];
      entryPointFiles.forEach((filePath) => {
        const relativePath = filePath
          .replace(this.workspaceRoot, "")
          .split(path.sep)
          .join("/");
        entryPoints.push(relativePath);
      });

      // ── Last change group ──────────────────────────────────────────────────

      const lastChangeGroup: any = {
        id: null,
        filesChanged: [],
        symbolsChanged: [],
        message: "No changes recorded yet — Ripple was just installed",
      };

      const lastGroupId = (() => {
        for (let i = history.events.length - 1; i >= 0; i--) {
          if (history.events[i].changeGroup) return history.events[i].changeGroup;
        }
        return null;
      })();

      if (lastGroupId) {
        const groupEvents = history.getGroup(lastGroupId);
        const changedFiles = new Set<string>();
        const changedSymbols = new Set<string>();

        groupEvents.forEach((e) => {
          if (e.source.includes("::")) {
            changedSymbols.add(e.source.split("::")[1]);
            changedFiles.add(path.basename(e.source.split("::")[0]));
          } else {
            changedFiles.add(path.basename(e.source));
          }
          if (e.target) {
            const tBase = e.target.includes("::") ? e.target.split("::")[0] : e.target;
            changedFiles.add(path.basename(tBase));
          }
        });

        lastChangeGroup.id = lastGroupId;
        lastChangeGroup.filesChanged = Array.from(changedFiles).filter(Boolean);
        lastChangeGroup.symbolsChanged = Array.from(changedSymbols).filter(Boolean);
        delete lastChangeGroup.message;
        const ts = parseInt(lastGroupId.split("_")[1]);
        if (!isNaN(ts)) lastChangeGroup.changedAt = new Date(ts).toISOString();
      }

      // ── Critical files ─────────────────────────────────────────────────────

      const criticalFiles: any[] = [];
      graph.files.forEach((node, filePath) => {
        const blastRadius = node.importedBy.size;
        const isHighChurn = node.changeCount > HIGH_CHURN_CRITICAL;
        const isHighBlast = blastRadius >= HIGH_BLAST_CRITICAL;

        if (isHighBlast || isHighChurn) {
          criticalFiles.push({
            path: path.basename(filePath),
            importedBy: blastRadius,
            changeCount: node.changeCount,
            modificationRisk: blastRadius >= DANGEROUS_BLAST_RADIUS || node.changeCount > DANGEROUS_CHURN
              ? "dangerous"
              : "caution",
            reasons: [
              ...(isHighBlast ? [`imported by ${blastRadius} files`] : []),
              ...(isHighChurn ? [`modified ${node.changeCount} times`] : []),
            ],
          });
        }
      });
      criticalFiles.sort((a, b) => b.importedBy - a.importedBy);

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

      // ── Tech stack ─────────────────────────────────────────────────────────

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
        hasTurborepo:
          fs.existsSync(path.join(this.workspaceRoot, "turbo.json")),
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

      // ── Safe directories ───────────────────────────────────────────────────

      const safeToCreateIn: string[] = [];
      const candidateDirs = [
        "app/components", "src/components", "components",
        "app/hooks", "src/hooks", "hooks",
        "app/lib", "src/lib", "lib",
        "app/utils", "src/utils", "utils",
        "app/types", "src/types", "types",
        "app/services", "src/services", "services",
      ];
      candidateDirs.forEach((dir) => {
        if (fs.existsSync(path.join(this.workspaceRoot, dir))) safeToCreateIn.push(dir);
      });
      ["apps", "packages", "web"].forEach((prefix) => {
        const prefixDir = path.join(this.workspaceRoot, prefix);
        if (!fs.existsSync(prefixDir)) return;
        try {
          // For web/ — scan directly (it IS the app, not a container of packages)
          if (prefix === "web") {
            ["core/components", "core/hooks", "core/store", "core/services", "core/lib",
             "components", "hooks", "store", "services"].forEach((sub) => {
              const subPath = path.join(prefixDir, sub);
              if (fs.existsSync(subPath)) {
                const rel = `${prefix}/${sub}`;
                if (!safeToCreateIn.includes(rel)) safeToCreateIn.push(rel);
              }
            });
            return;
          }
          // For apps/ and packages/ — scan sub-package directories
          fs.readdirSync(prefixDir).forEach((pkg) => {
            const pkgPath = path.join(prefixDir, pkg);
            try { if (!fs.statSync(pkgPath).isDirectory()) return; } catch { return; }
            ["components", "hooks", "lib", "store", "services"].forEach((sub) => {
              const subPath = path.join(pkgPath, sub);
              if (fs.existsSync(subPath)) {
                const rel = `${prefix}/${pkg}/${sub}`;
                if (!safeToCreateIn.includes(rel)) safeToCreateIn.push(rel);
              }
            });
          });
        } catch { /* skip */ }
      });

      // ── Orphaned symbols ───────────────────────────────────────────────────

      const orphanedSymbols: string[] = [];
      graph.symbols.forEach((sym) => {
        if (entryPointFiles.has(sym.file)) return;
        const fileNode = graph.files.get(sym.file);
        if (fileNode && fileNode.importedBy.size > 0) return;
        if (
          sym.calledBy.size === 0 &&
          sym.kind === "function" &&
          !sym.name.startsWith("_") &&
          sym.name !== "default"
        ) {
          orphanedSymbols.push(`${path.basename(sym.file)}::${sym.name}`);
        }
      });

      // ── Project metadata ──────────────────────────────────────────────────────

      let rippleVersion = "1.0.0";
      try {
        const ripplePkg = JSON.parse(
          fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
        );
        if (ripplePkg.version) rippleVersion = ripplePkg.version;
      } catch { /* stay with fallback */ }

      let projectName = path.basename(this.workspaceRoot);
      let projectDescription = "";
      let importAlias = "";

      try {
        const pkgPath = path.join(this.workspaceRoot, "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
          if (pkg.name) projectName = pkg.name;
          if (pkg.description) projectDescription = pkg.description;
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
          if (firstAlias) importAlias = firstAlias.replace("/*", "");
        }
      } catch { /* no alias */ }

      // ── Coding patterns — ONE combined disk-read loop, cached ──────────────
      //
      // patternCache prevents O(n) disk reads on every context regeneration.
      // Both arrow function preference and class component detection run in
      // a single pass and are stored together.
      // invalidatePatternCache() is called in updateFile() when files change.

      if (!this.patternCache) {
        let arrowFileCount = 0;
        let namedFileCount = 0;
        let hasClassComponents = false;

        graph.files.forEach((_, filePath) => {
          if (
            filePath.includes("node_modules") ||
            filePath.includes(".next") ||
            filePath.includes(".ripple") ||
            filePath.includes(".config.") ||
            filePath.includes(".setup.")
          ) return;
          try {
            const content = fs.readFileSync(filePath, "utf8");
            const namedFns = (content.match(/^(export\s+)?(async\s+)?function\s+\w+/gm) || []).length;
            const arrowFns = (content.match(/^(export\s+)?(const|let)\s+\w+\s*=\s*(async\s+)?\(/gm) || []).length;
            if (arrowFns > namedFns) arrowFileCount++;
            else if (namedFns > 0) namedFileCount++;
            if (/extends\s+(React\.)?Component/.test(content)) hasClassComponents = true;
            // MobX class stores use class declarations without extending React.Component
            if (/^class\s+\w+Store/.test(content) || /makeObservable|makeAutoObservable/.test(content)) hasClassComponents = true;
          } catch { /* skip unreadable */ }
        });

        this.patternCache = {
          prefersArrowFunctions: arrowFileCount > namedFileCount,
          hasClassComponents,
        };
      }

      const { prefersArrowFunctions, hasClassComponents } = this.patternCache;

      // Source file imports only — exclude node_modules from pattern detection
      const sourceImportPaths = Array.from(graph.files.entries())
        .filter(([fp]) =>
          !fp.includes("node_modules") &&
          !fp.includes(".next") &&
          !fp.includes(".ripple")
        )
        .flatMap(([_, node]) => Array.from(node.imports));

      const importBasenames = sourceImportPaths.map((i) =>
        path.basename(i, path.extname(i))
      );

      // State management
      const stateManagement: string[] = [];
      if (importBasenames.some((i) => i.includes("zustand"))) stateManagement.push("zustand");
      if (importBasenames.some((i) => i.includes("redux"))) stateManagement.push("redux");
      if (importBasenames.some((i) => i.includes("jotai"))) stateManagement.push("jotai");
      if (importBasenames.some((i) => i.includes("recoil"))) stateManagement.push("recoil");
      if (importBasenames.some((i) => i === "mobx" || i.includes("mobx-react"))) stateManagement.push("mobx");
      try {
        const pkgRaw2 = fs.readFileSync(path.join(this.workspaceRoot, "package.json"), "utf8");
        const pkg2 = JSON.parse(pkgRaw2);
        const allDeps2 = { ...(pkg2.dependencies ?? {}), ...(pkg2.devDependencies ?? {}) };
        if (allDeps2["@tanstack/react-query"] || allDeps2["react-query"]) stateManagement.push("react-query");
        if (allDeps2["@trpc/client"] || allDeps2["@trpc/react-query"]) stateManagement.push("trpc");
        if (allDeps2["swr"]) stateManagement.push("swr");
        if (allDeps2["mobx"] && !stateManagement.includes("mobx")) stateManagement.push("mobx");
        if (allDeps2["mobx-state-tree"] && !stateManagement.includes("mobx-state-tree")) stateManagement.push("mobx-state-tree");
      } catch { /* no package.json */ }
      if (stateManagement.length === 0) stateManagement.push("useState");

      // Styling — read package.json for node_modules packages
      const stylingApproach: string[] = [];
      const cssImports = sourceImportPaths.filter(
        (i) => i.endsWith(".css") || i.endsWith(".scss")
      );
      if (cssImports.some((i) => i.includes("module"))) stylingApproach.push("css-modules");
      try {
        const pkgRaw = fs.readFileSync(
          path.join(this.workspaceRoot, "package.json"), "utf8"
        );
        const pkg = JSON.parse(pkgRaw);
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        if (deps["styled-components"]) stylingApproach.push("styled-components");
        if (deps["@emotion/react"] || deps["@emotion/styled"]) stylingApproach.push("emotion");
      } catch { /* no package.json or invalid */ }
      if (techStack.hasTailwind) stylingApproach.push("tailwind");
      if (stylingApproach.length === 0 && cssImports.length > 0) stylingApproach.push("css");

      // Testing
      const testingFramework: string[] = [];
      if (
        fs.existsSync(path.join(this.workspaceRoot, "jest.config.ts")) ||
        fs.existsSync(path.join(this.workspaceRoot, "jest.config.js"))
      ) testingFramework.push("jest");
      if (fs.existsSync(path.join(this.workspaceRoot, "vitest.config.ts"))) testingFramework.push("vitest");
      if (fs.existsSync(path.join(this.workspaceRoot, "playwright.config.ts"))) testingFramework.push("playwright");

      const codingPatterns = {
        prefersArrowFunctions,
        stateManagement,
        stylingApproach,
        testingFramework,
        componentPattern: hasClassComponents ? "class or functional" : "functional only",
      };

      // ── Detected constraints ───────────────────────────────────────────────

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
        detectedConstraints.push("State management uses MobX — add new state as MobX stores or store extensions, not useState");
      } else if (stateManagement.length === 1 && stateManagement[0] === "useState" && !hasDataFetching) {
        detectedConstraints.push("State management uses useState only — do not introduce Redux, Zustand, or Jotai");
      } else if (hasDataFetching) {
        const dfLibs = stateManagement.filter((s) => ["react-query","trpc","swr"].includes(s)).join(", ");
        detectedConstraints.push(`Data fetching uses ${dfLibs} — use existing patterns for server state`);
      }

      // ── Public API ─────────────────────────────────────────────────────────

      const publicApi: Record<string, string[]> = {};
      graph.files.forEach((node, filePath) => {
        const isSource =
          !filePath.includes("node_modules") &&
          !filePath.includes(".ripple") &&
          !filePath.includes(".next");
        if (!isSource) return;

        const exported: string[] = [];
        node.symbols.forEach((symbolId) => {
          const sym = graph.symbols.get(symbolId);
          if (sym && (node.importedBy.size > 0 || sym.calledBy.size > 0)) {
            exported.push(sym.name);
          }
        });

        if (exported.length > 0) {
          const key = path.relative(this.workspaceRoot, filePath)
            .split(path.sep).join("/");
          publicApi[key] = exported;
        }
      });

      // ── Files section (for context.files.json) ─────────────────────────────
      //
      // 3-segment key prevents collision in monorepos.
      // Shallow file fallback prevents crash when file is at project root.

      const filesMap: Record<string, any> = {};
      graph.files.forEach((node, filePath) => {
        const isSource =
          !filePath.includes("node_modules") &&
          !filePath.includes(".ripple") &&
          !filePath.includes(".next");
        if (!isSource) return;

        // FIX 2: project-relative paths for imports and importedBy values — matches
        // the key format from Fix 1, so every reference is a valid direct lookup.
        const importedBy = Array.from(node.importedBy)
          .filter((f) => !f.includes("node_modules"))
          .map((f) => path.relative(this.workspaceRoot, f).split(path.sep).join("/"));
        const imports = Array.from(node.imports)
          .filter((f) => !f.includes("node_modules"))
          .map((f) => path.relative(this.workspaceRoot, f).split(path.sep).join("/"));

        const symbols = Array.from(node.symbols)
          .map((id) => id.split("::")[1])
          .filter(Boolean);

        if (importedBy.length === 0 && imports.length === 0 && symbols.length === 0) return;

        // FIX 1: project-relative path as key — unique across every file in the
        // project, never leaks machine-local path, directly usable as a lookup key.
        const fileKey = path.relative(this.workspaceRoot, filePath).split(path.sep).join("/");

        const blastSize = node.importedBy.size;
        const modificationRisk =
          blastSize >= DANGEROUS_BLAST_RADIUS || node.changeCount > DANGEROUS_CHURN
            ? "dangerous"
            : blastSize >= CAUTION_BLAST_RADIUS || node.changeCount > CAUTION_CHURN
            ? "caution"
            : "safe";

        filesMap[fileKey] = {
          fullPath: filePath,
          importedBy,
          imports,
          symbols,
          changeCount: node.changeCount,
          lastModified: node.lastModifiedAt,
          modificationRisk,
        };
      });

      // ── Symbols section (for context.symbols.json) ─────────────────────────

      const symbolsMap: Record<string, any> = {};
      graph.symbols.forEach((sym) => {
        // FIX 2: project-relative path for the file portion of calledBy/calls refs
        const toRelSymId = (id: string) => {
          const p = id.split("::");
          if (p.length < 2) return id;
          const relFile = path.relative(this.workspaceRoot, p[0]).split(path.sep).join("/");
          return `${relFile}::${p[1]}`;
        };
        const calledBy = Array.from(sym.calledBy).map(toRelSymId).filter(Boolean);
        const calls = Array.from(sym.calls).map(toRelSymId).filter(Boolean);

        if (calledBy.length === 0 && calls.length === 0) return;

        // FIX 1+2: symbolKey uses project-relative path — unique, lookup-safe
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

      // ── TIERED DELIVERY ────────────────────────────────────────────────────

      // context.files.json — read when modifying files or adding imports
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

      // context.symbols.json — read when modifying functions or tracing calls
      fs.writeFileSync(
        path.join(contextDir, "context.symbols.json"),
        JSON.stringify({
          rippleVersion,
          generated: new Date().toISOString(),
          description: "Symbol call graph with layer classification. Read when modifying functions or tracing call chains.",
          symbols: symbolsMap,
        }, null, 2)
      );

      // ── Available focus files — agents can find the right file without guessing
      const availableFocusFiles: Record<string, string> = {};
      graph.files.forEach((node, filePath) => {
        const isSource =
          !filePath.includes("node_modules") &&
          !filePath.includes(".ripple") &&
          !filePath.includes(".next");
        if (!isSource) return;
        if (node.imports.size === 0 && node.importedBy.size === 0 && node.symbols.size === 0) return;

        const focusKey = makeFocusKey(filePath);
        const blastSize = node.importedBy.size;
        const risk = blastSize >= DANGEROUS_BLAST_RADIUS || node.changeCount > DANGEROUS_CHURN ? "dangerous"
          : blastSize >= CAUTION_BLAST_RADIUS || node.changeCount > CAUTION_CHURN ? "caution" : "safe";
        availableFocusFiles[path.basename(filePath)] = `.ripple/focus/${focusKey}.json [${risk}]`;
      });

      // Build real focus examples — include type files that have importers
      const focusExamplesForContext: string[] = [];
      graph.files.forEach((node, filePath) => {
        if (focusExamplesForContext.length >= 3) return;
        const isSource = !filePath.includes("node_modules") && !filePath.includes(".next") && !filePath.includes(".ripple");
        if (!isSource) return;
        // Include any file with connections (imports OR importedBy OR symbols)
        if (node.imports.size === 0 && node.importedBy.size === 0 && node.symbols.size === 0) return;
        const fk = makeFocusKey(filePath);
        focusExamplesForContext.push(`${path.basename(filePath)} → .ripple/focus/${fk}.json`);
      });

      // context.json — lightweight summary only, always read, ~500 tokens
      const lightContext = {
        rippleVersion,
        projectName,
        projectDescription: projectDescription || "Add description to package.json for richer agent context",
        importAlias: importAlias
          ? `Use '${importAlias}/...' for imports (detected from tsconfig)`
          : "Use relative imports (no tsconfig alias detected)",
        generated: new Date().toISOString(),
        instructions: [
          "FASTEST: Look up your target file in availableFocusFiles and read that path (~200 tokens).",
          focusExamplesForContext.length > 0
            ? `Real examples: ${focusExamplesForContext.join(" | ")}`
            : "Focus files generated after first scan.",
          "For new features or debugging: read this file first, then check _tieredContext.decisionTree.",
          "Check criticalFiles and warnings before touching any file.",
          "Check lastChangeGroup.changedAt to see when the last change happened.",
          "Use safeToCreateIn to know where to put new files.",
          "Check orphanedSymbols before creating new utility functions.",
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
          summary: "Read the smallest file that answers your question. Start with the focus file.",
          decisionTree: {
            "I know which file to modify": "Look it up in availableFocusFiles → read that path (~200 tokens)",
            "I need to add a new file": "Check safeToCreateIn and publicApi in this file",
            "I need to understand file connections": "Read context.files.json",
            "I need to trace a call chain": "Read context.symbols.json — calledBy uses file::function format",
            "I am debugging across files": "Check lastChangeGroup.changedAt → read context.symbols.json",
          },
          files: {
            ".ripple/focus/{dir}-{name}.json": "PRIMARY. ~200 tokens. Read for any targeted file change.",
            ".ripple/context.json": "This file. ~500 tokens. Orientation and new features.",
            ".ripple/context.files.json": "~3000 tokens. Full file map, coding patterns, public API.",
            ".ripple/context.symbols.json": "~5000 tokens. Full call graph. calledBy = file.tsx::function.",
          },
          tokenEstimates: {
            "focus file only": "~200 tokens",
            "context.json only": "~500 tokens",
            "context.json + context.files.json": "~3000 tokens",
            "context.json + context.symbols.json": "~5000 tokens",
            "all files": "~15000 tokens",
          },
        },
        queryHints: {
          mostConnectedFiles,
          recentlyChangedFiles,
          highRiskSymbols,
        },
        entryPoints,
        lastChangeGroup,
        criticalFiles: criticalFiles.slice(0, 10),
        warnings,
        techStack,
        safeToCreateIn,
        orphanedSymbols: orphanedSymbols.slice(0, 20),
        availableFocusFiles,
        agentTasks: {
          addNewComponent: [
            "1. Check safeToCreateIn for the correct directory",
            `2. Use ${stylingApproach[0] ?? "detected styling"} for styling`,
            "3. Check publicApi and orphanedSymbols — reuse before creating new",
            `4. Component pattern: ${hasClassComponents ? "class or functional" : "functional only"}`,
          ],
          modifyExistingFile: [
            "1. Look up file in availableFocusFiles — read that path (~200 tokens)",
            "2. Check modificationRisk — stop and confirm with user if 'dangerous'",
            "3. Check each symbol's layer — only touch the layer the user requested",
            "4. Check calledBy (uses file.tsx::function format) — every caller must still work",
          ],
          addNewFeature: [
            techStack.hasNextJs
              ? "1. Routes: add pages in app/ (App Router) or pages/ (Pages Router)"
              : techStack.hasReactRouter || techStack.hasVite
              ? "1. Routes: add route components and register in the router config file"
              : "1. Check entryPoints to understand where new routes or pages go",
            "2. Check safeToCreateIn for file placement",
            "3. Check publicApi for existing utilities to reuse",
            `4. State management: ${stateManagement.join(", ")}`,
            importAlias ? `5. Import style: use '${importAlias}/...' prefix` : "5. Import style: use relative imports",
          ],
          debugBug: [
            "1. Check lastChangeGroup.changedAt — what changed and when",
            "2. Check warnings — high_churn files are most likely sources",
            "3. Read context.symbols.json — calledBy uses file.tsx::function to trace full chain",
          ],
        },
      };

      fs.writeFileSync(
        path.join(contextDir, "context.json"),
        JSON.stringify(lightContext, null, 2)
      );

      // Generate WORKFLOW.md — copy to CLAUDE.md once, zero repeated prompts forever
      this.generateWorkflow(
        projectName, projectDescription, importAlias,
        safeToCreateIn, stateManagement,
        stylingApproach, testingFramework, entryPoints, graph, rippleVersion
      );

      // Generate per-file focused context — 200 tokens per file vs 50,000
      this.generateFocusedContexts(graph);
    } catch (err) {
      console.warn("[Ripple] Context generation failed:", err);
    }
  }

  // ── FOCUSED CONTEXT — Per-file minimal context ─────────────────────────────
  //
  // Generates .ripple/focus/{parent}-{basename}.json for every connected file.
  // Contains ONLY data relevant to that specific file and its direct neighbors.
  //
  // Agent modifying authService.ts reads ONLY .ripple/focus/auth-authService.json
  // — ~200 tokens instead of 50,000 tokens for the full context files.
  //
  // Naming uses parent-basename to prevent collision on files like index.ts:
  //   app/auth/index.ts  → focus/auth-index.json
  //   app/user/index.ts  → focus/user-index.json
  //
  // This is the PRIMARY interface for agents doing targeted file modifications.

  private generateFocusedContexts(graph: SystemGraph): void {
    try {
      const focusDir = path.join(path.dirname(this.persistPath), "focus");
      if (!fs.existsSync(focusDir)) fs.mkdirSync(focusDir, { recursive: true });

      // FOCUS-10 fix: delete stale focus files for deleted/renamed source files.
      // Without this, .ripple/focus/ accumulates ghost files indefinitely.
      const validFocusKeys = new Set<string>();
      graph.files.forEach((fnode, fp) => {
        if (fp.includes("node_modules") || fp.includes(".ripple") || fp.includes(".next")) return;
        if (fnode.imports.size === 0 && fnode.importedBy.size === 0 && fnode.symbols.size === 0) return;
        const kp = fp.split(path.sep);
        validFocusKeys.add(kp.length >= 2
          ? `${kp[kp.length - 2]}-${path.basename(fp, path.extname(fp))}`
          : path.basename(fp, path.extname(fp)));
      });
      try {
        fs.readdirSync(focusDir).forEach((fname) => {
          if (!fname.endsWith(".json")) return;
          if (!validFocusKeys.has(fname.slice(0, -5))) {
            fs.unlinkSync(path.join(focusDir, fname));
          }
        });
      } catch { /* focus dir may be empty on first run */ }

      graph.files.forEach((node, filePath) => {
        // Mirror shouldIgnore() — same directories excluded from focus file generation
        const isSource =
          !filePath.includes("node_modules") &&
          !filePath.includes(".ripple") &&
          !filePath.includes(".next") &&
          !filePath.includes(`${path.sep}dist${path.sep}`) &&
          !filePath.includes(`${path.sep}out${path.sep}`) &&
          !filePath.includes(`${path.sep}build${path.sep}`) &&
          !filePath.includes(".turbo") &&
          !filePath.includes(".vercel") &&
          !filePath.includes(`${path.sep}coverage${path.sep}`);
        if (!isSource) return;
        // Generate focus files for connected files AND files with symbols (e.g. type files)
        if (node.imports.size === 0 && node.importedBy.size === 0 && node.symbols.size === 0) return;

        // 3-segment key prevents collision in monorepos (e.g. multiple lib/ directories)
        const basename = makeFocusKey(filePath);

        // Files that import this file — project-relative paths match generateSingleFocus and context.files.json
        const MAX_IMPORTEDBY = 10;
        const allImportedBy = Array.from(node.importedBy).filter((f) => !f.includes("node_modules"));
        const importedByTruncated = allImportedBy.length > MAX_IMPORTEDBY;
        const importedBy = allImportedBy.slice(0, MAX_IMPORTEDBY).map((f) => {
            const n = graph.files.get(f);
            const b = n?.importedBy.size ?? 0;
            const c = n?.changeCount ?? 0;
            // Project-relative path — consistent with generateSingleFocus and context.files.json
            const relPath = path.relative(this.workspaceRoot, f).split(path.sep).join("/");
            // FOCUS-6: flag API routes and pages — they have 0 importers but are public-facing
            const fBase = path.basename(f);
            const isEntryPoint =
              fBase === "route.ts" || fBase === "route.tsx" ||
              fBase === "page.tsx" || fBase === "page.ts" ||
              f.includes(`${path.sep}pages${path.sep}api${path.sep}`) ||
              f.includes(`${path.sep}app${path.sep}api${path.sep}`);
            return {
              file: relPath,
              modificationRisk: b >= DANGEROUS_BLAST_RADIUS || c > DANGEROUS_CHURN ? "dangerous"
                : b >= CAUTION_BLAST_RADIUS || c > CAUTION_CHURN ? "caution" : "safe",
              ...(isEntryPoint ? { isEntryPoint: true } : {}),
            };
          });

        // Files this file imports — project-relative paths
        const imports = Array.from(node.imports)
          .filter((f) => !f.includes("node_modules"))
          .map((f) => path.relative(this.workspaceRoot, f).split(path.sep).join("/"));

        // FOCUS-7: detect barrel files — surfaces re-exports for agent guidance
        const isBarrel = ["index.ts","index.tsx","index.js","index.jsx"]
          .includes(path.basename(filePath));
        const reExports: string[] = isBarrel
          ? Array.from(node.imports).filter(f => !f.includes("node_modules")).map(f =>
              path.relative(this.workspaceRoot, f).split(path.sep).join("/")
            )
          : [];

        // Symbols — calledBy/calls use project-relative paths (consistent with generateSingleFocus)
        const MAX_CALLERS = 10;
        const symbols: any[] = [];
        node.symbols.forEach((symbolId) => {
          const sym = graph.symbols.get(symbolId);
          if (!sym) return;
          const allCB = Array.from(sym.calledBy);
          const allCL = Array.from(sym.calls);
          // Project-relative helper — same pattern as toRelSymId in generateContext
          const toRel = (id: string) => {
            const p = id.split("::");
            if (p.length < 2) return id;
            return `${path.relative(this.workspaceRoot, p[0]).split(path.sep).join("/")}::${p[1]}`;
          };
          symbols.push({
            name: sym.name,
            kind: sym.kind,
            layer: sym.layer ?? "unknown",
            // FIX 4: callerCount is always the full untruncated count (sym.calledBy.size).
            // calledByTruncated:true signals that the calledBy *array* is only a preview.
            callerCount: sym.calledBy.size,
            calledBy: allCB.slice(0, MAX_CALLERS).map(toRel).filter(Boolean),
            ...(allCB.length > MAX_CALLERS ? { calledByTruncated: true } : {}),
            calls: allCL.slice(0, MAX_CALLERS).map(toRel).filter(Boolean),
          });
        });

        const blastSize = node.importedBy.size;
        let modificationRisk: "dangerous" | "caution" | "safe" =
          blastSize >= DANGEROUS_BLAST_RADIUS || node.changeCount > DANGEROUS_CHURN
            ? "dangerous"
            : blastSize >= CAUTION_BLAST_RADIUS || node.changeCount > CAUTION_CHURN
            ? "caution"
            : "safe";

        // FOCUS-2: parse errors may mean importedBy is incomplete — never show "safe" with parse errors
        if (node.hasParseError && modificationRisk === "safe") modificationRisk = "caution";

        const focused = {
          file: path.basename(filePath),
          fullPath: filePath.split(path.sep).join("/"),
          modificationRisk,
          changeCount: node.changeCount,
          focusKey: basename,
          instructions: [
            ...(node.hasParseError ? ["⚠ WARNING: This file has parse errors. Connections may be incomplete. Fix errors and save to update."] : []),
            ...(isBarrel && reExports.length > 0 ? [`Barrel/re-export file. To modify implementation, read focus files for: ${reExports.join(", ")}`] : []),
            modificationRisk === "dangerous"
              ? `DANGER: This file has ${blastSize} importers. Any change has wide blast radius. Proceed with extreme care.`
              : modificationRisk === "caution"
              ? `CAUTION: This file has ${blastSize} importers. Verify all callers still work after changes.`
              : "Safe to modify — low blast radius.",
            "calledBy uses dir/file.tsx::functionName format — use it to locate callers directly.",
            "Use layer field to confirm you are modifying the correct layer (logic/ui/handler).",
          ],
          hasParseError: node.hasParseError ?? false,
          // F-GAP-3: explicit data quality signal so agents know parse-error files
          // may have incomplete calledBy, calls, and symbol data. Agents must not
          // treat "partial" focus files as authoritative — run a search to supplement.
          dataQuality: node.hasParseError ? "partial" : "complete",
          // FIX 3: structured total count so agents don't have to parse natural language
          totalImporterCount: node.importedBy.size,
          importedByTruncated,
          ...(isBarrel && reExports.length > 0 ? { isBarrel: true, reExports } : {}),
          importedBy,
          imports,
          symbols,
        };

        fs.writeFileSync(
          path.join(focusDir, `${basename}.json`),
          JSON.stringify(focused, null, 2)
        );
      });
    } catch (err) {
      console.warn("[Ripple] Focused context generation failed:", err);
    }
  }

  // ── WORKFLOW.MD — Zero-prompt agent protocol ──────────────────────────────
  //
  // Developer copies this to CLAUDE.md (Claude Code) or .cursorrules (Cursor).
  // Agent reads it every session automatically.
  // One-line prompts work safely forever after copying.

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
      // Derive hasMobX locally — avoids adding parameter to call site
      const hasMobX = stateManagement.includes("mobx") || stateManagement.includes("mobx-state-tree");

      // Derive techStack locally — same reason: not passed as a parameter
      // Uses this.workspaceRoot which is available as a class property
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

      const workflowPath = path.join(
        path.dirname(this.persistPath),
        "WORKFLOW.md"
      );

      // Collect dangerous files for explicit warning
      const dangerousFiles: string[] = [];
      graph.files.forEach((node, filePath) => {
        if (node.importedBy.size >= DANGEROUS_BLAST_RADIUS) {
          dangerousFiles.push(
            `${path.basename(filePath)} (${node.importedBy.size} importers)`
          );
        }
      });

      // Build real focus file examples
      const focusExamples: string[] = [];
      graph.files.forEach((node, filePath) => {
        const isSource = !filePath.includes("node_modules") && !filePath.includes(".next") && !filePath.includes(".ripple");
        if (!isSource || (node.imports.size === 0 && node.importedBy.size === 0)) return;
        const focusKey = makeFocusKey(filePath);
        if (focusExamples.length < 5) {
          const blastSize = node.importedBy.size;
          const risk = blastSize >= DANGEROUS_BLAST_RADIUS || node.changeCount > DANGEROUS_CHURN ? "dangerous"
            : blastSize >= CAUTION_BLAST_RADIUS || node.changeCount > CAUTION_CHURN ? "caution" : "safe";
          focusExamples.push(`${path.basename(filePath)} [${risk}] → .ripple/focus/${focusKey}.json`);
        }
      });

      const content = `# ${projectName} — Ripple Workflow
*Copy this to your project root as CLAUDE.md (Claude Code) or .cursorrules (Cursor)*
*After copying: one-line prompts work safely. No repeated instructions needed.*

---

## YOUR AUTOMATIC PROTOCOL

You MUST run this protocol before every task — automatically, without being asked:

**Step 1:** Identify the file(s) involved in the task
**Step 2:** For each file, compute its focus path:
  - Formula: \`.ripple/focus/{grandparent}-{parent}-{filename-no-extension}.json\`
  - Example: \`packages/features/auth/lib/authService.ts\` → \`.ripple/focus/auth-lib-authService.json\`
  - Always verify using \`availableFocusFiles\` in context.json — exact keys are listed there
  - Full list: \`.ripple/context.json\` → \`availableFocusFiles\`
**Step 3:** Read the focus file (~200 tokens total)
**Step 4:** Check \`modificationRisk\`:
  - \`"safe"\` → proceed
  - \`"caution"\` → note callers, proceed carefully  
  - \`"dangerous"\` → STOP. Tell user: "This file has [N] importers. I recommend confirming the approach. Shall I proceed?"
**Step 5:** For every symbol you will modify, check its \`calledBy\` list. Every caller must still work.
**Step 6:** Check the symbol's \`layer\`. Only touch the layer the user asked for.

If task involves multiple files or you cannot identify the file → read \`.ripple/context.json\` first.

**MULTI-FILE CHANGES — follow this order:**
1. Read ALL relevant focus files before touching anything
2. Find shared types — modify types files FIRST
3. Modify core logic files SECOND
4. Modify UI and handler files LAST
5. Verify every \`calledBy\` caller works after each file change

---

## PLANNING FOR COMPLEX TASKS

For any task touching more than one file, run this planning algorithm BEFORE writing any code:

**Step 1 — Find the starting file.**
Identify the most central file for the task (e.g. for "update auth flow" → start with \`authService.ts\`).
Read its focus file from \`availableFocusFiles\` in context.json.

**Step 2 — Chain exploration (1-2 levels deep).**
Look at the \`imports\` and \`importedBy\` arrays in that focus file.
Read focus files for the most relevant dependencies and dependents.
Stop after 2 levels — this gives you the full blast surface without noise.

**Step 3 — Formulate the plan BEFORE touching any code.**
State to the user exactly which files you will change and in what order.

Example plan format:
\`\`\`
To implement [task], I will make the following changes:
1. types/auth.ts       — add PasskeyCredential type  [caution, 3 importers]
2. lib/authService.ts  — update login() logic         [dangerous, 7 importers]
3. components/LoginButton.tsx — update UI handler     [safe, 0 importers]

Shall I proceed in this order?
\`\`\`

**Step 4 — Wait for user confirmation before writing any code.**

**Why this matters:** An agent that starts coding a complex refactor before mapping the full surface will miss files, create inconsistencies, and produce broken changes at scale. The plan step uses your graph data — not guesswork — to map the real scope of the change.

---

## THIS PROJECT

${projectDescription ? `**What this project does:** ${projectDescription}\n` : ""}\
**Files tracked:** ${graph.files.size}
**Framework:** ${techStack.hasNextJs ? "Next.js" : techStack.hasVite ? "Vite" : techStack.hasReactRouter ? "React Router" : "Unknown — check build config"}
**Import style:** ${importAlias ? `Use '${importAlias}/...' for imports` : "Use relative imports"}
**Entry points:** ${entryPoints.slice(0, 4).join(", ") || "none detected"}
**State management:** ${stateManagement.join(", ")}
**Styling:** ${stylingApproach.join(", ") || "see context.files.json"}
**Testing:** ${testingFramework.length > 0 ? testingFramework.join(", ") : "none detected"}
**New files go in:** ${safeToCreateIn.slice(0, 4).join(", ")}${dangerousFiles.length > 0 ? `
**High-blast files (STOP + confirm):** ${dangerousFiles.slice(0, 5).join(", ")}` : ""}

---

## FOCUS FILES IN THIS PROJECT

${focusExamples.length > 0
  ? focusExamples.map(e => `- ${e}`).join("\n")
  : "- No focus files generated yet — save any file to generate them"}

---

## ONE-LINE PROMPT EXAMPLES

After you copy this file, these one-line prompts work safely:

| User says | What you do |
|-----------|-------------|
| "Update the login logic" | Find login file → read focus → check calledBy → modify layer:logic only |
| "Fix the button styling" | Find button file → read focus → modify layer:ui only |
| "Add a new API endpoint" | Read context.json → check entryPoints + safeToCreateIn → create file |
| "Debug why auth is broken" | Read context.json → check lastChangeGroup → trace with context.symbols.json |
| "Add email validation" | Find form file → read focus → check if validator exists in orphanedSymbols |

---

## LAYER TARGETING

Every symbol has a \`layer\` field in its focus file:

| Layer | What it means | When to touch |
|-------|---------------|---------------|
| \`logic\` | Pure computation | "change the logic/algorithm/calculation" |
| \`ui\` | JSX rendering | "update the UI/design/layout" |
| \`handler\` | Event handlers | "change what happens on click/submit" |
| \`state\` | React state | "update the state management" |
| \`data\` | API/fetch calls | "change the data fetching" |
| \`mixed\` | Multiple layers | ASK user before touching |
| \`unknown\` | Unclassified | Read carefully before touching |

---

## ABSOLUTE RULES

1. Never modify \`.ripple/\` files
2. Never change a function signature without checking ALL calledBy callers
3. Never create files outside: ${safeToCreateIn.slice(0, 4).join(", ")}
4. ${hasMobX
  ? "New state goes in a MobX store (web/core/store/ or equivalent) — never introduce useState for shared state"
  : stateManagement[0] === "useState"
  ? "Never introduce Redux, Zustand, or Jotai without user confirmation"
  : `Use ${stateManagement.join(", ")} for state — do not mix in incompatible libraries`
}
5. Always use ${stylingApproach[0] ?? "existing styling approach"} for new UI

---
*Auto-generated by Ripple v${rippleVersion} — updates on every file save*
*This file reflects your actual codebase. It is always current.*
`;

      fs.writeFileSync(workflowPath, content);
// ── AUTO-SYNC to agent instruction files ──────────────────────────────
      // The core promise: developer copies WORKFLOW.md to their agent file ONCE.
      // After that, Ripple keeps it updated automatically on every save.
      // This is what makes "live-updating context" true — not just for .ripple/
      // but for the files AI agents actually read.
      //
      // Priority order: AGENTS.md → CLAUDE.md → .cursorrules
      // Only syncs if the file already exists AND contains Ripple content.
      // Never overwrites a file the developer wrote themselves.
      const agentFiles = [
        { name: "AGENTS.md",     path: path.join(this.workspaceRoot, "AGENTS.md") },
        { name: "CLAUDE.md",     path: path.join(this.workspaceRoot, "CLAUDE.md") },
        { name: ".cursorrules",  path: path.join(this.workspaceRoot, ".cursorrules") },
      ];

      const rippleSignature = "Auto-generated by Ripple";

      for (const agentFile of agentFiles) {
        try {
          if (!fs.existsSync(agentFile.path)) continue;
          const existing = fs.readFileSync(agentFile.path, "utf8");
          // Only overwrite if the file was originally created by Ripple.
          // This protects manually written agent files.
          if (!existing.includes(rippleSignature)) continue;
          fs.writeFileSync(agentFile.path, content);
        } catch {
          // Best-effort — never block the save cycle
        }
      }
    } catch {
      // Best-effort
    }
  }

  // Called from GraphEngine.updateFile() so agents see fresh context right after save.
  // FOCUS-GAP-8 fix: previously focus files were only written inside debouncedCacheWrite()
  // which fires 2 seconds after the last save. An agent started immediately after saving
  // would read a stale focus file that didn't reflect the just-saved changes.
  generateSingleFocus(graph: SystemGraph, filePath: string): void {
    if (!this.contextGenerationEnabled) return;
    try {
      const node = graph.files.get(filePath);
      if (!node) return;

      const isSource =
        !filePath.includes("node_modules") &&
        !filePath.includes(".ripple") &&
        !filePath.includes(".next") &&
        !filePath.includes(`${path.sep}dist${path.sep}`) &&
        !filePath.includes(`${path.sep}out${path.sep}`) &&
        !filePath.includes(`${path.sep}build${path.sep}`) &&
        !filePath.includes(".turbo");
      if (!isSource) return;
      if (node.imports.size === 0 && node.importedBy.size === 0 && node.symbols.size === 0) return;

      const focusDir = path.join(path.dirname(this.persistPath), "focus");
      if (!fs.existsSync(focusDir)) fs.mkdirSync(focusDir, { recursive: true });

      const basename = makeFocusKey(filePath);

      const importedBy = Array.from(node.importedBy)
        .filter((f) => !f.includes("node_modules"))
        .map((f) => {
          const n = graph.files.get(f);
          const b = n?.importedBy.size ?? 0;
          const c = n?.changeCount ?? 0;
          return {
            // Project-relative path — matches format used in generateFocusedContexts
            file: path.relative(this.workspaceRoot, f).split(path.sep).join("/"),
            modificationRisk: b >= DANGEROUS_BLAST_RADIUS || c > DANGEROUS_CHURN ? "dangerous"
              : b >= CAUTION_BLAST_RADIUS || c > CAUTION_CHURN ? "caution" : "safe",
          };
        });

      const imports = Array.from(node.imports)
        .filter((f) => !f.includes("node_modules"))
        .map((f) => path.relative(this.workspaceRoot, f).split(path.sep).join("/"));

      const symbols: any[] = [];
      node.symbols.forEach((symbolId) => {
        const sym = graph.symbols.get(symbolId);
        if (!sym) return;
        // Project-relative helper — matches toRelSymId in generateContext
        const toRel = (id: string) => {
          const p = id.split("::");
          if (p.length < 2) return id;
          return `${path.relative(this.workspaceRoot, p[0]).split(path.sep).join("/")}::${p[1]}`;
        };
        symbols.push({
          name: sym.name,
          kind: sym.kind,
          layer: sym.layer ?? "unknown",
          callerCount: sym.calledBy.size,
          calledBy: Array.from(sym.calledBy).map(toRel).filter(Boolean),
          calls: Array.from(sym.calls).map(toRel).filter(Boolean),
        });
      });

      const blastSize = node.importedBy.size;
      const modificationRisk = blastSize >= DANGEROUS_BLAST_RADIUS || node.changeCount > DANGEROUS_CHURN
        ? "dangerous"
        : blastSize >= CAUTION_BLAST_RADIUS || node.changeCount > CAUTION_CHURN
        ? "caution" : "safe";

      const topImporterNames = importedBy.slice(0, 3)
        .map((i: any) => typeof i === "object" ? i.file : i).join(", ");

      const focused = {
        file: path.basename(filePath),
        fullPath: filePath.split(path.sep).join("/"),
        modificationRisk,
        changeCount: node.changeCount,
        focusKey: basename,
        dataQuality: node.hasParseError ? "partial" : "complete",
        // Bug fix: totalImporterCount was missing from generateSingleFocus.
        // generateFocusedContexts (full scan) had it, but per-save writes
        // overwrote focus files without this field after every save.
        totalImporterCount: node.importedBy.size,
        instructions: [
          ...(node.hasParseError
            ? ["⚠ WARNING: This file has parse errors. Connections may be incomplete."]
            : []),
          modificationRisk === "dangerous"
            ? `DANGER: This file has ${blastSize} importers. Top importers: ${topImporterNames}. Any change has wide blast radius.`
            : modificationRisk === "caution"
            ? `CAUTION: This file has ${blastSize} importers (${topImporterNames}). Verify all callers still work.`
            : "Safe to modify — low blast radius.",
          "calledBy uses parent/file.ts::functionName format — use it to locate callers directly.",
          "Use layer field to confirm you are modifying the correct layer (logic/ui/handler).",
        ],
        hasParseError: node.hasParseError ?? false,
        importedBy,
        imports,
        symbols,
      };

      fs.writeFileSync(
        path.join(focusDir, `${basename}.json`),
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

// 3-segment collision-resistant focus file key.
// Prevents monorepo collisions where many packages share directory names (lib/, utils/, types/).
// packages/features/bookings/lib/handleCancelBooking.ts → "bookings-lib-handleCancelBooking"
function makeFocusKey(filePath: string): string {
  const parts = filePath.split(path.sep);
  const base = path.basename(filePath, path.extname(filePath));
  if (parts.length >= 4) {
    return `${parts[parts.length - 3]}-${parts[parts.length - 2]}-${base}`;
  }
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}-${base}`;
  }
  return base;
}

function makeSymbolId(filePath: string, symbolName: string): string {
  return `${filePath}::${symbolName}`;
}

function makeChangeGroup(): string {
  return `save_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const TS_JS_GLOB = "**/*.{ts,tsx,js,jsx}";

// ── Risk thresholds — centralized so tuning happens in one place ─────────────
export const DANGEROUS_BLAST_RADIUS = 5;  // importedBy count → "dangerous"
export const CAUTION_BLAST_RADIUS   = 2;  // importedBy count → "caution"
export const DANGEROUS_CHURN        = 15; // changeCount      → "dangerous"
export const CAUTION_CHURN          = 8;  // changeCount      → "caution"
const HIGH_BLAST_CRITICAL    = 3;  // importedBy count → enters criticalFiles
const HIGH_CHURN_CRITICAL    = 10; // changeCount      → enters criticalFiles
export const HIGH_RISK_CALLER_COUNT = 3;  // calledBy count   → highRiskSymbols

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

  // Called from extension.ts when ripple.generateContext setting is false.
  // Disables .ripple/ file writes. Graph still builds — Impact Lens + CodeLens still work.
  setContextGeneration(enabled: boolean): void {
    this.persistence.contextGenerationEnabled = enabled;
  }
  private project: Project;
  private workspaceRoot: string;

  // True during initialScan() — suppresses all history logging
  private isScanning = false;

  // O(1) new-file detection — avoids O(n) history scan on every updateFile()
  private sessionNewFiles = new Set<string>();

  // Debounced cache write — max one disk write per 2 seconds
  private cacheWriteTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.graph = new SystemGraph();
    this.history = new HistoryLog();
    this.persistence = new GraphPersistence(workspaceRoot);
    this.persistence.load(this.history);

    this.project = new Project({
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
  }

  // Called from extension.ts deactivate() to flush pending cache write
  dispose(): void {
    if (this.cacheWriteTimer) {
      clearTimeout(this.cacheWriteTimer);
      this.cacheWriteTimer = undefined;
      this.persistence.saveCache(this.graph);
      this.persistence.generateContext(this.graph, this.history);
    }
  }

  private toTsMorphPath(filePath: string): string {
    return filePath.split(path.sep).join("/");
  }

  private toGraphPath(filePath: string): string {
    return filePath.split("/").join(path.sep);
  }

  private debouncedCacheWrite(): void {
    if (this.cacheWriteTimer) clearTimeout(this.cacheWriteTimer);
    this.cacheWriteTimer = setTimeout(() => {
      this.cacheWriteTimer = undefined;
      this.persistence.saveCache(this.graph);
      this.persistence.generateContext(this.graph, this.history);
    }, 2000);
  }

  // ── INITIAL SCAN ──────────────────────────────────────────────────────────
  //
  // First install: full 3-pass scan → saves cache → logs baseline_snapshot.
  // Subsequent launches: loads cache → re-parses only stale/new files.
  // Priority file scanned first so features appear within ~1 second.

  async initialScan(
    onProgress?: (scanned: number, total: number) => void,
    priorityFile?: string
  ): Promise<void> {
    this.isScanning = true;

    const files = await vscode.workspace.findFiles(
      TS_JS_GLOB,
      `**/{${IGNORE_DIRS.join(",")}}/**`
    );

    let validFiles = files
      .map((u) => u.fsPath)
      .filter((p) => !shouldIgnore(p));

    // GAP-8 fix: Sort barrel files (index.ts/tsx/js/jsx) to front of scan order.
    // resolveBarrelSources() requires the barrel to already be in ts-morph's project.
    // Without this sort, barrel files scanned AFTER their importers produce no
    // importedBy edges for the files they re-export on first install.
    validFiles.sort((a, b) => {
      const aIsBarrel = /[\/]index\.(ts|tsx|js|jsx)$/.test(a) ? 0 : 1;
      const bIsBarrel = /[\/]index\.(ts|tsx|js|jsx)$/.test(b) ? 0 : 1;
      return aIsBarrel - bIsBarrel;
    });

    if (priorityFile && !shouldIgnore(priorityFile)) {
      validFiles = [
        priorityFile,
        ...validFiles.filter((f) => f !== priorityFile),
      ];
    }

    // ── CACHE FAST PATH ──────────────────────────────────────────────────────

    const staleFiles = this.persistence.loadCache(this.graph);
    const cacheWasLoaded = this.graph.files.size > 0;

    if (cacheWasLoaded) {
      const cachedPaths = new Set(this.graph.files.keys());
      const newFiles = validFiles.filter((f) => !cachedPaths.has(f));
      const filesToParse = [...new Set([...staleFiles, ...newFiles])];

      if (filesToParse.length === 0) {
        // Cache fully fresh — load source files into ts-morph for CodeLens
        for (const filePath of validFiles) {
          const tsMorphPath = this.toTsMorphPath(filePath);
          if (!this.project.getSourceFile(tsMorphPath)) {
            try {
              const content = fs.readFileSync(filePath, "utf8");
              this.project.createSourceFile(tsMorphPath, content, { overwrite: true });
            } catch { /* skip */ }
          }
        }
        console.log("[Ripple] Cache fully fresh — skipping scan");
        this.isScanning = false;
        onProgress?.(validFiles.length, validFiles.length);
        this.persistence.generateContext(this.graph, this.history);
        this.persistence.flush(this.history);
        return;
      }

      console.log(`[Ripple] Cache loaded — reparsing ${filesToParse.length} changed files`);

      staleFiles.forEach((f) => this.removeFileEdges(f, true));

      let scanned = 0;
      for (const filePath of filesToParse) this.ensureFileNode(filePath);

      for (const filePath of filesToParse) {
        try { this.parseImportsAndExports(filePath); }
        catch { console.warn("[Ripple] Failed to parse:", filePath); }
        scanned++;
        onProgress?.(scanned, filesToParse.length);
      }

      // Load non-stale cached files into ts-morph for CodeLens queries
      const parsedPaths = new Set(filesToParse.map((f) => this.toTsMorphPath(f)));
      for (const filePath of validFiles) {
        const tsMorphPath = this.toTsMorphPath(filePath);
        if (parsedPaths.has(tsMorphPath) || this.project.getSourceFile(tsMorphPath)) continue;
        try {
          const content = fs.readFileSync(filePath, "utf8");
          this.project.createSourceFile(tsMorphPath, content, { overwrite: true });
        } catch { /* skip */ }
      }

      for (const filePath of filesToParse) {
        try { this.parseCallsOnly(filePath); }
        catch { console.warn("[Ripple] Failed to parse calls:", filePath); }
      }

      this.isScanning = false;
      this.persistence.saveCache(this.graph);
      this.persistence.generateContext(this.graph, this.history);
      this.persistence.flush(this.history);
      return;
    }

    // ── FULL SCAN (first install or cache missing) ────────────────────────────

    for (const filePath of validFiles) this.ensureFileNode(filePath);

    let scanned = 0;
    for (const filePath of validFiles) {
      try { this.parseImportsAndExports(filePath); }
      catch { console.warn("[Ripple] Failed to parse:", filePath); }
      scanned++;
      onProgress?.(scanned, validFiles.length);
    }

    for (const filePath of validFiles) {
      try { this.parseCallsOnly(filePath); }
      catch { console.warn("[Ripple] Failed to parse calls:", filePath); }
    }

    this.isScanning = false;
    this.persistence.saveCache(this.graph);
    this.persistence.generateContext(this.graph, this.history);

    if (!this.history.hasBaseline()) {
      const sourceFileCount = validFiles.filter((f) => fs.existsSync(f)).length;
      this.history.log({
        timestamp: Date.now(),
        type: "baseline_snapshot",
        source: "initial_scan",
        metadata: `files:${sourceFileCount}|symbols:${this.graph.symbols.size}`,
      });
    }

    this.persistence.flush(this.history);
  }

  // ── INCREMENTAL UPDATE ────────────────────────────────────────────────────
  //
  // Hash-gated. Diffs old vs new state. Logs only what changed.
  // All events from one save share one changeGroup.

  updateFile(filePath: string): void {
    if (shouldIgnore(filePath)) return;

    let content: string;
    // Create changeGroup before read attempt so error-path deletion
    // shares the same group as any related events (GAP-7 fix)
    const deleteChangeGroup = makeChangeGroup();
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      this.removeFile(filePath, deleteChangeGroup);
      return;
    }

    const newHash = sha1(content);
    const existing = this.graph.files.get(filePath);
    if (existing?.hash === newHash) return;

    const isNewFile = !existing && !this.sessionNewFiles.has(filePath);
    if (isNewFile) this.sessionNewFiles.add(filePath);

    const oldImports = new Set(existing?.imports ?? []);
    const oldSymbols = new Set(existing?.symbols ?? []);

    // Snapshot per-symbol text BEFORE parseFile mutates sourceFile.
    // parseFile calls sourceFile.replaceWithText() which mutates the same object.
    const oldSymbolHashes = new Map<string, string>();
    const snapshotSourceFile = this.project.getSourceFile(this.toTsMorphPath(filePath));

    if (snapshotSourceFile) {
      const snapshots = new Map<string, string>();
      snapshotSourceFile.getFunctions().forEach((f) => {
        const name = f.getName();
        if (name) snapshots.set(name, f.getText());
      });
      snapshotSourceFile.getVariableDeclarations().forEach((v) => {
        const name = v.getName();
        if (name) snapshots.set(name, v.getText());
      });
      oldSymbols.forEach((symbolId) => {
        const symbolName = symbolId.split("::")[1];
        if (!symbolName) return;
        const text = snapshots.get(symbolName);
        if (text) oldSymbolHashes.set(symbolId, sha1(text));
      });
    }

    const oldCalls = new Map<string, Set<string>>();
    oldSymbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      if (sym) oldCalls.set(symbolId, new Set(sym.calls));
    });

    // Snapshot calledBy for all existing symbols before edges are cleared.
    // After re-parsing, symbols may be recreated with the same name.
    // We restore their calledBy so the "who calls this" view stays correct
    // without requiring every caller file to be re-saved.
    const savedCalledBy = new Map<string, Set<string>>();
    oldSymbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      if (sym && sym.calledBy.size > 0) {
        savedCalledBy.set(symbolId, new Set(sym.calledBy));
      }
    });

    // Invalidate pattern cache so coding patterns stay accurate after file changes
    this.persistence.invalidatePatternCache();
    this.removeFileEdges(filePath, true);
    this.parseFile(filePath, content);

    // Restore calledBy edges for symbols that were recreated with the same name.
    // symbolId is filePath::symbolName — if the symbol exists again with the
    // same name, its calledBy should be the same until callers are re-parsed.
    savedCalledBy.forEach((callerIds, symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      if (!sym) return; // Symbol deleted — callers will get stale edges until they re-parse
      callerIds.forEach((callerId) => {
        const callerSym = this.graph.symbols.get(callerId);
        if (!callerSym) return; // Caller no longer exists in graph
        sym.calledBy.add(callerId);
        callerSym.calls.add(symbolId);
      });
    });

    const newFileNode = this.graph.files.get(filePath);
    if (!newFileNode) return;

    const changeGroup = makeChangeGroup();
    const now = Date.now();

    if (isNewFile) {
      this.history.log({
        timestamp: now,
        type: "file_created",
        source: filePath,
        fileHash: newFileNode.hash,
        changeGroup,
      });
    }

    // Import diff
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

    // Symbol diff
    oldSymbols.forEach((symbolId) => {
      if (!newFileNode.symbols.has(symbolId)) {
        this.history.log({ timestamp: now, type: "symbol_deleted", source: symbolId, changeGroup });
      }
    });

    newFileNode.symbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);

      if (!oldSymbols.has(symbolId)) {
        this.history.log({
          timestamp: now,
          type: "symbol_created",
          source: symbolId,
          kind: sym?.kind,
          symbolHash: sym ? sha1(symbolId) : undefined,
          layer: sym?.layer,
          changeGroup,
        });
      } else {
        // Per-symbol hash — only fires when THIS specific function changed
        const oldHash = oldSymbolHashes.get(symbolId);
        if (oldHash) {
          const newSourceFile = this.project.getSourceFile(this.toTsMorphPath(filePath));
          let newSymbolHash: string | null = null;

          if (newSourceFile) {
            const symbolName = symbolId.split("::")[1];
            const funcDecl = newSourceFile.getFunctions().find((f) => f.getName() === symbolName);
            if (funcDecl) {
              newSymbolHash = sha1(funcDecl.getText());
            } else {
              const varDecl = newSourceFile.getVariableDeclarations().find((v) => v.getName() === symbolName);
              if (varDecl) newSymbolHash = sha1(varDecl.getText());
            }
          }

          if (newSymbolHash && oldHash !== newSymbolHash) {
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
      }
    });

    // Call edge diff
    newFileNode.symbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      if (!sym) return;
      const oldCallSet = oldCalls.get(symbolId) ?? new Set<string>();

      sym.calls.forEach((targetId) => {
        if (!oldCallSet.has(targetId)) {
          const targetNode = this.graph.symbols.get(targetId);
          this.history.log({
            timestamp: now,
            type: "call_added",
            source: symbolId,
            target: targetId,
            targetCallerCount: targetNode?.calledBy.size,
            changeGroup,
          });
        }
      });

      oldCallSet.forEach((targetId) => {
        if (!sym.calls.has(targetId)) {
          const targetSym = this.graph.symbols.get(targetId);
          if (!targetSym) return;

          if (targetSym.file === filePath) {
            // Same-file call removed — only log if target symbol was also deleted.
            // GAP-5 fix: without this gate, every save produces noisy
            // call_removed + call_added for all internal functions even when
            // those relationships did not change.
            if (!newFileNode.symbols.has(targetId)) {
              this.history.log({ timestamp: now, type: "call_removed", source: symbolId, target: targetId, changeGroup });
            }
          } else {
            // Cross-file call — only log if target file no longer imported.
            // Removed the inverted condition: previously logged when file IS still
            // imported, which is wrong — we should log when the call was removed
            // but the import still exists (function call deleted, import kept).
            if (!newFileNode.imports.has(targetSym.file)) {
              this.history.log({ timestamp: now, type: "call_removed", source: symbolId, target: targetId, changeGroup });
            }
          }
        }
      });
    });

    this.persistence.flush(this.history);
    // Write focus file for THIS file immediately — agents may start immediately after save.
    // Full cache and context write stays debounced (2s) to avoid per-keystroke disk I/O.
    this.persistence.generateSingleFocus(this.graph, filePath);
    this.debouncedCacheWrite();
  }

  // ── ADD FILE ──────────────────────────────────────────────────────────────

  addFile(filePath: string): void {
    if (shouldIgnore(filePath)) return;

    this.sessionNewFiles.add(filePath);
    this.persistence.invalidatePatternCache();
    this.ensureFileNode(filePath);
    this.parseFile(filePath);

    const fileNode = this.graph.files.get(filePath);
    if (!fileNode) return;

    const changeGroup = makeChangeGroup();
    const now = Date.now();

    this.history.log({ timestamp: now, type: "file_created", source: filePath, fileHash: fileNode.hash, changeGroup });

    fileNode.symbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      // symbolHash = per-symbol body hash (consistent with updateFile symbol_created)
      // fileHash field reserved for file-level events (file_created, file_deleted)
      this.history.log({ timestamp: now, type: "symbol_created", source: symbolId, kind: sym?.kind, symbolHash: sha1(symbolId), layer: sym?.layer, changeGroup });
    });

    fileNode.imports.forEach((importedPath) => {
      this.history.log({ timestamp: now, type: "import_added", source: filePath, target: importedPath, changeGroup });
    });

    fileNode.symbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      if (!sym) return;
      sym.calls.forEach((targetId) => {
        const targetNode = this.graph.symbols.get(targetId);
        this.history.log({ timestamp: now, type: "call_added", source: symbolId, target: targetId, targetCallerCount: targetNode?.calledBy.size, changeGroup });
      });
    });

    this.persistence.flush(this.history);
    // Write focus file immediately — same as updateFile — agents may start right after file creation
    this.persistence.generateSingleFocus(this.graph, filePath);
    this.debouncedCacheWrite();
  }

  // ── REMOVE FILE ───────────────────────────────────────────────────────────

  removeFile(filePath: string, existingChangeGroup?: string): void {
    if (!this.graph.files.has(filePath)) return;
    const changeGroup = existingChangeGroup ?? makeChangeGroup();

    // Before removing edges, clean up importers' forward edges.
    // removeFileEdges no longer clears importedBy (Bug 1 fix) so we must
    // explicitly remove this file from each importer's imports set here.
    // Without this, deleted files remain in their importers' imports sets forever.
    const fileNodeToDelete = this.graph.files.get(filePath)!;
    fileNodeToDelete.importedBy.forEach((importerPath) => {
      const importerNode = this.graph.files.get(importerPath);
      if (importerNode) importerNode.imports.delete(filePath);
    });

    this.removeFileEdges(filePath, false, changeGroup);
    this.graph.files.delete(filePath);
    this.history.log({ timestamp: Date.now(), type: "file_deleted", source: filePath, changeGroup });
    this.persistence.flush(this.history);
    this.debouncedCacheWrite();
  }

  // ── THREE-PASS HELPERS ────────────────────────────────────────────────────

  private parseImportsAndExports(filePath: string): void {
    const src = (() => {
      try { return fs.readFileSync(filePath, "utf8"); }
      catch { return null; }
    })();
    if (src === null) return;

    const now = Date.now();
    const fileNode = this.ensureFileNode(filePath);
    fileNode.hash = sha1(src);
    fileNode.lastModifiedAt = now;
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
      fileNode.hasParseError = false;
    } catch (err) {
      fileNode.hasParseError = true;
      console.warn("[Ripple] Parse error in:", filePath);
    }
  }

  private parseCallsOnly(filePath: string): void {
    const sourceFile = this.project.getSourceFile(this.toTsMorphPath(filePath));
    if (!sourceFile) return;
    this.parseCalls(filePath, sourceFile);
  }

  private parseFile(filePath: string, content?: string): void {
    const src = content ?? (() => {
      try { return fs.readFileSync(filePath, "utf8"); }
      catch { return null; }
    })();
    if (src === null) return;

    const now = Date.now();
    const fileNode = this.ensureFileNode(filePath);
    fileNode.hash = sha1(src);
    fileNode.lastModifiedAt = now;
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
    } catch (err) {
      fileNode.hasParseError = true;
      console.warn("[Ripple] Parse error in:", filePath);
    }
  }

  // ── IMPORTS ───────────────────────────────────────────────────────────────

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

      if (!rawTarget) return;

      const absoluteTarget = this.toGraphPath(rawTarget);
      fileNode.imports.add(absoluteTarget);
      this.ensureFileNode(absoluteTarget).importedBy.add(filePath);

      if (this.isBarrelFile(absoluteTarget)) {
        this.resolveBarrelSources(absoluteTarget).forEach((src) => {
          if (fileNode.imports.has(src)) return;
          fileNode.imports.add(src);
          this.ensureFileNode(src).importedBy.add(filePath);
        });
      }
    });
  }

  // ── EXPORTS / SYMBOLS ─────────────────────────────────────────────────────

  private parseExports(filePath: string, sourceFile: SourceFile): void {
    const fileNode = this.graph.files.get(filePath)!;
    const exportedDeclarations: ReadonlyMap<string, ExportedDeclarations[]> =
      sourceFile.getExportedDeclarations();

    exportedDeclarations.forEach((declarations, exportName) => {
      declarations.forEach((decl) => {
        const kind = this.resolveSymbolKind(decl);
        if (!kind) return;

        const actualName = (decl as any).getName?.() ?? exportName;
        const symbolId = makeSymbolId(filePath, actualName);

        const existing = this.graph.symbols.get(symbolId);
        if (existing) {
          existing.lastModifiedAt = Date.now();
          return;
        }

        const layerInfo = (kind === "function" || kind === "method")
          ? this.detectSymbolLayer(decl, decl.getText())
          : { layer: "unknown" as SymbolNode["layer"], containsLayers: ["unknown"] };

        this.graph.symbols.set(symbolId, {
          id: symbolId,
          name: actualName,
          file: filePath,
          kind,
          layer: layerInfo.layer,
          containsLayers: layerInfo.containsLayers,
          calls: new Set(),
          calledBy: new Set(),
          createdAt: Date.now(),
          lastModifiedAt: Date.now(),
        });
        fileNode.symbols.add(symbolId);
      });
    });
  }

  // ── INTERNAL SYMBOL TRACKING ───────────────────────────────────────────────

  private parseInternalSymbols(filePath: string, sourceFile: SourceFile): void {
    const fileNode = this.graph.files.get(filePath)!;

    sourceFile.getFunctions().forEach((funcDecl) => {
      const name = funcDecl.getName();
      if (!name) return;

      const symbolId = makeSymbolId(filePath, name);
      if (this.graph.symbols.has(symbolId)) return;

      const layerInfo = this.detectSymbolLayer(funcDecl, funcDecl.getText());
      this.graph.symbols.set(symbolId, {
        id: symbolId,
        name,
        file: filePath,
        kind: "function",
        layer: layerInfo.layer,
        containsLayers: layerInfo.containsLayers,
        calls: new Set(),
        calledBy: new Set(),
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
      });
      fileNode.symbols.add(symbolId);
    });

    sourceFile.getVariableDeclarations().forEach((varDecl) => {
      const name = varDecl.getName();
      if (!name || name.includes("{") || name.includes("[")) return;

      const initializer = varDecl.getInitializer();
      if (!initializer) return;

      const kind = initializer.getKind();
      if (kind !== SyntaxKind.ArrowFunction && kind !== SyntaxKind.FunctionExpression) return;

      const symbolId = makeSymbolId(filePath, name);
      if (this.graph.symbols.has(symbolId)) return;

      const layerInfo = this.detectSymbolLayer(varDecl, varDecl.getText());
      this.graph.symbols.set(symbolId, {
        id: symbolId,
        name,
        file: filePath,
        kind: "function",
        layer: layerInfo.layer,
        containsLayers: layerInfo.containsLayers,
        calls: new Set(),
        calledBy: new Set(),
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
      });
      fileNode.symbols.add(symbolId);
    });
  }

  // ── SYMBOL LAYER DETECTION ────────────────────────────────────────────────
  //
  // Classifies a function as ui/logic/handler/state/effect/data/mixed/unknown.
  // Pure AST analysis — no AI required.
  // Enables agents to target only the requested layer in mixed-code files.

  private detectSymbolLayer(
    funcNode: Node,
    funcText: string
  ): { layer: SymbolNode["layer"]; containsLayers: string[] } {
    const layers: string[] = [];

    const callNames = funcNode
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .map((c) => c.getExpression().getText().split(".").pop() ?? "")
      .filter(Boolean);

    // UI — contains JSX
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
    if (hasJsx) layers.push("ui");

    // STATE
    if (callNames.some((n) =>
      ["useState","useReducer","useRef","useContext","useAtom","useSignal","createSignal"].includes(n)
    )) layers.push("state");

    // EFFECT
    if (callNames.some((n) =>
      ["useEffect","useLayoutEffect","useInsertionEffect","useMemo","useCallback"].includes(n)
    )) layers.push("effect");

    // DATA — fetch, axios, React Query, tRPC, Prisma/ORM, Supabase, Next.js data methods
    const dataPatterns = ["fetch","axios","useQuery","useMutation","useInfiniteQuery","trpc","supabase","prisma",
      "getServerSideProps","getStaticProps","findFirst","findMany","findUnique","create","update","upsert","deleteMany"];
    if (callNames.some((n) => dataPatterns.some((p) => n.toLowerCase().includes(p.toLowerCase())))) layers.push("data");

    // HANDLER
    const funcName = (funcNode as any).getName?.() ?? "";
    if (/^(handle[A-Z]|on[A-Z])/.test(funcName) || /^(handle[A-Z]|on[A-Z])/.test(funcText.slice(0, 80))) {
      layers.push("handler");
    }

    // LOGIC — pure computation
    if (layers.length === 0) {
      const hasConditionals =
        funcNode.getDescendantsOfKind(SyntaxKind.IfStatement).length > 0 ||
        funcNode.getDescendantsOfKind(SyntaxKind.SwitchStatement).length > 0 ||
        funcNode.getDescendantsOfKind(SyntaxKind.ConditionalExpression).length > 0;
      if (hasConditionals || funcText.length > 50) layers.push("logic");
    }

    if (layers.length === 0) layers.push("unknown");

    const layer: SymbolNode["layer"] =
      layers.length > 1 ? "mixed" : (layers[0] as SymbolNode["layer"]);

    return { layer, containsLayers: layers };
  }

  // ── SYMBOL KIND RESOLVER ──────────────────────────────────────────────────

  private resolveSymbolKind(decl: Node): SymbolNode["kind"] | null {
    switch (decl.getKind()) {
      case SyntaxKind.FunctionDeclaration:
      case SyntaxKind.FunctionExpression:
      case SyntaxKind.ArrowFunction:
        return "function";
      case SyntaxKind.ClassDeclaration:
      case SyntaxKind.ClassExpression:
        return "class";
      case SyntaxKind.MethodDeclaration:
        return "method";
      case SyntaxKind.VariableDeclaration:
      case SyntaxKind.VariableStatement:
        return "variable";
      default:
        return null;
    }
  }

  // ── FUNCTION CALLS ────────────────────────────────────────────────────────

  private parseCalls(filePath: string, sourceFile: SourceFile): void {
    const fileNode = this.graph.files.get(filePath)!;

    const importedSymbolNames = new Map<string, string>();

    fileNode.imports.forEach((importedPath) => {
      this.graph.files.get(importedPath)?.symbols.forEach((symbolId) => {
        const sym = this.graph.symbols.get(symbolId);
        if (sym) importedSymbolNames.set(sym.name, symbolId);
      });
    });

    fileNode.symbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      if (sym) importedSymbolNames.set(sym.name, symbolId);
    });

    if (importedSymbolNames.size === 0) return;

    const callerSymbolId = this.findComponentSymbol(filePath);

    sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((callExpr) => {
      const calledName = this.extractCalledName(callExpr.getExpression().getText());
      if (!calledName) return;
      const targetSymbolId = importedSymbolNames.get(calledName);
      if (!targetSymbolId) return;
      const enclosing = this.findEnclosingSymbol(callExpr, filePath);
      if (!enclosing) return;
      this.addCallEdge(enclosing, targetSymbolId);
    });

    sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).forEach((el) => {
      const name = el.getTagNameNode().getText();
      const targetSymbolId = importedSymbolNames.get(name);
      if (!targetSymbolId || !callerSymbolId) return;
      this.addCallEdge(callerSymbolId, targetSymbolId);
    });

    sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).forEach((el) => {
      const name = el.getTagNameNode().getText();
      const targetSymbolId = importedSymbolNames.get(name);
      if (!targetSymbolId || !callerSymbolId) return;
      this.addCallEdge(callerSymbolId, targetSymbolId);
    });
  }

  private addCallEdge(callerSymbolId: string, targetSymbolId: string): void {
    const callerNode = this.graph.symbols.get(callerSymbolId);
    const targetNode = this.graph.symbols.get(targetSymbolId);
    if (!callerNode || !targetNode) return;
    if (callerSymbolId === targetSymbolId) return;
    if (callerNode.calls.has(targetSymbolId)) return;
    callerNode.calls.add(targetSymbolId);
    targetNode.calledBy.add(callerSymbolId);
  }

  private findComponentSymbol(filePath: string): string | null {
    const fileNode = this.graph.files.get(filePath);
    if (!fileNode) return null;
    for (const symbolId of fileNode.symbols) {
      const sym = this.graph.symbols.get(symbolId);
      if (sym && (sym.kind === "function" || sym.kind === "variable")) return symbolId;
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
          if (this.graph.symbols.has(symbolId)) return symbolId;
        }
        if (kind === SyntaxKind.ArrowFunction) {
          const parent = current.getParent();
          if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
            const varName = (parent as any).getNameNode?.()?.getText();
            if (varName) {
              const symbolId = makeSymbolId(filePath, varName);
              if (this.graph.symbols.has(symbolId)) return symbolId;
            }
          }
        }
      }
      current = current.getParent();
    }
    return null;
  }

  // ── EDGE REMOVAL ──────────────────────────────────────────────────────────

  private removeFileEdges(
    filePath: string,
    silent: boolean,
    changeGroup?: string
  ): void {
    const fileNode = this.graph.files.get(filePath);
    if (!fileNode) return;
    const now = Date.now();

    fileNode.imports.forEach((importedPath) => {
      this.graph.files.get(importedPath)?.importedBy.delete(filePath);
      if (!silent) {
        this.history.log({ timestamp: now, type: "import_removed", source: filePath, target: importedPath, changeGroup });
      }
    });
    fileNode.imports.clear();
    // IMPORTANT — DO NOT clear fileNode.importedBy here.
    //
    // What importedBy means: it records WHICH OTHER FILES import THIS file.
    // Those other files have not changed — they still import this file.
    //
    // What this loop above already did: for each file THIS file imports
    // (e.g. utils.ts), it removed THIS file from THAT file's importedBy set.
    // That is the correct reverse-edge cleanup for the forward direction.
    //
    // Clearing importedBy here would mean: every time ANY file is saved and
    // re-parsed, all other files that import it would instantly lose their
    // forward edges to it — until THEY are also re-saved. This would cause
    // cascading ghost "0 importers" entries across the entire graph on every
    // keystroke. It is the exact opposite of what we want.
    //
    // For true file DELETION, removeFile() handles importedBy cleanup before
    // calling this method, then deletes the node entirely.

    fileNode.symbols.forEach((symbolId) => {
      const sym = this.graph.symbols.get(symbolId);
      if (!sym) return;

      sym.calls.forEach((targetId) => {
        this.graph.symbols.get(targetId)?.calledBy.delete(symbolId);
        if (!silent) {
          this.history.log({ timestamp: now, type: "call_removed", source: symbolId, target: targetId, changeGroup });
        }
      });

      // Also log from caller's perspective — Phase 3 needs full picture
      sym.calledBy.forEach((callerId) => {
        const callerNode = this.graph.symbols.get(callerId);
        if (!callerNode) return;
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
    return base === "index.ts" || base === "index.tsx" || base === "index.js" || base === "index.jsx";
  }

  private resolveBarrelSources(barrelPath: string): string[] {
    const sources: string[] = [];
    const sourceFile = this.project.getSourceFile(this.toTsMorphPath(barrelPath));
    if (!sourceFile) return sources;

    sourceFile.getExportDeclarations().forEach((exportDecl) => {
      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      if (!moduleSpecifier) return;
      const rawTarget = normalizeImportPath(moduleSpecifier, barrelPath, this.workspaceRoot);
      if (!rawTarget) return;
      const absoluteTarget = this.toGraphPath(rawTarget);
      if (this.isBarrelFile(absoluteTarget)) return;
      sources.push(absoluteTarget);
    });

    return sources;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // IMPACT QUERY FUNCTIONS — O(1) via reverse edges
  // ────────────────────────────────────────────────────────────────────────────

  downstreamFiles(filePath: string): string[] {
    return Array.from(this.graph.files.get(filePath)?.importedBy ?? []);
  }

  upstreamFiles(filePath: string): string[] {
    return Array.from(this.graph.files.get(filePath)?.imports ?? []);
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
    const sourceFile = this.project.getSourceFile(this.toTsMorphPath(filePath));
    if (!sourceFile) return null;

    let offset: number;
    try {
      offset = sourceFile.compilerNode.getPositionOfLineAndCharacter(line, character);
    } catch {
      return null;
    }

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
          if (this.graph.symbols.has(symbolId)) return symbolId;
        }
      }

      if (kind === SyntaxKind.ArrowFunction) {
        const parent = current.getParent();
        if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
          const nameNode = (parent as any).getNameNode?.();
          const name: string | undefined = nameNode?.getText();
          if (name) {
            const symbolId = makeSymbolId(filePath, name);
            if (this.graph.symbols.has(symbolId)) return symbolId;
          }
        }
      }

      current = current.getParent();
    }

    return null;
  }

  getSymbolDeclarationLine(symbolId: string): number | null {
    const sym = this.graph.symbols.get(symbolId);
    if (!sym) return null;

    const sourceFile = this.project.getSourceFile(this.toTsMorphPath(sym.file));
    if (!sourceFile) return null;

    try {
      const funcDecl = sourceFile.getFunctions().find((f) => f.getName() === sym.name);
      if (funcDecl) return Math.max(0, funcDecl.getStartLineNumber() - 1);

      const varDecl = sourceFile.getVariableDeclarations().find((v) => v.getName() === sym.name);
      if (varDecl) return Math.max(0, varDecl.getStartLineNumber() - 1);
    } catch {
      return null;
    }

    return null;
  }
}
