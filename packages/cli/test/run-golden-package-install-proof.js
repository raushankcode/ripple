const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const rootPackage = readJson(path.join(repoRoot, "package.json"));
const proofRoot = path.join(
  repoRoot,
  "test",
  ".tmp",
  `golden-package-install-proof-${Date.now()}`,
);
const packRoot = path.join(proofRoot, "packs");
const consumerRoot = path.join(proofRoot, "consumer");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFile(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
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

  return execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGit(args) {
  execFileSync("git", args, {
    cwd: consumerRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function packPackage(packageDir) {
  fs.mkdirSync(packRoot, { recursive: true });
  const output = runNpm(["pack", "--json", "--pack-destination", packRoot], packageDir);
  const [packed] = JSON.parse(output);
  assert(packed.filename, `npm pack output should include filename for ${packageDir}`);
  const tarballPath = path.join(packRoot, packed.filename);
  assert(fs.existsSync(tarballPath), `Packed tarball should exist: ${tarballPath}`);
  assert(
    packed.files.some((file) => file.path === "dist/index.js"),
    `${packed.name} tarball should include dist/index.js`,
  );
  return tarballPath;
}

function setupConsumerRepo() {
  writeFile(
    consumerRoot,
    "package.json",
    JSON.stringify({ name: "ripple-package-consumer", private: true }, null, 2),
  );
  writeFile(
    consumerRoot,
    "src/util.ts",
    [
      "export function trimName(value: string): string {",
      "  return value.trim();",
      "}",
      "",
    ].join("\n"),
  );
  writeFile(
    consumerRoot,
    "tests/util.test.ts",
    [
      "import { trimName } from '../src/util';",
      "",
      "export function testTrimName(): string {",
      "  return trimName(' Ada ');",
      "}",
      "",
    ].join("\n"),
  );
  runGit(["init"]);
}

function installPackedCli(coreTarball, cliTarball) {
  runNpm(
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      coreTarball,
      cliTarball,
    ],
    consumerRoot,
  );

  const cliEntry = path.join(
    consumerRoot,
    "node_modules",
    "@getripple",
    "cli",
    "dist",
    "index.js",
  );
  const coreEntry = path.join(
    consumerRoot,
    "node_modules",
    "@getripple",
    "core",
    "dist",
    "index.js",
  );
  assert(fs.existsSync(cliEntry), "Installed @getripple/cli should include dist/index.js");
  assert(fs.existsSync(coreEntry), "Installed @getripple/core should include dist/index.js");

  const binPath = path.join(
    consumerRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "ripple.cmd" : "ripple",
  );
  assert(fs.existsSync(binPath), "Installed package should expose the ripple binary");
  return cliEntry;
}

function runInstalledRipple(cliEntry, args) {
  return execFileSync(process.execPath, [cliEntry, ...args], {
    cwd: consumerRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runInstalledRippleJson(cliEntry, args) {
  const output = runInstalledRipple(cliEntry, [...args, "--json"]);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Expected JSON for installed ripple ${args.join(" ")}:\n${output}`);
  }
}

function proveInstalledCliWorks(cliEntry) {
  const version = runInstalledRipple(cliEntry, ["--version"]).trim();
  assert.strictEqual(version, rootPackage.version);

  const init = runInstalledRippleJson(cliEntry, ["init"]);
  assert.strictEqual(init.protocol, "ripple-init");
  assert(
    init.files.some(
      (file) => file.path === ".ripple/policy.json" && file.status === "written",
    ),
    "installed ripple init should write policy",
  );
  assert(
    init.files.some(
      (file) => file.path === ".github/workflows/ripple.yml" && file.status === "written",
    ),
    "installed ripple init should write CI workflow",
  );

  const plan = runInstalledRippleJson(cliEntry, [
    "plan",
    "--file",
    "src/util.ts",
    "--task",
    "normalize display name whitespace",
    "--mode",
    "file",
    "--save",
  ]);
  assert.strictEqual(plan.changeIntent.protocol, "ripple-change-intent");
  assert.strictEqual(plan.changeIntent.targetFile, "src/util.ts");
  assert.strictEqual(plan.changeIntent.policyExplanation.policyExists, true);
  assert.strictEqual(plan.changeIntent.readinessSnapshot.canBlockInCi, true);

  const doctor = runInstalledRippleJson(cliEntry, ["doctor"]);
  assert.strictEqual(doctor.status, "ready");
  assert.strictEqual(doctor.enforcement.level, "ci-gate-ready");
  assert.strictEqual(doctor.enforcement.canBlockInCi, true);

  const gate = runInstalledRippleJson(cliEntry, ["gate", "--intent", "latest"]);
  assert.strictEqual(gate.protocol, "ripple-gate");
  assert.strictEqual(gate.status, "open");
  assert.strictEqual(gate.decision, "continue");
  assert.strictEqual(gate.canContinue, true);
}

function main() {
  const coreTarball = packPackage(path.join(repoRoot, "packages", "core"));
  const cliTarball = packPackage(path.join(repoRoot, "packages", "cli"));

  setupConsumerRepo();
  const cliEntry = installPackedCli(coreTarball, cliTarball);
  proveInstalledCliWorks(cliEntry);

  console.log("Ripple golden package install proof passed");
  console.log(`Workspace: ${consumerRoot}`);
  console.log("Packed packages: @getripple/core, @getripple/cli");
  console.log("Installed CLI: init -> plan -> doctor ci-gate-ready -> gate open");
}

main();
