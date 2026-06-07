const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const rootPackage = readJson(path.join(repoRoot, "package.json"));

const packages = [
  {
    name: "@getripple/core",
    dir: "packages/core",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    requiredFiles: ["package.json", "README.md", "CHANGELOG.md", "dist/index.js", "dist/index.d.ts"],
    requiredReadmeText: [
      "npm install @getripple/core",
      "GraphEngine",
      "Trust Boundary Contract",
    ],
    requiredKeywords: ["ai-agent", "drift-control", "trust-boundaries"],
  },
  {
    name: "@getripple/cli",
    dir: "packages/cli",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    bin: {
      ripple: "dist/index.js",
    },
    requiredFiles: ["package.json", "README.md", "CHANGELOG.md", "dist/index.js", "dist/index.d.ts"],
    requiredReadmeText: [
      "npm install -g @getripple/cli",
      "npx -y @getripple/cli doctor",
      "ripple init",
      "ripple gate",
    ],
    requiredKeywords: ["ai-agent", "cli", "ci", "drift-control"],
  },
  {
    name: "@getripple/mcp",
    dir: "packages/mcp",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    bin: {
      "ripple-mcp": "dist/server.js",
    },
    requiredFiles: [
      "package.json",
      "README.md",
      "CHANGELOG.md",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/server.js",
      "dist/server.d.ts",
      "examples/published.config.json",
    ],
    requiredReadmeText: [
      "npx",
      "@getripple/mcp",
      "ripple-mcp --workspace",
      "ripple_get_agent_workflow",
      "ripple_gate",
    ],
    requiredKeywords: ["ai-agent", "mcp", "stdio", "drift-control"],
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function runNpm(args, cwd) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return execFileSync(process.execPath, [npmExecPath, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return execFileSync(npmCommand, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function packagePath(pkg, relativePath = "") {
  return path.join(repoRoot, pkg.dir, relativePath);
}

function assertPackageMetadata(pkg) {
  const packageJson = readJson(packagePath(pkg, "package.json"));
  assert.strictEqual(packageJson.name, pkg.name, `${pkg.name} name`);
  assert.strictEqual(packageJson.version, rootPackage.version, `${pkg.name} version`);
  assert.strictEqual(packageJson.license, "MIT", `${pkg.name} license`);
  assert.strictEqual(packageJson.type, "commonjs", `${pkg.name} type`);
  assert.strictEqual(packageJson.main, pkg.main, `${pkg.name} main`);
  assert.strictEqual(packageJson.types, pkg.types, `${pkg.name} types`);
  assert.deepStrictEqual(packageJson.bin ?? undefined, pkg.bin, `${pkg.name} bin`);
  assert(Array.isArray(packageJson.files), `${pkg.name} files`);
  assert(packageJson.files.includes("dist"), `${pkg.name} should publish dist`);
  assert(packageJson.files.includes("CHANGELOG.md"), `${pkg.name} should publish changelog`);
  assert(packageJson.description.length >= 40, `${pkg.name} should have a real description`);
  assert.strictEqual(packageJson.repository?.type, "git", `${pkg.name} repository type`);
  assert.strictEqual(
    packageJson.repository?.url,
    "git+https://github.com/raushankcode/ripple.git",
    `${pkg.name} repository url`,
  );
  assert.strictEqual(
    packageJson.repository?.directory,
    pkg.dir.replace(/\\/g, "/"),
    `${pkg.name} repository directory`,
  );
  assert.strictEqual(
    packageJson.bugs?.url,
    "https://github.com/raushankcode/ripple/issues",
    `${pkg.name} bugs url`,
  );
  assert.strictEqual(
    packageJson.homepage,
    "https://raushankcode.github.io/ripple/",
    `${pkg.name} homepage`,
  );
  assert.strictEqual(packageJson.engines?.node, ">=18", `${pkg.name} node engine`);
  assert.strictEqual(packageJson.publishConfig?.access, "public", `${pkg.name} publish access`);

  for (const keyword of pkg.requiredKeywords) {
    assert(
      packageJson.keywords?.includes(keyword),
      `${pkg.name} keywords should include ${keyword}`,
    );
  }

  if (pkg.name === "@getripple/core") {
    assert(packageJson.dependencies?.glob, "@getripple/core should depend on glob");
    assert(packageJson.dependencies?.["ts-morph"], "@getripple/core should depend on ts-morph");
  } else {
    assert.strictEqual(
      packageJson.dependencies?.["@getripple/core"],
      `^${rootPackage.version}`,
      `${pkg.name} should depend on the compatible @getripple/core release range`,
    );
  }
}

function assertReadme(pkg) {
  const readme = readText(packagePath(pkg, "README.md"));
  for (const requiredText of pkg.requiredReadmeText) {
    assert(
      readme.includes(requiredText),
      `${pkg.name} README should include ${requiredText}`,
    );
  }
}

function assertPackDryRun(pkg) {
  const output = runNpm(["pack", "--dry-run", "--json"], packagePath(pkg));
  const [packed] = JSON.parse(output);
  assert.strictEqual(packed.name, pkg.name, `${pkg.name} packed name`);
  assert.strictEqual(packed.version, rootPackage.version, `${pkg.name} packed version`);

  const packedFiles = new Set(packed.files.map((file) => file.path));
  for (const requiredFile of pkg.requiredFiles) {
    assert(
      packedFiles.has(requiredFile),
      `${pkg.name} pack should include ${requiredFile}`,
    );
  }
}

function assertMcpPublishedConfig() {
  const config = readJson(packagePath(
    { dir: "packages/mcp" },
    "examples/published.config.json",
  ));
  const ripple = config.mcpServers?.ripple;
  assert.strictEqual(ripple?.command, "npx");
  assert.deepStrictEqual(ripple?.args?.slice(0, 3), ["-y", "@getripple/mcp", "--workspace"]);
  assert.strictEqual(ripple?.args?.[3], "/absolute/path/to/your/repo");
}

function assertRootDocs() {
  const readme = readText(path.join(repoRoot, "README.md"));
  const requiredText = [
    "@getripple/cli",
    "@getripple/mcp",
    "npm run proof:agent-control",
    "npm run release:check",
    "npm run release:identity",
    "npm run release:npm-preflight -- --live",
    "npm run proof:release-check",
    "npm run smoke:post-publish -- --live",
    "npm run proof:publish-readiness",
    "npm run proof:mcp-package-install",
    "RELEASE.md",
  ];
  for (const text of requiredText) {
    assert(readme.includes(text), `Root README should include ${text}`);
  }
}

function main() {
  for (const pkg of packages) {
    assertPackageMetadata(pkg);
    assertReadme(pkg);
    assertPackDryRun(pkg);
  }

  assertMcpPublishedConfig();
  assertRootDocs();

  console.log("Ripple package publish-readiness proof passed");
  console.log("Packages: @getripple/core, @getripple/cli, @getripple/mcp");
  console.log("Checked: metadata, docs, entry points, bins, npm pack dry-run, MCP published config");
}

main();
