/**
 * types.ts — Ripple
 * Core data structures for the live system graph and architectural history.
 *
 * Main layers:
 *
 *  Graph layer   — FileNode, SymbolNode, SystemGraph
 *    The in-memory dependency and call graph. It can be restored from
 *    .ripple/.cache/graph.cache.json, then repaired from disk when stale.
 *
 *  History layer — ChangeEvent, ChangeEventType, HistoryLog
 *    Bounded architectural history persisted to .ripple/history.json.
 *    The first baseline_snapshot is preserved when old events are trimmed.
 *
 * ChangeEvent metadata:
 *  changeGroup       — links all events from the same save operation together
 *  symbol_modified   — fires when a function's content changes between saves
 *  kind              — function | class | method | variable
 *  symbolHash        — SHA1 hash of symbol body text at moment of event
 *  previousHash      — SHA1 hash before modification (symbol_modified only)
 *  layer             — semantic layer for history queries by layer type
 *  targetCallerCount — blast radius at moment call edge was added
 *  metadata          — human-readable string for baseline_snapshot events
 */

// ────────────────────────────────────────────────────────────────────────────
// ADAPTER LAYER
// ────────────────────────────────────────────────────────────────────────────

export type RippleAdapterCapability =
  | "files"
  | "dependencies"
  | "reverse-dependencies"
  | "symbols"
  | "call-edges"
  | "tests"
  | "configs";

export type RippleAdapterLanguage =
  | "javascript"
  | "typescript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "csharp"
  | "php"
  | "ruby"
  | "generic";

export interface RippleAdapterCapabilities {
  language: RippleAdapterLanguage;
  displayName: string;
  extensions: string[];
  capabilities: RippleAdapterCapability[];
}

export interface RippleAdapterDependency {
  sourceFile: string;
  targetFile?: string;
  specifier: string;
  kind: "import" | "require" | "export" | "package" | "module" | "unknown";
  resolved: boolean;
}

export interface RippleAdapterSymbol {
  file: string;
  name: string;
  kind: SymbolNode["kind"] | "interface" | "type" | "enum" | "module" | "unknown";
  exported?: boolean;
  startLine?: number;
  endLine?: number;
}

export interface RippleAdapterCallEdge {
  caller: string;
  callee: string;
  confidence: "exact" | "probable" | "heuristic";
}

export interface RippleAdapterTestHint {
  testFile: string;
  targetFile?: string;
  kind: "direct" | "convention" | "package" | "unknown";
}

export interface RippleAdapterScanResult {
  files: string[];
  dependencies: RippleAdapterDependency[];
  symbols: RippleAdapterSymbol[];
  callEdges: RippleAdapterCallEdge[];
  testHints: RippleAdapterTestHint[];
  warnings: string[];
}

export interface RippleLanguageAdapter {
  id: string;
  capabilities: RippleAdapterCapabilities;
  detect(workspaceRoot: string): Promise<boolean> | boolean;
  scan(workspaceRoot: string): Promise<RippleAdapterScanResult> | RippleAdapterScanResult;
}

// ────────────────────────────────────────────────────────────────────────────
// GRAPH LAYER
// ────────────────────────────────────────────────────────────────────────────

export interface FileNode {
  path: string;

  // Forward edges: files this file imports.
  imports: Set<string>;

  // Reverse edges: files that import this file.
  // Preserved during incremental reparses so importer relationships survive
  // target-file saves; true deletion cleanup happens in removeFile().
  importedBy: Set<string>;

  // Symbol IDs defined in this file, formatted as filePath::symbolName.
  symbols: Set<string>;

  // SHA1 of file content — used for hash-gated incremental updates.
  // updateFile() exits early without re-parsing if hash unchanged.
  hash: string;

  createdAt: number;
  lastModifiedAt: number;

  // Total times this file has been saved since Ripple was installed.
  // High changeCount = high churn = high modification risk.
  changeCount: number;

  // Set to true when ts-morph could not fully parse this file.
  // Connections shown may be incomplete until the file is fixed and saved.
  hasParseError?: boolean;
}

export interface SymbolNode {
  // Unique identifier: filePath::symbolName
  id: string;

  name: string;

  // Absolute OS-native path to the file containing this symbol.
  file: string;

  kind: "function" | "class" | "method" | "variable";

