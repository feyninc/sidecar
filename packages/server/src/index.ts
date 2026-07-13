/**
 * Minimal MCP JSON-RPC runtime for Sidecar tools and widget resources.
 *
 * The server package is deliberately small: it maps MCP methods to loaded
 * Sidecar tools, applies optional auth/proxy layers, and serves generated UI
 * resources during development or simple deployments.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { runProxy, type SidecarProxy } from "./proxy.js";
import { createSseHub, createSseStream, type McpNotificationSink } from "./sse.js";
import type { SidecarAuth } from "@sidecar-ai/auth";
import {
  JSONRPC_VERSION,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestId } from "@modelcontextprotocol/sdk/types.js";
import {
  createToolDescriptor,
  executePrompt,
  executeResource,
  executeTool,
  SidecarRuntimeError,
  toolResult,
  type CodeModeRenderStrategy,
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
  type RemoteExecutionDefinition,
  type RemoteExecutionResult,
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
export const SIDECAR_MCP_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

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

/** Runtime code-mode options passed by compiler-generated server output. */
export type SidecarCodeModeRuntimeOptions = {
  enabled?: boolean;
  unsafe?: boolean;
  /**
   * Optional shared secret for stateless remote callback tokens.
   *
   * Set this from an environment variable on multi-instance/serverless hosts.
   * Without it, Sidecar uses process-local tokens intended for local dev and
   * single-process Node servers.
   */
  callbackSecret?: string;
  render?: {
    enabled?: boolean;
    strategy?: CodeModeRenderStrategy;
  };
  widgetMeta?: Record<string, unknown>;
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
  codeMode?: SidecarCodeModeRuntimeOptions;
  remoteExecution?: RemoteExecutionDefinition;
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

const CODE_MODE_SEARCH_TOOL = "search_tools";
const CODE_MODE_SCHEMA_TOOL = "get_tool_schema";
const CODE_MODE_EXECUTE_TOOL = "execute_code";
const CODE_MODE_RESULT_PREFIX = "__SIDECAR_CODE_MODE_RESULT__";
const CODE_MODE_CALLBACK_PATH = "/__sidecar/code-mode/tool";
const CODE_MODE_CALLBACK_TOKEN_TTL_MS = 5 * 60 * 1000;

type CodeRunSession = {
  authSession: unknown;
  requestId: RequestId | string;
};

type CodeModeCallbackTokenPayload = {
  version: 1;
  expiresAt: number;
  authSession: unknown;
  requestId: RequestId | string;
};

type CodeModeToolCall = {
  tool: string;
  ok: boolean;
  result: McpToolResult;
};

type CodeModeRunnerResult =
  | {
      ok: true;
      value: unknown;
      calls: CodeModeToolCall[];
      explicitRender?: { tool?: string; value?: unknown };
    }
  | {
      ok: false;
      error: string;
      calls: CodeModeToolCall[];
    };

/** JSON-RPC MCP dispatcher for Sidecar tools and resources. */
export class SidecarMcpServer {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly resources = new Map<string, RegisteredResource>();
  private readonly prompts = new Map<string, RegisteredPrompt>();
  private readonly resourceTemplates: LoadedResourceTemplate[];
  private readonly activeRequests = new Map<RequestId, AbortController>();
  private readonly subscribedResourceUris = new Set<string>();
  private readonly codeRuns = new Map<string, CodeRunSession>();

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
    if (this.isCodeModeEnabled()) {
      return codeModeDescriptors(this.options.codeMode?.widgetMeta);
    }
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
          protocolVersion: negotiateProtocolVersion(request),
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
    return configured && configured > 0 ? Math.floor(configured) : 50;
  }

  /** Executes a tool after request-level and tool-level auth checks. */
  private async callTool(
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<McpToolResult> {
    if (this.isCodeModeEnabled()) {
      return this.callCodeModeTool(request, context);
    }

    const params = request.params as { name?: unknown; arguments?: unknown } | undefined;
    const name = typeof params?.name === "string" ? params.name : undefined;
    if (!name) {
      throw new JsonRpcError(-32602, "tools/call requires params.name.");
    }

    const loaded = this.tools.get(name);
    if (!loaded) {
      throw new JsonRpcError(-32602, `Unknown tool "${name}".`);
    }

    return this.executeRegisteredTool(name, loaded, params?.arguments ?? {}, request, context);
  }

  /** Executes a registered tool through the normal Sidecar validation/auth path. */
  private async executeRegisteredTool(
    name: string,
    loaded: RegisteredTool,
    argsValue: unknown,
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<McpToolResult> {
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
            argsValue ?? {},
            `Invalid parameters for tool "${name}".`,
          )
        : argsValue ?? {};
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

  /** Returns true when this runtime should expose the code-mode meta-tool catalog. */
  private isCodeModeEnabled(): boolean {
    return Boolean(this.options.codeMode?.enabled);
  }

  /** Dispatches code-mode meta-tools instead of public authored tools. */
  private async callCodeModeTool(
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<McpToolResult> {
    const params = request.params as { name?: unknown; arguments?: unknown } | undefined;
    const name = typeof params?.name === "string" ? params.name : undefined;
    if (!name) {
      throw new JsonRpcError(-32602, "tools/call requires params.name.");
    }

    switch (name) {
      case CODE_MODE_SEARCH_TOOL:
        return this.searchCodeModeTools(params?.arguments);
      case CODE_MODE_SCHEMA_TOOL:
        return this.describeCodeModeTools(params?.arguments);
      case CODE_MODE_EXECUTE_TOOL:
        return this.executeCodeMode(params?.arguments, request, context);
      default:
        throw new JsonRpcError(-32602, `Unknown tool "${name}".`);
    }
  }

  /** Searches the internal authored tool catalog exposed to generated code. */
  private searchCodeModeTools(args: unknown): McpToolResult {
    const query = typeof (args as { query?: unknown } | undefined)?.query === "string"
      ? String((args as { query: string }).query).toLowerCase()
      : "";
    const matches = [...this.tools.values()]
      .map((entry) => codeModeToolSummary(entry.descriptor))
      .filter((entry) => {
        if (!query) return true;
        return `${entry.id} ${entry.name} ${entry.description}`.toLowerCase().includes(query);
      });

    return toolResult({
      structuredContent: { tools: matches },
      content: matches.length
        ? matches.map((entry) => `- ${entry.id}: ${entry.description}`).join("\n")
        : "No internal Sidecar tools matched that query.",
    });
  }

  /** Returns JSON Schema and generated TypeScript call signatures for internal tools. */
  private describeCodeModeTools(args: unknown): McpToolResult {
    const requested = readStringArray((args as { tools?: unknown } | undefined)?.tools);
    const entries = [...this.tools.values()]
      .filter((entry) => !requested.length || requested.includes(entry.descriptor.name))
      .map((entry) => ({
        ...codeModeToolSummary(entry.descriptor),
        inputSchema: entry.descriptor.inputSchema,
        outputSchema: entry.descriptor.outputSchema,
        typescript: codeModeToolSignature(entry.descriptor),
      }));

    return toolResult({
      structuredContent: { tools: entries },
      content: entries.length
        ? entries.map((entry) => entry.typescript).join("\n\n")
        : "No internal Sidecar tools matched that request.",
    });
  }

  /** Executes generated code through the configured remote executor or unsafe local mode. */
  private async executeCodeMode(
    args: unknown,
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<McpToolResult> {
    const code = typeof (args as { code?: unknown } | undefined)?.code === "string"
      ? (args as { code: string }).code
      : undefined;
    if (!code?.trim()) {
      throw new JsonRpcError(-32602, "execute_code requires a non-empty code string.");
    }

    const authSession = context.authSession ?? await this.authorizeEndpoint(context);
    const runId = randomUUID();
    const callbackToken = this.createCodeModeCallbackToken({
      authSession,
      requestId: request.id ?? runId,
    });

    try {
      const execution = this.options.codeMode?.unsafe
        ? await this.executeUnsafeCodeMode(code, request, { ...context, authSession })
        : await this.executeRemoteCodeMode(code, runId, callbackToken.token, context);
      return this.codeModeExecutionResult(execution);
    } finally {
      if (callbackToken.processLocal) {
        this.codeRuns.delete(callbackToken.token);
      }
    }
  }

  /** Creates an opaque callback token for generated remote runners. */
  private createCodeModeCallbackToken(
    session: CodeRunSession,
  ): { token: string; processLocal: boolean } {
    const secret = this.options.codeMode?.callbackSecret ?? process.env.SIDECAR_CODE_MODE_SECRET;
    if (secret) {
      return {
        token: sealCodeModeCallbackToken(
          {
            version: 1,
            expiresAt: Date.now() + CODE_MODE_CALLBACK_TOKEN_TTL_MS,
            authSession: session.authSession,
            requestId: session.requestId,
          },
          secret,
        ),
        processLocal: false,
      };
    }

    const token = randomUUID();
    this.codeRuns.set(token, session);
    return { token, processLocal: true };
  }

  /** Runs generated code directly in-process for trusted/local deployments. */
  private async executeUnsafeCodeMode(
    code: string,
    request: JsonRpcRequest,
    context: SidecarHandleContext,
  ): Promise<CodeModeRunnerResult> {
    const calls: CodeModeToolCall[] = [];
    const toolMarkers = new WeakMap<object, { tool: string; result: McpToolResult }>();
    const tools = Object.fromEntries([...this.tools.values()].map((entry) => [
      codeModeMethodName(entry.descriptor.name),
      async (args: Record<string, unknown> = {}) => {
        const result = await this.executeRegisteredTool(
          entry.descriptor.name,
          entry,
          args,
          { ...request, id: `${String(request.id ?? "code")}:${entry.descriptor.name}` },
          context,
        );
        calls.push({ tool: entry.descriptor.name, ok: !result.isError, result });
        const value = result.structuredContent ?? result;
        if (value && typeof value === "object") {
          toolMarkers.set(value, { tool: entry.descriptor.name, result });
        }
        return value;
      },
    ]));
    const sidecar = {
      render(value: unknown, options: { tool?: string } = {}) {
        const inferredTool = value && typeof value === "object"
          ? toolMarkers.get(value)?.tool
          : undefined;
        return {
          __sidecarRender: true,
          tool: options.tool ?? inferredTool,
          value,
        };
      },
    };
    const module = await import(`data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`);
    if (typeof module.default !== "function") {
      throw new JsonRpcError(-32602, "execute_code code must default-export a function.");
    }
    const value = await module.default({ tools, sidecar });
    return { ok: true, value: stripCodeModeMarkers(value), calls, explicitRender: readExplicitRender(value) };
  }

  /** Passes generated code to the project-owned `remote.ts` executor. */
  private async executeRemoteCodeMode(
    code: string,
    runId: string,
    callbackToken: string,
    context: SidecarHandleContext,
  ): Promise<CodeModeRunnerResult> {
    if (!this.options.remoteExecution) {
      throw new JsonRpcError(
        -32000,
        "Code mode remote execution is enabled, but no remote.ts executor was loaded.",
      );
    }

    const callbackUrl = codeModeCallbackUrl(context.request);
    const run = {
      id: runId,
      files: [
        {
          path: "sidecar-runner.mjs",
          text: renderCodeModeRunner(code, [...this.tools.values()].map((entry) => entry.descriptor)),
        },
      ],
      command: ["node", "sidecar-runner.mjs"],
      env: {
        SIDECAR_CODE_RUN_ID: runId,
        SIDECAR_CALLBACK_URL: callbackUrl,
        SIDECAR_CALLBACK_TOKEN: callbackToken,
      },
      timeoutMs: this.options.toolTimeoutMs ?? 30_000,
    };
    const remoteResult = await this.options.remoteExecution.execute(run, { log: consoleLogger });
    return parseRemoteCodeModeResult(remoteResult);
  }

  /** Converts a runner result into the public MCP tool result for `execute_code`. */
  private codeModeExecutionResult(execution: CodeModeRunnerResult): McpToolResult {
    if (!execution.ok) {
      return toolResult.error(execution.error ?? "Code mode execution failed.", {
        structuredContent: {
          codeMode: {
            ok: false,
            calls: execution.calls,
          },
        },
      });
    }

    const render = selectCodeModeRender(
      execution,
      [...this.tools.values()].map((entry) => entry.descriptor),
      this.options.codeMode?.render,
    );
    const selectedResult = render?.result;
    return toolResult({
      structuredContent: {
        codeMode: stripUndefined({
          ok: true,
          value: execution.value,
          renderer: render?.tool,
          result: selectedResult?.structuredContent,
          content: selectedResult?.content,
          meta: selectedResult?._meta,
          calls: execution.calls.map((call) => ({
            tool: call.tool,
            ok: call.ok,
          })),
        }),
      },
      content: selectedResult?.content?.length
        ? selectedResult.content
        : JSON.stringify(execution.value ?? {}, null, 2),
      meta: {
        sidecar: stripUndefined({
          codeMode: stripUndefined({
            renderer: render?.tool,
          }),
        }),
      },
    });
  }

  /** Handles tool calls from generated remote code. */
  async handleCodeModeToolCallback(input: unknown): Promise<McpToolResult> {
    const body = input as { token?: unknown; tool?: unknown; arguments?: unknown } | undefined;
    const token = typeof body?.token === "string" ? body.token : undefined;
    const toolName = typeof body?.tool === "string" ? body.tool : undefined;
    if (!token || !toolName) {
      throw new JsonRpcHttpError(400, -32602, "Code-mode callback requires token and tool.");
    }

    const session = this.codeRuns.get(token);
    const sealedSession = session ?? this.readSealedCodeModeCallbackToken(token);
    if (!sealedSession) {
      throw new JsonRpcHttpError(401, -32001, "Invalid or expired code-mode callback token.");
    }

    const loaded = this.tools.get(toolName);
    if (!loaded) {
      throw new JsonRpcHttpError(404, -32602, `Unknown internal tool "${toolName}".`);
    }

    return this.executeRegisteredTool(
      toolName,
      loaded,
      body?.arguments ?? {},
      {
        jsonrpc: JSONRPC_VERSION,
        id: `${String(sealedSession.requestId)}:${toolName}`,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: body?.arguments ?? {},
        },
      },
      { authSession: sealedSession.authSession },
    );
  }

  /** Reads a stateless encrypted callback token when process-local lookup misses. */
  private readSealedCodeModeCallbackToken(token: string): CodeRunSession | undefined {
    const secret = this.options.codeMode?.callbackSecret ?? process.env.SIDECAR_CODE_MODE_SECRET;
    if (!secret) {
      return undefined;
    }

    const payload = openCodeModeCallbackToken(token, secret);
    if (!payload || payload.version !== 1 || payload.expiresAt < Date.now()) {
      return undefined;
    }
    return {
      authSession: payload.authSession,
      requestId: payload.requestId,
    };
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
      _meta: resource._meta,
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

    if (pathname === CODE_MODE_CALLBACK_PATH) {
      if (request.method !== "POST") {
        response.writeHead(405, {
          "allow": "POST",
          "content-type": "application/json",
        });
        response.end(JSON.stringify({ error: "method_not_allowed" }));
        return;
      }

      try {
        const body = await readJson(request, maxBodyBytes);
        const result = await mcp.handleCodeModeToolCallback(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
      } catch (error) {
        const status = error instanceof JsonRpcHttpError ? error.status : 400;
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: normalizeHttpError(error) }));
      }
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

  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    throw new JsonRpcHttpError(
      400,
      -32600,
      `Unsupported MCP-Protocol-Version "${version}".`,
    );
  }
}

/** Matches the official SDK lifecycle negotiation for initialize requests. */
function negotiateProtocolVersion(request: JsonRpcRequest): string {
  const params = request.params;
  const requested = params && typeof params === "object" && !Array.isArray(params)
    ? (params as { protocolVersion?: unknown }).protocolVersion
    : undefined;
  return typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : SIDECAR_MCP_PROTOCOL_VERSION;
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
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return `${path} must contain at least ${schema.minItems} items.`;
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return `${path} must contain at most ${schema.maxItems} items.`;
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
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern).test(value))) {
      return `${path} must match pattern ${schema.pattern}.`;
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

/** Builds the three public tools exposed when code mode is enabled. */
function codeModeDescriptors(widgetMeta: Record<string, unknown> | undefined): McpToolDescriptor[] {
  return [
    createToolDescriptor({
      name: "Search Tools",
      id: CODE_MODE_SEARCH_TOOL,
      description: "Search the internal Sidecar tool catalog available to code mode. Use this before writing code when you need to identify the right internal tool.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Plain-language search query for tool names and descriptions.",
          },
        },
        required: [],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    }),
    createToolDescriptor({
      name: "Get Tool Schema",
      id: CODE_MODE_SCHEMA_TOOL,
      description: "Return JSON Schemas and TypeScript call signatures for internal Sidecar tools selected for generated code.",
      inputSchema: {
        type: "object",
        properties: {
          tools: {
            type: "array",
            description: "Optional internal tool ids. Omit to describe every available internal tool.",
            items: { type: "string" },
          },
        },
        required: [],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    }),
    {
      ...createToolDescriptor({
        name: "Execute Code",
        id: CODE_MODE_EXECUTE_TOOL,
        description: [
          "Execute generated JavaScript code against the typed internal Sidecar tool API.",
          "The code must default-export an async or sync function that receives { tools, sidecar }.",
          "Use search_tools and get_tool_schema first when you need tool signatures.",
        ].join(" "),
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "JavaScript module source. It must default-export a function: export default async function({ tools, sidecar }) { ... }",
            },
          },
          required: ["code"],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
      }),
      _meta: widgetMeta,
    },
  ];
}

