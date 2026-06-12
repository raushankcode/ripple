const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const rootPackage = readJson(path.join(repoRoot, "package.json"));

const publicPackages = [
  {
    name: "@getripple/core",
    dir: "packages/core",
  },
  {
    name: "@getripple/cli",
    dir: "packages/cli",
    dependsOnCore: true,
  },
  {
    name: "@getripple/mcp",
    dir: "packages/mcp",
    dependsOnCore: true,
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertIncludes(value, expected, label) {
  assert(
    value.includes(expected),
    `${label} should include ${expected}`,
  );
}

function assertRootReleaseScripts() {
  const scripts = rootPackage.scripts ?? {};

  assert.strictEqual(
    scripts["release:check"],
    "npm run proof:agent-control && npm run test:persona && npm run release:identity && npm run release:npm-preflight && npm run test:release-check",
    "release:check should run the product proof, persona proof, identity review, npm preflight, and release proof",
  );
  assert.strictEqual(
    scripts["proof:release-check"],
    "npm run release:check",
    "proof:release-check should alias the release gate",
  );
  assert.strictEqual(
    scripts["test:release-check"],
    "node test/run-release-check-proof.js",
    "test:release-check should run this proof",
  );
  assert.strictEqual(
    scripts["test:persona"],
    "node test/run-product-persona-proof.js",
    "test:persona should run the product persona proof",
  );
  assert.strictEqual(
    scripts["release:identity"],
    "node test/run-release-identity-review.js",
    "release:identity should run the release identity review",
  );
  assert.strictEqual(
    scripts["release:npm-preflight"],
    "node test/run-npm-registry-preflight.js",
    "release:npm-preflight should run the npm registry preflight",
  );
  assert.strictEqual(
    scripts["smoke:post-publish"],
    "node test/run-post-publish-smoke.js",
    "smoke:post-publish should run the post-publish smoke script",
  );
  assert.strictEqual(
    scripts["demo:agent-control"],
    "npm run build:cli && node test/run-agent-control-demo.js",
    "demo:agent-control should run the one-command agent control demo",
  );

  for (const requiredScript of [
    "proof:agent-control",
    "proof:doctor-contract",
    "proof:hook-runner",
    "proof:closed-intent-gate",
    "proof:mcp-doctor-contract",
    "proof:mcp-closed-intent-gate",
    "proof:package-install",
    "proof:mcp-package-install",
    "proof:publish-readiness",
    "test:persona",
  ]) {
    assert(scripts[requiredScript], `Missing required release script: ${requiredScript}`);
  }

  assertIncludes(
    scripts["test:agent-control"],
    "run-golden-doctor-contract-proof.js",
    "product proof",
  );
  assertIncludes(
    scripts["test:agent-control"],
    "run-golden-closed-intent-gate-proof.js",
    "product proof",
  );
  assertIncludes(
    scripts["test:agent-control"],
    "run-golden-hook-runner-proof.js",
    "product proof",
  );
  assertIncludes(
    scripts["test:agent-control"],
    "run-golden-mcp-doctor-contract-proof.js",
    "product proof",
  );
  assertIncludes(
    scripts["test:agent-control"],
    "run-golden-mcp-closed-intent-gate-proof.js",
    "product proof",
  );
  assertIncludes(
    scripts["test:agent-control"],
    "run-golden-package-install-proof.js",
    "product proof",
  );
  assertIncludes(
    scripts["test:agent-control"],
    "run-golden-mcp-package-install-proof.js",
    "product proof",
  );
  assertIncludes(
    scripts["test:agent-control"],
    "run-package-readiness-proof.js",
    "product proof",
  );
}

function assertPackageVersions() {
  for (const pkg of publicPackages) {
    const packageJson = readJson(path.join(repoRoot, pkg.dir, "package.json"));
    assert.strictEqual(packageJson.name, pkg.name, `${pkg.name} name`);
    assert.strictEqual(
      packageJson.version,
      rootPackage.version,
      `${pkg.name} version should match root`,
    );
    assert.strictEqual(
      packageJson.publishConfig?.access,
      "public",
      `${pkg.name} should publish publicly`,
    );
    if (pkg.dependsOnCore) {
      assert.strictEqual(
        packageJson.dependencies?.["@getripple/core"],
        `^${rootPackage.version}`,
        `${pkg.name} should depend on the compatible @getripple/core release range`,
      );
    }
  }
}

function assertReleaseChecklist() {
  const checklistPath = path.join(repoRoot, "RELEASE.md");
  assert(fs.existsSync(checklistPath), "RELEASE.md should exist");
  const release = readText(checklistPath);

  for (const requiredText of [
    "npm run release:check",
    "npm run release:identity",
    "npm run release:npm-preflight -- --live",
    "npm run smoke:post-publish -- --live",
    "npm publish --workspace @getripple/core",
    "npm publish --workspace @getripple/cli",
    "npm publish --workspace @getripple/mcp",
    "npx -y @getripple/cli doctor",
    "npx -y @getripple/mcp --workspace",
    "@getripple/cli -> ripple --version, init, plan, gate",
    "@getripple/mcp -> ripple_get_agent_workflow, ripple_doctor, ripple_plan_context, ripple_gate",
    "Manual Gates",
    "Release Identity Review",
    "NPM Registry Preflight",
    "Do not publish if",
    "docs/product-persona.md",
    `npm view @getripple/core@${rootPackage.version} version --json`,
  ]) {
    assertIncludes(release, requiredText, "RELEASE.md");
  }
}

function assertRootReadmeReleasePath() {
  const readme = readText(path.join(repoRoot, "README.md"));
  for (const requiredText of [
    "npm run release:check",
    "npm run proof:release-check",
    "RELEASE.md",
  ]) {
    assertIncludes(readme, requiredText, "Root README");
  }
}

function main() {
  assertRootReleaseScripts();
  assertPackageVersions();
  assertReleaseChecklist();
  assertRootReadmeReleasePath();

  console.log("Ripple release check proof passed");
  console.log("Command: npm run release:check");
  console.log("Checked: release scripts, product proof wiring, package versions, publish order, release docs");
  console.log("Manual gates remain: npm auth, package ownership, human final review, actual npm publish");
}

main();
