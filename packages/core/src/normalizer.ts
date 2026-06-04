/**
 * normalizer.ts — Ripple
 * Resolves TypeScript/JavaScript import specifiers to absolute file paths.
 *
 * Resolution order:
 *   1. Scoped @org/package specifiers  → check workspace packages first,
 *                                        then tsconfig aliases, else null (npm package)
 *   2. Bare node_modules specifiers    → null immediately
 *   3. Style files (.css/.scss/etc)    → null (graph.ts handles directly)
 *   4. Relative imports (./)           → resolve from importer directory
 *   5. tsconfig.json path aliases      → read and cache from tsconfig.json
 *   6. @/ alias fallback               → maps to workspaceRoot (Next.js default)
 *
 * Monorepo rule:
 *   Scoped imports may point to local workspace packages, not npm packages.
 *   loadWorkspacePackages() reads pnpm-workspace.yaml, lerna.json, or the
 *   package.json workspaces field so @my-org/utils can resolve to packages/utils.
 *
 * Path invariant:
 *   Returned paths use forward slashes. graph.ts converts them to OS-native
 *   graph keys via toGraphPath() before storing them.
 */

import * as path from "path";
import * as fs from "fs";

// ────────────────────────────────────────────────────────────────────────────
// WORKSPACE PACKAGE DETECTION
// ────────────────────────────────────────────────────────────────────────────
//
// Maps package name → absolute path to package root on disk.
// Example: "@my-org/utils" -> "packages/utils"
//
// Populated by loadWorkspacePackages(), which reads:
//   - pnpm-workspace.yaml  (pnpm monorepos)
//   - lerna.json           (Lerna monorepos)
//   - package.json         workspaces field (npm/yarn workspaces)

const workspacePackageCache = new Map<string, Map<string, string>>();

function loadWorkspacePackages(workspaceRoot: string): Map<string, string> {
  if (workspacePackageCache.has(workspaceRoot)) {
    return workspacePackageCache.get(workspaceRoot)!;
  }

  const packages = new Map<string, string>();

  // Discover which glob patterns define local packages.
  const packageGlobs: string[] = [];

  // ── pnpm-workspace.yaml ───────────────────────────────────────────────────
  const pnpmWorkspacePath = path.join(workspaceRoot, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpmWorkspacePath)) {
    try {
      const raw = fs.readFileSync(pnpmWorkspacePath, "utf8");
      // Simple YAML line parser for "packages:" sections with "- 'glob'" entries.
      // We do not pull in a full YAML parser to keep the bundle small.
      let inPackages = false;
      raw.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (trimmed === "packages:") {
          inPackages = true;
          return;
        }
        if (inPackages && trimmed.startsWith("-")) {
          // Strip leading "- " and surrounding quotes.
          const glob = trimmed
            .slice(1)
            .trim()
            .replace(/^['"]|['"]$/g, "");
          if (glob && !glob.startsWith("#")) {
            packageGlobs.push(glob);
          }
        } else if (inPackages && !trimmed.startsWith("-") && trimmed.length > 0) {
          inPackages = false;
        }
      });
    } catch { /* malformed yaml — skip */ }
  }

  // ── lerna.json ────────────────────────────────────────────────────────────
  const lernaPath = path.join(workspaceRoot, "lerna.json");
  if (fs.existsSync(lernaPath) && packageGlobs.length === 0) {
    try {
      const lerna = JSON.parse(fs.readFileSync(lernaPath, "utf8"));
      if (Array.isArray(lerna.packages)) {
        lerna.packages.forEach((g: string) => packageGlobs.push(g));
      }
    } catch { /* malformed json — skip */ }
  }

  // ── package.json workspaces ───────────────────────────────────────────────
  const rootPkgPath = path.join(workspaceRoot, "package.json");
  if (fs.existsSync(rootPkgPath) && packageGlobs.length === 0) {
    try {
      const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
      // workspaces can be an array ["packages/*"] or an object { packages: [...] }
      const ws = pkg.workspaces;
      if (Array.isArray(ws)) {
        ws.forEach((g: string) => packageGlobs.push(g));
      } else if (ws && Array.isArray(ws.packages)) {
        ws.packages.forEach((g: string) => packageGlobs.push(g));
      }
    } catch { /* malformed json — skip */ }
  }

  if (packageGlobs.length === 0) {
    workspacePackageCache.set(workspaceRoot, packages);
    return packages;
  }

  // ── Resolve globs to actual package directories ───────────────────────────
  // Resolve simple globs manually to avoid adding a YAML/glob parser here:
  // "packages/*" → scan every directory inside packages/
  // "apps/*"     → scan every directory inside apps/
  // "packages/utils" → exact directory

  packageGlobs.forEach((glob) => {
    if (glob.endsWith("/*") || glob.endsWith("\\*")) {
      // Directory wildcard: scan one level deep.
      const baseDir = path.join(workspaceRoot, glob.slice(0, -2));
      if (!fs.existsSync(baseDir)) {return;}
      try {
        fs.readdirSync(baseDir).forEach((entry) => {
          const entryPath = path.join(baseDir, entry);
          try {
            if (!fs.statSync(entryPath).isDirectory()) {return;}
          } catch { return; }
          registerPackage(entryPath, packages);
        });
      } catch { /* unreadable directory */ }
    } else {
      // Exact path: register one package directory.
      const entryPath = path.join(workspaceRoot, glob);
      if (fs.existsSync(entryPath)) {
        registerPackage(entryPath, packages);
      }
    }
  });

  workspacePackageCache.set(workspaceRoot, packages);
  return packages;
}

