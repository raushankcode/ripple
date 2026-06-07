# Ripple Release Checklist

This checklist answers one question:

```txt
Can we launch this build today?
```

Run the release gate from the repo root:

```bash
npm run release:check
```

This command does not publish anything. It proves the product is ready enough
for a human to make the final release decision.

## What The Gate Proves

`npm run release:check` runs the full agent-control proof and then checks the
release checklist itself.

It proves:

- `ripple init` can make a fresh repo ready
- packed `@getripple/cli` installs into a clean repo
- packed `@getripple/mcp` installs into a clean repo
- the installed CLI can run `init -> plan -> doctor -> gate`
- the installed MCP stdio server can run `workflow -> doctor -> plan -> doctor -> gate`
- drift control catches boundary violations
- human approval gates block and unblock correctly
- CI speaks the same `continue`, `repair`, `human-review`, and `restore-readiness` language
- MCP host and MCP stdio speak the same gate language
- npm package metadata, entry points, bins, README install commands, and `npm pack --dry-run` contents are valid
- public package versions match the root version
- release scripts and this checklist are wired together
- public docs match the product persona and avoid forbidden overclaims

## Manual Gates

These checks cannot be automated safely:

- Review the final diff and make sure it matches the intended release.
- Review `docs/product-persona.md` if the product promise, audience, or claims changed.
- Run `npm run release:identity` and consciously review the public product identity.
- Run `npm run release:npm-preflight -- --live` and review npm registry readiness.
- Confirm npm account access with `npm whoami`.
- Confirm the `@getripple` npm scope and package names are owned or available.
- Confirm this version should be released publicly.
- Confirm no secret, private repo path, local credential, or accidental test artifact is included.
- Confirm the public README and package READMEs describe the product honestly.

## Release Identity Review

Run:

```bash
npm run release:identity
```

This prints the public identity you are about to release.

Product identity:

```txt
Ripple is a local drift-control gate for AI coding agents that plans before edit, checks after edit, catches drift, and tells the agent what to fix.
```

Package identity:

```txt
@getripple/core -> local engine
@getripple/cli  -> terminal and CI interface
@getripple/mcp  -> agent-facing MCP stdio interface
```

Human decision:

```txt
Are these names, version, scope, public promise, alpha status, and README claims exactly what we want to publish?
```

Do not publish if:

- the `@getripple` npm scope or package names are not controlled by you
- the version is not the version you want public
- the README sounds stronger than the product really is
- the release still depends on this local machine to work
- the package descriptions no longer match the product direction
- you feel rushed and have not reviewed the final diff

## NPM Registry Preflight

Run the dry preflight anytime:

```bash
npm run release:npm-preflight
```

Dry mode validates local package identity and prints the read-only registry
checks. It does not hit the network.

Before publishing, run the live preflight:

```bash
npm run release:npm-preflight -- --live
```

Live mode runs read-only npm commands:

```bash
npm whoami
npm access ls-packages @getripple --json
npm view @getripple/core@1.0.6 version --json
npm view @getripple/cli@1.0.6 version --json
npm view @getripple/mcp@1.0.6 version --json
```

Expected result before publishing a new version:

```txt
npm whoami succeeds
@getripple/core@1.0.6 is not found
@getripple/cli@1.0.6 is not found
@getripple/mcp@1.0.6 is not found
```

Stop if:

- npm auth fails
- any target version already exists
- registry checks fail for a reason other than package not found
- you cannot confirm `@getripple` scope/package ownership

## Publish Order

Publish the packages in dependency order:

```bash
npm publish --workspace @getripple/core
npm publish --workspace @getripple/cli
npm publish --workspace @getripple/mcp
```

`@getripple/cli` and `@getripple/mcp` depend on the matching `@getripple/core` version,
so core must publish first.

## Post-Publish Smoke

After publishing, run the automated public install smoke:

```bash
npm run smoke:post-publish -- --live
```

Without `--live`, the command only prints the smoke plan and does not hit the
network:

```bash
npm run smoke:post-publish
```

The live smoke creates a fresh temporary repo and verifies:

```txt
@getripple/cli -> ripple --version, init, plan, gate
@getripple/mcp -> ripple_get_agent_workflow, ripple_doctor, ripple_plan_context, ripple_gate
```

Manual equivalent for the CLI public install path:

```bash
npx -y @getripple/cli doctor
npx -y @getripple/cli init
npx -y @getripple/cli plan --file src/index.ts --task "smoke test Ripple" --mode file --save
npx -y @getripple/cli gate --intent latest
```

For MCP:

```bash
npx -y @getripple/mcp --workspace /absolute/path/to/your/repo
```

Then connect an MCP client with:

```json
{
  "mcpServers": {
    "ripple": {
      "command": "npx",
      "args": [
        "-y",
        "@getripple/mcp",
        "--workspace",
        "/absolute/path/to/your/repo"
      ]
    }
  }
}
```

The first MCP calls to verify are:

```txt
ripple_get_agent_workflow
ripple_doctor
ripple_plan_context
ripple_gate
```

## Release Rule

If `npm run release:check` fails, do not publish.

If it passes, publish only after the manual gates are reviewed by a human.
