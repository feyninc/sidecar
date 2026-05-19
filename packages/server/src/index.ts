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
import { createSseHub, createSseStream, type McpNotificationSink } from "./sse.js";
import type { SidecarAuth } from "@sidecar-ai/auth";
import { JSONRPC_VERSION } from "@modelcontextprotocol/sdk/types.js";
import type { RequestId } from "@modelcontextprotocol/sdk/types.js";
import {
  createToolDescriptor,
  executePrompt,
  executeResource,
  executeTool,
  SidecarRuntimeError,
  type JsonObject,
  type JsonSchema,
  type McpListOperation,
  type McpPromptDescriptor,
  type McpPromptResult,
  type McpResourceDescriptor,
  type McpResourceReadResult,
  type McpResourceTemplateDescriptor,
  type McpToolDescriptor,
  type McpToolResult,
  type PaginationConfig,
  type PaginationOverride,
  type PaginationResult,
  type ProgressToken,
  type PromptContext,
  type ResourceCapabilityConfig,
  type ResourceContext,
  type RuntimeNotifications,
  type SidecarPrompt,
  type SidecarResource,
  type SidecarTool,
  type ToolCapabilityConfig,
  type ToolContext
} from "@sidecar-ai/core";

/** JSON-RPC request shape accepted by the MCP runtime. */
export type JsonRpcRequest = {
  jsonrpc: typeof JSONRPC_VERSION;
  id?: RequestId | null;
  method: string;
  params?: unknown;
};

/** JSON-RPC response shape returned by the MCP runtime. */
export type JsonRpcResponse =
  | {
      jsonrpc: typeof JSONRPC_VERSION;
      id: RequestId | null;
      result: unknown;
    }
  | {
      jsonrpc: typeof JSONRPC_VERSION;
      id: RequestId | null;
      error: {
        code: number;
        message: string;
        data?: unknown;
      };
    };

type JsonRpcErrorPayload = Extract<JsonRpcResponse, { error: unknown }>["error"];

/** MCP protocol version Sidecar currently speaks over Streamable HTTP. */
export const SIDECAR_MCP_PROTOCOL_VERSION = "2025-11-25";

/** Runtime tool plus an optional precomputed descriptor from the compiler. */
export type LoadedTool = {
  tool: SidecarTool<any, any, any>;
  descriptor?: McpToolDescriptor;
};

type RegisteredTool = LoadedTool & {
  descriptor: McpToolDescriptor;
  descriptorProvided: boolean;
};

type RegisteredResource = LoadedResource & {
  descriptor: McpResourceDescriptor;
};

type RegisteredPrompt = LoadedPrompt & {
  descriptor: McpPromptDescriptor;
};

/** HTML/text resource served to MCP Apps clients. */
export type LoadedResource = {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  text?: string;
  _meta?: Record<string, unknown>;
  resource?: SidecarResource;
  descriptor?: McpResourceDescriptor;
};

/** Runtime prompt plus an optional precomputed descriptor from the compiler. */
export type LoadedPrompt = {
  prompt: SidecarPrompt<any, any, any>;
  descriptor?: McpPromptDescriptor;
};

/** Optional resource template descriptor exposed by `resources/templates/list`. */
export type LoadedResourceTemplate = {
  descriptor: McpResourceTemplateDescriptor;
};

/** Options for the in-memory MCP request dispatcher. */
export type SidecarMcpServerOptions = {
  name?: string;
  version?: string;
  tools: LoadedTool[];
  resources?: LoadedResource[];
  resourceTemplates?: LoadedResourceTemplate[];
  prompts?: LoadedPrompt[];
  auth?: SidecarAuth;
  createContext?: (request: JsonRpcRequest) => ToolContext | Promise<ToolContext>;
  maxBodyBytes?: number;
  toolTimeoutMs?: number;
  allowedOrigins?: string[];
  publicUrl?: string;
  capabilities?: {
    tools?: ToolCapabilityConfig;
    resources?: ResourceCapabilityConfig;
    prompts?: { listChanged?: boolean };
  };
  pagination?: PaginationConfig;
};

/** Additional request context supplied by HTTP adapters. */
export type SidecarHandleContext = {
  request?: Request;
  authSession?: unknown;
  notifications?: McpNotificationSink;
};

