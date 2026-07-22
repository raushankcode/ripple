# @getripple/core Changelog

## [1.0.14] - 2026-07-21

### Fixed
- Detect changed symbols in files outside the approved boundary (`changedOutsideBoundarySymbols` previously only checked symbols inside already-allowed files, silently missing edits to unauthorized files entirely).
- Detect deletions of unapproved symbols during a staged/worktree check (previously invisible to the gate).
- Stamp and verify a tamper-evidence fingerprint on saved change intents, rejecting hand-edited `.ripple/intents/latest.json` files.
- Fix Windows quoting bug in cloud audit actor lookup (`git log --pretty=format:'%ae'` returned a literal-quoted string on cmd.exe).
- Fix risk evidence loss: contract-risk and file-risk evidence lines were deduplicated as plain strings, so two changed symbols/files sharing the same caller count, exported flag, or importer count would silently lose one entry's evidence.
- Recognize Python module-level assignments and decorator changes as tracked symbols (previously invisible to the staged-diff parser).
- Two-axis risk scoring: clean, boundary-respecting changes are capped at score 50 (LOW/MEDIUM); any real violation is floored at 51+ (HIGH/CRITICAL), so risk score now reliably discriminates authorized from unauthorized changes.

## [1.0.9] - 2026-06-13

### Changed
- Align core package documentation with Ripple's local authorization-gate positioning.
- Clarify the Trust Boundary Contract and Authorization Gate Contract while preserving the technical `GraphEngine` integration guidance.
- Update package metadata language for npm users building custom integrations.

## [1.0.8] - 2026-06-09

### Fixed
- Record `.ripple/history.json` events during cached `GraphEngine` scans so changed files still produce semantic history.
- Preserve architectural memory for changed symbols, imports, and calls through events such as `symbol_modified`, `symbol_created`, `symbol_deleted`, `import_added`, `import_removed`, `call_added`, and `call_removed`.
- Add regression coverage proving cached scans record history after a real file change.

### Validation
- Confirm real-repo graph and symbol discovery on a local clone of `sindresorhus/ky`, including high-impact files with broad importer counts.

## [1.0.7] - 2026-06-08

### Added
- Add structured risk summaries with level, score, summary, reasons, evidence, affected files/symbols, and required actions.
- Add graph-backed risk evidence from saved intents, boundary drift, blast radius, policy risk, public contracts, and verification targets.
- Add shared risk contracts used by CLI, MCP, and CI gate outputs.

### Changed
- Make gate evidence more explicit so downstream interfaces can explain why an agent may continue, must repair, or needs human review.

## [1.0.6] - 2026-06-07

### Fixed
- Report Git spawn failures with actionable messages when Node.js cannot launch `git`.
- Preserve the exact Git readiness failure in `ripple doctor` and readiness summaries.

## [1.0.5] - 2026-06-04

### Changed
- Refresh package README wording for npm users.
- Clarify that the core powers VS Code, CLI, and MCP, while most users should start with `@getripple/cli` or `@getripple/mcp`.
- Document JavaScript/TypeScript depth, basic Python support, and static-analysis limits more clearly.

## [1.0.4] - 2026-06-03

### Fixed
- Publishable package identity under `@getripple/core`.
- Release readiness checks for packed installs, package metadata, and shared engine entry points.
- Package-specific README and changelog included in the npm tarball.

## [1.0.3] - 2026-06-03

### Added
- Initial standalone package release of Ripple's core graph and workflow engine.
- `GraphEngine` APIs for scanning a local repo, planning context, focus summaries, blast radius, and recent history.
- Trust-boundary, policy, readiness, approval, audit, gate, and drift-repair summaries shared by CLI and MCP.

### Notes
- Public alpha. Prefer `@getripple/cli` for terminal use and `@getripple/mcp` for AI-agent integration.
