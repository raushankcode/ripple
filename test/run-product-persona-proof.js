const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const personaPath = path.join(repoRoot, "docs", "product-persona.md");

const publicSurfaces = [
  ["Root README", "README.md"],
  ["Landing page", "docs/index.html"],
  ["Core README", "packages/core/README.md"],
  ["CLI README", "packages/cli/README.md"],
  ["MCP README", "packages/mcp/README.md"],
  ["Release checklist", "RELEASE.md"],
  ["Root package metadata", "package.json"],
  ["Core package metadata", "packages/core/package.json"],
  ["CLI package metadata", "packages/cli/package.json"],
  ["MCP package metadata", "packages/mcp/package.json"],
];

const requiredPersonaSections = [
  "## Founder Standard",
  "## Human Promise",
  "## Category",
  "## Product Sentence",
  "## Forbidden Claims",
  "## Interface Roles",
  "## Decision Test",
];

const rootReadmeRequiredText = [
  "Ripple tells AI coding agents when they may continue",
  "Plan before edit.",
  "Save intent.",
  "Choose a trust boundary.",
  "Check after edit.",
  "Catch drift.",
  "Continue / stop / human review.",
  "These are signals, not proofs.",
];

const landingRequiredText = [
  "Local drift control",
  "plan before edit",
  "check after edit",
  "catch drift",
];

const cliRequiredText = [
  "Plan before edit. Check after edit. Catch drift. Tell the agent what to fix.",
  "ripple plan",
  "ripple check",
  "ripple gate",
];

const mcpRequiredText = [
  "Plan before edit. Check after edit. Catch drift. Tell the agent what to fix.",
  "ripple_plan_context",
  "ripple_check_staged",
  "ripple_gate",
];

const forbiddenPublicClaims = [
  "revolutionary",
  "game-changing",
  "autonomous safety guaranteed",
  "understands everything",
  "one click to safe ai",
  "the most powerful",
  "perfectly understands your repo",
  "prevents all unsafe ai changes",
  "supports every tech stack deeply",
  "makes autonomous agents safe by itself",
  "guarantees no production risk",
  "more powerful than every ai coding tool",
];

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function normalize(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function assertIncludes(value, requiredText, label) {
  assert(
    normalize(value).includes(normalize(requiredText)),
    `${label} should include: ${requiredText}`,
  );
}

function assertPersonaFoundation() {
  assert(fs.existsSync(personaPath), "docs/product-persona.md should exist");
  const persona = fs.readFileSync(personaPath, "utf8");

  for (const section of requiredPersonaSections) {
    assertIncludes(persona, section, "Product persona");
  }

  assertIncludes(
    persona,
    "Ripple exists to keep the human builder in command.",
    "Product persona",
  );
  assertIncludes(
    persona,
    "Local drift control for AI coding agents.",
    "Product persona",
  );
  assertIncludes(
    persona,
    "CLI and MCP contain the strongest plan/check/repair/gate workflow.",
    "Product persona",
  );
}

function assertPublicPromise() {
  const rootReadme = readText("README.md");
  const landing = readText("docs/index.html");
  const cliReadme = readText("packages/cli/README.md");
  const mcpReadme = readText("packages/mcp/README.md");

  rootReadmeRequiredText.forEach((text) => assertIncludes(rootReadme, text, "Root README"));
  landingRequiredText.forEach((text) => assertIncludes(landing, text, "Landing page"));
  cliRequiredText.forEach((text) => assertIncludes(cliReadme, text, "CLI README"));
  mcpRequiredText.forEach((text) => assertIncludes(mcpReadme, text, "MCP README"));
}

function assertNoForbiddenClaims() {
  for (const [label, relativePath] of publicSurfaces) {
    const text = normalize(readText(relativePath));
    for (const claim of forbiddenPublicClaims) {
      assert(
        !text.includes(claim),
        `${label} must not include forbidden persona claim: ${claim}`,
      );
    }
  }
}

function main() {
  assertPersonaFoundation();
  assertPublicPromise();
  assertNoForbiddenClaims();

  console.log("Ripple product persona proof passed");
  console.log("Checked: persona foundation, public promise, and forbidden overclaims");
}

main();