/** Node-style HTTP request handler used by servers and serverless adapters. */
export type SidecarHttpRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export type { McpNotificationMessage, McpNotificationSink } from "./sse.js";

type RuntimeNotificationOptions = {
  toolsListChanged: boolean;
  resourcesListChanged: boolean;
  promptsListChanged: boolean;
  isResourceSubscribed(uri: string): boolean;
};

/** JSON-RPC MCP dispatcher for Sidecar tools and resources. */
export class SidecarMcpServer {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly resources = new Map<string, RegisteredResource>();
  private readonly prompts = new Map<string, RegisteredPrompt>();
  private readonly resourceTemplates: LoadedResourceTemplate[];
  private readonly activeRequests = new Map<RequestId, AbortController>();
  private readonly subscribedResourceUris = new Set<string>();

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
      const descriptor = resource.descriptor ?? {
        uri: resource.uri,
        name: resource.name ?? resource.uri,
        description: resource.description,
        mimeType: resource.mimeType,
        _meta: resource._meta,
      };
      this.resources.set(resource.uri, { ...resource, descriptor });
    }

    for (const loaded of options.prompts ?? []) {
      const descriptor = loaded.descriptor ?? {
        name: loaded.prompt.name ?? loaded.prompt.title,
        title: loaded.prompt.title,
        description: loaded.prompt.description,
      };
      if (this.prompts.has(descriptor.name)) {
        throw new Error(`Duplicate Sidecar prompt name "${descriptor.name}".`);
      }
      this.prompts.set(descriptor.name, { ...loaded, descriptor });
    }

    this.resourceTemplates = options.resourceTemplates ?? [];
  }

  /** Returns all tool descriptors exposed through `tools/list`. */
  descriptors(): McpToolDescriptor[] {
    return [...this.tools.values()].map((loaded) => loaded.descriptor);
  }

  /** Returns all resource descriptors exposed through `resources/list`. */
  resourceDescriptors(): McpResourceDescriptor[] {
    return [...this.resources.values()].map((loaded) => loaded.descriptor);
  }

  /** Returns all prompt descriptors exposed through `prompts/list`. */
  promptDescriptors(): McpPromptDescriptor[] {
    return [...this.prompts.values()].map((loaded) => loaded.descriptor);
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
        jsonrpc: JSONRPC_VERSION,
        id: request.id,
        result
      };
    } catch (error) {
      if (error instanceof RequestCancelledError) {
        return undefined;
      }
      return {
        jsonrpc: JSONRPC_VERSION,
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
          protocolVersion: SIDECAR_MCP_PROTOCOL_VERSION,
          capabilities: this.capabilities(),
          serverInfo: {
            name: this.options.name ?? "sidecar",
            version: this.options.version ?? "0.0.0-dev"
          }
        };

      case "ping":
        return {};

      case "tools/list":
        return this.listTools(request, context);

      case "tools/call":
        return this.callTool(request, context);

      case "resources/list":
        return this.listResources(request, context);

      case "resources/read":
        return this.readResource(request, context);

      case "resources/templates/list":
        return this.listResourceTemplates(request, context);

      case "resources/subscribe":
        return this.subscribeResource(request);

      case "resources/unsubscribe":
        return this.unsubscribeResource(request);

      case "prompts/list":
        return this.listPrompts(request, context);

      case "prompts/get":
        return this.getPrompt(request, context);

      default:
        throw new JsonRpcError(-32601, `Unsupported method "${request.method}".`);
    }
  }

  /** Builds the MCP server capability object from implemented runtime features. */
  private capabilities(): Record<string, unknown> {
    const configured = this.options.capabilities ?? {};
    return stripUndefined({
      tools: stripUndefined({
        listChanged: configured.tools?.listChanged || undefined,
      }),
      resources: stripUndefined({
        subscribe: configured.resources?.subscribe || undefined,
        listChanged: configured.resources?.listChanged || undefined,
      }),
      prompts: this.prompts.size || configured.prompts?.listChanged
        ? stripUndefined({
            listChanged: configured.prompts?.listChanged || undefined,
          })
        : undefined,
    });
  }

  /** Lists tools with MCP cursor pagination. */
  private async listTools(
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<{ tools: McpToolDescriptor[]; nextCursor?: string }> {
    const page = await this.paginate("tools/list", this.descriptors(), request, context);
    return stripUndefined({
      tools: [...page.items],
      nextCursor: page.nextCursor,
    });
  }

  /** Lists resources with MCP cursor pagination. */
  private async listResources(
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<{ resources: McpResourceDescriptor[]; nextCursor?: string }> {
    const page = await this.paginate("resources/list", this.resourceDescriptors(), request, context);
    return stripUndefined({
      resources: [...page.items],
      nextCursor: page.nextCursor,
    });
  }

  /** Lists resource templates with MCP cursor pagination. */
  private async listResourceTemplates(
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<{ resourceTemplates: McpResourceTemplateDescriptor[]; nextCursor?: string }> {
    const page = await this.paginate(
      "resources/templates/list",
      this.resourceTemplates.map((entry) => entry.descriptor),
      request,
      context,
    );
    return stripUndefined({
      resourceTemplates: [...page.items],
      nextCursor: page.nextCursor,
    });
  }

  /** Lists prompts with MCP cursor pagination. */
  private async listPrompts(
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<{ prompts: McpPromptDescriptor[]; nextCursor?: string }> {
    const page = await this.paginate("prompts/list", this.promptDescriptors(), request, context);
    return stripUndefined({
      prompts: [...page.items],
      nextCursor: page.nextCursor,
    });
  }

  /** Applies configured or default cursor pagination to one supported list operation. */
  private async paginate<Item>(
    operation: McpListOperation,
    items: readonly Item[],
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<PaginationResult<Item>> {
    const cursor = readCursorParam(request);
    const pageSize = this.pageSize();
    const override = selectPaginationOverride<Item>(this.options.pagination?.override, operation);
    if (override) {
      return override({
        operation,
        items,
        cursor,
        pageSize,
        auth: context.authSession,
      });
    }

    return defaultPagination(items, cursor, pageSize);
  }

  /** Returns the server-chosen page size for all built-in list pagination. */
  private pageSize(): number {
    const configured = this.options.pagination?.pageSize;
    return configured && configured > 0 ? Math.floor(configured) : 10;
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
    ctx.notify = this.createNotifications(context, request);
    const controller = new AbortController();
    if (request.id !== null && request.id !== undefined) {
      this.activeRequests.set(request.id, controller);
    }
    ctx.request = {
      ...ctx.request,
      signal: controller.signal,
    };

    try {
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
    } finally {
      if (request.id !== null && request.id !== undefined) {
        this.activeRequests.delete(request.id);
      }
    }
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

  /** Reads a generated widget or authored resource by URI. */
  private async readResource(
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<McpResourceReadResult> {
    const params = request.params as { uri?: unknown } | undefined;
    const uri = typeof params?.uri === "string" ? params.uri : undefined;
    if (!uri) {
      throw new JsonRpcError(-32602, "resources/read requires params.uri.");
    }

    const resource = this.resources.get(uri);
    if (!resource) {
      throw new JsonRpcError(-32002, `Resource not found: "${uri}".`, { uri });
    }

    if (resource.resource) {
      const toolContext = this.options.createContext
        ? await this.options.createContext(request)
        : createDefaultContext(request);
      if (context.authSession !== undefined) {
        toolContext.auth = context.authSession;
      }
      toolContext.notify = this.createNotifications(context, request);
      return executeResource(resource.resource, toResourceContext(toolContext), {
        uri,
        mimeType: resource.descriptor.mimeType,
      });
    }

    return {
      contents: [
        {
          uri,
          mimeType: resource.mimeType ?? "text/plain",
          text: resource.text ?? "",
          _meta: resource._meta
        }
      ]
    };
  }

  /** Accepts a resource subscription when server-level support is enabled. */
  private subscribeResource(request: JsonRpcRequest): Record<string, never> {
    if (!this.options.capabilities?.resources?.subscribe) {
      throw new JsonRpcError(-32601, "Resource subscriptions are not enabled.");
    }
    const uri = readUriParam(request, "resources/subscribe");
    if (!this.resources.has(uri)) {
      throw new JsonRpcError(-32002, `Resource not found: "${uri}".`, { uri });
    }
    this.subscribedResourceUris.add(uri);
    return {};
  }

  /** Accepts a resource unsubscription when server-level support is enabled. */
  private unsubscribeResource(request: JsonRpcRequest): Record<string, never> {
    if (!this.options.capabilities?.resources?.subscribe) {
      throw new JsonRpcError(-32601, "Resource subscriptions are not enabled.");
    }
    const uri = readUriParam(request, "resources/unsubscribe");
    if (!this.resources.has(uri)) {
      throw new JsonRpcError(-32002, `Resource not found: "${uri}".`, { uri });
    }
    this.subscribedResourceUris.delete(uri);
    return {};
  }

  /** Renders one named prompt with validated arguments. */
  private async getPrompt(
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<McpPromptResult> {
    const params = request.params as { name?: unknown; arguments?: unknown } | undefined;
    const name = typeof params?.name === "string" ? params.name : undefined;
    if (!name) {
      throw new JsonRpcError(-32602, "prompts/get requires params.name.");
    }
    const loaded = this.prompts.get(name);
    if (!loaded) {
      throw new JsonRpcError(-32602, `Unknown prompt "${name}".`);
    }

    const toolContext = this.options.createContext
      ? await this.options.createContext(request)
      : createDefaultContext(request);
    if (context.authSession !== undefined) {
      toolContext.auth = context.authSession;
    }
    toolContext.notify = this.createNotifications(context, request);
    return executePrompt(loaded.prompt, params?.arguments ?? {}, toPromptContext(toolContext));
  }

  /** Creates notification helpers scoped by advertised server capabilities. */
  private createNotifications(
    context: SidecarHandleContext,
    request: JsonRpcRequest,
  ): RuntimeNotifications {
    const configured = this.options.capabilities ?? {};
    return createRuntimeNotifications(
      context.notifications,
      readProgressToken(request),
      {
        toolsListChanged: Boolean(configured.tools?.listChanged),
        resourcesListChanged: Boolean(configured.resources?.listChanged),
        promptsListChanged: Boolean(configured.prompts?.listChanged),
        isResourceSubscribed: (uri) => this.subscribedResourceUris.has(uri),
      },
    );
  }

  /** Accepts notifications without side effects for client compatibility. */
  private async handleNotification(request: JsonRpcRequest): Promise<void> {
    if (request.method === "notifications/cancelled") {
      this.cancelRequest(request);
    }
  }

  /** Applies a client cancellation notification to an active request. */
  private cancelRequest(request: JsonRpcRequest): void {
    const params = request.params as { requestId?: unknown; reason?: unknown } | undefined;
    const requestId = params?.requestId;
    if (typeof requestId !== "string" && typeof requestId !== "number") {
      return;
    }
    const controller = this.activeRequests.get(requestId);
    if (!controller || controller.signal.aborted) {
      return;
    }
    const reason = typeof params?.reason === "string" ? params.reason : "Request cancelled.";
    controller.abort(new RequestCancelledError(reason));
  }
}

/** Creates an in-memory MCP dispatcher. */
export function createSidecarMcpServer(options: SidecarMcpServerOptions): SidecarMcpServer {
  return new SidecarMcpServer(options);
}

/** Creates a Node HTTP server exposing the MCP dispatcher at one endpoint. */
export function createSidecarHttpServer(options: SidecarMcpServerOptions & { path?: string; proxy?: SidecarProxy }) {
  return createServer(createSidecarHttpHandler(options));
}

/** Creates a Node request handler exposing the MCP dispatcher at one endpoint. */
export function createSidecarHttpHandler(
  options: SidecarMcpServerOptions & { path?: string; proxy?: SidecarProxy },
): SidecarHttpRequestHandler {
  const endpoint = options.path ?? "/mcp";
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  const streamHub = createSseHub();
  const mcp = createSidecarMcpServer(options);

  return async (request, response) => {
    const pathname = request.url?.split("?")[0];
    const requestLog = createHttpRequestLog(request, pathname);
    response.once("finish", () => {
      logHttpRequest(requestLog, response.statusCode);
    });

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

    if (
      options.auth &&
      request.method === "GET" &&
      isProtectedResourceMetadataPath(pathname, endpoint)
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(options.auth.metadata()));
      return;
    }

    if (
      options.auth &&
      request.method === "GET" &&
      pathname === "/.well-known/oauth-authorization-server"
    ) {
      await proxyAuthorizationServerMetadata(options.auth, response);
      return;
    }

    if (request.method === "GET" && pathname === endpoint) {
      try {
        const fetchRequest = toFetchRequest(request, options.publicUrl ?? options.auth?.resource);
        if (options.auth) {
          const authSession = await authorizeHttpRequest(options.auth, fetchRequest, response);
          if (authSession === AUTH_RESPONSE_SENT) {
            return;
          }
        }
        validateProtocolVersion(request);
        validateGetHeaders(request);
        streamHub.open(response);
      } catch (error) {
        const status = error instanceof JsonRpcHttpError ? error.status : 400;
        response.writeHead(status, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: JSONRPC_VERSION,
            id: null,
            error: normalizeHttpError(error)
          })
        );
      }
      return;
    }

    if (pathname === endpoint && request.method !== "POST") {
      response.writeHead(405, {
        "allow": "GET, POST",
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    if (pathname !== endpoint) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    try {
      const fetchRequest = toFetchRequest(request, options.publicUrl ?? options.auth?.resource);
      const authSession = options.auth
        ? await authorizeHttpRequest(options.auth, fetchRequest, response)
        : undefined;
      if (options.auth && authSession === AUTH_RESPONSE_SENT) {
        return;
      }

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
      if (rpcRequest.id !== undefined && hasProgressToken(rpcRequest)) {
        const stream = createSseStream(response, { supportsRequestProgress: true });
        const payload = await mcp.handle(rpcRequest, {
          request: fetchRequest,
          authSession,
          notifications: stream,
        });
        if (payload) {
          stream.sendJson(payload);
        }
        stream.end();
        return;
      }

      const payload = await mcp.handle(rpcRequest, {
        request: fetchRequest,
        authSession,
        notifications: streamHub,
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
          jsonrpc: JSONRPC_VERSION,
          id: null,
          error: normalizeHttpError(error)
        })
      );
    }
  };
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

type HttpRequestLog = {
  method?: string;
  path?: string;
  host?: string;
  accept?: string;
  contentType?: string;
  contentLength?: string;
  mcpProtocolVersion?: string;
  origin?: string;
  userAgent?: string;
  authorization: "present" | "absent";
  cookie: "present" | "absent";
};

/** Captures sanitized request metadata for MCP deployment debugging. */
function createHttpRequestLog(
  request: IncomingMessage,
  pathname: string | undefined,
): HttpRequestLog {
  return {
    method: request.method,
    path: pathname,
    host: truncateHeader(singleHeader(request.headers.host)),
    accept: truncateHeader(singleHeader(request.headers.accept)),
    contentType: truncateHeader(singleHeader(request.headers["content-type"])),
    contentLength: truncateHeader(singleHeader(request.headers["content-length"])),
    mcpProtocolVersion: truncateHeader(singleHeader(request.headers["mcp-protocol-version"])),
    origin: truncateHeader(singleHeader(request.headers.origin)),
    userAgent: truncateHeader(singleHeader(request.headers["user-agent"])),
    authorization: request.headers.authorization ? "present" : "absent",
    cookie: request.headers.cookie ? "present" : "absent",
  };
}

/** Emits one JSON log line for failed requests, or all requests when debugging is enabled. */
function logHttpRequest(metadata: HttpRequestLog, status: number): void {
  const debug = process.env.SIDECAR_DEBUG === "1" || process.env.SIDECAR_LOG_LEVEL === "debug";
  if (!debug && status < 400) {
    return;
  }

  const message = JSON.stringify({
    event: "sidecar.mcp.http",
    status,
    ...stripUndefined(metadata),
  });
  if (status >= 500) {
    console.error(message);
  } else if (status >= 400) {
    console.warn(message);
  } else {
    console.info(message);
  }
}

/** Returns a single request-header value without exposing multi-value details. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(", ") : value;
}

/** Keeps diagnostic header values readable in provider logs. */
function truncateHeader(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}

/** Serves AuthKit-style compatibility metadata for older MCP clients. */
async function proxyAuthorizationServerMetadata(
  auth: SidecarAuth,
  response: ServerResponse,
): Promise<void> {
  const [authorizationServer] = auth.authorizationServers;
  if (!authorizationServer) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "authorization_server_not_configured" }));
    return;
  }

  try {
    const url = new URL("/.well-known/oauth-authorization-server", authorizationServer);
    const upstream = await fetch(url, { headers: { accept: "application/json" } });
    const body = await upstream.text();
    response.writeHead(upstream.ok ? 200 : 502, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    });
    response.end(body);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "sidecar.mcp.authorization_metadata_proxy_failed",
      authorizationServer,
      message: error instanceof Error ? error.message : "Unknown error",
    }));
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "authorization_metadata_unavailable" }));
  }
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

