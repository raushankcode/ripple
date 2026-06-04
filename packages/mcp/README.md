# @getripple/mcp

MCP stdio server for AI agents that need Ripple's architectural context before
editing code.

The server lets agents call Ripple directly instead of reading markdown files.
Plan before edit. Check after edit. Catch drift. Tell the agent what to fix.

## Setup

Paste this into your MCP-compatible client (Claude Code, Cursor, or any MCP host).

Replace the workspace path with the absolute path to your project.

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

**macOS / Linux:** `/Users/yourname/projects/myapp`
**Windows:** `C:\\Users\\yourname\\projects\\myapp`

No install required. `npx` fetches and runs the server automatically.

## Agent Workflow

Call these tools in order:

**1. Before editing — get context and save intent:**

```
ripple_plan_context
```

Returns the files to read first, risk level, allowed boundary, and verification
targets. Pass `save: true` to record the intent for drift checking.

**2. After editing and staging — check for drift:**

```
ripple_check_staged
```

Compares staged changes against the saved intent. Returns intent drift, boundary
drift, policy drift, and readiness drift in a single verdict.

**3. When you only need continue or stop:**

```
ripple_gate
```

Returns the compact decision the agent needs to proceed or pause for human review.

**4. If drift is detected — get the repair plan:**

```
ripple_repair_intent_drift
```

Returns specific actions: which files to unstage, which contracts to review, and
what to verify before widening scope.

## All Tools

```
ripple_get_agent_workflow      — full agent workflow guide and loop
ripple_doctor                  — check project readiness before scanning
ripple_plan_context            — plan before editing a target file
ripple_check_staged            — check staged changes against saved intent
ripple_check_changed           — check changed files against a git base ref
ripple_audit_change            — audit a completed change for drift signals
ripple_gate                    — compact continue/stop decision
ripple_get_approval_status     — check whether a human gate is required
ripple_repair_intent_drift     — get repair actions when drift is detected
ripple_get_focus               — focused context for a single file
ripple_get_blast_radius        — files that depend on a target file
ripple_explain_policy          — explain the active trust boundary policy
ripple_get_recent_changes      — recent architectural changes from history
```

## Run Without Config

After global install:

```bash
npm install -g @getripple/mcp
ripple-mcp --workspace /absolute/path/to/your/repo
```

Without installing:

```bash
npx -y @getripple/mcp --workspace /absolute/path/to/your/repo
```

## Protocol

The server communicates over stdio using newline-delimited JSON-RPC. Only
JSON-RPC messages are written to stdout. Scan progress and logs are written to
stderr so MCP clients can parse responses without noise.

## Privacy

Ripple runs entirely on your machine. No account, telemetry, cloud indexing, or
remote model call is required.

## Status

Public alpha. The strongest current experience is JavaScript and TypeScript.

## License

MIT