/** Compact internal tool summary returned by code-mode search. */
function codeModeToolSummary(descriptor: McpToolDescriptor): {
  id: string;
  name: string;
  method: string;
  description: string;
  annotations?: unknown;
} {
  return {
    id: descriptor.name,
    name: descriptor.title ?? descriptor.name,
    method: codeModeMethodName(descriptor.name),
    description: descriptor.description,
    annotations: descriptor.annotations,
  };
}

/** Emits a readable TypeScript signature for one internal tool binding. */
function codeModeToolSignature(descriptor: McpToolDescriptor): string {
  return [
    `/** ${descriptor.description.replace(/\*\//g, "* /")} */`,
    `tools.${codeModeMethodName(descriptor.name)}(input: ${JSON.stringify(descriptor.inputSchema, null, 2)}): Promise<unknown>;`,
  ].join("\n");
}

/** Creates a stable JS method name for an internal tool id. */
function codeModeMethodName(toolId: string): string {
  const parts = toolId
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean);
  const method = parts
    .map((part, index) => index === 0
      ? `${part.charAt(0).toLowerCase()}${part.slice(1)}`
      : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return /^[a-zA-Z_$]/.test(method) ? method : "tool";
}

/** Reads a string array from JSON-like input. */
function readStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : [];
}

