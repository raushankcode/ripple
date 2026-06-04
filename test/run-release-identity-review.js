const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const rootPackage = readJson(path.join(repoRoot, "package.json"));
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const productSentence =
  "Ripple is a local AI-agent workflow engine that plans before edit, checks after edit, catches drift, and tells the agent what to fix.";

const publicPackages = [
  {
    name: "@getripple/core",
    role: "local engine",
    dir: "packages/core",
    publicEntry: "dist/index.js",
    install: "npm install @getripple/core",
    publish: "npm publish --workspace @getripple/core",
  },
  {
    name: "@getripple/cli",
    role: "terminal and CI interface",
    dir: "packages/cli",
    publicEntry: "dist/index.js",
    bin: "ripple",
    install: "npm install -g @getripple/cli",
    publish: "npm publish --workspace @getripple/cli",
  },
  {
    name: "@getripple/mcp",
    role: "agent-facing MCP stdio interface",
    dir: "packages/mcp",
    publicEntry: "dist/index.js",
    bin: "ripple-mcp",
    install: "npx -y @getripple/mcp --workspace /absolute/path/to/your/repo",
    publish: "npm publish --workspace @getripple/mcp",
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function packageJson(pkg) {
  return readJson(path.join(repoRoot, pkg.dir, "package.json"));
}

function assertIncludes(value, expected, label) {
  assert(
    value.includes(expected) || normalizeWhitespace(value).includes(normalizeWhitespace(expected)),
    `${label} should include ${expected}`,
  );
}

function normalizeWhitespace(value) {
  return value
    .replace(/(^|\n)\s*>\s?/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function assertIdentityFacts() {
  assert.strictEqual(rootPackage.name, "ripple");
  assert.strictEqual(rootPackage.displayName, "Ripple — Local AI-Agent Workflow Engine");
  assert(SEMVER_RE.test(rootPackage.version), "root version should be a semver release");
  assert.strictEqual(rootPackage.publisher, "rippleai");
  assert.strictEqual(rootPackage.author?.name, "Raushan Soni");
  assert.strictEqual(rootPackage.repository?.url, "https://github.com/raushankcode/ripple");
  assert.strictEqual(rootPackage.homepage, "https://raushankcode.github.io/ripple/");
  assert.strictEqual(rootPackage.bugs?.url, "https://github.com/raushankcode/ripple/issues");

  const rootReadme = readText(path.join(repoRoot, "README.md"));
  assertIncludes(rootReadme, productSentence, "Root README");
  assertIncludes(rootReadme, "Public alpha.", "Root README");
  assertIncludes(rootReadme, "These are signals, not proofs.", "Root README");

  for (const pkg of publicPackages) {
    const json = packageJson(pkg);
    assert.strictEqual(json.name, pkg.name, `${pkg.name} package name`);
    assert.strictEqual(json.version, rootPackage.version, `${pkg.name} version`);
    assert.strictEqual(json.license, "MIT", `${pkg.name} license`);
    assert.strictEqual(json.main, pkg.publicEntry, `${pkg.name} public entry`);
    assert.strictEqual(json.publishConfig?.access, "public", `${pkg.name} publish access`);
    assert.strictEqual(
      json.repository?.url,
      "git+https://github.com/raushankcode/ripple.git",
      `${pkg.name} repository url`,
    );
    assert.strictEqual(
      json.repository?.directory,
      pkg.dir,
      `${pkg.name} repository directory`,
    );
    if (pkg.bin) {
      assert(json.bin?.[pkg.bin], `${pkg.name} should expose ${pkg.bin}`);
    }
  }
}

function assertIdentityDocs() {
  const release = readText(path.join(repoRoot, "RELEASE.md"));
  for (const requiredText of [
    "## Release Identity Review",
    "npm run release:identity",
    productSentence,
    "Package identity",
    "Human decision",
    "Do not publish if",
  ]) {
    assertIncludes(release, requiredText, "RELEASE.md");
  }

  const rootPackageScripts = rootPackage.scripts ?? {};
  assert.strictEqual(
    rootPackageScripts["release:identity"],
    "node test/run-release-identity-review.js",
    "release:identity script",
  );
  assertIncludes(
    rootPackageScripts["release:check"],
    "npm run release:identity",
    "release:check script",
  );
}

function printIdentityReview() {
  console.log("Ripple release identity review");
  console.log("");
  console.log("Product identity:");
  console.log(`  Name: Ripple`);
  console.log(`  Version: ${rootPackage.version}`);
  console.log(`  Publisher: ${rootPackage.publisher}`);
  console.log(`  Author: ${rootPackage.author?.name}`);
  console.log(`  Repository: ${rootPackage.repository?.url}`);
  console.log(`  Homepage: ${rootPackage.homepage}`);
  console.log("");
  console.log("Public promise:");
  console.log(`  ${productSentence}`);
  console.log("");
  console.log("Package identity:");
  for (const pkg of publicPackages) {
    const json = packageJson(pkg);
    console.log(`  ${pkg.name}`);
    console.log(`    role: ${pkg.role}`);
    console.log(`    version: ${json.version}`);
    console.log(`    install: ${pkg.install}`);
    console.log(`    publish: ${pkg.publish}`);
    if (pkg.bin) {
      console.log(`    binary: ${pkg.bin} -> ${json.bin[pkg.bin]}`);
    }
  }
  console.log("");
  console.log("Human decision required:");
  console.log("  Confirm package names, npm scope ownership, version, public promise, README honesty, and alpha status before publishing.");
  console.log("  This command proves the identity review is wired; it does not approve the release for you.");
}

function main() {
  assertIdentityFacts();
  assertIdentityDocs();
  printIdentityReview();
}

main();
