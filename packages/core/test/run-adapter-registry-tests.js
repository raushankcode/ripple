const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  adapterCapabilityConfidence,
  detectWorkspaceAdapters,
  hasAdapterCapability,
} = require("../dist");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const tmpRoot = path.join(repoRoot, "test", ".tmp", `adapter-registry-${Date.now()}`);

function writeFile(workspaceRoot, relativePath, contents) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function main() {
  const tsWorkspace = path.join(tmpRoot, "ts-workspace");
  writeFile(tsWorkspace, "src/index.ts", "export const value = 1;\n");
  writeFile(tsWorkspace, "src/view.jsx", "export function View() { return null; }\n");
  writeFile(tsWorkspace, "README.md", "# Fixture\n");
  writeFile(tsWorkspace, "node_modules/ignored/index.ts", "export const ignored = true;\n");

  const tsDetection = detectWorkspaceAdapters(tsWorkspace);
  assert.strictEqual(tsDetection.supportLevel, "deep");
  assert.strictEqual(tsDetection.primaryAdapter.id, "builtin-js-ts");
  assert(tsDetection.primaryAdapter.confidence > 0.9, "JS/TS adapter should be high confidence");
  assert.strictEqual(tsDetection.primaryAdapter.capabilities.language, "typescript");
  assert.strictEqual(tsDetection.primaryAdapter.matchedFiles, 2);
  assert(
    hasAdapterCapability(tsDetection.primaryAdapter, "symbols"),
    "JS/TS adapter should expose symbol support"
  );
  const tsCallEdges = adapterCapabilityConfidence(tsDetection.primaryAdapter, "call-edges");
  assert.strictEqual(tsCallEdges.status, "partial");
  assert.strictEqual(tsCallEdges.agentUse, "verify");
  assert(
    tsDetection.primaryAdapter.agentPolicy.canTrust.some((item) => item.includes("static imports")),
    "JS/TS adapter should tell agents what they can trust"
  );
  assert(
    tsDetection.primaryAdapter.agentPolicy.mustFallbackToManual.some((item) => item.includes("non-JS/TS")),
    "JS/TS adapter should tell agents when to inspect manually"
  );
  assert(
    tsDetection.adapters.some((adapter) => adapter.id === "builtin-generic"),
    "generic fallback should remain available"
  );

  const pythonWorkspace = path.join(tmpRoot, "python-workspace");
  writeFile(pythonWorkspace, "pyproject.toml", "[project]\nname = \"fixture\"\n");
  writeFile(
    pythonWorkspace,
    "src/service.py",
    "from .utils import normalize_token\n\n\ndef authenticate(token):\n    return normalize_token(token) == 'valid'\n"
  );
  writeFile(
    pythonWorkspace,
    "src/utils.py",
    "def normalize_token(token):\n    return token.strip().lower()\n"
  );
  writeFile(
    pythonWorkspace,
    "tests/test_service.py",
    "from src.service import authenticate\n\n\ndef test_authenticate():\n    assert authenticate(' valid ')\n"
  );

  const pythonDetection = detectWorkspaceAdapters(pythonWorkspace);
  assert.strictEqual(pythonDetection.supportLevel, "deep");
  assert.strictEqual(pythonDetection.primaryAdapter.id, "builtin-python");
  assert.strictEqual(pythonDetection.primaryAdapter.capabilities.language, "python");
  assert.strictEqual(pythonDetection.primaryAdapter.matchedFiles, 3);
  assert(
    hasAdapterCapability(pythonDetection.primaryAdapter, "symbols"),
    "Python adapter should expose symbol support"
  );
  const pythonSymbols = adapterCapabilityConfidence(pythonDetection.primaryAdapter, "symbols");
  assert.strictEqual(pythonSymbols.status, "available");
  assert.strictEqual(pythonSymbols.agentUse, "trust");
  const pythonCallEdges = adapterCapabilityConfidence(pythonDetection.primaryAdapter, "call-edges");
  assert.strictEqual(pythonCallEdges.status, "partial");
  assert.strictEqual(pythonCallEdges.agentUse, "verify");
  assert(
    pythonDetection.primaryAdapter.agentPolicy.canTrust.some((item) =>
      item.includes("Python source file discovery")
    ),
    "Python adapter should tell agents what they can trust"
  );
  assert(
    pythonDetection.primaryAdapter.agentPolicy.mustFallbackToManual.some((item) =>
      item.includes("runtime plugin loading")
    ),
    "Python adapter should tell agents when to inspect manually"
  );

  const genericWorkspace = path.join(tmpRoot, "generic-workspace");
  writeFile(genericWorkspace, "README.md", "# Fixture\n");
  writeFile(genericWorkspace, "scripts/build.sh", "echo build\n");

  const genericDetection = detectWorkspaceAdapters(genericWorkspace);
  assert.strictEqual(genericDetection.supportLevel, "generic");
  assert.strictEqual(genericDetection.primaryAdapter.id, "builtin-generic");
  assert(genericDetection.primaryAdapter.confidence < 0.5, "generic adapter should be low confidence");
  assert.strictEqual(genericDetection.primaryAdapter.matchedFiles, 2);
  assert(
    !hasAdapterCapability(genericDetection.primaryAdapter, "symbols"),
    "generic adapter should not claim deep symbol support"
  );
  const genericSymbols = adapterCapabilityConfidence(genericDetection.primaryAdapter, "symbols");
  assert.strictEqual(genericSymbols.status, "unavailable");
  assert.strictEqual(genericSymbols.agentUse, "manual");
  assert(
    genericDetection.primaryAdapter.agentPolicy.planningGuidance.some((item) =>
      item.includes("file-level")
    ),
    "generic adapter should give file-level planning guidance"
  );

  console.log("Ripple adapter registry tests passed");
}

main();
