# @getripple/cli Changelog

## [1.0.9] - 2026-06-13

### Changed
- Reframe the CLI package as the human, Git hook, and CI enforcer for Ripple's local authorization gate.
- Lead npm users toward `ripple init`, hook enforcement, CI gating, and debugging commands instead of presenting manual planning as the normal workflow.
- Update package metadata to depend on `@getripple/core@^1.0.9`.

## [1.0.8] - 2026-06-09

### Validation
- Manually validated the CLI on a local clone of `sindresorhus/ky` for saved intents, file-boundary drift, risk explanations, blast-radius evidence, repair handoff, policy-based human approval, CI blocking, and GitHub annotations.

### Fixed
- Consume the core history fix so CLI scan and gate workflows preserve architectural history after cached scans.

## [1.0.7] - 2026-06-08

### Added
- Show risk level, score, summary, reasons, evidence, affected files/symbols, and required actions in `ripple gate` output.
- Add JSON gate risk fields for automation, CI, and agent workflows.
- Add golden CLI proofs for compact STOP output and evidence-backed gate decisions.

### Changed
- Make CLI gate output explain crossed trust boundaries with direct allowed-vs-changed evidence.

## [1.0.6] - 2026-06-07

### Fixed
- Depend on the `1.0.6` core engine so CLI readiness output explains blocked Git execution clearly.
- Keep install and release proofs aligned with the fixed package set.

## [1.0.5] - 2026-06-04

### Changed
- Refresh package README wording for npm users.
- Restore the first-run `npx -y @getripple/cli doctor` readiness command.
- Clarify the plan/check/gate workflow, control modes, CI gate behavior, and local privacy posture.

## [1.0.4] - 2026-06-03

### Fixed
- Executable entry point for the `ripple` binary.
- Publishable package identity under `@getripple/cli`.
- Release readiness checks for packed installs and CI gate behavior.
- Package-specific README and changelog included in the npm tarball.

## [1.0.3] - 2026-06-03

### Added
- Initial release of the Ripple CLI.
- Commands for `scan`, `focus`, `blast`, `plan`, `check`, `audit`, `repair`, `gate`, `doctor`, `agent`, `init`, and `init-ci`.
- GitHub Actions workflow generation with `ripple init-ci`.
- Drift checks against saved change intent, control boundary, current policy, and readiness snapshot.
- Trust-boundary checking with `--mode function`, `--mode file`, `--mode task`, and `--mode pr`.

### Notes
- Public alpha. The strongest current experience is JavaScript and TypeScript.