  // Semantic layer — what kind of code this symbol contains.
  // Detected automatically from the AST using heuristics.
  // Enables AI agents to target the correct layer when the user says
  // "change only the logic" or "update only the UI" without touching
  // the rest of a mixed-code file.
  layer?: "ui" | "logic" | "handler" | "state" | "effect" | "data" | "mixed" | "unknown";

  // All layers found inside this symbol.
  // A "mixed" symbol may contain ["ui", "logic", "handler"].
  containsLayers?: string[];

  // SHA1 of the symbol body/declaration text at the last successful parse.
  // Persisted in graph.cache.json so cross-session edits still produce
  // accurate symbol_modified history events.
  symbolHash?: string;

  // Forward call edges: symbols this symbol calls.
  calls: Set<string>;

  // Reverse call edges: symbols that call this symbol.
  calledBy: Set<string>;

  createdAt: number;
  lastModifiedAt: number;
}

export class SystemGraph {
  // Keyed by absolute OS-native file path.
  files: Map<string, FileNode> = new Map();

  // Keyed by symbolId, formatted as filePath::symbolName.
  symbols: Map<string, SymbolNode> = new Map();
}

// ────────────────────────────────────────────────────────────────────────────
// HISTORY LAYER
// ────────────────────────────────────────────────────────────────────────────

export type ChangeEventType =
  | "baseline_snapshot"  // fired once on first install, never again
  | "file_created"       // new file detected after installation
  | "file_deleted"       // file removed from project
  | "symbol_created"     // new function/class/variable appeared
  | "symbol_modified"    // existing symbol content changed between saves
  | "symbol_deleted"     // symbol removed from file
  | "import_added"       // file started importing another file
  | "import_removed"     // import was deleted
  | "call_added"         // function started calling another function
  | "call_removed";      // call relationship was removed

export interface ChangeEvent {
  // Unix timestamp in milliseconds
  timestamp: number;

  type: ChangeEventType;

  // Primary entity — file path for file events, symbolId for symbol events
  source: string;

  // Secondary entity — present for relationship events (import/call)
  target?: string;

  // ── Event metadata ────────────────────────────────────────────────────────

  // Links all events from the same save operation together.
  // Format: "save_<timestamp>_<hex>" — reconstructible to ISO date.
  changeGroup?: string;

  // Symbol kind — function | class | method | variable
  kind?: string;

  // Semantic layer of the symbol — populated on symbol_created and symbol_modified.
  // Enables history queries like "which UI layer symbols changed this week?"
  layer?: "ui" | "logic" | "handler" | "state" | "effect" | "data" | "mixed" | "unknown";

  // SHA1 hash of the SYMBOL BODY TEXT at time of event.
  // Set on symbol_created and symbol_modified events only.
  // Use this for comparing symbol content across saves.
  symbolHash?: string;

  // SHA1 hash of the whole file at time of event.
  // Set on file_created events when content is available.
  fileHash?: string;

  // SHA1 hash of symbol body text BEFORE modification.
  // Present only on symbol_modified events.
  previousHash?: string;

  // Blast radius (calledBy count) at the exact moment a call edge was added.
  // Lets you query: "when did this function first become high-risk?"
  targetCallerCount?: number;

  // Human-readable metadata for baseline_snapshot events.
  // Format: "files:<n>|symbols:<n>"
  metadata?: string;

  // Reserved for future git integration.
  commitId?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// HISTORY LOG
// ────────────────────────────────────────────────────────────────────────────

export class HistoryLog {
  events: ChangeEvent[] = [];

  log(event: ChangeEvent): void {
    this.events.push(event);

    // Trim in-memory history to match the persisted MAX_EVENTS limit while
    // preserving the baseline event when it exists.
    if (this.events.length > 10000) {
      const baseline = this.events.find(
        (e) => e.type === "baseline_snapshot"
      );
      const recent = this.events
        .filter((e) => e.type !== "baseline_snapshot")
        .slice(-9999);
      this.events = baseline ? [baseline, ...recent] : recent;
    }
  }

  // Returns true if a baseline_snapshot event exists.
  // Used to ensure baseline fires exactly once (on first install).
  hasBaseline(): boolean {
    return this.events.some((e) => e.type === "baseline_snapshot");
  }

  // Returns all events that share a changeGroup (same save operation).
  getGroup(changeGroup: string): ChangeEvent[] {
    return this.events.filter((e) => e.changeGroup === changeGroup);
  }

  // Returns all events where source or target matches the given path/symbolId.
  getHistory(source: string): ChangeEvent[] {
    return this.events.filter(
      (e) => e.source === source || e.target === source
    );
  }
}