/** Internal sentinel used when a client cancels an active request. */
class RequestCancelledError extends Error {
  constructor(message = "Request cancelled.") {
    super(message);
    this.name = "RequestCancelledError";
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
      jsonrpc: JSONRPC_VERSION,
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
    notify: noopNotifications,
    env: process.env
  };
}

const noopNotifications: RuntimeNotifications = {
  async progress() {},
  async toolsChanged() {},
  async resourcesChanged() {},
  async promptsChanged() {},
  async resourceUpdated() {},
};

/** Creates typed notification helpers for one runtime invocation. */
function createRuntimeNotifications(
  sink: McpNotificationSink | undefined,
  progressToken: ProgressToken | undefined,
  options: RuntimeNotificationOptions,
): RuntimeNotifications {
  return {
    async progress(update) {
      if (!sink?.supportsRequestProgress || progressToken === undefined) {
        return;
      }
      sink.send("notifications/progress", stripUndefined({
        progressToken,
        progress: update.progress,
        total: update.total,
        message: update.message,
      }));
    },
    async toolsChanged() {
      if (options.toolsListChanged) {
        sink?.send("notifications/tools/list_changed");
      }
    },
    async resourcesChanged() {
      if (options.resourcesListChanged) {
        sink?.send("notifications/resources/list_changed");
      }
    },
    async promptsChanged() {
      if (options.promptsListChanged) {
        sink?.send("notifications/prompts/list_changed");
      }
    },
    async resourceUpdated(uri) {
      if (options.isResourceSubscribed(uri)) {
        sink?.send("notifications/resources/updated", { uri });
      }
    },
  };
}

