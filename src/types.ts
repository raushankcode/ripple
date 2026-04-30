/**
 * types.ts — Ripple
 * Core data structures for the live system graph and architectural history.
 *
 * Three layers:
 *
 *  Graph layer   — FileNode, SymbolNode, SystemGraph
 *    The in-memory dependency graph. Rebuilt on every VS Code session.
 *    Never persisted directly — only the ChangeLog is persisted.
 *
 *  History layer — ChangeEvent, ChangeEventType, HistoryLog
 *    The append-only architectural history. Persisted to .ripple/history.json.
 *    Accumulates from the moment Ripple is installed. Never overwritten.
 *
 * ChangeEvent fields designed for Phase 3:
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
// GRAPH LAYER
// ────────────────────────────────────────────────────────────────────────────

export interface FileNode {
  path: string;

  // Forward edges — files this file imports
  imports: Set<string>;

  // Reverse edges — files that import this file.
  // Built atomically with forward edges — never out of sync.
  // NEVER cleared in removeFileEdges during update — only cleared when
  // the file is truly deleted (removeFile handles this).
  importedBy: Set<string>;

  // Symbol IDs defined in this file (format: filePath::symbolName)
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

  // Absolute OS-native path to the file containing this symbol
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

  // Forward call edges — symbols this symbol calls
  calls: Set<string>;

  // Reverse call edges — symbols that call this symbol.
  // Built atomically with forward edges — never out of sync.
  calledBy: Set<string>;

  createdAt: number;
  lastModifiedAt: number;
}

export class SystemGraph {
  // Keyed by absolute OS-native file path
  files: Map<string, FileNode> = new Map();

  // Keyed by symbolId: filePath::symbolName
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

  // ── Phase 3 fields ───────────────────────────────────────────────────────

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

  // SHA1 hash of the WHOLE FILE at time of event.
  // Set on file_created and file_deleted events only.
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

  // Git commit ID — populated in Phase 3 git integration.
  commitId?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// HISTORY LOG
// ────────────────────────────────────────────────────────────────────────────

export class HistoryLog {
  events: ChangeEvent[] = [];

  log(event: ChangeEvent): void {
    this.events.push(event);

    // Trim in-memory array to prevent unbounded memory growth on long sessions.
    // Threshold matches flush() MAX_EVENTS exactly (10000) to prevent silent
    // event loss on VS Code restart. Previously this was 11000 vs flush() 10000
    // which caused events 10001-11000 to exist in memory but never reach disk.
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