#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import {
  createRippleMcpToolHost,
  RIPPLE_MCP_TOOLS,
  RippleMcpToolCallArgs,
  RippleMcpToolHost,
  RippleMcpToolName,
} from "./tools";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type JsonRpcSuccessResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
};

type JsonRpcErrorResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

type ToolCallParams = {
  name?: unknown;
  arguments?: unknown;
};

const JSON_RPC_VERSION = "2.0";
const SERVER_NAME = "ripple-mcp";

const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export class RippleMcpJsonRpcServer {
  constructor(
    private readonly host: RippleMcpToolHost,
    private readonly version: string = readPackageVersion()
  ) {}

  async handleLine(line: string): Promise<JsonRpcResponse | null> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (err) {
      return this.error(null, JSON_RPC_ERRORS.parseError, "Parse error", errorMessage(err));
    }
    return this.handleMessage(message);
  }

  async handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
    if (!isJsonRpcRequest(message)) {
      return this.error(null, JSON_RPC_ERRORS.invalidRequest, "Invalid Request");
    }

    const id = message.id ?? null;
    const isNotification = message.id === undefined;

    if (message.method === "notifications/initialized") {
      return null;
    }

    if (!message.method) {
      return isNotification
        ? null
        : this.error(id, JSON_RPC_ERRORS.invalidRequest, "Request method is required.");
    }

    try {
      if (message.method === "initialize") {
        return isNotification ? null : this.success(id, this.initializeResult());
      }

      if (message.method === "ping") {
        return isNotification ? null : this.success(id, {});
      }

      if (message.method === "tools/list") {
        return isNotification
          ? null
          : this.success(id, { tools: this.host.listTools() });
      }

      if (message.method === "tools/call") {
        return isNotification
          ? null
          : this.success(id, await this.callToolResult(message.params));
      }

      return isNotification
        ? null
        : this.error(id, JSON_RPC_ERRORS.methodNotFound, `Method not found: ${message.method}`);
    } catch (err) {
      return this.error(id, JSON_RPC_ERRORS.internalError, errorMessage(err));
    }
  }

  dispose(): void {
    this.host.dispose();
  }

  private initializeResult(): unknown {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: SERVER_NAME,
        title: "Ripple MCP",
        version: this.version,
      },
      instructions:
        "Use Ripple before editing code to get focused architectural context, blast radius, recent changes, and token-budgeted read plans.",
    };
  }

  private async callToolResult(params: unknown): Promise<unknown> {
    const parsed = parseToolCallParams(params);
    if (!isRippleMcpToolName(parsed.name)) {
      throw new Error(`Unknown Ripple MCP tool: ${String(parsed.name)}`);
    }

    try {
      const result = await this.host.callTool(parsed.name, parsed.arguments);
      const text = JSON.stringify(result.data, null, 2);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
        structuredContent: result.data,
        isError: false,
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: errorMessage(err),
          },
        ],
        isError: true,
      };
    }
  }

  private success(id: JsonRpcId, result: unknown): JsonRpcSuccessResponse {
    return {
      jsonrpc: JSON_RPC_VERSION,
      id,
      result,
    };
  }

  private error(
    id: JsonRpcId,
    code: number,
    message: string,
    data?: unknown
  ): JsonRpcErrorResponse {
    return {
      jsonrpc: JSON_RPC_VERSION,
      id,
      error: {
        code,
        message,
        ...(data === undefined ? {} : { data }),
      },
    };
  }
}

export async function runStdioServer(workspaceRoot: string): Promise<void> {
  const originalLog = console.log;
  console.log = () => {};

  const host = createRippleMcpToolHost({ workspaceRoot });
  const server = new RippleMcpJsonRpcServer(host);
  const lines = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  const writeResponse = (response: JsonRpcResponse | null): void => {
    if (!response) {
      return;
    }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  };

  let queue: Promise<void> = Promise.resolve();

  const handleInputLine = async (line: string): Promise<void> => {
    try {
      writeResponse(await server.handleLine(line));
    } catch (err: unknown) {
      writeResponse({
        jsonrpc: JSON_RPC_VERSION,
        id: null,
        error: {
          code: JSON_RPC_ERRORS.internalError,
          message: errorMessage(err),
        },
      });
    }
  };

  lines.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    queue = queue.then(() => handleInputLine(trimmed));
  });

  lines.on("close", () => {
    void queue.finally(() => {
      server.dispose();
      console.log = originalLog;
    });
  });
}

function parseToolCallParams(params: unknown): {
  name: unknown;
  arguments: RippleMcpToolCallArgs;
} {
  if (!isRecord(params)) {
    throw new Error("tools/call params must be an object.");
  }

  const toolParams = params as ToolCallParams;
  if (!isRecord(toolParams.arguments)) {
    throw new Error("tools/call arguments must be an object.");
  }

  return {
    name: toolParams.name,
    arguments: toolParams.arguments,
  };
}

function isRippleMcpToolName(name: unknown): name is RippleMcpToolName {
  return typeof name === "string" && RIPPLE_MCP_TOOLS.some((tool) => tool.name === name);
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isRecord(value)) {
    return false;
  }
  const request = value as Partial<JsonRpcRequest>;
  const id = request.id;
  return (
    request.jsonrpc === JSON_RPC_VERSION &&
    (id === undefined || typeof id === "string" || typeof id === "number" || id === null) &&
    (request.method === undefined || typeof request.method === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readPackageVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function resolveWorkspaceRoot(argv: string[]): string {
  const envRoot = process.env.RIPPLE_WORKSPACE_ROOT;
  let root = envRoot && envRoot.trim().length > 0 ? envRoot : process.cwd();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      process.stdout.write([
        "Ripple MCP stdio server",
        "",
        "Usage:",
        "  ripple-mcp [--workspace <path>]",
        "",
        "Environment:",
        "  RIPPLE_WORKSPACE_ROOT  Workspace root used when --workspace is not provided",
        "",
      ].join("\n"));
      process.exit(0);
    }
    if (token === "--workspace") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --workspace");
      }
      root = value;
      i++;
      continue;
    }
    if (token.startsWith("--workspace=")) {
      root = token.slice("--workspace=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return path.resolve(root);
}

if (require.main === module) {
  try {
    runStdioServer(resolveWorkspaceRoot(process.argv.slice(2))).catch((err: unknown) => {
      console.error(`Ripple MCP error: ${errorMessage(err)}`);
      process.exitCode = 1;
    });
  } catch (err) {
    console.error(`Ripple MCP error: ${errorMessage(err)}`);
    process.exitCode = 1;
  }
}
