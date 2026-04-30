/**
 * normalizer.ts — Ripple
 * Resolves TypeScript/JavaScript import specifiers to absolute file paths.
 *
 * Resolution order:
 *   1. Scoped @org/package specifiers → check tsconfig aliases first, else null
 *   2. Bare node_modules specifiers   → null immediately
 *   3. Style files (.css/.scss/.sass/.less) → null (graph.ts handles directly)
 *   4. Relative imports (./)          → resolve from importer directory
 *   5. tsconfig.json path aliases     → read and cache from tsconfig.json
 *   6. @/ alias fallback              → maps to workspaceRoot (Next.js default)
 *
 * WINDOWS PATH RULE:
 *   All returned paths use forward slashes.
 *   graph.ts converts to OS-native paths via toGraphPath() before use.
 *
 * FIXES:
 *   Fix 1 — trailing comma handling in tsconfig.json (JSON.parse crash fix)
 *   Fix 2 — scoped @org/package fast exit prevents alias cache pollution
 *   Fix 3 — tsconfig watcher invalidates cache (wired in extension.ts)
 */

import * as path from "path";
import * as fs from "fs";

// ────────────────────────────────────────────────────────────────────────────
// TSCONFIG ALIAS CACHE
// ────────────────────────────────────────────────────────────────────────────

interface AliasEntry {
  prefix: string;
  wildcard: boolean;
  targets: string[];
}

// Cache keyed by workspaceRoot.
// Invalidated when tsconfig.json changes via clearAliasCache() called from
// extension.ts onDidChange watcher. Without invalidation, path alias changes
// during a session would require a full VS Code restart to take effect.
const aliasCache = new Map<string, AliasEntry[]>();

function loadAliases(workspaceRoot: string): AliasEntry[] {
  if (aliasCache.has(workspaceRoot)) {
    return aliasCache.get(workspaceRoot)!;
  }

  const entries: AliasEntry[] = [];

  const tsconfigPath = path.join(workspaceRoot, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) {
    try {
      const raw = fs.readFileSync(tsconfigPath, "utf8");

      // Strip single-line comments (// ...) and block comments (/* ... */)
      // tsconfig.json files commonly use comments — standard JSON rejects them
      const stripped = raw
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");

      // Fix 1: Strip trailing commas before closing braces/brackets.
      // tsconfig.json allows trailing commas — standard JSON.parse does not.
      // A trailing comma crash silently empties the alias cache, breaking all
      // alias resolution for the session without any visible error to the user.
      const cleaned = stripped.replace(/,\s*([}\]])/g, "$1");

      const tsconfig = JSON.parse(cleaned);
      const compilerOptions = tsconfig?.compilerOptions ?? {};
      const paths: Record<string, string[]> = compilerOptions?.paths ?? {};
      const baseUrl: string = compilerOptions?.baseUrl ?? ".";
      const baseDir = path.resolve(workspaceRoot, baseUrl);

      Object.entries(paths).forEach(([alias, targets]) => {
        if (!Array.isArray(targets)) return;

        const isWildcard = alias.endsWith("/*");
        const prefix = isWildcard ? alias.slice(0, -1) : alias;

        const resolvedTargets = targets.map((t: string) => {
          const clean =
            isWildcard && t.endsWith("/*") ? t.slice(0, -2) : t;
          return path.resolve(baseDir, clean);
        });

        entries.push({
          prefix,
          wildcard: isWildcard,
          targets: resolvedTargets,
        });
      });
    } catch {
      // tsconfig unreadable or malformed — fall through to @/ fallback.
      // This is non-fatal: relative imports still resolve correctly.
      console.warn(
        "[Ripple] tsconfig.json could not be parsed — using @/ fallback only"
      );
    }
  }

  aliasCache.set(workspaceRoot, entries);
  return entries;
}

// ────────────────────────────────────────────────────────────────────────────
// EXTENSION RESOLUTION
// ────────────────────────────────────────────────────────────────────────────

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