/** Encrypts callback authorization state for remote executors on multi-instance hosts. */
function sealCodeModeCallbackToken(
  payload: CodeModeCallbackTokenPayload,
  secret: string,
): string {
  const iv = randomBytes(12);
  const key = codeModeSecretKey(secret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(payload);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    base64UrlEncode(iv),
    base64UrlEncode(tag),
    base64UrlEncode(ciphertext),
  ].join(".");
}

/** Opens a stateless callback token produced by `sealCodeModeCallbackToken`. */
function openCodeModeCallbackToken(
  token: string,
  secret: string,
): CodeModeCallbackTokenPayload | undefined {
  const [version, ivText, tagText, ciphertextText] = token.split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText) {
    return undefined;
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      codeModeSecretKey(secret),
      base64UrlDecode(ivText),
    );
    decipher.setAuthTag(base64UrlDecode(tagText));
    const plaintext = Buffer.concat([
      decipher.update(base64UrlDecode(ciphertextText)),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as CodeModeCallbackTokenPayload;
  } catch {
    return undefined;
  }
}

/** Normalizes arbitrary secret text into the key size required by AES-256-GCM. */
function codeModeSecretKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/** Encodes bytes as URL-safe base64 without padding. */
function base64UrlEncode(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/** Decodes URL-safe base64 bytes. */
function base64UrlDecode(text: string): Buffer {
  return Buffer.from(text, "base64url");
}

/** Resolves the callback URL sent to remote executors. */
function codeModeCallbackUrl(request: Request | undefined): string {
  if (request) {
    return new URL(CODE_MODE_CALLBACK_PATH, request.url).href;
  }
  return CODE_MODE_CALLBACK_PATH;
}

/** Generates the portable Node runner executed by project-owned remote executors. */
function renderCodeModeRunner(code: string, descriptors: McpToolDescriptor[]): string {
  const methodMap = Object.fromEntries(
    descriptors.map((descriptor) => [codeModeMethodName(descriptor.name), descriptor.name]),
  );
  return `const CODE_MODE_RESULT_PREFIX = ${JSON.stringify(CODE_MODE_RESULT_PREFIX)};
const callbackUrl = process.env.SIDECAR_CALLBACK_URL;
const callbackToken = process.env.SIDECAR_CALLBACK_TOKEN;
if (!callbackUrl || !callbackToken) {
  throw new Error("Sidecar code-mode runner is missing callback configuration.");
}
const toolMethods = ${JSON.stringify(methodMap, null, 2)};
const calls = [];
const toolMarkers = new WeakMap();

async function callTool(tool, args = {}) {
  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: callbackToken, tool, arguments: args }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.error?.message ?? result?.error ?? "Sidecar internal tool call failed.");
  }
  calls.push({ tool, ok: !result.isError, result });
  const value = result.structuredContent ?? result;
  if (value && typeof value === "object") {
    toolMarkers.set(value, { tool, result });
  }
  return value;
}

const tools = Object.fromEntries(Object.entries(toolMethods).map(([method, tool]) => [
  method,
  (args) => callTool(tool, args),
]));

const sidecar = {
  render(value, options = {}) {
    return { __sidecarRender: true, tool: options.tool ?? toolMarkers.get(value)?.tool, value };
  },
};

function stripMarkers(value) {
  if (value && typeof value === "object" && value.__sidecarRender) {
    return stripMarkers(value.value);
  }
  return value;
}

try {
  const module = await import("data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}");
  if (typeof module.default !== "function") {
    throw new Error("execute_code code must default-export a function.");
  }
  const value = await module.default({ tools, sidecar });
  const explicitRender = value && typeof value === "object" && value.__sidecarRender
    ? { tool: value.tool, value: stripMarkers(value.value) }
    : undefined;
  console.log(CODE_MODE_RESULT_PREFIX + JSON.stringify({
    ok: true,
    value: stripMarkers(value),
    calls,
    explicitRender,
  }));
} catch (error) {
  console.log(CODE_MODE_RESULT_PREFIX + JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    calls,
  }));
  process.exitCode = 1;
}
`;
}

/** Parses the remote runner's marked JSON result from stdout. */
function parseRemoteCodeModeResult(result: RemoteExecutionResult): CodeModeRunnerResult {
  const line = result.stdout
    .split(/\r?\n/)
    .reverse()
    .find((entry) => entry.startsWith(CODE_MODE_RESULT_PREFIX));
  if (!line) {
    return {
      ok: false,
      error: result.stderr || `Remote executor exited with code ${result.exitCode} without returning a Sidecar result.`,
      calls: [],
    };
  }

  try {
    return JSON.parse(line.slice(CODE_MODE_RESULT_PREFIX.length)) as CodeModeRunnerResult;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid code-mode runner result.",
      calls: [],
    };
  }
}

