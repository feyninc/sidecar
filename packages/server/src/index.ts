/**
 * Minimal MCP JSON-RPC runtime for Sidecar tools and widget resources.
 *
 * The server package is deliberately small: it maps MCP methods to loaded
 * Sidecar tools, applies optional auth/proxy layers, and serves generated UI
 * resources during development or simple deployments.
 */
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { runProxy, type SidecarProxy } from "./proxy.js";
import type { SidecarAuth } from "@sidecar/auth";
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

/** JSON-RPC request shape accepted by the MCP runtime. */
export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};

/** JSON-RPC response shape returned by the MCP runtime. */
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

/** Runtime tool plus an optional precomputed descriptor from the compiler. */
export type LoadedTool = {
  tool: SidecarTool<any, any, any>;
  descriptor?: McpToolDescriptor;
};

/** HTML/text resource served to MCP Apps clients. */
export type LoadedResource = {
  uri: string;
  name?: string;
  mimeType: string;
  text: string;
};

/** Options for the in-memory MCP request dispatcher. */
export type SidecarMcpServerOptions = {
  name?: string;
  version?: string;
  tools: LoadedTool[];
  resources?: LoadedResource[];
  auth?: SidecarAuth;
  createContext?: (request: JsonRpcRequest) => ToolContext | Promise<ToolContext>;
};

/** Additional request context supplied by HTTP adapters. */
export type SidecarHandleContext = {
  request?: Request;
};

/** JSON-RPC MCP dispatcher for Sidecar tools and resources. */
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

  /** Returns all tool descriptors exposed through `tools/list`. */
  descriptors(): McpToolDescriptor[] {
    return [...this.tools.values()].map((loaded) => loaded.descriptor ?? createToolDescriptor(loaded.tool));
  }

  /** Handles a JSON-RPC request or notification. */
  async handle(
    request: JsonRpcRequest,
    context: SidecarHandleContext = {},
  ): Promise<JsonRpcResponse | undefined> {
    if (request.id === undefined) {
      await this.handleNotification(request);
      return undefined;
    }

    try {
      const result = await this.dispatch(request, context);
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

  /** Routes an MCP method to its implementation. */
  private async dispatch(
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<unknown> {
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
        return this.callTool(request, context);

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

  /** Executes a tool after request-level and tool-level auth checks. */
  private async callTool(
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<McpToolResult> {
    const params = request.params as { name?: unknown; arguments?: unknown } | undefined;
    const name = typeof params?.name === "string" ? params.name : undefined;
    if (!name) {
      throw new JsonRpcError(-32602, "tools/call requires params.name.");
    }

    const loaded = this.tools.get(name);
    if (!loaded) {
      throw new JsonRpcError(-32602, `Unknown tool "${name}".`);
    }

    const authSession = await this.authorizeTool(loaded, context);
    const ctx = this.options.createContext
      ? await this.options.createContext(request)
      : createDefaultContext(request);
    if (authSession !== undefined) {
      ctx.auth = authSession;
    }

    return executeTool(loaded.tool, params?.arguments ?? {}, ctx);
  }

  /** Applies Sidecar auth policy for a tool call. */
  private async authorizeTool(
    loaded: LoadedTool,
    context: SidecarHandleContext,
  ): Promise<unknown | undefined> {
    const policy = loaded.tool.auth;
    if (!policy || policy.public === true) {
      return undefined;
    }

    if (!this.options.auth) {
      if (policy) {
        throw new JsonRpcError(
          -32001,
          `Tool "${loaded.descriptor?.name ?? loaded.tool.name}" requires auth, but no auth.ts configuration is loaded.`,
        );
      }
      return undefined;
    }

    const request = context.request ?? new Request(this.options.auth.resource);
    const requestAuth = await this.options.auth.authorizeRequest(request);
    if (!requestAuth.ok) {
      throw authJsonRpcError(requestAuth);
    }

    const toolAuth = this.options.auth.authorizeTool(policy, requestAuth.auth);
    if (!toolAuth.ok) {
      throw authJsonRpcError(toolAuth);
    }

    return toolAuth.auth;
  }

  /** Reads a generated widget/resource by URI. */
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

  /** Accepts notifications without side effects for client compatibility. */
  private async handleNotification(_request: JsonRpcRequest): Promise<void> {
    // Notifications intentionally do not produce responses. The v0 server does
    // not need notification side effects yet, but accepting them makes MCP
    // clients less brittle during initialization.
  }
}

/** Creates an in-memory MCP dispatcher. */
export function createSidecarMcpServer(options: SidecarMcpServerOptions): SidecarMcpServer {
  return new SidecarMcpServer(options);
}

/** Creates a Node HTTP server exposing the MCP dispatcher at one endpoint. */
export function createSidecarHttpServer(options: SidecarMcpServerOptions & { path?: string; proxy?: SidecarProxy }) {
  const mcp = createSidecarMcpServer(options);
  const endpoint = options.path ?? "/mcp";

  return createServer(async (request, response) => {
    if (isRejectedLocalOrigin(request)) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "forbidden_origin" }));
      return;
    }

    const proxyResult = await runProxy(options.proxy, request);
    if (proxyResult) {
      response.writeHead(proxyResult.status, proxyResult.headers);
      response.end(proxyResult.body ?? "");
      return;
    }

    const pathname = request.url?.split("?")[0];
    if (
      options.auth &&
      request.method === "GET" &&
      isProtectedResourceMetadataPath(pathname, endpoint)
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(options.auth.metadata()));
      return;
    }

    if (request.method === "GET" && pathname === endpoint) {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "sse_not_supported" }));
      return;
    }

    if (request.method !== "POST" || pathname !== endpoint) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    try {
      const body = await readJson(request);
      const requests = Array.isArray(body) ? body : [body];
      const responses = (
        await Promise.all(
          requests.map((entry) =>
            mcp.handle(assertJsonRpcRequest(entry), {
              request: toFetchRequest(request)
            })
          )
        )
      ).filter(Boolean);

      const payload = Array.isArray(body) ? responses : responses[0] ?? null;
      if (!responses.length) {
        response.writeHead(202);
        response.end();
        return;
      }

      const authError = Array.isArray(body) ? undefined : httpAuthError(payload);
      response.writeHead(authError?.status ?? 200, {
        "content-type": "application/json",
        ...(authError?.headers ?? {}),
      });
      response.end(JSON.stringify(payload));
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

/** Rejects browser-originated requests to local MCP servers from non-local origins. */
function isRejectedLocalOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return false;
  }

  const host = request.headers.host ?? "";
  if (!isLocalHost(host)) {
    return false;
  }

  try {
    return !isLocalHost(new URL(origin).host);
  } catch {
    return true;
  }
}

