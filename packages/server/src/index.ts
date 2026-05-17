/**
 * Minimal MCP JSON-RPC runtime for Sidecar tools and widget resources.
 *
 * The server package is deliberately small: it maps MCP methods to loaded
 * Sidecar tools, applies optional auth/proxy layers, and serves generated UI
 * resources during development or simple deployments.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { runProxy, type SidecarProxy } from "./proxy.js";
import type { SidecarAuth } from "@sidecar/auth";
import {
  createToolDescriptor,
  executeTool,
  type JsonSchema,
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

type RegisteredTool = LoadedTool & {
  descriptor: McpToolDescriptor;
  descriptorProvided: boolean;
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
  maxBodyBytes?: number;
  toolTimeoutMs?: number;
  allowedOrigins?: string[];
  publicUrl?: string;
};

/** Additional request context supplied by HTTP adapters. */
export type SidecarHandleContext = {
  request?: Request;
  authSession?: unknown;
};

/** JSON-RPC MCP dispatcher for Sidecar tools and resources. */
export class SidecarMcpServer {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly resources = new Map<string, LoadedResource>();

  constructor(private readonly options: SidecarMcpServerOptions) {
    for (const loaded of options.tools) {
      const descriptorProvided = Boolean(loaded.descriptor);
      const descriptor = loaded.descriptor ?? createToolDescriptor(loaded.tool);
      if (this.tools.has(descriptor.name)) {
        throw new Error(`Duplicate Sidecar tool id "${descriptor.name}".`);
      }
      this.tools.set(descriptor.name, { ...loaded, descriptor, descriptorProvided });
    }

    for (const resource of options.resources ?? []) {
      if (this.resources.has(resource.uri)) {
        throw new Error(`Duplicate Sidecar resource uri "${resource.uri}".`);
      }
      this.resources.set(resource.uri, resource);
    }
  }

  /** Returns all tool descriptors exposed through `tools/list`. */
  descriptors(): McpToolDescriptor[] {
    return [...this.tools.values()].map((loaded) => loaded.descriptor);
  }

  /** Handles a JSON-RPC request or notification. */
  async handle(
    request: JsonRpcRequest,
    context: SidecarHandleContext = {},
  ): Promise<JsonRpcResponse | undefined> {
    if (request.id === undefined) {
      await this.authorizeEndpoint(context);
      await this.handleNotification(request);
      return undefined;
    }

    try {
      const authSession = await this.authorizeEndpoint(context);
      const authorizedContext = { ...context, authSession };
      const result = await this.dispatch(request, authorizedContext);
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
    const controller = new AbortController();
    ctx.request = {
      ...ctx.request,
      signal: controller.signal,
    };

    const args = loaded.descriptorProvided
      ? validateAgainstSchema(
          loaded.descriptor.inputSchema,
          params?.arguments ?? {},
          `Invalid parameters for tool "${name}".`,
        )
      : params?.arguments ?? {};
    const result = await withTimeout(
      executeTool(loaded.tool, args, ctx),
      this.options.toolTimeoutMs,
      controller,
    );
    if (loaded.descriptorProvided) {
      validateAgainstSchema(
        loaded.descriptor.outputSchema,
        result.structuredContent,
        `Invalid structuredContent returned by tool "${name}".`,
      );
    }
    return result;
  }

  /** Authenticates the whole HTTP MCP request when auth.ts is configured. */
  private async authorizeEndpoint(
    context: SidecarHandleContext,
  ): Promise<unknown | undefined> {
    if (context.authSession !== undefined) {
      return context.authSession;
    }
    if (!this.options.auth) {
      return undefined;
    }

    const request = context.request ?? new Request(this.options.auth.resource);
    const requestAuth = await this.options.auth.authorizeRequest(request);
    if (!requestAuth.ok) {
      throw authJsonRpcError(requestAuth);
    }

    return requestAuth.auth;
  }

  /** Applies Sidecar auth policy for a tool call. */
  private async authorizeTool(
    loaded: RegisteredTool,
    context: SidecarHandleContext,
  ): Promise<unknown | undefined> {
    const policy = loaded.tool.auth;

    if (!this.options.auth) {
      if (policy && policy.public !== true) {
        throw new JsonRpcError(
          -32001,
          `Tool "${loaded.descriptor?.name ?? loaded.tool.name}" requires auth, but no auth.ts configuration is loaded.`,
        );
      }
      return undefined;
    }

    const authSession = context.authSession ?? await this.authorizeEndpoint(context);
    const toolAuth = this.options.auth.authorizeTool(policy, authSession as never);
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
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;

  return createServer(async (request, response) => {
    if (isRejectedOrigin(request, options.allowedOrigins)) {
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
      validateProtocolVersion(request);
      validatePostHeaders(request);

      const body = await readJson(request, maxBodyBytes);
      if (Array.isArray(body)) {
        throw new JsonRpcHttpError(400, -32600, "JSON-RPC batches are not supported by MCP Streamable HTTP.");
      }
      if (isJsonRpcResponseMessage(body)) {
        response.writeHead(202);
        response.end();
        return;
      }

      const rpcRequest = assertJsonRpcRequest(body);
      const fetchRequest = toFetchRequest(request, options.publicUrl ?? options.auth?.resource);
      const authSession = options.auth
        ? await authorizeHttpRequest(options.auth, fetchRequest, response)
        : undefined;
      if (options.auth && authSession === AUTH_RESPONSE_SENT) {
        return;
      }

      const payload = await mcp.handle(rpcRequest, {
        request: fetchRequest,
        authSession,
      }) ?? null;
      const responses = payload === null ? [] : [payload];
      if (!responses.length) {
        response.writeHead(202);
        response.end();
        return;
      }

      const authError = httpAuthError(payload);
      response.writeHead(authError?.status ?? 200, {
        "content-type": "application/json",
        ...(authError?.headers ?? {}),
      });
      response.end(JSON.stringify(payload));
    } catch (error) {
      const status = error instanceof JsonRpcHttpError ? error.status : 400;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: normalizeHttpError(error)
        })
      );
    }
  });
}

