import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { runProxy, type SidecarProxy } from "./proxy.js";
import {
  createToolDescriptor,
  executeTool,
  result,
  type JsonObject,
  type McpToolDescriptor,
  type McpToolResult,
  type SidecarTool,
  type ToolContext
} from "@sidecar/core";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse =
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      result: unknown;
    }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: {
        code: number;
        message: string;
        data?: unknown;
      };
    };

type JsonRpcErrorPayload = Extract<JsonRpcResponse, { error: unknown }>["error"];

export type LoadedTool = {
  tool: SidecarTool<any, any>;
  descriptor?: McpToolDescriptor;
};

export type LoadedResource = {
  uri: string;
  name?: string;
  mimeType: string;
  text: string;
};

export type SidecarMcpServerOptions = {
  name?: string;
  version?: string;
  tools: LoadedTool[];
  resources?: LoadedResource[];
  createContext?: (request: JsonRpcRequest) => ToolContext | Promise<ToolContext>;
};

export class SidecarMcpServer {
  private readonly tools = new Map<string, LoadedTool>();
  private readonly resources = new Map<string, LoadedResource>();

  constructor(private readonly options: SidecarMcpServerOptions) {
    for (const loaded of options.tools) {
      const descriptor = loaded.descriptor ?? createToolDescriptor(loaded.tool);
      this.tools.set(descriptor.name, { ...loaded, descriptor });
    }

    for (const resource of options.resources ?? []) {
      this.resources.set(resource.uri, resource);
    }
  }

  descriptors(): McpToolDescriptor[] {
    return [...this.tools.values()].map((loaded) => loaded.descriptor ?? createToolDescriptor(loaded.tool));
  }

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
    if (request.id === undefined) {
      await this.handleNotification(request);
      return undefined;
    }

    try {
      const result = await this.dispatch(request);
      return {
        jsonrpc: "2.0",
        id: request.id,
        result
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: normalizeError(error)
      };
    }
  }

  private async dispatch(request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case "initialize":
        return {
          protocolVersion: "2025-11-25",
          capabilities: {
            tools: {
              listChanged: false
            },
            resources: {
              listChanged: false
            }
          },
          serverInfo: {
            name: this.options.name ?? "sidecar",
            version: this.options.version ?? "0.0.0-dev"
          }
        };

      case "tools/list":
        return {
          tools: this.descriptors()
        };

      case "tools/call":
        return this.callTool(request);

      case "resources/list":
        return {
          resources: [...this.resources.values()].map((resource) => ({
            uri: resource.uri,
            name: resource.name ?? resource.uri,
            mimeType: resource.mimeType
          }))
        };

      case "resources/read":
        return this.readResource(request);

      default:
        throw new JsonRpcError(-32601, `Unsupported method "${request.method}".`);
    }
  }

  private async callTool(request: JsonRpcRequest): Promise<McpToolResult> {
    const params = request.params as { name?: unknown; arguments?: unknown } | undefined;
    const name = typeof params?.name === "string" ? params.name : undefined;
    if (!name) {
      throw new JsonRpcError(-32602, "tools/call requires params.name.");
    }

    const loaded = this.tools.get(name);
    if (!loaded) {
      throw new JsonRpcError(-32602, `Unknown tool "${name}".`);
    }

    const ctx = this.options.createContext
      ? await this.options.createContext(request)
      : createDefaultContext(request);

    return executeTool(loaded.tool, params?.arguments ?? {}, ctx);
  }

  private readResource(request: JsonRpcRequest): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
    const params = request.params as { uri?: unknown } | undefined;
    const uri = typeof params?.uri === "string" ? params.uri : undefined;
    if (!uri) {
      throw new JsonRpcError(-32602, "resources/read requires params.uri.");
    }

    const resource = this.resources.get(uri);
    if (!resource) {
      throw new JsonRpcError(-32602, `Unknown resource "${uri}".`);
    }

    return {
      contents: [
        {
          uri: resource.uri,
          mimeType: resource.mimeType,
          text: resource.text
        }
      ]
    };
  }

  private async handleNotification(_request: JsonRpcRequest): Promise<void> {
    // Notifications intentionally do not produce responses. The v0 server does
    // not need notification side effects yet, but accepting them makes MCP
    // clients less brittle during initialization.
  }
}

export function createSidecarMcpServer(options: SidecarMcpServerOptions): SidecarMcpServer {
  return new SidecarMcpServer(options);
}

export function createSidecarHttpServer(options: SidecarMcpServerOptions & { path?: string; proxy?: SidecarProxy }) {
  const mcp = createSidecarMcpServer(options);
  const endpoint = options.path ?? "/mcp";

  return createServer(async (request, response) => {
    const proxyResult = await runProxy(options.proxy, request);
    if (proxyResult) {
      response.writeHead(proxyResult.status, proxyResult.headers);
      response.end(proxyResult.body ?? "");
      return;
    }

    if (request.method !== "POST" || request.url?.split("?")[0] !== endpoint) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    try {
      const body = await readJson(request);
      const requests = Array.isArray(body) ? body : [body];
      const responses = (
        await Promise.all(requests.map((entry) => mcp.handle(assertJsonRpcRequest(entry))))
      ).filter(Boolean);

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(Array.isArray(body) ? responses : responses[0] ?? null));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: normalizeError(error)
        })
      );
    }
  });
}

export * from "./proxy.js";

export class JsonRpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
    this.name = "JsonRpcError";
  }
}

function createDefaultContext(request: JsonRpcRequest): ToolContext {
  const memory = new Map<string, unknown>();

  return {
    auth: undefined,
    request: {
      id: String(request.id ?? randomUUID()),
      signal: new AbortController().signal,
      host: "unknown",
      transport: "streamable-http"
    },
    services: {},
    tools: {},
    result,
    log: consoleLogger,
    trace: {
      async span(_name, run) {
        return run();
      }
    },
    storage: {
      async get(key) {
        return memory.get(key) as never;
      },
      async set(key, value) {
        memory.set(key, value);
      },
      async delete(key) {
        memory.delete(key);
      }
    },
    env: process.env
  };
}

const consoleLogger = {
  debug(message: string, data?: Record<string, unknown>) {
    console.debug(message, data ?? "");
  },
  info(message: string, data?: Record<string, unknown>) {
    console.info(message, data ?? "");
  },
  warn(message: string, data?: Record<string, unknown>) {
    console.warn(message, data ?? "");
  },
  error(message: string, data?: Record<string, unknown>) {
    console.error(message, data ?? "");
  }
};

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function assertJsonRpcRequest(value: unknown): JsonRpcRequest {
  if (!value || typeof value !== "object") {
    throw new JsonRpcError(-32600, "Request must be a JSON object.");
  }

  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== "2.0" || typeof record.method !== "string") {
    throw new JsonRpcError(-32600, "Invalid JSON-RPC request.");
  }

  return {
    jsonrpc: "2.0",
    id: typeof record.id === "string" || typeof record.id === "number" || record.id === null ? record.id : undefined,
    method: record.method,
    params: record.params
  };
}

function normalizeError(error: unknown): JsonRpcErrorPayload {
  if (error instanceof JsonRpcError) {
    return {
      code: error.code,
      message: error.message,
      data: error.data
    };
  }

  if (error instanceof Error) {
    return {
      code: -32000,
      message: error.message
    };
  }

  return {
    code: -32000,
    message: "Unknown server error.",
    data: error as JsonObject
  };
}
