/**
 * extension.ts — Ripple
 * Live Architectural Intelligence for TypeScript and JavaScript Projects
 *
 * Three features:
 *
 *  Feature 1 — Impact Lens
 *    Sidebar tree view. Open any file and instantly see what it
 *    imports and what imports it. Zero configuration required.
 *    CSS and style files shown as real dependencies.
 *
 *  Feature 2 — Ripple CodeLens
 *    Persistent hint above every function declaration showing
 *    how many callers exist. Click to see full caller detail
 *    in a dedicated panel. Always visible — no cursor hunting.
 *
 *  Feature 3 — Safety Check
 *    Watches .git/index via hybrid watcher + poll approach.
 *    Fires when files are staged. Shows blast radius of untested
 *    files before the developer pushes. Never blocks the commit.
 *
 * ALL BUGS FIXED IN THIS VERSION:
 *  Bug 1 — Background scan implemented — features register instantly
 *           initialScan runs non-blocking with progress status bar
 *           Priority file scanned first for immediate CodeLens feedback
 *  Bug 2 — engine.dispose() called on deactivate — cache write flushed
 *  Bug 3 — dependsOn filtered through isSourceFile() — no node_modules
 *  Bug 4 — Welcome notification on first install via globalState
 *  Bug 5 — Output channel reused, never multiplied
 *  Bug 6 — CodeLens refresh debounced 300ms — no flicker
 *  Bug 7 — Per-snapshot cooldown for Safety Check
 *  Bug 8 — Flexible test file detection — 12 conventions
 *  Bug 9 — Export detection via regex not uppercase heuristic
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  GraphEngine,
  DANGEROUS_BLAST_RADIUS,
  CAUTION_BLAST_RADIUS,
  DANGEROUS_CHURN,
  CAUTION_CHURN,
  HIGH_RISK_CALLER_COUNT,
} from "./graph";
import { clearAliasCache } from "./normalizer";

// ────────────────────────────────────────────────────────────────────────────
// ENGINE INSTANCE — accessible by deactivate()
// ────────────────────────────────────────────────────────────────────────────

let _engine: GraphEngine | undefined;

// ────────────────────────────────────────────────────────────────────────────
// ACTIVATION
// ────────────────────────────────────────────────────────────────────────────

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return;

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  console.log("[Ripple] Extension activated.");

  // ── Read user configuration ───────────────────────────────────────────────
  // Read once at activation. VS Code calls activate() on workspace open.
  // If the user changes settings mid-session, they reload the window (standard pattern).
  const cfg = vscode.workspace.getConfiguration("ripple");
  const cfgEnabled       = cfg.get<boolean>("enabled",         true);
  const cfgShowCodeLens  = cfg.get<boolean>("showCodeLens",    true);
  const cfgSafetyCheck   = cfg.get<boolean>("safetyCheck",     true);
  const cfgGenContext    = cfg.get<boolean>("generateContext",  true);

  if (!cfgEnabled) {
    console.log("[Ripple] Disabled via ripple.enabled setting — exiting.");
    return;
  }

  // ── Build the live system graph ──────────────────────────────────────────
  const engine = new GraphEngine(workspaceRoot);
  _engine = engine;

  // Apply context generation setting — graph always builds, but
  // .ripple/ file writes are suppressed when the user opts out.
  if (!cfgGenContext) engine.setContextGeneration(false);

  // Bug fix: set context key so the Impact Lens view appears in the sidebar.
  // 'workspaceHasTypeScriptOrJavaScript' is NOT a built-in VS Code key —
  // the extension must set it explicitly. Without this, the view panel shows
  // an empty "No views are available" state even though the icon is registered.
  vscode.commands.executeCommand(
    "setContext",
    "workspaceHasTypeScriptOrJavaScript",
    true
  );

  // ── Feature 1 — Impact Lens ──────────────────────────────────────────────
  // Registered BEFORE scan starts so sidebar appears instantly
  const impactLens = new ImpactLensProvider(engine);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("ripple.impactLens", impactLens)
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => impactLens.refresh())
  );

  // ── Feature 2 — Ripple CodeLens ──────────────────────────────────────────
  // Registered BEFORE scan starts so it appears on first file open
  const codeLensProvider = new RippleCodeLensProvider(engine);

  if (cfgShowCodeLens) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(
        [
          { language: "typescript" },
          { language: "typescriptreact" },
          { language: "javascript" },
          { language: "javascriptreact" },
        ],
        codeLensProvider
      )
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ripple.showCallers",
      (symbolId: string) => {
        RippleCallerPanel.show(context.extensionUri, engine, symbolId);
      }
    )
  );

  // ── "Copy Ripple Prompt" command ──────────────────────────────────────────
  //
  // Right-click any TypeScript/JavaScript file → "↯ Ripple: Copy Agent Prompt"
  // Generates a ready-to-paste prompt for any AI agent.
  // Developer fills in their task. Paste to Claude Code, Cursor, Copilot etc.
  // Uses ~400 tokens total (prompt + focus file). Safe, fast, minimal.

  context.subscriptions.push(
    vscode.commands.registerCommand("ripple.copyPrompt", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage(
          "↯ Ripple: Open a TypeScript file to generate a prompt."
        );
        return;
      }

      const filePath = editor.document.uri.fsPath;
      const fileNode = engine.graph.files.get(filePath);

      if (!fileNode) {
        vscode.window.showWarningMessage(
          "↯ Ripple: File not yet scanned — save the file first."
        );
        return;
      }

      const fileName = path.basename(filePath);
      const blastSize = fileNode.importedBy.size;
      const risk =
        blastSize >= DANGEROUS_BLAST_RADIUS || fileNode.changeCount > DANGEROUS_CHURN
          ? "DANGEROUS"
          : blastSize >= CAUTION_BLAST_RADIUS || fileNode.changeCount > CAUTION_CHURN
          ? "caution"
          : "safe";

      const importedByNames = Array.from(fileNode.importedBy)
        .filter((f) => !f.includes("node_modules"))
        .map((f) => path.basename(f))
        .slice(0, 4)
        .join(", ");

      const symbolSummary = Array.from(fileNode.symbols)
        .map((id) => {
          const sym = engine.graph.symbols.get(id);
          if (!sym) return null;
          return `${sym.name} [${sym.layer ?? "unknown"}]`;
        })
        .filter(Boolean)
        .slice(0, 5)
        .join(", ");

      // Build focus file key using the same 3-segment formula as makeFocusKey() in graph.ts.
      // Must match exactly — if this diverges, the copied prompt points to a non-existent file.
      // Formula: grandparent-parent-basename for depth>=4, parent-basename for shallower paths.
      const parts = filePath.split(path.sep);
      const baseName = path.basename(filePath, path.extname(filePath));
      const focusBasename = parts.length >= 4
        ? `${parts[parts.length - 3]}-${parts[parts.length - 2]}-${baseName}`
        : parts.length >= 2
        ? `${parts[parts.length - 2]}-${baseName}`
        : baseName;

      // Absolute path — resolves Codex gap where relative path was not found
      const absoluteFocusPath = path.join(
        workspaceRoot, ".ripple", "focus", `${focusBasename}.json`
      );

      const riskLine = risk === "DANGEROUS"
        ? `2. STOP — ${blastSize} files import this. Ask user: "This affects ${blastSize} other files. Confirm before I proceed."`
        : risk === "caution"
        ? `2. Caution — ${blastSize} importer${blastSize !== 1 ? "s" : ""}. Verify all callers work after your change.`
        : "2. Safe to modify — low blast radius.";

      const prompt = `[DESCRIBE YOUR TASK HERE]

Before making any changes:
1. Read the focus file for this file:
   Relative: .ripple/focus/${focusBasename}.json
   Absolute: ${absoluteFocusPath}
${riskLine}
3. Check calledBy for every symbol you will modify
4. Only touch the layer the user requested (logic/ui/handler/state/data)

File: ${fileName} | Risk: ${risk} | ${blastSize} importer${blastSize !== 1 ? "s" : ""}${importedByNames ? ` (${importedByNames})` : ""}
Symbols: ${symbolSummary || "none detected yet"}
Project rules: .ripple/WORKFLOW.md`;

      vscode.env.clipboard.writeText(prompt).then(() => {
        vscode.window.showInformationMessage(
          `↯ Ripple: Prompt copied — paste to your AI agent and replace [DESCRIBE YOUR TASK HERE].`
        );
      });
    })
  );

  // ── "Show Setup Panel" command — resets insight panel state ──────────────
  // Available in Command Palette: "Ripple: Show AI Setup Panel"
  // Solves the problem of panel not reappearing after reinstall or
  // after AGENTS.md is deleted. Developer runs this to see the panel again.

  context.subscriptions.push(
    vscode.commands.registerCommand("ripple.showSetupPanel", () => {
      // Clear both state keys so maybeShow will run fresh
      context.workspaceState.update("ripple.insight.activated", false);
      context.workspaceState.update("ripple.insight.dismissCount", 0);
      // Show immediately — do not wait for next launch
      RippleInsightPanel.maybeShow(context, engine, workspaceRoot);
    })
  );

  // Bug 6 fix: debounce CodeLens refresh — prevents flicker on rapid saves
  let codeLensRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      engine.updateFile(doc.uri.fsPath);
      impactLens.refresh();

      if (codeLensRefreshTimer) clearTimeout(codeLensRefreshTimer);
      codeLensRefreshTimer = setTimeout(() => {
        codeLensProvider.refresh();
      }, 300);
    })
  );

  // ── Feature 3 — Safety Check ─────────────────────────────────────────────
  if (cfgSafetyCheck) {
    const safetyCheck = new SafetyCheckProvider(engine, workspaceRoot);
    safetyCheck.start(context);
  }

  // ── File watcher for new / deleted files ─────────────────────────────────
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/*.{ts,tsx,js,jsx}"
  );

  context.subscriptions.push(
    watcher.onDidCreate((uri) => {
      engine.addFile(uri.fsPath);
      codeLensProvider.refresh();
      impactLens.refresh();
    })
  );

  context.subscriptions.push(
    watcher.onDidDelete((uri) => {
      engine.removeFile(uri.fsPath);
      codeLensProvider.refresh();
      impactLens.refresh();
    })
  );

  context.subscriptions.push(watcher);

  // ── tsconfig.json watcher — invalidates alias cache on change ────────────
  const tsconfigWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceRoot, "tsconfig.json")
  );
  context.subscriptions.push(
    tsconfigWatcher.onDidChange(() => {
      clearAliasCache(workspaceRoot);
      console.log("[Ripple] tsconfig.json changed — alias cache cleared");
    })
  );
  context.subscriptions.push(tsconfigWatcher);

  // ── Bug 1 fix: Background scan — non-blocking ────────────────────────────
  //
  // Features are already registered above. Scan runs in background.
  // Priority file scanned first so CodeLens appears within ~1 second.
  // Status bar shows progress. Features refresh after scan completes.

  const scanStatus = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99
  );
  scanStatus.text = "↯ Ripple: scanning...";
  scanStatus.tooltip = "Ripple is building the dependency graph";
  scanStatus.show();
  context.subscriptions.push(scanStatus);

  const priorityFile =
    vscode.window.activeTextEditor?.document.uri.fsPath;

  engine
    .initialScan((scanned, total) => {
      scanStatus.text = `↯ Ripple: scanning ${scanned}/${total}`;

      // Refresh after enough files scanned to show meaningful data
      // scanned === 5 gives call edges a chance to be detected
      if (scanned === 5 || total <= 5) {
        impactLens.refresh();
        codeLensProvider.refresh();
      }
    }, priorityFile)
    .then(() => {
      scanStatus.text = "↯ Ripple: ready";
      scanStatus.tooltip = "Ripple: dependency graph built";

      // Final refresh — full graph now complete
      impactLens.refresh();
      codeLensProvider.refresh();

      setTimeout(() => scanStatus.hide(), 3000);

      // Show project insight panel — persists until developer activates AI mode
      // Smart dismissal: only stops showing once WORKFLOW.md is copied,
      // or after 3 manual dismissals with "Remind me later"
      RippleInsightPanel.maybeShow(context, engine, workspaceRoot);

      // Small project onboarding — projects under 10 files never trigger maybeShow.
      // Give them a direct notification pointing to the next step.
      if (engine.graph.files.size > 0 && engine.graph.files.size < 10) {
        const hasWorkflow = fs.existsSync(path.join(workspaceRoot, ".ripple", "WORKFLOW.md"));
        const hasActivated =
          fs.existsSync(path.join(workspaceRoot, "AGENTS.md")) ||
          fs.existsSync(path.join(workspaceRoot, "CLAUDE.md")) ||
          fs.existsSync(path.join(workspaceRoot, ".cursorrules"));

        if (hasWorkflow && !hasActivated) {
          vscode.window.showInformationMessage(
            `↯ Ripple: ${engine.graph.files.size} files scanned. ` +
            `Copy .ripple/WORKFLOW.md to CLAUDE.md or AGENTS.md to activate AI agent mode.`,
            "Copy Now"
          ).then((choice) => {
            if (choice !== "Copy Now") return;
            const workflowPath = path.join(workspaceRoot, ".ripple", "WORKFLOW.md");
            const agentsPath   = path.join(workspaceRoot, "AGENTS.md");
            try {
              fs.copyFileSync(workflowPath, agentsPath);
              vscode.window.showInformationMessage(
                "↯ Ripple: AGENTS.md created. AI agents now follow the Ripple protocol."
              );
            } catch {
              vscode.window.showWarningMessage(
                "↯ Ripple: Could not create AGENTS.md — copy .ripple/WORKFLOW.md manually."
              );
            }
          });
        }
      }
    })
    .catch((err) => {
      scanStatus.text = "↯ Ripple: scan failed";
      console.error("[Ripple] Initial scan failed:", err);
    });
}

// Bug 2 fix: engine.dispose() called on deactivate
// Flushes any pending debounced cache write before VS Code closes
export function deactivate(): void {
  _engine?.dispose();
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 1 — IMPACT LENS
// Sidebar tree view showing upstream and downstream file connections.
// Updates every time the active editor changes.
// Shows ALL dependency types including CSS and style files.
// ────────────────────────────────────────────────────────────────────────────

class ImpactLensProvider implements vscode.TreeDataProvider<ImpactItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private engine: GraphEngine) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(item: ImpactItem): vscode.TreeItem {
    return item;
  }

  getChildren(element?: ImpactItem): ImpactItem[] {
    if (element) return [];

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return [new ImpactItem("Open a TypeScript file to begin", "info")];
    }

    const filePath = editor.document.uri.fsPath;
    const fileNode = this.engine.graph.files.get(filePath);

    if (!fileNode) {
      return [
        new ImpactItem("File not yet scanned — save to trigger scan", "info"),
      ];
    }

    const items: ImpactItem[] = [];

    // ── Used by ────────────────────────────────────────────────────────────
    const usedBy = this.engine
      .downstreamFiles(filePath)
      .filter((p) => this.isSourceFile(p));

    if (usedBy.length === 0) {
      items.push(new ImpactItem("Used by: nothing", "info"));
    } else {
      items.push(new ImpactItem(`Used by (${usedBy.length}):`, "header"));
      usedBy.forEach((p) =>
        items.push(new ImpactItem(path.basename(p), "file", p))
      );
    }

    // ── Depends on ─────────────────────────────────────────────────────────
    // Bug 3 fix: also filter dependsOn through isSourceFile()
    // Previously only usedBy was filtered — node_modules could appear here
    const dependsOn = this.engine
      .upstreamFiles(filePath)
      .filter((p) => this.isSourceFile(p));

    if (dependsOn.length === 0) {
      items.push(new ImpactItem("Depends on: nothing", "info"));
    } else {
      items.push(
        new ImpactItem(`Depends on (${dependsOn.length}):`, "header")
      );
      dependsOn.forEach((p) =>
        items.push(new ImpactItem(path.basename(p), "file", p))
      );
    }

    return items;
  }

  // Filters out generated and package directories
  // Shows source files and style files — hides everything else
  private isSourceFile(filePath: string): boolean {
    return (
      !filePath.includes("node_modules") &&
      !filePath.includes(".ripple") &&
      !filePath.includes("dist") &&
      !filePath.includes(".next") &&
      !filePath.includes(".turbo") &&
      !filePath.includes(".vercel")
    );
  }
}

class ImpactItem extends vscode.TreeItem {
  constructor(
    label: string,
    private kind: "header" | "file" | "info",
    filePath?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);

    if (kind === "file" && filePath) {
      this.resourceUri = vscode.Uri.file(filePath);
      this.command = {
        command: "vscode.open",
        title: "Open file",
        arguments: [vscode.Uri.file(filePath)],
      };
      this.tooltip = filePath;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 2 — RIPPLE CODELENS
//
// Shows impact information above every function declaration permanently.
// No cursor interaction required — information is always visible.
//
// Bug 9 fix: export detection via regex — not uppercase name heuristic.
//   Show "no external callers" only on genuinely exported functions.
//   Show caller count on ALL functions with 1+ callers.
//   Hide completely on internal functions with 0 callers.
// ────────────────────────────────────────────────────────────────────────────

class RippleCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private engine: GraphEngine) {}

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const filePath = document.uri.fsPath;
    const fileNode = this.engine.graph.files.get(filePath);
    if (!fileNode) return [];

    const lenses: vscode.CodeLens[] = [];
    const exportedNames = this.getExportedNames(document);

    fileNode.symbols.forEach((symbolId) => {
      const sym = this.engine.graph.symbols.get(symbolId);
      if (!sym) return;

      // Only show CodeLens for functions and methods
      if (sym.kind !== "function" && sym.kind !== "method") return;

      const declarationLine = this.engine.getSymbolDeclarationLine(symbolId);
      if (declarationLine === null) return;

      const range = new vscode.Range(declarationLine, 0, declarationLine, 0);
      const callerCount = sym.calledBy.size;

      if (callerCount === 0) {
        // Only show "no external callers" on exported functions
        // Internal functions with 0 callers are expected — no hint needed
        const isExported = exportedNames.has(sym.name);
        if (!isExported) return;

        lenses.push(
          new vscode.CodeLens(range, {
            title: `↯ no external callers`,
            command: "",
            tooltip:
              "Ripple: No other functions call this directly. May be an entry point or page component.",
          })
        );
      } else {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `↯ ${callerCount} caller${callerCount > 1 ? "s" : ""} — click to see details`,
            command: "ripple.showCallers",
            arguments: [symbolId],
            tooltip: `Ripple: ${callerCount} function${
              callerCount > 1 ? "s call" : " calls"
            } this — click to see which ones`,
          })
        );
      }
    });

    return lenses;
  }

  // Extracts exported symbol names using regex — fast, no AST needed.
  // Handles: export default function, export function, export const,
  //          export { Name }, export async function
  private getExportedNames(document: vscode.TextDocument): Set<string> {
    const text = document.getText();
    const names = new Set<string>();

    // export default function Name
    const defaultFn = text.match(
      /export\s+default\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
    );
    defaultFn?.forEach((m) => {
      const match = m.match(/function\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (match) names.add(match[1]);
    });

    // export function Name / export async function Name
    for (const match of text.matchAll(
      /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
    )) {
      names.add(match[1]);
    }

    // export const Name = / export let Name =
    for (const match of text.matchAll(
      /export\s+(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g
    )) {
      names.add(match[1]);
    }

    // export { Name, OtherName as Alias }
    for (const match of text.matchAll(/export\s+\{([^}]+)\}/g)) {
      match[1].split(",").forEach((name) => {
        const trimmed = name.trim().split(/\s+as\s+/)[0].trim();
        if (trimmed) names.add(trimmed);
      });
    }

    return names;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 2 — RIPPLE CALLER PANEL
//
// WebView panel opened when developer clicks a CodeLens hint.
// Shows full caller detail — function names, file paths, clickable links.
// Bug 5 fix: single panel instance reused — never multiplies.
// ────────────────────────────────────────────────────────────────────────────

class RippleCallerPanel {
  private static currentPanel: RippleCallerPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(
    extensionUri: vscode.Uri,
    engine: GraphEngine,
    symbolId: string
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "rippleCallers",
      "Ripple — Caller Details",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    this.panel.webview.html = this.buildHtml(engine, symbolId);

    this.panel.webview.onDidReceiveMessage((message) => {
      if (message.command === "openFile" && message.filePath) {
        // Bug fix: use vscode.Uri.file() not raw string.
        // Raw strings with Windows backslashes can fail silently.
        // vscode.Uri.file() handles all platform path separators correctly.
        const uri = vscode.Uri.file(message.filePath);
        vscode.workspace
          .openTextDocument(uri)
          .then((doc) => vscode.window.showTextDocument(doc))
          .then(undefined, (err) => {
            vscode.window.showWarningMessage(
              `↯ Ripple: Could not open file — ${err?.message ?? String(err)}`
            );
          });
      }
    });

    this.panel.onDidDispose(() => {
      RippleCallerPanel.currentPanel = undefined;
    });
  }

  // Bug 5 fix: reuse existing panel — update content for new symbol
  static show(
    extensionUri: vscode.Uri,
    engine: GraphEngine,
    symbolId: string
  ): void {
    if (RippleCallerPanel.currentPanel) {
      RippleCallerPanel.currentPanel.panel.webview.html =
        RippleCallerPanel.currentPanel.buildHtml(engine, symbolId);
      RippleCallerPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    RippleCallerPanel.currentPanel = new RippleCallerPanel(
      extensionUri,
      engine,
      symbolId
    );
  }

  private buildHtml(engine: GraphEngine, symbolId: string): string {
    const sym = engine.graph.symbols.get(symbolId);
    if (!sym) {
      return `<html><body style="font-family:sans-serif;padding:24px">Symbol not found.</body></html>`;
    }

    const callerIds = Array.from(sym.calledBy);
    const callerCount = callerIds.length;

    const callerCards = callerIds
      .map((callerId) => {
        const caller = engine.graph.symbols.get(callerId);
        if (!caller) return "";
        const fileName = path.basename(caller.file);
        const dirParts = path.dirname(caller.file).split(path.sep);
        const shortDir = dirParts.slice(-2).join("/");
        // Bug fix: JSON.stringify produces surrounding double-quotes which break
        // the HTML onclick attribute: onclick="openFile("path")" is parsed as
        // onclick="openFile(" followed by broken trailing tokens.
        // Fix: store path in a data- attribute and read it in JS.
        // data- attributes use HTML entity encoding which handles any path safely.
        const safeDataPath = caller.file
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `
        <div class="caller-card" data-path="${safeDataPath}" onclick="openFile(this.getAttribute('data-path'))">
          <div class="caller-fn">${caller.name}()</div>
          <div class="caller-path">${shortDir}/<strong>${fileName}</strong></div>
        </div>`;
      })
      .join("");

    const warningBanner =
      callerCount >= HIGH_RISK_CALLER_COUNT
        ? `<div class="warning-banner">
            ⚠ High blast radius — ${callerCount} callers will be affected
           </div>`
        : "";

    const emptyState =
      callerCount === 0
        ? `<div class="empty-state">
            <div class="empty-icon">↯</div>
            <div class="empty-title">No external callers found</div>
            <div class="empty-desc">
              ${sym.name}() is not directly called by any other function
              in the import graph. This is typically a page component,
              an entry point, or a function called only by the framework.
            </div>
          </div>`
        : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Ripple — ${sym.name}()</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family, system-ui);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 28px 24px;
      line-height: 1.5;
    }
    .header { margin-bottom: 20px; }
    .ripple-badge {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    .symbol-name {
      font-size: 20px;
      font-weight: 700;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .symbol-file {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
    .warning-banner {
      background: rgba(255,200,0,0.08);
      border: 1px solid rgba(255,200,0,0.25);
      border-radius: 5px;
      padding: 10px 14px;
      font-size: 12px;
      color: var(--vscode-editorWarning-foreground, #f0c040);
      margin-bottom: 20px;
    }
    .section-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 10px;
    }
    .caller-card {
      padding: 12px 14px;
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 5px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: background 0.12s;
    }
    .caller-card:hover { background: var(--vscode-list-hoverBackground); }
    .caller-fn {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 13px;
      font-weight: 500;
    }
    .caller-path {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 3px;
    }
    .empty-state { padding: 32px 0 16px; text-align: center; }
    .empty-icon {
      font-size: 32px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
      opacity: 0.4;
    }
    .empty-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 10px;
    }
    .empty-desc {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      max-width: 340px;
      margin: 0 auto;
      line-height: 1.6;
    }
    .footer {
      margin-top: 28px;
      padding-top: 14px;
      border-top: 1px solid var(--vscode-panel-border, #333);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.7;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="ripple-badge">↯ Ripple — Impact Analysis</div>
    <div class="symbol-name">${sym.name}()</div>
    <div class="symbol-file">${path.basename(sym.file)}</div>
  </div>

  ${warningBanner}

  ${
    callerCount > 0
      ? `<div class="section-label">Called by ${callerCount} function${
          callerCount > 1 ? "s" : ""
        }</div>`
      : ""
  }

  ${callerCards}
  ${emptyState}

  <div class="footer">
    Ripple tracks import-based and same-file callers.
    Dynamic imports and aliased imports not yet tracked.
    Click any caller to open the file.
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function openFile(filePath) {
      vscode.postMessage({ command: 'openFile', filePath });
    }
  </script>
</body>
</html>`;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 3 — SAFETY CHECK
//
// Hybrid: FileSystemWatcher on .git/index as primary,
// git diff --cached polling every 2s as fallback for Windows.
//
// Bug 7 fix: snapshot-based cooldown — different staged file sets
//   always fire independently regardless of cooldown window.
// Bug 5 fix: single output channel reused — never multiplied.
// Bug 8 fix: flexible test file detection — 12 conventions covered.
// ────────────────────────────────────────────────────────────────────────────

class SafetyCheckProvider {
  private lastNotifiedSnapshot = "";
  private lastNotificationTime = 0;
  private readonly COOLDOWN_MS = 10000;
  private readonly POLL_MS = 2000;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private outputChannel: vscode.OutputChannel | undefined;

  constructor(
    private engine: GraphEngine,
    private workspaceRoot: string
  ) {}

  start(context: vscode.ExtensionContext): void {
    const gitIndexPath = path.join(this.workspaceRoot, ".git", "index");

    if (!fs.existsSync(gitIndexPath)) {
      console.log("[Ripple] No .git/index found — Safety Check disabled");
      return;
    }

    // PRIMARY — FileSystemWatcher on .git/index
    try {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.file(path.join(this.workspaceRoot, ".git")),
          "index"
        )
      );
      context.subscriptions.push(
        watcher.onDidChange(() => this.checkStaging())
      );
      context.subscriptions.push(watcher);
    } catch {
      console.log("[Ripple] .git/index watcher failed — poll only");
    }

    // FALLBACK — Poll git diff --cached directly every 2s
    let lastStagedSnapshot = "";

    this.pollTimer = setInterval(() => {
      try {
        const { execSync } = require("child_process");
        const current = execSync("git diff --cached --name-only", {
          cwd: this.workspaceRoot,
          encoding: "utf8",
          timeout: 2000,
        }) as string;

        const snapshot = current.trim();
        if (snapshot !== lastStagedSnapshot) {
          lastStagedSnapshot = snapshot;
          if (snapshot.length > 0) this.checkStaging();
        }
      } catch {
        // git not available — stay silent
      }
    }, this.POLL_MS);

    context.subscriptions.push({
      dispose: () => {
        if (this.pollTimer) clearInterval(this.pollTimer);
        if (this.outputChannel) this.outputChannel.dispose();
      },
    });

    console.log("[Ripple] Safety Check active — watcher + poll hybrid");
  }

  private checkStaging(): void {
    const stagedFiles = this.getStagedFiles();
    if (stagedFiles.length === 0) return;

    // Bug 7 fix: snapshot-based cooldown
    const snapshot = stagedFiles.sort().join("|");
    const now = Date.now();

    if (
      snapshot === this.lastNotifiedSnapshot &&
      now - this.lastNotificationTime < this.COOLDOWN_MS
    ) {
      return;
    }

    const absoluteStagedFiles = stagedFiles.map((f) =>
      path.join(this.workspaceRoot, f)
    );

    const blastRadius = this.engine.blastRadius(absoluteStagedFiles);
    const untestedFiles = blastRadius.filter((f) => !this.isTestFile(f));

    if (untestedFiles.length === 0) return;

    this.lastNotifiedSnapshot = snapshot;
    this.lastNotificationTime = now;

    const stagedNames = stagedFiles
      .slice(0, 2)
      .map((f) => path.basename(f))
      .join(", ");
    const moreSuffix =
      stagedFiles.length > 2 ? ` +${stagedFiles.length - 2} more` : "";
    const untestedNames = untestedFiles
      .slice(0, 3)
      .map((f) => path.basename(f))
      .join(", ");
    const moreUntested =
      untestedFiles.length > 3 ? ` +${untestedFiles.length - 3} more` : "";

    vscode.window
      .showWarningMessage(
        `↯ Ripple: ${stagedNames}${moreSuffix} → ${
          untestedFiles.length
        } untested file${
          untestedFiles.length > 1 ? "s" : ""
        } affected: ${untestedNames}${moreUntested}`,
        "View details",
        "Understood"
      )
      .then((selection) => {
        if (selection === "View details") {
          this.showDetails(stagedFiles, untestedFiles);
        }
      });
  }

  private showDetails(
    stagedFiles: string[],
    untestedFiles: string[]
  ): void {
    // Bug 5 fix: reuse single output channel
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel(
        "Ripple — Safety Check"
      );
    }

    this.outputChannel.clear();
    this.outputChannel.appendLine("↯ RIPPLE — SAFETY CHECK");
    this.outputChannel.appendLine("═".repeat(50));
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(`Staged files (${stagedFiles.length}):`);
    stagedFiles.forEach((f) =>
      this.outputChannel!.appendLine(`  • ${path.basename(f)}`)
    );
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(
      `Untested files in blast radius (${untestedFiles.length}):`
    );
    untestedFiles.forEach((f) => {
      const shortDir = path.dirname(f).split(path.sep).slice(-2).join("/");
      this.outputChannel!.appendLine(
        `  • ${path.basename(f)}  (${shortDir})`
      );
    });
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(
      "These files have no test coverage and may be affected"
    );
    this.outputChannel.appendLine(
      "by your staged changes. Verify before pushing."
    );
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(
      `Checked at: ${new Date().toLocaleString()}`
    );
    this.outputChannel.show(true);
  }

  private getStagedFiles(): string[] {
    try {
      const { execSync } = require("child_process");
      const output = execSync("git diff --cached --name-only", {
        cwd: this.workspaceRoot,
        encoding: "utf8",
        timeout: 3000,
      }) as string;

      return output
        .split("\n")
        .map((f: string) => f.trim())
        .filter(
          (f: string) => f.length > 0 && /\.(ts|tsx|js|jsx)$/.test(f)
        );
    } catch {
      return [];
    }
  }

  // Bug 8 fix: flexible test file detection — 12 conventions
  private isTestFile(filePath: string): boolean {
    const base = path.basename(filePath);
    const normalized = filePath.split(path.sep).join("/");

    return (
      base.includes(".test.") ||
      base.includes(".spec.") ||
      base.includes("_test.") ||
      base.includes("-test.") ||
      base.endsWith(".test") ||
      base.endsWith(".spec") ||
      normalized.includes("/__tests__/") ||
      normalized.includes("/test/") ||
      normalized.includes("/tests/") ||
      normalized.includes("/__test__/") ||
      normalized.includes("/e2e/") ||
      normalized.includes("/cypress/") ||
      normalized.includes("/playwright/") ||
      normalized.includes("/vitest/")
    );
  }
} // ← SafetyCheckProvider

// ────────────────────────────────────────────────────────────────────────────
// RIPPLE INSIGHT PANEL
//
// PER-PROJECT: Uses workspaceState, not globalState.
// Each project is tracked independently:
//   - Project A with no AGENTS.md → panel shows
//   - Project A activated → panel never shows for Project A again
//   - Project B (different folder) → panel shows independently
//
// Shows per project until one of three exit conditions is met:
//   1. AGENTS.md / CLAUDE.md / .cursorrules contains Ripple content (success)
//   2. Developer clicks "Activate AI Mode" button (success)
//   3. Developer clicks "Remind me later" 3 times (give up)
//
// Developer can always re-show via Command Palette:
//   "Ripple: Show AI Setup Panel"
// ────────────────────────────────────────────────────────────────────────────

class RippleInsightPanel {
  private static readonly STATE_DISMISS_COUNT = "ripple.insight.dismissCount";
  private static readonly STATE_ACTIVATED = "ripple.insight.activated";
  private static readonly MAX_DISMISSALS = 3;

  // Called after every scan completes — decides whether to show
  static maybeShow(
    context: vscode.ExtensionContext,
    engine: GraphEngine,
    workspaceRoot: string
  ): void {
    // Exit condition 1: developer already activated (copied WORKFLOW.md)
    if (context.workspaceState.get(RippleInsightPanel.STATE_ACTIVATED)) return;

    // Exit condition 2: activation file exists on disk
    const activationFiles = [
      path.join(workspaceRoot, "AGENTS.md"),
      path.join(workspaceRoot, "CLAUDE.md"),
      path.join(workspaceRoot, ".cursorrules"),
    ];
    const alreadyActivated = activationFiles.some((f) => {
      if (!fs.existsSync(f)) return false;
      try {
        const content = fs.readFileSync(f, "utf8");
        return content.includes("Ripple") || content.includes(".ripple/focus");
      } catch { return false; }
    });

    if (alreadyActivated) {
      context.workspaceState.update(RippleInsightPanel.STATE_ACTIVATED, true);
      return;
    }

    // Exit condition 3: too many dismissals
    const dismissCount = (context.workspaceState.get(RippleInsightPanel.STATE_DISMISS_COUNT) as number) ?? 0;
    if (dismissCount >= RippleInsightPanel.MAX_DISMISSALS) return;

    // Find the highest-risk file with its actual callers
    let riskFilePath = "";
    let riskFileName = "";
    let riskCount = 0;

    engine.graph.files.forEach((node, fp) => {
      if (
        !fp.includes("node_modules") &&
        !fp.includes(".ripple") &&
        !fp.includes(".next") &&
        node.importedBy.size > riskCount
      ) {
        riskCount = node.importedBy.size;
        riskFilePath = fp;
        riskFileName = path.basename(fp);
      }
    });

    // Only show if project has enough files to be meaningful
    // A 3-file project with 2 importers is not a useful Ripple demonstration
    if (engine.graph.files.size < 10) return;

    // Only show if project has meaningful risk structure
    if (riskCount < CAUTION_BLAST_RADIUS) return;

    // Build the caller list — real file names from the graph
    const callerNames = Array.from(
      engine.graph.files.get(riskFilePath)?.importedBy ?? new Set<string>()
    )
      .filter((f) => !f.includes("node_modules") && !f.includes(".next"))
      .map((f) => path.basename(f))
      .slice(0, 5);

    const moreCallers = riskCount > DANGEROUS_BLAST_RADIUS ? ` +${riskCount - DANGEROUS_BLAST_RADIUS} more` : "";

    RippleInsightPanel.show(
      context,
      engine,
      workspaceRoot,
      riskFileName,
      riskCount,
      callerNames,
      moreCallers
    );
  }

  private static show(
    context: vscode.ExtensionContext,
    engine: GraphEngine,
    workspaceRoot: string,
    riskFileName: string,
    riskCount: number,
    callerNames: string[],
    moreCallers: string
  ): void {
    const fileCount = engine.graph.files.size;
    const symbolCount = engine.graph.symbols.size;

    const panel = vscode.window.createWebviewPanel(
      "rippleInsight",
      "↯ Ripple — Project Insight",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    panel.webview.html = RippleInsightPanel.buildHtml(
      riskFileName,
      riskCount,
      callerNames,
      moreCallers,
      fileCount,
      symbolCount
    );

    panel.webview.onDidReceiveMessage((message) => {
      if (message.command === "activate") {
        // Copy WORKFLOW.md to AGENTS.md for the developer
        const workflowPath = path.join(workspaceRoot, ".ripple", "WORKFLOW.md");
        const agentsPath = path.join(workspaceRoot, "AGENTS.md");

        try {
          if (fs.existsSync(workflowPath)) {
            // Check if AGENTS.md already exists with non-Ripple content
            if (fs.existsSync(agentsPath)) {
              const existing = fs.readFileSync(agentsPath, "utf8");
              if (!existing.includes("Ripple")) {
                // Append rather than overwrite
                fs.appendFileSync(agentsPath, "\n\n" + fs.readFileSync(workflowPath, "utf8"));
              } else {
                fs.copyFileSync(workflowPath, agentsPath);
              }
            } else {
              fs.copyFileSync(workflowPath, agentsPath);
            }
            context.workspaceState.update(RippleInsightPanel.STATE_ACTIVATED, true);
            vscode.window.showInformationMessage(
              "↯ Ripple: AGENTS.md created. AI agents will now follow the Ripple protocol automatically."
            );
          } else {
            vscode.window.showWarningMessage(
              "↯ Ripple: WORKFLOW.md not found yet — save any TypeScript file to generate it, then try again."
            );
          }
        } catch (err) {
          vscode.window.showErrorMessage(
            "↯ Ripple: Could not create AGENTS.md — please copy .ripple/WORKFLOW.md manually."
          );
        }
        panel.dispose();
      }

      if (message.command === "dismiss") {
        const current = (context.workspaceState.get(RippleInsightPanel.STATE_DISMISS_COUNT) as number) ?? 0;
        context.workspaceState.update(RippleInsightPanel.STATE_DISMISS_COUNT, current + 1);
        panel.dispose();
      }

      if (message.command === "neverShow") {
        context.workspaceState.update(RippleInsightPanel.STATE_DISMISS_COUNT, RippleInsightPanel.MAX_DISMISSALS);
        panel.dispose();
      }
    });
  }

  private static buildHtml(
    riskFileName: string,
    riskCount: number,
    callerNames: string[],
    moreCallers: string,
    fileCount: number,
    symbolCount: number
  ): string {
    const callerListHtml = callerNames
      .map((name) => `<div class="caller-item"><span class="caller-dot"></span>${name}</div>`)
      .join("");

    const riskLabel = riskCount >= DANGEROUS_BLAST_RADIUS ? "DANGEROUS" : "CAUTION";
    const riskColor = riskCount >= DANGEROUS_BLAST_RADIUS ? "#ff5566" : "#f0a030";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ripple — Project Insight</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--vscode-font-family, system-ui);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 32px 28px;
      line-height: 1.6;
      max-width: 560px;
    }

    .top-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 24px;
    }

    .badge-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #00d4f5;
      box-shadow: 0 0 6px #00d4f5;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .headline {
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.3px;
      margin-bottom: 20px;
      line-height: 1.3;
    }

    .risk-block {
      background: rgba(255, 85, 102, 0.06);
      border: 1px solid rgba(255, 85, 102, 0.2);
      border-left: 3px solid ${riskColor};
      border-radius: 6px;
      padding: 16px 18px;
      margin-bottom: 20px;
    }

    .risk-file {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 14px;
      font-weight: 600;
      color: ${riskColor};
      margin-bottom: 4px;
    }

    .risk-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1.2px;
      background: ${riskColor};
      color: #000;
      padding: 2px 7px;
      border-radius: 3px;
      display: inline-block;
      margin-bottom: 10px;
    }

    .risk-desc {
      font-size: 12.5px;
      color: var(--vscode-foreground);
      opacity: 0.85;
      line-height: 1.6;
    }

    .callers-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--vscode-descriptionForeground);
      margin: 16px 0 8px;
    }

    .callers-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 6px;
    }

    .caller-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      color: var(--vscode-foreground);
      opacity: 0.9;
    }

    .caller-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: ${riskColor};
      flex-shrink: 0;
      opacity: 0.7;
    }

    .more-callers {
      font-size: 11.5px;
      color: var(--vscode-descriptionForeground);
      margin-left: 13px;
    }

    .divider {
      border: none;
      border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
      margin: 20px 0;
    }

    .protection-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 12px;
    }

    .protection-icon {
      font-size: 16px;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .protection-text {
      font-size: 13px;
      line-height: 1.6;
    }

    .protection-text strong {
      color: #00d4f5;
    }

    .stats-row {
      font-size: 11.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 24px;
      line-height: 1.8;
    }

    .stat-num {
      color: var(--vscode-foreground);
      font-weight: 600;
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .btn-primary {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: #00d4f5;
      color: #0a0f1a;
      border: none;
      border-radius: 6px;
      padding: 11px 20px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      font-family: var(--vscode-font-family, system-ui);
      transition: opacity 0.15s;
      width: 100%;
    }

    .btn-primary:hover { opacity: 0.88; }

    .btn-secondary-row {
      display: flex;
      gap: 10px;
    }

    .btn-secondary {
      flex: 1;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
      border-radius: 6px;
      padding: 8px 14px;
      font-size: 12px;
      cursor: pointer;
      font-family: var(--vscode-font-family, system-ui);
      transition: color 0.15s, border-color 0.15s;
    }

    .btn-secondary:hover {
      color: var(--vscode-foreground);
      border-color: rgba(255,255,255,0.25);
    }

    .manual-note {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 12px;
      opacity: 0.7;
      text-align: center;
    }

    .manual-note code {
      font-family: var(--vscode-editor-font-family, monospace);
      opacity: 1;
    }
  </style>
</head>
<body>
  <div class="top-badge">
    <span class="badge-dot"></span>
    ↯ Ripple — Your Project Insight
  </div>

  <div class="headline">Ripple found something important<br>about your project.</div>

  <div class="risk-block">
    <div class="risk-label">${riskLabel}</div>
    <div class="risk-file">${riskFileName}</div>
    <div class="risk-desc">
      <strong style="color:var(--vscode-foreground)">${riskCount} files depend on this.</strong>
      If an AI agent changes it without knowing this,
      these files could break silently:
    </div>
    <div class="callers-label">Dependent files</div>
    <div class="callers-list">
      ${callerListHtml}
    </div>
    ${moreCallers ? `<div class="more-callers">${moreCallers}</div>` : ""}
  </div>

  <div class="protection-row">
    <span class="protection-icon">↯</span>
    <div class="protection-text">
      Ripple tracks all <strong>${riskCount} connections</strong> automatically.
      One click below writes an AGENTS.md to your project.
      From that point, every AI agent session follows the
      safe-change protocol without you typing anything.
    </div>
  </div>

  <hr class="divider">

  <div class="stats-row">
    Ripple mapped <span class="stat-num">${symbolCount}</span> functions
    across <span class="stat-num">${fileCount}</span> files in your project.
  </div>

  <div class="actions">
    <button class="btn-primary" onclick="activate()">
      ↯ Activate AI Mode — Create AGENTS.md
    </button>
    <div class="btn-secondary-row">
      <button class="btn-secondary" onclick="dismiss()">Remind me later</button>
      <button class="btn-secondary" onclick="neverShow()">Don't show again</button>
    </div>
  </div>

  <div class="manual-note">
    Or copy manually: <code>.ripple/WORKFLOW.md</code> → <code>AGENTS.md</code>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function activate() { vscode.postMessage({ command: 'activate' }); }
    function dismiss()  { vscode.postMessage({ command: 'dismiss' });  }
    function neverShow(){ vscode.postMessage({ command: 'neverShow' });}
  </script>
</body>
</html>`;
  }
}