/** Narrows the full tool context into the resource context shape. */
function toResourceContext(ctx: ToolContext): ResourceContext {
  return {
    auth: ctx.auth,
    request: ctx.request,
    services: ctx.services,
    log: ctx.log,
    storage: ctx.storage,
    notify: ctx.notify,
    env: ctx.env,
  };
}

/** Narrows the full tool context into the prompt context shape. */
function toPromptContext(ctx: ToolContext): PromptContext {
  return {
    auth: ctx.auth,
    request: ctx.request,
    services: ctx.services,
    log: ctx.log,
    storage: ctx.storage,
    notify: ctx.notify,
    env: ctx.env,
  };
}

/** Reads a pagination cursor from request params. */
function readCursorParam(request: JsonRpcRequest): string | undefined {
  const params = request.params as { cursor?: unknown } | undefined;
  if (params?.cursor === undefined) {
    return undefined;
  }
  if (typeof params.cursor !== "string" || !params.cursor) {
    throw new JsonRpcError(-32602, "Pagination cursor must be a non-empty string.");
  }
  return params.cursor;
}

/** Reads a required resource URI from request params. */
function readUriParam(request: JsonRpcRequest, method: string): string {
  const params = request.params as { uri?: unknown } | undefined;
  const uri = typeof params?.uri === "string" ? params.uri : undefined;
  if (!uri) {
    throw new JsonRpcError(-32602, `${method} requires params.uri.`);
  }
  return uri;
}