/**
  * Reads a package directory and registers its package.json "name" field.
 */
function registerPackage(pkgDir: string, packages: Map<string, string>): void {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {return;}
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (pkg.name && typeof pkg.name === "string") {
      packages.set(pkg.name, pkgDir);
    }
  } catch { /* malformed package.json — skip */ }
}

/**
 * Resolves a workspace package import specifier to a local file path.
 *
 * @param specifier  e.g. "@my-org/utils" or "@my-org/utils/helpers"
 * @param packages   workspace package map from loadWorkspacePackages()
 * @returns          absolute forward-slash path to the resolved file, or null
 */
function resolveWorkspaceImport(
  specifier: string,
  packages: Map<string, string>
): string | null {
  // Exact package import, such as "@my-org/utils".
  if (packages.has(specifier)) {
    const pkgDir = packages.get(specifier)!;
    // Resolve to the package's main entry point.
    const resolved = resolvePackageEntry(pkgDir);
    return resolved ? resolved.split(path.sep).join("/") : null;
  }

  // Sub-path import, such as "@my-org/utils/helpers".
  for (const [pkgName, pkgDir] of packages) {
    if (specifier.startsWith(pkgName + "/")) {
      const subPath = specifier.slice(pkgName.length + 1);
      const absolutePath = path.join(pkgDir, subPath);
      const resolved = resolveWithExtension(absolutePath);
      if (resolved) {return resolved.split(path.sep).join("/");}

      // src/ subdirectory fallback is common in TypeScript workspace packages.
      const srcPath = path.join(pkgDir, "src", subPath);
      const resolvedSrc = resolveWithExtension(srcPath);
      if (resolvedSrc) {return resolvedSrc.split(path.sep).join("/");}
    }
  }

  return null;
}

/**
 * Resolves the main entry point of a workspace package directory.
 * Reads package.json "main", "exports", or "module" fields.
 * Falls back to src/index.ts and index.ts.
 */
function resolvePackageEntry(pkgDir: string): string | null {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));

      // Prefer package exports when present.
      if (pkg.exports) {
        const exportsMain =
          typeof pkg.exports === "string"
            ? pkg.exports
            : pkg.exports["."]?.import || pkg.exports["."]?.require || pkg.exports["."];
        if (typeof exportsMain === "string") {
          const resolved = resolveWithExtension(path.join(pkgDir, exportsMain));
          if (resolved) {return resolved;}
        }
      }

      // Fall back through common package entry fields.
      if (pkg.main) {
        const resolved = resolveWithExtension(path.join(pkgDir, pkg.main));
        if (resolved) {return resolved;}
      }

      if (pkg.module) {
        const resolved = resolveWithExtension(path.join(pkgDir, pkg.module));
        if (resolved) {return resolved;}
      }
    } catch { /* malformed package.json */ }
  }

  // TypeScript workspace packages commonly expose src/index.*.
  const srcIndex = resolveWithExtension(path.join(pkgDir, "src", "index"));
  if (srcIndex) {return srcIndex;}

  // Last package-local fallback: index.* at the package root.
  const rootIndex = resolveWithExtension(path.join(pkgDir, "index"));
  if (rootIndex) {return rootIndex;}

  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// TSCONFIG ALIAS CACHE
// ────────────────────────────────────────────────────────────────────────────

interface AliasEntry {
  prefix: string;
  wildcard: boolean;
  targets: string[];
}

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

      // tsconfig.json permits comments, but JSON.parse does not.
      const stripped = raw
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");

      // tsconfig.json also permits trailing commas.
      const cleaned = stripped.replace(/,\s*([}\]])/g, "$1");

      const tsconfig = JSON.parse(cleaned);
      const compilerOptions = tsconfig?.compilerOptions ?? {};
      const paths: Record<string, string[]> = compilerOptions?.paths ?? {};
      const baseUrl: string = compilerOptions?.baseUrl ?? ".";
      const baseDir = path.resolve(workspaceRoot, baseUrl);

      Object.entries(paths).forEach(([alias, targets]) => {
        if (!Array.isArray(targets)) {return;}

        const isWildcard = alias.endsWith("/*");
        const prefix = isWildcard ? alias.slice(0, -1) : alias;

        const resolvedTargets = targets.map((t: string) => {
          const clean = isWildcard && t.endsWith("/*") ? t.slice(0, -2) : t;
          return path.resolve(baseDir, clean);
        });

        entries.push({ prefix, wildcard: isWildcard, targets: resolvedTargets });
      });
    } catch {
      console.warn("[Ripple] tsconfig.json could not be parsed — using @/ fallback only");
    }
  }

  aliasCache.set(workspaceRoot, entries);
  return entries;
}

