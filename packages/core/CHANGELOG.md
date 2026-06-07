# @getripple/core Changelog

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