/** Reads an MCP progress token from request params metadata. */
function readProgressToken(request: JsonRpcRequest): ProgressToken | undefined {
  const params = request.params;
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const meta = (params as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const progressToken = (meta as { progressToken?: unknown }).progressToken;
  if (typeof progressToken === "string") {
    return progressToken;
  }
  if (typeof progressToken === "number" && Number.isInteger(progressToken)) {
    return progressToken;
  }
  return undefined;
}

/** Returns true when a request is asking for out-of-band request progress. */
function hasProgressToken(request: JsonRpcRequest): boolean {
  return readProgressToken(request) !== undefined;
}

/** Selects a global or operation-specific pagination override. */
function selectPaginationOverride<Item>(
  override: PaginationConfig["override"] | undefined,
  operation: McpListOperation,
): PaginationOverride<Item> | undefined {
  if (!override) {
    return undefined;
  }
  if (typeof override === "function") {
    return override as PaginationOverride<Item>;
  }

  const key = operationToPaginationKey(operation);
  return (override[key] ?? override.default) as PaginationOverride<Item> | undefined;
}

/** Maps MCP method names to typed config keys. */
function operationToPaginationKey(
  operation: McpListOperation,
): "toolsList" | "resourcesList" | "resourceTemplatesList" | "promptsList" {
  switch (operation) {
    case "tools/list":
      return "toolsList";
    case "resources/list":
      return "resourcesList";
    case "resources/templates/list":
      return "resourceTemplatesList";
    case "prompts/list":
      return "promptsList";
  }
}

/** Default opaque-cursor pagination over an in-memory list. */
function defaultPagination<Item>(
  items: readonly Item[],
  cursor: string | undefined,
  pageSize: number,
): PaginationResult<Item> {
  const offset = cursor ? decodeCursor(cursor) : 0;
  const page = items.slice(offset, offset + pageSize);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : undefined,
  };
}

