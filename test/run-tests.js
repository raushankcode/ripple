"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");
const crypto = require("crypto");

const repoRoot = path.resolve(__dirname, "..");
const tempRoot = path.join(repoRoot, "test", ".tmp");
const workspaceRoot = path.join(tempRoot, `workspace-${process.pid}-${Date.now()}`);

const captured = {
  clipboard: "",
  codeLensProviders: [],
  commandExecutions: [],
  commands: new Map(),
  infos: [],
  intervals: [],
  outputChannels: [],
  panels: [],
  state: new Map(),
  subscriptions: [],
  treeProviders: new Map(),
  warnings: [],
  watchers: [],
};

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(items, expected, message) {
  assert(items.includes(expected), `${message}. Expected ${expected} in ${JSON.stringify(items)}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function chmodTree(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      chmodTree(fullPath);
    } else {
      try {
        fs.chmodSync(fullPath, 0o666);
      } catch {
        // Best-effort Windows cleanup.
      }
    }
  });
}

function cleanDir(dir, required = true) {
  const resolved = path.resolve(dir);
  const allowed = path.resolve(tempRoot);
  if (resolved !== allowed && !resolved.startsWith(`${allowed}${path.sep}`)) {
    throw new Error(`Refusing to clean outside test temp: ${resolved}`);
  }
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch (err) {
    chmodTree(resolved);
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
    } catch (retryErr) {
      if (required) {
        throw retryErr;
      }
      console.warn(`warning - could not clean test temp ${resolved}: ${retryErr.message}`);
    }
  }
}

async function cleanDirEventually(dir, required = true) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      cleanDir(dir, true);
      return;
    } catch (err) {
      lastError = err;
      await sleep(75 * (attempt + 1));
    }
  }

  if (required) {
    throw lastError;
  }
}

function writeFile(relativePath, content) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.trimStart());
}

function writeWorkspaceFile(relativePath, content) {
  writeFile(relativePath, content);
  return path.join(workspaceRoot, relativePath);
}

function readWorkspaceJson(...segments) {
  return JSON.parse(fs.readFileSync(path.join(workspaceRoot, ...segments), "utf8"));
}

function readFocusByProjectPath(context, relativePath) {
  const lookup = context.availableFocusFilesByPath[relativePath];
  assert(lookup, `Missing focus lookup for ${relativePath}`);
  return readWorkspaceJson(...lookup.split(" ")[0].split(/[\\/]/));
}

function toWorkspacePath(filePath) {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/");
}

function resetCapturedRuntime() {
  captured.clipboard = "";
  captured.codeLensProviders.length = 0;
  captured.commandExecutions.length = 0;
  captured.commands.clear();
  captured.infos.length = 0;
  captured.intervals.length = 0;
  captured.outputChannels.length = 0;
  captured.panels.length = 0;
  captured.state.clear();
  captured.subscriptions.length = 0;
  captured.treeProviders.clear();
  captured.warnings.length = 0;
  captured.watchers.length = 0;
  captured.onDidSaveTextDocument = undefined;
  captured.onDidChangeActiveTextEditor = undefined;
  captured.statusBar = undefined;
  captured.errors = [];
}

function sha1Text(content) {
  return crypto.createHash("sha1").update(content).digest("hex");
}

function createFixtureWorkspace() {
  fs.mkdirSync(tempRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  writeFile("package.json", JSON.stringify({
    name: "ripple-fixture",
    description: "Fixture project for Ripple tests",
  }, null, 2));

  writeFile("tsconfig.json", JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "commonjs",
      jsx: "react-jsx",
      strict: true,
    },
  }, null, 2));

  writeFile("src/normalizer.ts", `
export function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveValue(value: string): string {
  return normalizeValue(value);
}
`);

  writeFile("src/graph.ts", `
import { normalizeValue } from "./normalizer";

export function buildGraph(raw: string[]): string[] {
  return raw.map((item) => normalizeValue(item));
}

export function formatGraph(raw: string[]): string {
  return buildGraph(raw).join(",");
}
`);

  writeFile("src/extension.ts", `
import { buildGraph } from "./graph";
import { normalizeValue } from "./normalizer";

export function activateName(name: string): string {
  return normalizeValue(name);
}

export function renderGraph(raw: string[]): string {
  return buildGraph(raw).join("|");
}
`);

  writeFile("src/index.ts", `
import { renderGraph } from "./extension";

export function boot(): string {
  return renderGraph([" A "]);
}
`);
}

function fixtureFiles() {
  const files = [];
  const ignored = new Set([".git", ".ripple", "node_modules", "dist", "out"]);
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (ignored.has(entry.name)) {
        return;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    });
  };
  walk(workspaceRoot);
  return files;
}

class EventEmitter {
  constructor() {
    this.listeners = [];
  }

  get event() {
    return (listener) => {
      this.listeners.push(listener);
      return { dispose() {} };
    };
  }

  fire(...args) {
    this.listeners.forEach((listener) => listener(...args));
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class Range {
  constructor(startLine, startCharacter, endLine, endCharacter) {
    this.start = { line: startLine, character: startCharacter };
    this.end = { line: endLine, character: endCharacter };
  }
}

class CodeLens {
  constructor(range, command) {
    this.range = range;
    this.command = command;
  }
}

class RelativePattern {
  constructor(base, pattern) {
    this.base = base;
    this.pattern = pattern;
  }
}

const Uri = {
  file(fsPath) {
    return {
      fsPath,
      path: fsPath.split(path.sep).join("/"),
      toString: () => fsPath,
    };
  },
};

function disposable() {
  return { dispose() {} };
}

function makeDocument(filePath) {
  return {
    uri: Uri.file(filePath),
    getText: () => fs.readFileSync(filePath, "utf8"),
  };
}

function createVscodeMock() {
  return {
    CodeLens,
    EventEmitter,
    Range,
    RelativePattern,
    TreeItem,
    TreeItemCollapsibleState: { None: 0 },
    Uri,
    ViewColumn: { Beside: 2 },
    StatusBarAlignment: { Left: 1 },
    commands: {
      executeCommand(name, ...args) {
        captured.commandExecutions.push({ name, args });
        return Promise.resolve();
      },
      registerCommand(name, handler) {
        captured.commands.set(name, handler);
        return disposable();
      },
    },
    env: {
      clipboard: {
        writeText(text) {
          captured.clipboard = text;
          return Promise.resolve();
        },
      },
    },
    languages: {
      registerCodeLensProvider(selector, provider) {
        captured.codeLensProviders.push({ selector, provider });
        return disposable();
      },
    },
    window: {
      activeTextEditor: null,
      createOutputChannel(name) {
        const channel = {
          name,
          lines: [],
          clear() {
            this.lines = [];
          },
          appendLine(line) {
            this.lines.push(line);
          },
          show() {
            this.shown = true;
          },
          dispose() {
            this.disposed = true;
          },
        };
        captured.outputChannels.push(channel);
        return channel;
      },
      createStatusBarItem() {
        const item = {
          text: "",
          tooltip: "",
          hide() {
            this.hidden = true;
          },
          show() {
            this.shown = true;
          },
        };
        captured.statusBar = item;
        return item;
      },
      createWebviewPanel(viewType, title, column, options) {
        const panel = {
          column,
          disposeCallbacks: [],
          disposed: false,
          options,
          title,
          viewType,
          webview: {
            callbacks: [],
            html: "",
            onDidReceiveMessage(callback) {
              this.callbacks.push(callback);
              return disposable();
            },
          },
          dispose() {
            this.disposed = true;
            this.disposeCallbacks.forEach((callback) => callback());
          },
          onDidDispose(callback) {
            this.disposeCallbacks.push(callback);
            return disposable();
          },
        };
        captured.panels.push(panel);
        return panel;
      },
      onDidChangeActiveTextEditor(callback) {
        captured.onDidChangeActiveTextEditor = callback;
        return disposable();
      },
      registerTreeDataProvider(id, provider) {
        captured.treeProviders.set(id, provider);
        return disposable();
      },
      showErrorMessage(message, ...items) {
        captured.errors = captured.errors || [];
        captured.errors.push({ message, items });
        return Promise.resolve();
      },
      showInformationMessage(message, ...items) {
        captured.infos.push({ message, items });
        return Promise.resolve();
      },
      showWarningMessage(message, ...items) {
        captured.warnings.push({ message, items });
        return Promise.resolve(items.includes("View details") ? "View details" : undefined);
      },
    },
    workspace: {
      workspaceFolders: [{ uri: Uri.file(workspaceRoot) }],
      createFileSystemWatcher(pattern) {
        const watcher = {
          pattern,
          onDidChangeCallbacks: [],
          onDidCreateCallbacks: [],
          onDidDeleteCallbacks: [],
          dispose() {},
          onDidChange(callback) {
            this.onDidChangeCallbacks.push(callback);
            return disposable();
          },
          onDidCreate(callback) {
            this.onDidCreateCallbacks.push(callback);
            return disposable();
          },
          onDidDelete(callback) {
            this.onDidDeleteCallbacks.push(callback);
            return disposable();
          },
        };
        captured.watchers.push(watcher);
        return watcher;
      },
      findFiles: async () => fixtureFiles().map((fsPath) => Uri.file(fsPath)),
      getConfiguration() {
        return {
          get(key, fallback) {
            const values = {
              enabled: true,
              generateContext: true,
              safetyCheck: true,
              showCodeLens: true,
            };
            return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
          },
        };
      },
      onDidSaveTextDocument(callback) {
        captured.onDidSaveTextDocument = callback;
        return disposable();
      },
    },
  };
}

function createChildProcessMock(realChildProcess) {
  return {
    ...realChildProcess,
    exec(command, options, callback) {
      if (String(command).includes("git diff --cached --name-only")) {
        callback(null, "src/normalizer.ts\n", "");
        return { kill() {} };
      }
      return realChildProcess.exec(command, options, callback);
    },
    execSync(command, options) {
      if (String(command).includes("git diff --cached --name-only")) {
        return "src/normalizer.ts\n";
      }
      return realChildProcess.execSync(command, options);
    },
  };
}

function installMocks() {
  const vscodeMock = createVscodeMock();
  const realChildProcess = require("child_process");
  const childProcessMock = createChildProcessMock(realChildProcess);
  const gitIndexPath = path.resolve(workspaceRoot, ".git", "index");
  const fsMock = {};
  Object.defineProperties(fsMock, Object.getOwnPropertyDescriptors(fs));
  fsMock.existsSync = (candidate) => {
    if (typeof candidate === "string" && path.resolve(candidate) === gitIndexPath) {
      return true;
    }
    return fs.existsSync(candidate);
  };
  const originalLoad = Module._load;
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;

  global.setInterval = (callback, ms) => {
    captured.intervals.push({ callback, ms });
    return { __mockInterval: captured.intervals.length - 1 };
  };
  global.clearInterval = () => {};

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") {
      return vscodeMock;
    }
    if (request === "fs") {
      return fsMock;
    }
    if (request === "child_process") {
      return childProcessMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  return {
    restore() {
      Module._load = originalLoad;
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
    },
    vscodeMock,
  };
}

function clearCompiledModuleCache() {
  [
    path.join(repoRoot, "out", "extension.js"),
    path.join(repoRoot, "out", "src", "extension.js"),
    path.join(repoRoot, "out", "packages", "core", "src", "index.js"),
    path.join(repoRoot, "out", "packages", "core", "src", "graph.js"),
    path.join(repoRoot, "out", "packages", "core", "src", "normalizer.js"),
    path.join(repoRoot, "out", "packages", "core", "src", "types.js"),
  ].forEach((modulePath) => {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch {
      // Not every output path exists in every build mode.
    }
  });
}

test("Graph engine generates dependency, focus, and agent context", async ({ GraphEngine }) => {
  const engine = new GraphEngine(workspaceRoot);
  await engine.initialScan();

  const normalizerPath = path.join(workspaceRoot, "src", "normalizer.ts");
  const graphPath = path.join(workspaceRoot, "src", "graph.ts");
  const extensionPath = path.join(workspaceRoot, "src", "extension.ts");

  assert(engine.graph.files.size === 4, `Expected 4 scanned files, got ${engine.graph.files.size}`);
  assert(engine.graph.symbols.size >= 7, `Expected at least 7 symbols, got ${engine.graph.symbols.size}`);
  assert(
    engine.downstreamFiles(normalizerPath).includes(graphPath),
    "normalizer.ts should be used by graph.ts"
  );
  assert(
    engine.downstreamFiles(normalizerPath).includes(extensionPath),
    "normalizer.ts should be used by extension.ts"
  );
  assert(
    engine.upstreamFiles(graphPath).includes(normalizerPath),
    "graph.ts should depend on normalizer.ts"
  );

  const contextPath = path.join(workspaceRoot, ".ripple", ".cache", "context.json");
  const workflowPath = path.join(workspaceRoot, ".ripple", "WORKFLOW.md");
  const context = JSON.parse(fs.readFileSync(contextPath, "utf8"));
  const workflow = fs.readFileSync(workflowPath, "utf8");

  assert(context.availableFocusFilesByPath["src/normalizer.ts"], "Missing path-based focus lookup");
  assert(context.agentOperatingMode, "Missing agent operating mode");
  assert(workflow.includes("TASK ROUTING"), "WORKFLOW.md missing task routing");

  const focusRelative = context.availableFocusFilesByPath["src/normalizer.ts"].split(" ")[0];
  const focusPath = path.join(workspaceRoot, focusRelative);
  const focusBefore = JSON.stringify(JSON.parse(fs.readFileSync(focusPath, "utf8")));
  const focus = JSON.parse(focusBefore);

  assert(focus.risk.modificationRisk === "caution", "normalizer.ts should be caution risk");
  assertIncludes(focus.verificationTargets.files, "src/graph.ts", "Focus verification targets missed graph.ts");
  assertIncludes(
    focus.verificationTargets.files,
    "src/extension.ts",
    "Focus verification targets missed extension.ts"
  );

  engine.persistence.generateSingleFocus(engine.graph, normalizerPath);
  const focusAfter = JSON.stringify(JSON.parse(fs.readFileSync(focusPath, "utf8")));
  assert(focusAfter === focusBefore, "Single-focus output drifted from full focus output");

  const duplicateEngine = new GraphEngine(workspaceRoot);
  const duplicateOne = path.join(workspaceRoot, "apps", "web", "src", "index.ts");
  const duplicateTwo = path.join(workspaceRoot, "packages", "web", "src", "index.ts");
  [duplicateOne, duplicateTwo].forEach((filePath) => {
    duplicateEngine.graph.files.set(filePath, {
      path: filePath,
      imports: new Set(),
      importedBy: new Set(),
      symbols: new Set([`${filePath}::main`]),
      hash: "",
      createdAt: 0,
      lastModifiedAt: 0,
      changeCount: 0,
      hasParseError: false,
    });
  });

  const lookup = duplicateEngine.persistence.buildFocusLookup(duplicateEngine.graph);
  assert(lookup.ambiguousFocusFileNames["index.ts"]?.length === 2, "Ambiguous index.ts files were not reported");
  assert(
    lookup.availableFocusFilesByBasename["index.ts"]?.status === "ambiguous",
    "Structured basename lookup should mark duplicate index.ts as ambiguous"
  );
  assertIncludes(
    lookup.ambiguousFocusFileMatches["index.ts"].map((match) => match.path),
    "apps/web/src/index.ts",
    "Ambiguous matches missed apps/web index.ts"
  );
  assert(
    lookup.ambiguousFocusFileMatches["index.ts"].every((match) => match.focus && typeof match.importers === "number"),
    "Ambiguous matches should include focus paths and importer counts"
  );
  assert(!lookup.availableFocusFiles["index.ts"], "Ambiguous basename should not be a direct lookup key");
  assert(
    !lookup.availableFocusFiles["apps/web/src/index.ts"],
    "availableFocusFiles should not expose relative-path fallbacks for ambiguous basenames"
  );
  assert(
    Object.values(lookup.availableFocusFilesByPath).every((value) => /-[a-f0-9]{6}\.json/.test(value)),
    "Collision-safe focus keys should include hash suffixes"
  );
});

test("Extension registers and exercises user-facing features", async ({ extension, vscodeMock }) => {
  const normalizerPath = path.join(workspaceRoot, "src", "normalizer.ts");
  const graphPath = path.join(workspaceRoot, "src", "graph.ts");
  const startedAt = Date.now();

  vscodeMock.window.activeTextEditor = { document: makeDocument(normalizerPath) };

  const context = {
    extensionUri: Uri.file(repoRoot),
    globalState: {
      get() {},
      update() {
        return Promise.resolve();
      },
    },
    subscriptions: captured.subscriptions,
    workspaceState: {
      get(key) {
        return captured.state.get(key);
      },
      update(key, value) {
        captured.state.set(key, value);
        return Promise.resolve();
      },
    },
  };

  await extension.activate(context);

  assert(captured.treeProviders.has("ripple.impactLens"), "Impact Lens provider was not registered");
  assert(captured.codeLensProviders.length === 1, "CodeLens provider was not registered once");
  ["ripple.copyPrompt", "ripple.showCallers", "ripple.showSetupPanel"].forEach((command) => {
    assert(captured.commands.has(command), `${command} was not registered`);
  });
  assert(
    captured.commandExecutions.some((command) => command.name === "setContext"),
    "VS Code workspace context was not set"
  );
  assert(captured.watchers.length >= 3, "Expected source, tsconfig, and git watchers");
  assert(captured.intervals.length >= 1, "Safety Check poll interval was not registered");

  const sourceWatcher = captured.watchers.find((watcher) =>
    String(watcher.pattern ?? "").includes("**/*.{ts,tsx,js,jsx}")
  );
  assert(sourceWatcher, "Source file watcher was not registered");
  assert(sourceWatcher.onDidChangeCallbacks.length >= 1, "Source watcher does not handle external changes");

  const projectConfigWatcher = captured.watchers.find((watcher) =>
    String(watcher.pattern?.pattern ?? "").includes("tsconfig.json") &&
    String(watcher.pattern?.pattern ?? "").includes("package.json")
  );
  assert(projectConfigWatcher, "Project config watcher was not registered");
  assert(projectConfigWatcher.onDidChangeCallbacks.length >= 1, "Project config watcher misses changes");

  await waitFor(() => {
    const contextPath = path.join(workspaceRoot, ".ripple", ".cache", "context.json");
    if (!fs.existsSync(contextPath)) {
      return false;
    }
    const generatedAt = Date.parse(JSON.parse(fs.readFileSync(contextPath, "utf8")).generated);
    return generatedAt >= startedAt;
  }, "fresh extension context generation");

  const impactItems = captured.treeProviders.get("ripple.impactLens")
    .getChildren()
    .map((item) => String(item.label));
  assert(impactItems.some((label) => label.startsWith("Used by")), "Impact Lens missed Used by section");
  assertIncludes(impactItems, "src/graph.ts", "Impact Lens missed graph.ts dependent");
  assertIncludes(impactItems, "src/extension.ts", "Impact Lens missed extension.ts dependent");

  const codeLensProvider = captured.codeLensProviders[0].provider;
  const graphLenses = codeLensProvider.provideCodeLenses(makeDocument(graphPath));
  assert(graphLenses.length > 0, "CodeLens returned no graph.ts lenses");
  assert(
    graphLenses.some((lens) => lens.command?.title?.includes("caller")),
    "CodeLens did not expose caller information"
  );

  await captured.commands.get("ripple.copyPrompt")();
  await sleep(0);
  assert(captured.clipboard.includes(".ripple/.cache/focus/"), "Copy Prompt missed focus file path");
  assert(captured.clipboard.includes("File: src/normalizer.ts"), "Copy Prompt missed relative target path");
  assert(captured.clipboard.includes("src/graph.ts"), "Copy Prompt missed relative importer path");
  assert(captured.clipboard.includes("Project rules: .ripple/WORKFLOW.md"), "Copy Prompt missed workflow pointer");
  assert(captured.infos.some((info) => info.message.includes("Prompt copied")), "Copy Prompt success message missing");

  const callerLens = graphLenses.find((lens) => lens.command?.command === "ripple.showCallers");
  assert(callerLens, "No clickable caller CodeLens was produced");
  await captured.commands.get("ripple.showCallers")(...callerLens.command.arguments);
  assert(captured.panels.some((panel) => panel.title.includes("Ripple")), "Caller panel was not opened");

  await captured.commands.get("ripple.showSetupPanel")();
  assert(captured.state.get("ripple.insight.activated") === false, "Setup panel did not reset activation state");
  assert(captured.state.get("ripple.insight.dismissCount") === 0, "Setup panel did not reset dismiss count");

  const extensionCompanionTest = writeWorkspaceFile("src/tests/extension-test.ts", `
import { renderGraph } from "../extension";

export function testRenderGraph(): string {
  return renderGraph([" A "]);
}
`);

  captured.onDidSaveTextDocument(makeDocument(normalizerPath));
  await sleep(20);

  const gitWatcher = captured.watchers.find((watcher) => String(watcher.pattern?.pattern ?? "").includes("index"));
  assert(gitWatcher, ".git/index watcher was not registered");
  gitWatcher.onDidChangeCallbacks.forEach((callback) => callback(Uri.file(path.join(workspaceRoot, ".git", "index"))));
  await sleep(20);

  assert(
    captured.warnings.some((warning) => warning.message.includes("1 untested file affected")),
    `Safety Check did not warn about staged blast radius: ${JSON.stringify(captured.warnings)}`
  );
  assert(
    captured.outputChannels.some((channel) => channel.lines.some((line) => line.includes("SAFETY CHECK"))),
    "Safety Check detail output was not produced"
  );

  const generatedContext = JSON.parse(
    fs.readFileSync(path.join(workspaceRoot, ".ripple", ".cache", "context.json"), "utf8")
  );
  assert(generatedContext.availableFocusFilesByPath, "Generated context lacks availableFocusFilesByPath");
  assert(generatedContext.agentOperatingMode, "Generated context lacks agentOperatingMode");

  context.subscriptions.forEach((subscription) => {
    try {
      subscription.dispose?.();
    } catch {
      // Best-effort cleanup.
    }
  });
  extension.deactivate?.();
  await cleanDirEventually(path.dirname(extensionCompanionTest), false);
});

test("Agent workflow gates safe, caution, dangerous, and setup activation paths", async ({ extension, GraphEngine, vscodeMock }) => {
  const agentRoot = path.join(workspaceRoot, "agent-workflow");
  await cleanDirEventually(agentRoot, false);

  writeWorkspaceFile("agent-workflow/safe.ts", `
export function localOnly(value: string): string {
  return value.toUpperCase();
}
`);

  writeWorkspaceFile("agent-workflow/caution.ts", `
export function cautionShared(value: string): string {
  return value.trim();
}
`);

  for (const name of ["alpha", "beta"]) {
    writeWorkspaceFile(`agent-workflow/caution-${name}.ts`, `
import { cautionShared } from "./caution";

export function ${name}Caution(): string {
  return cautionShared("${name}");
}
`);
  }

  writeWorkspaceFile("agent-workflow/dangerous.ts", `
export function sharedContract(value: string): string {
  return value.trim().toLowerCase();
}
`);

  for (let index = 1; index <= 5; index++) {
    writeWorkspaceFile(`agent-workflow/danger-consumer-${index}.ts`, `
import { sharedContract } from "./dangerous";

export function dangerConsumer${index}(): string {
  return sharedContract(" ${index} ");
}
`);
  }

  const engine = new GraphEngine(workspaceRoot);
  await engine.initialScan();

  const generatedContext = readWorkspaceJson(".ripple", ".cache", "context.json");
  const workflow = fs.readFileSync(path.join(workspaceRoot, ".ripple", "WORKFLOW.md"), "utf8");
  const safeFocus = readFocusByProjectPath(generatedContext, "agent-workflow/safe.ts");
  const cautionFocus = readFocusByProjectPath(generatedContext, "agent-workflow/caution.ts");
  const dangerousFocus = readFocusByProjectPath(generatedContext, "agent-workflow/dangerous.ts");

  assert(safeFocus.risk.modificationRisk === "safe", "Safe fixture should be low-risk");
  assert(
    safeFocus.risk.decision === "proceed_with_targeted_checks",
    "Safe focus should allow targeted checks"
  );
  assert(cautionFocus.risk.modificationRisk === "caution", "Caution fixture should be caution risk");
  assert(
    cautionFocus.risk.decision === "proceed_only_after_callers_are_checked",
    "Caution focus should require caller inspection"
  );
  assert(dangerousFocus.risk.modificationRisk === "dangerous", "Dangerous fixture should be dangerous risk");
  assert(
    dangerousFocus.risk.decision === "announce_risk_then_proceed_with_contract_guardrails",
    "Dangerous focus should require risk announcement and contract guardrails"
  );
  assert(
    dangerousFocus.agentPreflight.some((line) =>
      line.includes("DANGER: 5 importers") &&
      line.includes("contract-preserving") &&
      line.includes("stop before public contract")
    ),
    "Dangerous focus should tell agents to announce risk and stop before contract changes"
  );
  assertIncludes(
    dangerousFocus.changeContract.askFirstWhen,
    "A public export, function/type signature, return shape, type structure, or runtime behavior would change",
    "Dangerous focus missed contract-change ask-first rule"
  );
  assertIncludes(
    dangerousFocus.verificationTargets.files,
    "agent-workflow/danger-consumer-1.ts",
    "Dangerous focus missed verification target"
  );
  assert(
    generatedContext.riskPolicy.dangerous === "Announce high blast radius. For exact paths, proceed only with single-file contract-preserving edits; stop before public contract, behavior, caller, or multi-file changes.",
    "Project context dangerous policy is not explicit"
  );
  assert(
    generatedContext.agentTasks.modifyExistingFile.some((step) =>
      step.includes("announce the importer count")
    ),
    "Modify-file task instructions missed dangerous risk announcement"
  );
  assert(
    workflow.includes("AGENTS.md, CLAUDE.md, or .cursorrules"),
    "WORKFLOW.md should name supported agent instruction files"
  );
  assert(
    workflow.includes("If the user gave only a basename") &&
    workflow.includes("availableFocusFilesByBasename"),
    "WORKFLOW.md should require basename ambiguity checks"
  );
  assert(
    workflow.includes("DANGEROUS FILE PROTOCOL") &&
      workflow.includes("Exact path, dangerous file") &&
      workflow.includes("Contract change required"),
    "WORKFLOW.md should include the three-case dangerous file protocol"
  );
  assert(
    workflow.includes("Wait for confirmation before writing any code."),
    "WORKFLOW.md should require confirmation before complex edits"
  );
  assert(
    workflow.includes("agent-workflow/dangerous.ts (5 importers)"),
    "WORKFLOW.md should surface dangerous high-blast file"
  );
  assert(
    workflow.includes("agent-workflow/dangerous.ts [dangerous]"),
    "WORKFLOW.md should surface dangerous focus file"
  );
  engine.dispose();

  resetCapturedRuntime();
  vscodeMock.window.activeTextEditor = {
    document: makeDocument(path.join(workspaceRoot, "agent-workflow", "dangerous.ts")),
  };

  const context = {
    extensionUri: Uri.file(repoRoot),
    globalState: {
      get() {},
      update() {
        return Promise.resolve();
      },
    },
    subscriptions: captured.subscriptions,
    workspaceState: {
      get(key) {
        return captured.state.get(key);
      },
      update(key, value) {
        captured.state.set(key, value);
        return Promise.resolve();
      },
    },
  };

  await extension.activate(context);
  await waitFor(() =>
    captured.panels.some((panel) => panel.viewType === "rippleInsight"),
    "Ripple setup panel for agent workflow"
  );

  const setupPanel = captured.panels.find((panel) => panel.viewType === "rippleInsight");
  assert(setupPanel.webview.html.includes("Activate AI Mode"), "Setup panel missed activation button");
  setupPanel.webview.callbacks.forEach((callback) => callback({ command: "activate" }));
  await sleep(0);

  const agentsPath = path.join(workspaceRoot, "AGENTS.md");
  assert(fs.existsSync(agentsPath), "Setup activation did not create AGENTS.md");
  const agentsContent = fs.readFileSync(agentsPath, "utf8");
  assert(agentsContent.includes("<!-- RIPPLE:START -->"), "AGENTS.md missing Ripple start marker");
  assert(agentsContent.includes("<!-- RIPPLE:END -->"), "AGENTS.md missing Ripple end marker");
  assert(agentsContent.includes("YOUR AUTOMATIC PROTOCOL"), "AGENTS.md missing workflow protocol");
  assert(
    agentsContent.includes("agent-workflow/dangerous.ts (5 importers)"),
    "AGENTS.md missed dangerous high-blast file"
  );
  assert(
    captured.state.get("ripple.insight.activated") === true,
    "Setup activation did not mark workspace as activated"
  );

  await captured.commands.get("ripple.copyPrompt")();
  await sleep(0);
  assert(
    captured.clipboard.includes("File: agent-workflow/dangerous.ts | Risk: DANGEROUS | 5 importers"),
    "Dangerous Copy Prompt missed risk summary"
  );
  assert(
    captured.clipboard.includes("High blast radius") &&
      captured.clipboard.includes("contract-preserving") &&
      captured.clipboard.includes("stop before public contract"),
    "Dangerous Copy Prompt missed contract-guarded risk guidance"
  );
  assert(
    captured.clipboard.includes("Project rules: .ripple/WORKFLOW.md"),
    "Dangerous Copy Prompt missed workflow pointer"
  );

  context.subscriptions.forEach((subscription) => {
    try {
      subscription.dispose?.();
    } catch {
      // Best-effort cleanup.
    }
  });
  extension.deactivate?.();
});

test("History context records exact paths and call-edge removals", async ({ GraphEngine }) => {
  const engine = new GraphEngine(workspaceRoot);
  await engine.initialScan();

  let storedHistory = readWorkspaceJson(".ripple", "history.json");
  const baselineEvents = storedHistory.filter((event) => event.type === "baseline_snapshot");
  assert(baselineEvents.length === 1, `Fixture scan should have one baseline event, got ${baselineEvents.length}`);
  const existingFixtureSources = [
    path.join(workspaceRoot, "src", "normalizer.ts"),
    path.join(workspaceRoot, "src", "graph.ts"),
    path.join(workspaceRoot, "src", "extension.ts"),
    path.join(workspaceRoot, "src", "index.ts"),
  ];
  assert(
    !storedHistory.some((event) =>
      event.type === "file_created" && existingFixtureSources.includes(event.source)
    ),
    "Fixture scan should not record existing project files as file_created"
  );

  const normalizerPath = path.join(workspaceRoot, "src", "normalizer.ts");
  const graphPath = path.join(workspaceRoot, "src", "graph.ts");
  const normalizeValueBefore = `export function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}`;
  const normalizeValueAfter = `export function normalizeValue(value: string): string {
  const graphed = buildGraph([value])[0];
  return graphed.trim().toUpperCase();
}`;
  const normalizerNext = `
import { buildGraph } from "./graph";

${normalizeValueAfter}

export const expandValue = (value: string): string => {
  return normalizeValue(value).padStart(3, "0");
};
`;

  fs.writeFileSync(normalizerPath, normalizerNext.trimStart());
  engine.updateFile(normalizerPath);
  engine.dispose();

  const lastGroupId = (() => {
    for (let i = engine.history.events.length - 1; i >= 0; i--) {
      if (engine.history.events[i].changeGroup) {
        return engine.history.events[i].changeGroup;
      }
    }
    return null;
  })();
  assert(lastGroupId, "Update did not create a history changeGroup");

  const updateGroup = engine.history.getGroup(lastGroupId);
  const normalizeSym = `${normalizerPath}::normalizeValue`;
  const resolveSym = `${normalizerPath}::resolveValue`;
  const expandSym = `${normalizerPath}::expandValue`;
  const buildGraphSym = `${graphPath}::buildGraph`;
  const hasEvent = (type, source, target) =>
    updateGroup.some((event) =>
      event.type === type &&
      event.source === source &&
      (target === undefined || event.target === target)
    );

  assert(hasEvent("import_added", normalizerPath, graphPath), "History missed added graph import");
  assert(hasEvent("symbol_modified", normalizeSym), "History missed normalizeValue modification");
  assert(hasEvent("symbol_deleted", resolveSym), "History missed resolveValue deletion");
  assert(hasEvent("symbol_created", expandSym), "History missed expandValue creation");
  assert(hasEvent("call_removed", resolveSym, normalizeSym), "History missed call removal from deleted symbol");
  assert(hasEvent("call_added", normalizeSym, buildGraphSym), "History missed new buildGraph call");
  assert(hasEvent("call_added", expandSym, normalizeSym), "History missed new expandValue call");

  const modifiedEvent = updateGroup.find((event) => event.type === "symbol_modified" && event.source === normalizeSym);
  assert(modifiedEvent.previousHash === sha1Text(normalizeValueBefore), "previousHash did not match old symbol text");
  assert(modifiedEvent.symbolHash === sha1Text(normalizeValueAfter), "symbolHash did not match new symbol text");

  let context = readWorkspaceJson(".ripple", ".cache", "context.json");
  assertIncludes(context.lastChangeGroup.filesChanged, "src/normalizer.ts", "lastChangeGroup missed changed file");
  assert(
    context.lastChangeGroup.filesChanged.length === 1,
    `lastChangeGroup.filesChanged should contain only edited files, got ${JSON.stringify(context.lastChangeGroup.filesChanged)}`
  );
  assertIncludes(context.lastChangeGroup.relatedFiles, "src/graph.ts", "lastChangeGroup missed related import target");
  assertIncludes(
    context.lastChangeGroup.symbolsChanged,
    "src/normalizer.ts::normalizeValue",
    "lastChangeGroup missed path-qualified symbol"
  );
  assertIncludes(
    context.queryHints.recentlyChangedFiles,
    "src/normalizer.ts",
    "recentlyChangedFiles missed path-qualified edit"
  );
  assertIncludes(
    context.queryHints.highRiskSymbols,
    "src/normalizer.ts::normalizeValue",
    "highRiskSymbols should be path-qualified"
  );

  const alphaPath = writeWorkspaceFile("packages/alpha/src/index.ts", `
export function bootAlpha(): string {
  return "alpha";
}
`);
  const betaPath = writeWorkspaceFile("packages/beta/src/index.ts", `
export function bootBeta(): string {
  return "beta";
}
`);

  engine.addFile(alphaPath);
  engine.addFile(betaPath);
  engine.dispose();

  storedHistory = readWorkspaceJson(".ripple", "history.json");
  assert(
    storedHistory.some((event) => event.type === "file_created" && event.source === toWorkspacePath(alphaPath)),
    "History missed alpha index file_created"
  );
  assert(
    storedHistory.some((event) => event.type === "file_created" && event.source === toWorkspacePath(betaPath)),
    "History missed beta index file_created"
  );
  assert(
    !JSON.stringify(storedHistory).includes(workspaceRoot),
    "Persisted history should use project-relative paths"
  );

  context = readWorkspaceJson(".ripple", ".cache", "context.json");
  assertIncludes(
    context.queryHints.recentlyChangedFiles,
    "packages/alpha/src/index.ts",
    "recentlyChangedFiles collapsed alpha/index.ts"
  );
  assertIncludes(
    context.queryHints.recentlyChangedFiles,
    "packages/beta/src/index.ts",
    "recentlyChangedFiles collapsed beta/index.ts"
  );
  assert(
    !context.queryHints.recentlyChangedFiles.includes("index.ts"),
    `recentlyChangedFiles should not use ambiguous basenames: ${JSON.stringify(context.queryHints.recentlyChangedFiles)}`
  );
  assertIncludes(
    context.lastChangeGroup.filesChanged,
    "packages/beta/src/index.ts",
    "lastChangeGroup collapsed duplicate basename"
  );
  assert(
    !context.lastChangeGroup.filesChanged.includes("index.ts"),
    `lastChangeGroup.filesChanged should not use ambiguous basenames: ${JSON.stringify(context.lastChangeGroup.filesChanged)}`
  );
  assertIncludes(
    context.ambiguousFocusFileNames["index.ts"],
    "packages/alpha/src/index.ts",
    "Focus lookup missed alpha duplicate basename"
  );
  assertIncludes(
    context.ambiguousFocusFileNames["index.ts"],
    "packages/beta/src/index.ts",
    "Focus lookup missed beta duplicate basename"
  );
  assert(
    context.availableFocusFilesByBasename["index.ts"]?.status === "ambiguous",
    "Context should mark duplicate basename lookup as ambiguous"
  );
  assertIncludes(
    context.ambiguousFocusFileMatches["index.ts"].map((match) => match.path),
    "packages/alpha/src/index.ts",
    "Structured ambiguous lookup missed alpha duplicate basename"
  );
  assert(
    !context.availableFocusFiles["packages/alpha/src/index.ts"],
    "availableFocusFiles should only contain unique basename shortcuts"
  );

  engine.dispose();
});

test("History audit records every event type accurately", async ({ GraphEngine }) => {
  const auditRoot = path.join(workspaceRoot, "audit-history");
  await cleanDirEventually(auditRoot, false);
  fs.mkdirSync(auditRoot, { recursive: true });

  const engine = new GraphEngine(workspaceRoot);
  await engine.initialScan();

  const basePath = path.join(auditRoot, "base.ts");
  const consumerPath = path.join(auditRoot, "consumer.ts");
  const baseSymbol = `${basePath}::baseValue`;
  const consumeSymbol = `${consumerPath}::consume`;
  const addedSymbol = `${consumerPath}::addedSymbol`;

  const baseValueText = `export function baseValue(): string {
  return "base";
}`;
  const consumerBeforeText = `export function consume(): string {
  return baseValue();
}`;
  const consumerAfterText = `export function consume(): string {
  return "manual";
}`;
  const addedSymbolText = `export function addedSymbol(): string {
  return consume();
}`;

  const baseContent = `${baseValueText}
`;
  const consumerBeforeContent = `import { baseValue } from "./base";

${consumerBeforeText}
`;
  const consumerAfterContent = `${consumerAfterText}

${addedSymbolText}
`;
  const consumerFinalContent = `${consumerAfterText}
`;

  const latestGroupId = () => {
    for (let i = engine.history.events.length - 1; i >= 0; i--) {
      if (engine.history.events[i].changeGroup) {
        return engine.history.events[i].changeGroup;
      }
    }
    return null;
  };
  const findEvent = (events, type, source, target) =>
    events.find((event) =>
      event.type === type &&
      event.source === source &&
      (target === undefined || event.target === target)
    );
  const assertEvent = (events, type, source, target) => {
    const event = findEvent(events, type, source, target);
    assert(
      event,
      `Missing ${type}: ${source}${target ? ` -> ${target}` : ""} in ${JSON.stringify(events)}`
    );
    return event;
  };
  const groupAfter = (action) => {
    action();
    const groupId = latestGroupId();
    assert(groupId, "History action did not create a changeGroup");
    return { groupId, events: engine.history.getGroup(groupId) };
  };

  const baselineEvent = engine.history.events.find((event) => event.type === "baseline_snapshot");
  assert(baselineEvent, "History audit missing baseline_snapshot");
  assert(/^files:\d+\|symbols:\d+$/.test(baselineEvent.metadata ?? ""), "baseline_snapshot metadata is inaccurate");

  const baseCreate = groupAfter(() => {
    fs.writeFileSync(basePath, baseContent);
    engine.addFile(basePath);
  });
  const baseCreated = assertEvent(baseCreate.events, "file_created", basePath);
  assert(baseCreated.fileHash === sha1Text(baseContent), "file_created fileHash for base.ts is inaccurate");
  const baseSymbolCreated = assertEvent(baseCreate.events, "symbol_created", baseSymbol);
  assert(baseSymbolCreated.kind === "function", "baseValue symbol_created kind is inaccurate");
  assert(baseSymbolCreated.symbolHash === sha1Text(baseValueText), "baseValue symbolHash is inaccurate");

  const consumerCreate = groupAfter(() => {
    fs.writeFileSync(consumerPath, consumerBeforeContent);
    engine.addFile(consumerPath);
  });
  const consumerCreated = assertEvent(consumerCreate.events, "file_created", consumerPath);
  assert(consumerCreated.fileHash === sha1Text(consumerBeforeContent), "file_created fileHash for consumer.ts is inaccurate");
  const consumeCreated = assertEvent(consumerCreate.events, "symbol_created", consumeSymbol);
  assert(consumeCreated.symbolHash === sha1Text(consumerBeforeText), "consume symbol_created hash is inaccurate");
  assertEvent(consumerCreate.events, "import_added", consumerPath, basePath);
  const initialCallAdded = assertEvent(consumerCreate.events, "call_added", consumeSymbol, baseSymbol);
  assert(initialCallAdded.targetCallerCount === 1, "call_added targetCallerCount for baseValue is inaccurate");

  const consumerUpdate = groupAfter(() => {
    fs.writeFileSync(consumerPath, consumerAfterContent);
    engine.updateFile(consumerPath);
  });
  assertEvent(consumerUpdate.events, "import_removed", consumerPath, basePath);
  assertEvent(consumerUpdate.events, "call_removed", consumeSymbol, baseSymbol);
  const consumeModified = assertEvent(consumerUpdate.events, "symbol_modified", consumeSymbol);
  assert(consumeModified.previousHash === sha1Text(consumerBeforeText), "symbol_modified previousHash is inaccurate");
  assert(consumeModified.symbolHash === sha1Text(consumerAfterText), "symbol_modified symbolHash is inaccurate");
  const addedCreated = assertEvent(consumerUpdate.events, "symbol_created", addedSymbol);
  assert(addedCreated.kind === "function", "addedSymbol symbol_created kind is inaccurate");
  assert(addedCreated.symbolHash === sha1Text(addedSymbolText), "addedSymbol symbolHash is inaccurate");
  assertEvent(consumerUpdate.events, "call_added", addedSymbol, consumeSymbol);

  const consumerDeleteSymbol = groupAfter(() => {
    fs.writeFileSync(consumerPath, consumerFinalContent);
    engine.updateFile(consumerPath);
  });
  assertEvent(consumerDeleteSymbol.events, "call_removed", addedSymbol, consumeSymbol);
  assertEvent(consumerDeleteSymbol.events, "symbol_deleted", addedSymbol);

  const consumerDeleteFile = groupAfter(() => {
    engine.removeFile(consumerPath);
  });
  assertEvent(consumerDeleteFile.events, "symbol_deleted", consumeSymbol);
  assertEvent(consumerDeleteFile.events, "file_deleted", consumerPath);

  engine.dispose();

  const expectedTypes = [
    "baseline_snapshot",
    "file_created",
    "file_deleted",
    "symbol_created",
    "symbol_modified",
    "symbol_deleted",
    "import_added",
    "import_removed",
    "call_added",
    "call_removed",
  ];
  const recordedTypes = new Set(engine.history.events.map((event) => event.type));
  expectedTypes.forEach((type) => {
    assert(recordedTypes.has(type), `History audit did not generate ${type}`);
  });

  const storedHistory = readWorkspaceJson(".ripple", "history.json");
  assert(!JSON.stringify(storedHistory).includes(workspaceRoot), "history.json should not expose workspaceRoot");
  expectedTypes.forEach((type) => {
    assert(storedHistory.some((event) => event.type === type), `Persisted history missed ${type}`);
  });

  const storedConsumerUpdate = storedHistory.filter((event) => event.changeGroup === consumerUpdate.groupId);
  assertEvent(storedConsumerUpdate, "import_removed", "audit-history/consumer.ts", "audit-history/base.ts");
  const storedModified = assertEvent(
    storedConsumerUpdate,
    "symbol_modified",
    "audit-history/consumer.ts::consume"
  );
  assert(storedModified.previousHash === sha1Text(consumerBeforeText), "Persisted previousHash is inaccurate");
  assert(storedModified.symbolHash === sha1Text(consumerAfterText), "Persisted symbolHash is inaccurate");

  const storedConsumerDelete = storedHistory.filter((event) => event.changeGroup === consumerDeleteFile.groupId);
  assertEvent(storedConsumerDelete, "symbol_deleted", "audit-history/consumer.ts::consume");
  assertEvent(storedConsumerDelete, "file_deleted", "audit-history/consumer.ts");

  const reloadedEngine = new GraphEngine(workspaceRoot);
  const reloadedConsumerUpdate = reloadedEngine.history.getGroup(consumerUpdate.groupId);
  assertEvent(reloadedConsumerUpdate, "import_removed", consumerPath, basePath);
  assertEvent(reloadedConsumerUpdate, "symbol_modified", consumeSymbol);
  reloadedEngine.dispose();
});

async function main() {
  createFixtureWorkspace();
  const mocks = installMocks();

  try {
    clearCompiledModuleCache();
    const { GraphEngine } = require(path.join(repoRoot, "out", "packages", "core", "src", "index.js"));
    const extension = require(path.join(repoRoot, "out", "extension.js"));

    const context = {
      extension,
      GraphEngine,
      vscodeMock: mocks.vscodeMock,
    };

    for (const entry of tests) {
      await entry.fn(context);
      console.log(`ok - ${entry.name}`);
    }

    console.log(`\n${tests.length} test files passed through the real Ripple feature surface.`);
  } finally {
    mocks.restore();
    await cleanDirEventually(workspaceRoot, false);
  }
}

main().catch((err) => {
  console.error(`\nnot ok - ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