function resolveWithExtension(absolutePath: string): string | null {
  // Try exact path first (file with explicit extension in import)
  if (fs.existsSync(absolutePath)) {
    try {
      if (fs.statSync(absolutePath).isFile()) return absolutePath;
    } catch {
      // stat failed — continue to extension probing
    }
  }

  // Try appending each extension: file.ts, file.tsx, file.js, file.jsx
  for (const ext of EXTENSIONS) {
    const candidate = absolutePath + ext;
    if (fs.existsSync(candidate)) return candidate;
  }

  // Try as directory with index file: dir/index.ts, dir/index.tsx, etc.
  for (const ext of EXTENSIONS) {
    const candidate = path.join(absolutePath, `index${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves an import specifier to an absolute file path.
 *
 * Returns null for:
 *   - node_modules packages (can't be analysed as project source)
 *   - style files (graph.ts handles those directly)
 *   - unresolvable paths (file doesn't exist on disk)
 *
 * Returns a forward-slash path string on success.
 * Call toGraphPath() in graph.ts to convert to OS-native separators.
 */
export function normalizeImportPath(
  specifier: string,
  importerPath: string,
  workspaceRoot: string
): string | null {

  // ── Fix 2: Scoped packages — fast path with alias check ──────────────────
  // @radix-ui/react-dialog, @mui/material, @tanstack/react-query, etc.
  // These look like local aliases but are npm packages.
  // Exception: tsconfig may define @scope/* aliases (e.g. @acme/ui).
  // So: check aliases first, then null if no alias matches.
  if (specifier.startsWith("@") && !specifier.startsWith("@/")) {
    const secondSlash = specifier.indexOf("/", 1);
    if (secondSlash !== -1) {
      const aliases = loadAliases(workspaceRoot);
      const matchesAlias = aliases.some((a) => specifier.startsWith(a.prefix));
      if (!matchesAlias) return null;
      // Falls through to alias resolution below if matchesAlias is true
    }
  }

  // ── Bare node_modules specifiers ─────────────────────────────────────────
  // Anything not starting with . / @ / ~ / $ / # is a package name.
  // These are never local files — return null immediately.
  if (
    !specifier.startsWith(".") &&
    !specifier.startsWith("@") &&
    !specifier.startsWith("~") &&
    !specifier.startsWith("$") &&
    !specifier.startsWith("#")
  ) {
    return null;
  }

  // ── Style files ───────────────────────────────────────────────────────────
  // CSS/SCSS/SASS/LESS are handled directly in graph.ts as style dependencies.
  // They are not TypeScript source files — return null here.
  if (
    specifier.endsWith(".css") ||
    specifier.endsWith(".scss") ||
    specifier.endsWith(".sass") ||
    specifier.endsWith(".less")
  ) {
    return null;
  }

  // ── Relative imports ──────────────────────────────────────────────────────
  // ./utils, ../components/Button, ../../lib/api
  if (specifier.startsWith(".")) {
    const importerDir = path.dirname(importerPath);
    const absolutePath = path.resolve(importerDir, specifier);
    const resolved = resolveWithExtension(absolutePath);
    if (!resolved) return null;
    return resolved.split(path.sep).join("/");
  }

  // ── tsconfig.json path aliases ────────────────────────────────────────────
  // Loaded from cache after first resolution per workspace session.
  // Common patterns: @/components/Button, ~/utils, $lib/server
  const aliases = loadAliases(workspaceRoot);

  for (const alias of aliases) {
    if (!specifier.startsWith(alias.prefix)) continue;

    const rest = alias.wildcard ? specifier.slice(alias.prefix.length) : "";

    for (const targetDir of alias.targets) {
      const absolutePath = alias.wildcard
        ? path.join(targetDir, rest)
        : targetDir;

      const resolved = resolveWithExtension(absolutePath);
      if (resolved) {
        return resolved.split(path.sep).join("/");
      }
    }
  }

  // ── @/ fallback — hardcoded for Next.js projects ─────────────────────────
  // Used when tsconfig has no paths section or @/ is not defined there.
  // Maps @/ directly to workspaceRoot — the default in every Next.js project.
  // This fallback ensures @/components/Button resolves correctly even on
  // projects that haven't configured compilerOptions.paths.
  if (specifier.startsWith("@/")) {
    const withoutAlias = specifier.slice(2);
    const absolutePath = path.join(workspaceRoot, withoutAlias);
    const resolved = resolveWithExtension(absolutePath);
    if (!resolved) return null;
    return resolved.split(path.sep).join("/");
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// CACHE MANAGEMENT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Clears the alias cache for a workspace.
 *
 * Called from extension.ts when tsconfig.json changes during a session.
 * Without this, developers who add or modify path aliases would see stale
 * resolution until they restart VS Code — a very confusing experience.
 *
 * Wired in extension.ts:
 *   const tsconfigWatcher = vscode.workspace.createFileSystemWatcher("** /tsconfig.json");
 *   tsconfigWatcher.onDidChange(() => clearAliasCache(workspaceRoot));
 */
export function clearAliasCache(workspaceRoot: string): void {
  aliasCache.delete(workspaceRoot);
}