/** Removes explicit-render marker objects from unsafe in-process results. */
function stripCodeModeMarkers(value: unknown): unknown {
  if (value && typeof value === "object" && (value as { __sidecarRender?: unknown }).__sidecarRender) {
    return stripCodeModeMarkers((value as { value?: unknown }).value);
  }
  return value;
}

/** Reads an unsafe in-process explicit render marker. */
function readExplicitRender(value: unknown): { tool?: string; value?: unknown } | undefined {
  if (!value || typeof value !== "object" || !(value as { __sidecarRender?: unknown }).__sidecarRender) {
    return undefined;
  }
  const marker = value as { tool?: unknown; value?: unknown };
  return {
    tool: typeof marker.tool === "string" ? marker.tool : undefined,
    value: stripCodeModeMarkers(marker.value),
  };
}

/** Chooses the internal tool result that the dynamic code-mode widget should render. */
function selectCodeModeRender(
  execution: CodeModeRunnerResult,
  descriptors: McpToolDescriptor[],
  config: SidecarCodeModeRuntimeOptions["render"],
): CodeModeToolCall | undefined {
  if (!execution.ok || config?.enabled === false) {
    return undefined;
  }

  const renderable = new Set(
    descriptors
      .filter((descriptor) => Boolean(descriptor._meta?.["ui/resourceUri"]))
      .map((descriptor) => descriptor.name),
  );
  if (!renderable.size) {
    return undefined;
  }

  const strategy = config?.strategy ?? "last-renderable";
  if (strategy === "explicit") {
    const tool = execution.explicitRender?.tool;
    return tool && renderable.has(tool)
      ? execution.calls.find((call) => call.tool === tool)
      : undefined;
  }

  const calls = execution.calls.filter((call) => renderable.has(call.tool));
  return strategy === "first-renderable" ? calls[0] : calls.at(-1);
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
