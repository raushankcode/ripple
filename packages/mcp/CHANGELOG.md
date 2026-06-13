# @getripple/mcp Changelog

## [1.0.9] - 2026-06-13

### Changed
- Reframe the MCP package as the agent-facing wire for Ripple's local authorization gate.
- Add `ripple_record_verification` to the documented agent workflow so agents record test or verification evidence before the final gate.
- Update package metadata to depend on `@getripple/core@^1.0.9`.

## [1.0.8] - 2026-06-09

### Validation
- Manually validated MCP-backed agent workflows against a real `sindresorhus/ky` clone through planning, gate checks, repair handoff, policy-based human approval, and CI-style blocking.

### Fixed
- Consume the core history fix so MCP scans preserve architectural history after cached graph refreshes.

## [1.0.7] - 2026-06-08

### Added
- Return evidence-backed risk summaries through MCP gate responses.
- Add MCP contract coverage for gate risk level, score, reasons, evidence, and required actions.
- Expose the same continue/repair/human-review language used by CLI and CI.

### Changed
- Make MCP gate responses easier for AI agents to obey by pairing each stop decision with concrete repair or human-review instructions.

## [1.0.6] - 2026-06-07

### Fixed
- Silence scan/cache `console.log` output in the MCP stdio server so agent clients receive clean protocol output.
- Depend on the `1.0.6` core engine for clearer Git readiness diagnostics.

## [1.0.5] - 2026-06-04

### Changed
- Refresh package README wording for npm users configuring AI agents.
- Lead with the MCP config snippet and the before-edit / after-edit / gate / repair workflow.
- Clarify stdio protocol behavior and local privacy posture.

## [1.0.4] - 2026-06-03

### Fixed
- Executable entry point for the `ripple-mcp` binary.
- Publishable package identity under `@getripple/mcp`.
- Release readiness checks for packed MCP installs and stdio gate behavior.
- Package-specific README and changelog included in the npm tarball.

## [1.0.3] - 2026-06-03

### Added
- Initial release of Ripple's MCP stdio server.
- Agent tools for workflow handshake, context planning, staged/changed checks, audit, gate, approval status, repair, focus, blast radius, policy explanation, and recent changes.
- Structured continue/stop gate responses for MCP-compatible AI coding agents.

### Notes
- Public alpha. Agents should treat Ripple's output as local workflow evidence, not as a replacement for tests or human review.