/** Encodes a list offset as an opaque base64url cursor. */
function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

/** Decodes and validates Sidecar's default opaque cursor. */
function decodeCursor(cursor: string): number {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      offset?: unknown;
    };
    const offset = decoded.offset;
    if (!Number.isInteger(offset) || typeof offset !== "number" || offset < 0) {
      throw new Error("invalid offset");
    }
    return offset;
  } catch {
    throw new JsonRpcError(-32602, "Invalid pagination cursor.");
  }
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

  const supported = new Set([SIDECAR_MCP_PROTOCOL_VERSION]);
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

/** Enforces Streamable HTTP GET content negotiation before opening SSE. */
function validateGetHeaders(request: IncomingMessage): void {
  const accept = request.headers.accept;
  const acceptValue = Array.isArray(accept) ? accept.join(",") : accept;
  if (!acceptValue || !acceptValue.toLowerCase().includes("text/event-stream")) {
    throw new JsonRpcHttpError(
      406,
      -32600,
      "GET Accept must include text/event-stream.",
    );
  }
}

/** Adds a timeout and abort signal to tool execution. */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  controller: AbortController,
): Promise<T> {
  let abortListener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    abortListener = () => {
      reject(abortReason(controller.signal.reason));
    };
    if (controller.signal.aborted) {
      abortListener();
      return;
    }
    controller.signal.addEventListener("abort", abortListener, { once: true });
  });

  if (!timeoutMs || timeoutMs <= 0) {
    try {
      return await Promise.race([promise, abortPromise]);
    } finally {
      if (abortListener) {
        controller.signal.removeEventListener("abort", abortListener);
      }
    }
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      abortPromise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error = new JsonRpcError(-32000, "Tool execution timed out.");
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (abortListener) {
      controller.signal.removeEventListener("abort", abortListener);
    }
  }
}

/** Converts an AbortSignal reason into the error Sidecar should surface. */
function abortReason(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new RequestCancelledError();
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
    const allowed = new Set(Object.keys(schema.properties ?? {}));
    if (schema.additionalProperties === false) {
      const extra = Object.keys(record).find((key) => !allowed.has(key));
      if (extra) {
        return `${path}.${extra} is not allowed.`;
      }
    } else if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      for (const [key, entry] of Object.entries(record)) {
        if (!allowed.has(key)) {
          const failure = schemaFailure(schema.additionalProperties, entry, `${path}.${key}`);
          if (failure) return failure;
        }
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

/** Drops undefined values from JSON-like objects before returning protocol payloads. */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
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
  if (record.jsonrpc !== JSONRPC_VERSION || typeof record.method !== "string") {
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
    jsonrpc: JSONRPC_VERSION,
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
  if (record.jsonrpc !== JSONRPC_VERSION || !("id" in record) || !("result" in record || "error" in record)) {
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
  if (error instanceof SidecarRuntimeError && error.code === "invalid_pagination_cursor") {
    return {
      code: -32602,
      message: error.message,
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