// ────────────────────────────────────────────────────────────────────────────
// EXTENSION RESOLUTION
// ────────────────────────────────────────────────────────────────────────────

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const RUNTIME_EXTENSION_FALLBACKS = new Set([".js", ".jsx", ".mjs", ".cjs"]);

function resolveWithExtension(absolutePath: string): string | null {
  if (fs.existsSync(absolutePath)) {
    try {
      if (fs.statSync(absolutePath).isFile()) {return absolutePath;}
    } catch { /* continue to extension probing */ }
  }

  // NodeNext/ESM TypeScript projects often import "./file.js" from source
  // while the checked-in source file is "./file.ts".
  const importedExt = path.extname(absolutePath).toLowerCase();
  if (RUNTIME_EXTENSION_FALLBACKS.has(importedExt)) {
    const withoutRuntimeExt = absolutePath.slice(0, -importedExt.length);
    for (const ext of EXTENSIONS) {
      const candidate = withoutRuntimeExt + ext;
      if (fs.existsSync(candidate)) {return candidate;}
    }
  }

  for (const ext of EXTENSIONS) {
    const candidate = absolutePath + ext;
    if (fs.existsSync(candidate)) {return candidate;}
  }

  for (const ext of EXTENSIONS) {
    const candidate = path.join(absolutePath, `index${ext}`);
    if (fs.existsSync(candidate)) {return candidate;}
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves an import specifier to an absolute file path.
 *
 * Returns null for external npm packages and unresolvable paths.
 * Returns a forward-slash path string on success.
 */
export function normalizeImportPath(
  specifier: string,
  importerPath: string,
  workspaceRoot: string
): string | null {

  // ── Scoped package resolution (@org/package) ──────────────────────────────
  // Resolution order for @org/* imports:
  //   1. Workspace packages   — local monorepo packages
  //   2. tsconfig path aliases — @scope/* aliases in tsconfig
  //   3. null                  — external npm package
  if (specifier.startsWith("@") && !specifier.startsWith("@/")) {
    const secondSlash = specifier.indexOf("/", 1);
    if (secondSlash !== -1) {
      // Prefer local workspace packages before classifying a scoped import as npm.
      const workspacePackages = loadWorkspacePackages(workspaceRoot);
      if (workspacePackages.size > 0) {
        const workspaceResolved = resolveWorkspaceImport(specifier, workspacePackages);
        if (workspaceResolved) {return workspaceResolved;}
      }

      // Then allow tsconfig aliases such as @scope/* to resolve locally.
      const aliases = loadAliases(workspaceRoot);
      const matchesAlias = aliases.some((a) => specifier.startsWith(a.prefix));
      if (!matchesAlias) {
        // Not a workspace package and not a tsconfig alias: treat as npm.
        return null;
      }
      // Falls through to tsconfig alias resolution below
    }
  }

  // ── Bare node_modules specifiers ─────────────────────────────────────────
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
  if (
    specifier.endsWith(".css") ||
    specifier.endsWith(".scss") ||
    specifier.endsWith(".sass") ||
    specifier.endsWith(".less")
  ) {
    return null;
  }

  // ── Relative imports ──────────────────────────────────────────────────────
  if (specifier.startsWith(".")) {
    const importerDir = path.dirname(importerPath);
    const absolutePath = path.resolve(importerDir, specifier);
    const resolved = resolveWithExtension(absolutePath);
    if (!resolved) {return null;}
    return resolved.split(path.sep).join("/");
  }

  // ── tsconfig.json path aliases ────────────────────────────────────────────
  const aliases = loadAliases(workspaceRoot);

  for (const alias of aliases) {
    if (!specifier.startsWith(alias.prefix)) {continue;}

    const rest = alias.wildcard ? specifier.slice(alias.prefix.length) : "";

    for (const targetDir of alias.targets) {
      const absolutePath = alias.wildcard
        ? path.join(targetDir, rest)
        : targetDir;

      const resolved = resolveWithExtension(absolutePath);
      if (resolved) {return resolved.split(path.sep).join("/");}
    }
  }

  // ── @/ fallback ───────────────────────────────────────────────────────────
  if (specifier.startsWith("@/")) {
    const withoutAlias = specifier.slice(2);
    const absolutePath = path.join(workspaceRoot, withoutAlias);
    const resolved = resolveWithExtension(absolutePath);
    if (!resolved) {return null;}
    return resolved.split(path.sep).join("/");
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// CACHE MANAGEMENT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Clears both the alias cache and workspace package cache for a workspace.
 * Called from extension.ts when tsconfig.json changes during a session.
 */
export function clearAliasCache(workspaceRoot: string): void {
  aliasCache.delete(workspaceRoot);
  workspacePackageCache.delete(workspaceRoot);
}