/** Returns true for localhost hosts, with or without a port. */
function isLocalHost(host: string): boolean {
  if (host.startsWith("[::1]")) {
    return true;
  }

  const hostname = host.split(":")[0]?.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/** Returns true for the OAuth protected resource metadata endpoints Sidecar serves. */
function isProtectedResourceMetadataPath(
  pathname: string | undefined,
  endpoint: string,
): boolean {
  return (
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname === `/.well-known/oauth-protected-resource${endpoint}`
  );
}

export * from "./proxy.js";

/** JSON-RPC error with optional structured metadata. */
export class JsonRpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
    this.name = "JsonRpcError";
  }
}

/** Creates the default tool context used by tests and the dev server. */
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

/** Converts auth challenges into JSON-RPC errors while preserving HTTP metadata. */
function authJsonRpcError(result: Exclude<Awaited<ReturnType<SidecarAuth["authorizeRequest"]>>, { ok: true }>): JsonRpcError {
  return new JsonRpcError(
    result.status === 401 ? -32001 : -32003,
    result.body.error_description ?? result.body.error,
    {
      status: result.status,
      headers: headersToRecord(result.headers),
      body: result.body
    }
  );
}

/** Converts Fetch headers to a plain object for JSON-RPC error metadata. */
function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

/** Extracts HTTP auth status/headers from a JSON-RPC auth error response. */
function httpAuthError(value: unknown): { status: number; headers: Record<string, string> } | undefined {
  if (!value || typeof value !== "object" || !("error" in value)) {
    return undefined;
  }

  const error = (value as { error?: { data?: unknown } }).error;
  const data = error?.data;
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const status = (data as { status?: unknown }).status;
  const headers = (data as { headers?: unknown }).headers;
  if ((status !== 401 && status !== 403) || !headers || typeof headers !== "object") {
    return undefined;
  }

  return {
    status,
    headers: headers as Record<string, string>,
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

/** Reads and parses a JSON HTTP request body. */
async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Converts a Node request into a Fetch Request for auth/session code. */
function toFetchRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const protocol = headers.get("x-forwarded-proto") ?? "http";
  const host = headers.get("host") ?? "127.0.0.1";
  return new Request(`${protocol}://${host}${request.url ?? "/"}`, {
    headers,
    method: request.method
  });
}

/** Validates an arbitrary value as a JSON-RPC request. */
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

/** Normalizes unknown errors into JSON-RPC error payloads. */
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
