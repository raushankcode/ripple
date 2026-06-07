const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const rootPackage = readJson(path.join(repoRoot, "package.json"));
const version = rootPackage.version;
const live = process.argv.includes("--live");
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const publicPackages = [
  {
    name: "@getripple/core",
    dir: "packages/core",
    publish: "npm publish --workspace @getripple/core",
  },
  {
    name: "@getripple/cli",
    dir: "packages/cli",
    publish: "npm publish --workspace @getripple/cli",
    dependsOnCore: true,
  },
  {
    name: "@getripple/mcp",
    dir: "packages/mcp",
    publish: "npm publish --workspace @getripple/mcp",
    dependsOnCore: true,
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function npmRunnable(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
    };
  }

  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args,
  };
}

function runNpm(args, options = {}) {
  const runnable = npmRunnable(args);
  try {
    const stdout = execFileSync(runnable.command, runnable.args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: true,
      stdout,
      stderr: "",
    };
  } catch (err) {
    if (!options.allowFailure) {
      throw err;
    }
    return {
      ok: false,
      stdout: err.stdout?.toString?.() ?? "",
      stderr: err.stderr?.toString?.() ?? "",
      error: err,
    };
  }
}

function assertLocalPackageReadiness() {
  assert(SEMVER_RE.test(rootPackage.version), "root version should be a semver release");
  assert.deepStrictEqual(rootPackage.workspaces, [
    "packages/core",
    "packages/cli",
    "packages/mcp",
  ]);

  for (const pkg of publicPackages) {
    const packageJson = readJson(path.join(repoRoot, pkg.dir, "package.json"));
    assert.strictEqual(packageJson.name, pkg.name, `${pkg.name} name`);
    assert.strictEqual(packageJson.version, version, `${pkg.name} version`);
    assert.strictEqual(packageJson.publishConfig?.access, "public", `${pkg.name} public access`);
    assert.strictEqual(packageJson.license, "MIT", `${pkg.name} license`);
    if (pkg.dependsOnCore) {
      assert.strictEqual(
        packageJson.dependencies?.["@getripple/core"],
        `^${version}`,
        `${pkg.name} depends on compatible release core range`,
      );
    }
  }
}

function versionExistsResult(pkg) {
  const spec = `${pkg.name}@${version}`;
  const result = runNpm(["view", spec, "version", "--json"], {
    allowFailure: true,
  });
  if (result.ok) {
    const publishedVersion = result.stdout.trim().replace(/^"|"$/g, "");
    return {
      exists: publishedVersion === version,
      detail: publishedVersion || "found",
    };
  }

  const combined = `${result.stdout}\n${result.stderr}`;
  if (
    combined.includes("E404") ||
    combined.includes("404 Not Found") ||
    combined.includes("No match found")
  ) {
    return {
      exists: false,
      detail: "not found",
    };
  }

  throw new Error(`Could not check ${spec} on npm:\n${combined}`);
}

function scopeAccessResult() {
  const result = runNpm(["access", "ls-packages", "@getripple", "--json"], {
    allowFailure: true,
  });
  if (result.ok) {
    return {
      ok: true,
      detail: result.stdout.trim() || "{}",
    };
  }
  return {
    ok: false,
    detail: `${result.stdout}\n${result.stderr}`.trim(),
  };
}

function printDryRun() {
  console.log("Ripple npm registry preflight plan");
  console.log("");
  console.log("This command does not hit npm unless --live is passed.");
  console.log("");
  console.log("Before publishing, run:");
  console.log("  npm run release:npm-preflight -- --live");
  console.log("");
  console.log("Live mode will run read-only npm checks:");
  console.log("  npm whoami");
  console.log("  npm access ls-packages @getripple --json");
  for (const pkg of publicPackages) {
    console.log(`  npm view ${pkg.name}@${version} version --json`);
  }
  console.log("");
  console.log("Expected before publishing this version:");
  console.log("  npm whoami succeeds");
  console.log("  requested package versions are not found");
  console.log("  scope/package ownership is reviewed by the human before publish");
}

function runLivePreflight() {
  const whoami = runNpm(["whoami"]).stdout.trim();
  assert(whoami.length > 0, "npm whoami should return an account name");

  console.log("Ripple npm registry preflight");
  console.log("");
  console.log(`npm account: ${whoami}`);
  console.log(`version: ${version}`);
  console.log("");

  const scopeAccess = scopeAccessResult();
  if (scopeAccess.ok) {
    console.log("scope access:");
    console.log(scopeAccess.detail);
  } else {
    console.log("scope access:");
    console.log("  unable to confirm with npm access ls-packages");
    console.log("  review @getripple scope ownership manually before publishing");
  }
  console.log("");

  for (const pkg of publicPackages) {
    const result = versionExistsResult(pkg);
    if (result.exists) {
      throw new Error(`${pkg.name}@${version} already exists on npm. Stop before publishing.`);
    }
    console.log(`${pkg.name}@${version}: ${result.detail}`);
  }

  console.log("");
  console.log("Read-only npm checks passed.");
  console.log("This still does not prove publish permission. Human review is required before npm publish.");
}

function main() {
  assertLocalPackageReadiness();

  if (!live) {
    printDryRun();
    return;
  }

  runLivePreflight();
}

main();