const DEFAULT_ALLOWED_ORIGINS = [
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://claude.ai",
  "https://*.claude.ai",
];

/** Rejects browser-originated requests from invalid or unexpected origins. */
function isRejectedOrigin(request: IncomingMessage, allowedOrigins: string[] = []): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return false;
  }

  const host = request.headers.host ?? "";
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return true;
  }

  if (isLocalHost(host)) {
    return !isLocalHost(originUrl.host);
  }

  const requestOrigin = `https://${host}`;
  const allowed = [requestOrigin, ...DEFAULT_ALLOWED_ORIGINS, ...allowedOrigins];
  return !allowed.some((pattern) => matchesOrigin(pattern, originUrl.origin));
}

/** Returns true for localhost hosts, with or without a port. */
function isLocalHost(host: string): boolean {
  if (host.startsWith("[::1]")) {
    return true;
  }

  const hostname = host.split(":")[0]?.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/** Matches exact origin strings or simple wildcard host patterns. */
function matchesOrigin(pattern: string, origin: string): boolean {
  if (pattern === origin) {
    return true;
  }
  if (!pattern.includes("*")) {
    return false;
  }

  const escaped = pattern.split("*").map(escapeRegExp).join("[^.]+");
  return new RegExp(`^${escaped}$`).test(origin);
}

/** Escapes a string before embedding it in an origin regexp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/** JSON-RPC error that must map to a concrete HTTP status. */
class JsonRpcHttpError extends JsonRpcError {
  constructor(readonly status: number, code: number, message: string, data?: unknown) {
    super(code, message, data);
    this.name = "JsonRpcHttpError";
  }
}

const AUTH_RESPONSE_SENT = Symbol("sidecar.auth.response-sent");

/** Performs HTTP request-level auth and writes 401/403 directly. */
async function authorizeHttpRequest(
  auth: SidecarAuth,
  request: Request,
  response: ServerResponse,
): Promise<unknown | typeof AUTH_RESPONSE_SENT> {
  const result = await auth.authorizeRequest(request);
  if (result.ok) {
    return result.auth;
  }

  response.writeHead(result.status, {
    "content-type": "application/json",
    ...headersToRecord(result.headers),
  });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: result.status === 401 ? -32001 : -32003,
        message: result.body.error_description ?? result.body.error,
        data: {
          status: result.status,
          body: result.body,
        },
      },
    }),
  );
  return AUTH_RESPONSE_SENT;
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

/** Rejects unsupported MCP protocol versions when clients send the header. */
function validateProtocolVersion(request: IncomingMessage): void {
  const value = request.headers["mcp-protocol-version"];
  const version = Array.isArray(value) ? value[0] : value;
  if (!version) {
    return;
  }

  const supported = new Set(["2025-11-25"]);
  if (!supported.has(version)) {
    throw new JsonRpcHttpError(
      400,
      -32600,
      `Unsupported MCP-Protocol-Version "${version}".`,
    );
  }
}

/** Enforces Streamable HTTP POST content negotiation before body parsing. */
function validatePostHeaders(request: IncomingMessage): void {
  const contentType = request.headers["content-type"];
  const contentTypeValue = Array.isArray(contentType) ? contentType[0] : contentType;
  if (!contentTypeValue?.toLowerCase().includes("application/json")) {
    throw new JsonRpcHttpError(415, -32600, "POST Content-Type must be application/json.");
  }

  const accept = request.headers.accept;
  const acceptValue = Array.isArray(accept) ? accept.join(",") : accept;
  if (
    !acceptValue ||
    !acceptValue.toLowerCase().includes("application/json") ||
    !acceptValue.toLowerCase().includes("text/event-stream")
  ) {
    throw new JsonRpcHttpError(
      406,
      -32600,
      "POST Accept must include application/json and text/event-stream.",
    );
  }
}

