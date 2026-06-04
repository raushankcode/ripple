# @getripple/mcp

MCP stdio server for AI agents that need Ripple's architectural context before
editing code.

Paste this into an MCP-compatible client:

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

The server lets agents call Ripple directly instead of scraping markdown files.
It does not sandbox file writes by itself; MCP clients, CLI checks, CI gates, or
human review must obey Ripple's continue/stop decisions.

## Tools

```txt
ripple_get_agent_workflow
ripple_doctor
ripple_plan_context
ripple_check_staged
ripple_check_changed
ripple_audit_change
ripple_gate
ripple_get_approval_status
ripple_repair_intent_drift
ripple_get_focus
ripple_get_blast_radius
ripple_explain_policy
ripple_get_recent_changes
```

Use `ripple_plan_context` before editing to save task intent and control
boundary. Use `ripple_check_staged` or `ripple_audit_change` after editing to
detect intent drift, boundary drift, policy drift, and readiness drift. Use
`ripple_gate` when the agent only needs the compact continue/stop decision.

## Local Run

After install:

```bash
ripple-mcp --workspace /absolute/path/to/your/repo
```

Without installing:

```bash
npx -y @getripple/mcp --workspace /absolute/path/to/your/repo
```

For local monorepo development:

```bash
npm run build:mcp
node packages/mcp/dist/server.js --workspace /absolute/path/to/your/repo
```

## Protocol Notes

The server speaks newline-delimited JSON-RPC over stdio. Only JSON-RPC messages
are written to stdout; scan logs are redirected to stderr so MCP clients can
parse responses safely.

## Status

Public alpha. The strongest current experience is JavaScript and TypeScript.

## License

MIT