/** Adds a timeout and abort signal to tool execution. */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  controller: AbortController,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new JsonRpcError(-32000, "Tool execution timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/** Validates simple JSON Schema values used by compiler-generated descriptors. */
function validateAgainstSchema(
  schema: JsonSchema | undefined,
  value: unknown,
  message: string,
  options: { optional?: boolean } = {},
): unknown {
  if (!schema || (value === undefined && options.optional)) {
    return value;
  }

  const failure = schemaFailure(schema, value, "$");
  if (failure) {
    throw new JsonRpcError(-32602, message, { validation: failure });
  }
  return value;
}

/** Returns a readable validation failure for the supported JSON Schema subset. */
function schemaFailure(schema: JsonSchema, value: unknown, path: string): string | undefined {
  if (schema.anyOf?.length && !schema.anyOf.some((entry) => !schemaFailure(entry, value, path))) {
    return `${path} must match one anyOf schema.`;
  }
  if (schema.oneOf?.length && schema.oneOf.filter((entry) => !schemaFailure(entry, value, path)).length !== 1) {
    return `${path} must match exactly one oneOf schema.`;
  }
  if (schema.allOf?.length) {
    for (const entry of schema.allOf) {
      const failure = schemaFailure(entry, value, path);
      if (failure) return failure;
    }
  }
  if (schema.const !== undefined && value !== schema.const) {
    return `${path} must equal ${JSON.stringify(schema.const)}.`;
  }
  if (schema.enum && !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) {
    return `${path} must be one of the declared enum values.`;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesJsonSchemaType(type, value))) {
      return `${path} must be ${types.join(" or ")}.`;
    }
  }

  if (schema.type === "object" || schema.properties || schema.required) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return `${path} must be an object.`;
    }
    const record = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!(required in record)) {
        return `${path}.${required} is required.`;
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (key in record) {
        const failure = schemaFailure(propertySchema, record[key], `${path}.${key}`);
        if (failure) return failure;
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      const extra = Object.keys(record).find((key) => !allowed.has(key));
      if (extra) {
        return `${path}.${extra} is not allowed.`;
      }
    }
  }

  if (schema.type === "array" || schema.items) {
    if (!Array.isArray(value)) {
      return `${path} must be an array.`;
    }
    if (schema.items) {
      for (const [index, entry] of value.entries()) {
        const failure = schemaFailure(schema.items, entry, `${path}[${index}]`);
        if (failure) return failure;
      }
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `${path} is shorter than ${schema.minLength}.`;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `${path} is longer than ${schema.maxLength}.`;
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `${path} is less than ${schema.minimum}.`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `${path} is greater than ${schema.maximum}.`;
    }
  }

  return undefined;
}

/** Returns true when a value matches a primitive JSON Schema type. */
function matchesJsonSchemaType(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return Boolean(value && typeof value === "object" && !Array.isArray(value));
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
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

/** Reads and parses a bounded JSON HTTP request body. */
async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) {
      throw new JsonRpcHttpError(413, -32600, "Request body is too large.");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Converts a Node request into a Fetch Request for auth/session code. */
function toFetchRequest(request: IncomingMessage, baseUrl?: string): Request {
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

  const url = baseUrl
    ? new URL(request.url ?? "/", baseUrl)
    : new URL(
        request.url ?? "/",
        `${headers.get("x-forwarded-proto") ?? "http"}://${headers.get("host") ?? "127.0.0.1"}`,
      );
  return new Request(url, {
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
  if (
    "id" in record &&
    record.id !== undefined &&
    record.id !== null &&
    typeof record.id !== "string" &&
    typeof record.id !== "number"
  ) {
    throw new JsonRpcError(-32600, "JSON-RPC id must be a string, number, or null.");
  }

  return {
    jsonrpc: "2.0",
    id: typeof record.id === "string" || typeof record.id === "number" || record.id === null ? record.id : undefined,
    method: record.method,
    params: record.params
  };
}

/** Returns true for client responses that Streamable HTTP servers may acknowledge. */
function isJsonRpcResponseMessage(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== "2.0" || !("id" in record) || !("result" in record || "error" in record)) {
    return false;
  }

  return (
    record.id === null ||
    typeof record.id === "string" ||
    typeof record.id === "number"
  );
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
      message: "Internal server error."
    };
  }

  return {
    code: -32000,
    message: "Unknown server error.",
    data: error as JsonObject
  };
}

/** Normalizes transport-level parse/validation errors for HTTP responses. */
function normalizeHttpError(error: unknown): JsonRpcErrorPayload {
  if (error instanceof JsonRpcError) {
    return {
      code: error.code,
      message: error.message,
      data: error.data,
    };
  }

  return {
    code: -32700,
    message: "Invalid JSON request body.",
  };
}
