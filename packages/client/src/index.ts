/**
 * Framework-agnostic widget bridge.
 *
 * Sidecar's public API stays small and typed, and the browser transport is the
 * official MCP Apps iframe bridge. Platform-specific globals live in their
 * platform packages, not in this generic client.
 */
import {
  App,
  PostMessageTransport,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps/app-with-deps";

/** Standard result shape for host-only capabilities that may not exist everywhere. */
export type HostFeatureResult<T = void> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "unsupported" | "denied" | "cancelled" | "failed";
      message?: string;
    };

/** Host families Sidecar can theme and feature-detect at runtime. */
export type SidecarHostName = "chatgpt" | "claude" | "generic";

/** Display theme reported by the host or inferred from browser settings. */
export type SidecarTheme = "light" | "dark";

/** Display modes defined by the MCP Apps extension. */
export type SidecarDisplayMode = "inline" | "fullscreen" | "pip";

/** Runtime host information used by React/native packages. */
export type SidecarHostContext = {
  /** Host family currently embedding the widget. */
  name: SidecarHostName;
  /** Light/dark theme for host-aligned native components. */
  theme: SidecarTheme;
  /** Whether the context came from the MCP Apps bridge, a host fallback, or browser inference. */
  source: "mcp-apps" | "claude-css" | "media-query" | "fallback";
  /** Raw MCP Apps host context when supplied by the host. */
  raw?: unknown;
};

/** Listener called when the embedding host changes theme or capability context. */
export type HostContextListener = (context: SidecarHostContext) => void;

/** Minimal MCP content block shape used by client-side bridge calls. */
export type ClientContentBlock = {
  type: string;
  [key: string]: unknown;
};

/** Tool result data made available to a rendered widget. */
export type WidgetToolResult<
  Structured = unknown,
  Meta = Record<string, unknown>,
> = {
  /** Structured data sent through the standard MCP `structuredContent` field. */
  structuredContent: Structured | undefined;
  /** Backward-compatible alias for early Sidecar examples. Prefer `structuredContent`. */
  structured: Structured | undefined;
  /** Model-visible MCP content blocks. */
  content: unknown[];
  /** Host/widget-only metadata from MCP `_meta`. */
  meta: Meta;
  /** Standard MCP metadata field. */
  _meta?: Meta;
  /** Whether the tool result represents a tool execution error. */
  isError?: boolean;
};

/** Message a widget wants to send back into the model conversation. */
export type ModelMessage = {
  /** Convenience text. Sidecar normalizes this to one MCP text content block. */
  text?: string;
  /** Exact MCP content blocks for richer messages. Takes precedence over `text`. */
  content?: ClientContentBlock[];
};

/** Resource descriptor returned by standard MCP `resources/list`. */
export type ServerResource = {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Resource content returned by standard MCP `resources/read`. */
export type ServerResourceContent = {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Result of standard MCP `resources/list` proxied through the Apps host. */
export type ServerResourceListResult = {
  resources: ServerResource[];
  nextCursor?: string;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Result of standard MCP `resources/read` proxied through the Apps host. */
export type ServerResourceReadResult = {
  contents: ServerResourceContent[];
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Standard MCP sampling request params passed through the Apps host. */
export type SamplingMessageRequest = Record<string, unknown>;

/** Standard MCP sampling result returned by the Apps host. */
export type SamplingMessageResult = Record<string, unknown>;

/** Standard MCP log message levels. */
export type HostLogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

/** Standard MCP log notification payload sent through the Apps host. */
export type HostLogMessage = {
  level: HostLogLevel;
  data: unknown;
  logger?: string;
};

/** Standard MCP Apps size-change notification payload. */
export type SizeChangedMessage = {
  width: number;
  height: number;
};

/** Complete or partial tool input sent by the host before a tool result arrives. */
export type ToolInput = {
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Host bridge capabilities available to widget code. */
export type WidgetBridge = {
  callServerTool<
    TParams extends Record<string, unknown> = Record<string, unknown>,
    Structured = unknown,
    Meta = Record<string, unknown>,
  >(params: {
    name: string;
    arguments?: TParams;
  }): Promise<WidgetToolResult<Structured, Meta>>;
  callTool<TParams extends Record<string, unknown>, TResult>(
    name: string,
    params: TParams,
  ): Promise<TResult>;
  readServerResource(params: { uri: string }): Promise<HostFeatureResult<ServerResourceReadResult>>;
  listServerResources(params?: { cursor?: string }): Promise<HostFeatureResult<ServerResourceListResult>>;
  createSamplingMessage(params: SamplingMessageRequest): Promise<HostFeatureResult<SamplingMessageResult>>;
  sendMessage(message: ModelMessage): Promise<HostFeatureResult>;
  updateModelContext(
    context: Record<string, unknown>,
  ): Promise<HostFeatureResult>;
  sendLog(message: HostLogMessage): Promise<HostFeatureResult>;
  openLink(url: string): Promise<HostFeatureResult>;
  downloadFile(contents: ClientContentBlock[]): Promise<HostFeatureResult>;
  requestTeardown(params?: Record<string, never>): Promise<HostFeatureResult>;
  requestDisplayMode(mode: SidecarDisplayMode): Promise<HostFeatureResult<SidecarDisplayMode>>;
  sendSizeChanged(size: SizeChangedMessage): Promise<HostFeatureResult>;
  getToolResult<Structured, Meta = Record<string, unknown>>(): WidgetToolResult<
    Structured,
    Meta
  >;
  subscribeToolInput(listener: ToolInputListener): () => void;
  subscribeToolInputPartial(listener: ToolInputListener): () => void;
  subscribeToolResult(listener: ToolResultListener): () => void;
  subscribeToolCancelled(listener: ToolCancelledListener): () => void;
  getHostContext(): SidecarHostContext;
  getHostCapabilities(): Record<string, unknown> | undefined;
  subscribeHostContext(listener: HostContextListener): () => void;
};

/** Minimal preview host injected by `sidecar preview` before widget code runs. */
type SidecarPreviewHost = {
  hostContext: SidecarHostContext;
  hostCapabilities?: Record<string, unknown>;
  toolInput?: ToolInput;
  toolResult?: McpAppsToolResult;
};

declare global {
  interface Window {
    __sidecarPreview?: SidecarPreviewHost;
  }
}

/** Listener called when the host sends standard MCP Apps tool input. */
export type ToolInputListener = (input: ToolInput) => void;

/** Listener called when the host sends a standard MCP Apps tool-result notification. */
export type ToolResultListener = (result: WidgetToolResult) => void;

/** Listener called when the host cancels the active tool execution. */
export type ToolCancelledListener = (params: { reason?: string }) => void;

/** Structural constraint for generated typed tool clients. */
export type ToolClientShape = object;

/** Creates a browser bridge that speaks MCP Apps first and ChatGPT globals second. */
export function createBrowserBridge(): WidgetBridge {
  if (typeof window !== "undefined" && window.__sidecarPreview) {
    return createPreviewBridge(window.__sidecarPreview);
  }

  const state = createMcpAppsState();

  return {
    async callServerTool(params) {
      return callServerTool(state, params) as never;
    },

    async callTool(name, params) {
      const result = await callServerTool(state, { name, arguments: params });
      return result.structuredContent as never;
    },

    async readServerResource(params) {
      const app = await readyMcpApp(state);
      if (app?.getHostCapabilities()?.serverResources) {
        return { ok: true, value: await app.readServerResource(params) };
      }

      return { ok: false, reason: "unsupported" };
    },

    async listServerResources(params) {
      const app = await readyMcpApp(state);
      if (app?.getHostCapabilities()?.serverResources) {
        return { ok: true, value: await app.listServerResources(params) };
      }

      return { ok: false, reason: "unsupported" };
    },

    async createSamplingMessage(params) {
      const app = await readyMcpApp(state);
      if (app?.getHostCapabilities()?.sampling) {
        return { ok: true, value: await app.createSamplingMessage(params) };
      }

      return { ok: false, reason: "unsupported" };
    },

    async sendMessage(message) {
      const app = await readyMcpApp(state);
      if (app?.getHostCapabilities()?.message) {
        const result = await app.sendMessage({
          role: "user",
          content: normalizeMessageContent(message),
        });
        return result.isError ? { ok: false, reason: "denied" } : { ok: true, value: undefined };
      }

      return { ok: false, reason: "unsupported" };
    },

    async sendLog(message) {
      const app = await readyMcpApp(state);
      if (app?.getHostCapabilities()?.logging) {
        await app.sendLog(message);
        return { ok: true, value: undefined };
      }

      return { ok: false, reason: "unsupported" };
    },

    async updateModelContext(context) {
      const app = await readyMcpApp(state);
      if (app?.getHostCapabilities()?.updateModelContext) {
        await app.updateModelContext({ structuredContent: context });
        return { ok: true, value: undefined };
      }

      return { ok: false, reason: "unsupported" };
    },

    async openLink(url) {
      if (!isAllowedExternalUrl(url)) {
        return {
          ok: false,
          reason: "denied",
          message: "Only http, https, and mailto URLs can be opened externally.",
        };
      }

      const app = await readyMcpApp(state);
      if (app?.getHostCapabilities()?.openLinks) {
        const result = await app.openLink({ url });
        return result.isError ? { ok: false, reason: "denied" } : { ok: true, value: undefined };
      }

      return { ok: false, reason: "unsupported" };
    },

    async downloadFile(contents) {
      const app = await readyMcpApp(state);
      if (app?.getHostCapabilities()?.downloadFile) {
        const result = await app.downloadFile({ contents });
        return result.isError ? { ok: false, reason: "denied" } : { ok: true, value: undefined };
      }

      return { ok: false, reason: "unsupported" };
    },

    async requestTeardown(params) {
      const app = await readyMcpApp(state);
      if (app) {
        await app.requestTeardown(params ?? {});
        return { ok: true, value: undefined };
      }

      return { ok: false, reason: "unsupported" };
    },

    async requestDisplayMode(mode) {
      const app = await readyMcpApp(state);
      const available = app?.getHostContext()?.availableDisplayModes;
      if (app && Array.isArray(available) && available.includes(mode)) {
        const result = await app.requestDisplayMode({ mode });
        updateMcpHostContext(state, { ...app.getHostContext(), displayMode: result.mode });
        return { ok: true, value: result.mode };
      }

      return { ok: false, reason: "unsupported" };
    },

    async sendSizeChanged(size) {
      const app = await readyMcpApp(state);
      if (app) {
        await app.sendSizeChanged(size);
        return { ok: true, value: undefined };
      }

      return { ok: false, reason: "unsupported" };
    },

    getToolResult() {
      if (state.toolResult) {
        return state.toolResult as never;
      }

      return normalizeToolResult({
        structuredContent: undefined,
        content: [],
        _meta: {},
      }) as never;
    },

    subscribeToolInput(listener) {
      state.toolInputListeners.add(listener);
      return () => state.toolInputListeners.delete(listener);
    },

    subscribeToolInputPartial(listener) {
      state.toolInputPartialListeners.add(listener);
      return () => state.toolInputPartialListeners.delete(listener);
    },

    subscribeToolResult(listener) {
      state.toolResultListeners.add(listener);
      if (state.toolResult) {
        listener(state.toolResult);
      }
      return () => state.toolResultListeners.delete(listener);
    },

    subscribeToolCancelled(listener) {
      state.toolCancelledListeners.add(listener);
      return () => state.toolCancelledListeners.delete(listener);
    },

    getHostContext() {
      return detectHostContext();
    },

    getHostCapabilities() {
      return state.app?.getHostCapabilities();
    },

    subscribeHostContext(listener) {
      return subscribeHostContext(listener, state);
    },
  };
}

/** Creates a deterministic bridge for the local Sidecar preview catalog. */
function createPreviewBridge(preview: SidecarPreviewHost): WidgetBridge {
  const toolResult = normalizeToolResult(preview.toolResult ?? {
    structuredContent: undefined,
    content: [],
    _meta: {},
  });

  return {
    async callServerTool() {
      return toolResult as never;
    },
    async callTool() {
      return toolResult.structuredContent as never;
    },
    async readServerResource() {
      return { ok: false, reason: "unsupported" };
    },
    async listServerResources() {
      return { ok: false, reason: "unsupported" };
    },
    async createSamplingMessage() {
      return { ok: false, reason: "unsupported" };
    },
    async sendMessage() {
      return { ok: false, reason: "unsupported" };
    },
    async updateModelContext() {
      return { ok: false, reason: "unsupported" };
    },
    async sendLog(message) {
      console[message.level === "error" ? "error" : "log"]("[sidecar preview]", message);
      return { ok: true, value: undefined };
    },
    async openLink(url) {
      if (!isAllowedExternalUrl(url)) {
        return { ok: false, reason: "denied" };
      }
      window.open(url, "_blank", "noopener,noreferrer");
      return { ok: true, value: undefined };
    },
    async downloadFile() {
      return { ok: false, reason: "unsupported" };
    },
    async requestTeardown() {
      return { ok: false, reason: "unsupported" };
    },
    async requestDisplayMode(mode) {
      return { ok: true, value: mode };
    },
    async sendSizeChanged() {
      return { ok: true, value: undefined };
    },
    getToolResult() {
      return toolResult as never;
    },
    subscribeToolInput(listener) {
      listener(preview.toolInput ?? {});
      return () => {};
    },
    subscribeToolInputPartial() {
      return () => {};
    },
    subscribeToolResult(listener) {
      listener(toolResult);
      return () => {};
    },
    subscribeToolCancelled() {
      return () => {};
    },
    getHostContext() {
      return preview.hostContext;
    },
    getHostCapabilities() {
      return preview.hostCapabilities;
    },
    subscribeHostContext(listener) {
      listener(preview.hostContext);
      return () => {};
    },
  };
}

let defaultState: McpAppsState | undefined;

/** Default browser bridge used by generated widget clients. */
export const browserBridge = createBrowserBridge();

/** Convenience object for sending model messages and context updates. */
export const model = {
  message(message: ModelMessage): Promise<HostFeatureResult> {
    return browserBridge.sendMessage(message);
  },
  context: {
    update(context: Record<string, unknown>): Promise<HostFeatureResult> {
      return browserBridge.updateModelContext(context);
    },
  },
};

/** Convenience object for server-bound MCP requests proxied by the Apps host. */
export const server = {
  tool<
    TParams extends Record<string, unknown> = Record<string, unknown>,
    Structured = unknown,
    Meta = Record<string, unknown>,
  >(params: {
    name: string;
    arguments?: TParams;
  }): Promise<WidgetToolResult<Structured, Meta>> {
    return browserBridge.callServerTool<TParams, Structured, Meta>(params);
  },
  resource: {
    read(params: { uri: string }): Promise<HostFeatureResult<ServerResourceReadResult>> {
      return browserBridge.readServerResource(params);
    },
    list(params?: { cursor?: string }): Promise<HostFeatureResult<ServerResourceListResult>> {
      return browserBridge.listServerResources(params);
    },
  },
};

/** Convenience object for standard host sampling requests. */
export const sampling = {
  createMessage(params: SamplingMessageRequest): Promise<HostFeatureResult<SamplingMessageResult>> {
    return browserBridge.createSamplingMessage(params);
  },
};

/** Convenience object for standard host logging notifications. */
export const log = {
  send(message: HostLogMessage): Promise<HostFeatureResult> {
    return browserBridge.sendLog(message);
  },
};

/** Convenience object for view lifecycle and layout notifications. */
export const view = {
  requestTeardown(params?: Record<string, never>): Promise<HostFeatureResult> {
    return browserBridge.requestTeardown(params);
  },
  sizeChanged(size: SizeChangedMessage): Promise<HostFeatureResult> {
    return browserBridge.sendSizeChanged(size);
  },
};

/** Reads the current tool result from the default browser bridge. */
export function getToolResult<
  Structured,
  Meta = Record<string, unknown>,
>(): WidgetToolResult<Structured, Meta> {
  return browserBridge.getToolResult<Structured, Meta>();
}

/**
 * Creates a typed proxy where method calls become host tool calls.
 *
 * Generated clients pass the machine-name map while user code calls readable
 * camelCase methods.
 */
export function createToolClient<TTools extends ToolClientShape>(
  names: Record<Extract<keyof TTools, string>, string>,
  bridge: Pick<WidgetBridge, "callTool"> = browserBridge,
): TTools {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string" || property === "then" || property === "catch" || property === "finally") {
          return undefined;
        }
        if (!(property in names)) {
          return undefined;
        }
        const method = property as Extract<keyof TTools, string>;
        return (params: Record<string, unknown>) =>
          bridge.callTool(String(names[method]), params);
      },
    },
  ) as TTools;
}

type McpAppsToolResult = {
  structuredContent?: unknown;
  content?: unknown[];
  _meta?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
};

type McpAppsHostCapabilities = {
  serverTools?: unknown;
  openLinks?: unknown;
  downloadFile?: unknown;
  updateModelContext?: unknown;
  message?: unknown;
  [key: string]: unknown;
};

type McpAppsHostContext = {
  theme?: "light" | "dark";
  styles?: {
    variables?: Record<string, string | undefined>;
    css?: {
      fonts?: string;
    };
  };
  userAgent?: string;
  displayMode?: SidecarDisplayMode;
  availableDisplayModes?: SidecarDisplayMode[];
  [key: string]: unknown;
};

type McpAppsRuntime = {
  connect(transport: unknown, options?: Record<string, unknown>): Promise<void>;
  callServerTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<McpAppsToolResult>;
  readServerResource(params: { uri: string }): Promise<ServerResourceReadResult>;
  listServerResources(params?: { cursor?: string }): Promise<ServerResourceListResult>;
  createSamplingMessage(params: SamplingMessageRequest): Promise<SamplingMessageResult>;
  sendMessage(params: { role: "user"; content: ClientContentBlock[] }): Promise<{ isError?: boolean }>;
  sendLog(params: HostLogMessage): Promise<void>;
  updateModelContext(params: { content?: ClientContentBlock[]; structuredContent?: Record<string, unknown> }): Promise<unknown>;
  openLink(params: { url: string }): Promise<{ isError?: boolean }>;
  downloadFile(params: { contents: ClientContentBlock[] }): Promise<{ isError?: boolean }>;
  requestTeardown(params?: Record<string, never>): Promise<void>;
  requestDisplayMode(params: { mode: SidecarDisplayMode }): Promise<{ mode: SidecarDisplayMode }>;
  sendSizeChanged(params: SizeChangedMessage): Promise<void>;
  getHostCapabilities(): McpAppsHostCapabilities | undefined;
  getHostContext(): McpAppsHostContext | undefined;
  ontoolinput?: (params: ToolInput) => void;
  ontoolinputpartial?: (params: ToolInput) => void;
  ontoolresult?: (params: McpAppsToolResult) => void;
  onhostcontextchanged?: (params: McpAppsHostContext) => void;
  ontoolcancelled?: (params: { reason?: string }) => void;
  onteardown?: () => Record<string, never> | Promise<Record<string, never>>;
};

type McpAppsState = {
  app?: McpAppsRuntime;
  connectPromise?: Promise<McpAppsRuntime | undefined>;
  connected: boolean;
  failed: boolean;
  hostContext?: McpAppsHostContext;
  toolResult?: WidgetToolResult;
  hostContextListeners: Set<HostContextListener>;
  toolInputListeners: Set<ToolInputListener>;
  toolInputPartialListeners: Set<ToolInputListener>;
  toolResultListeners: Set<ToolResultListener>;
  toolCancelledListeners: Set<ToolCancelledListener>;
};

const MCP_APPS_READY_TIMEOUT_MS = 900;
const hostContextEventNames = ["hostcontextchanged"] as const;

/** Creates and starts the standard MCP Apps runtime when running in an iframe. */
function createMcpAppsState(): McpAppsState {
  if (defaultState) {
    return defaultState;
  }

  const state: McpAppsState = {
    connected: false,
    failed: false,
    hostContextListeners: new Set(),
    toolInputListeners: new Set(),
    toolInputPartialListeners: new Set(),
    toolResultListeners: new Set(),
    toolCancelledListeners: new Set(),
  };
  defaultState = state;

  if (!canUseMcpAppsBridge()) {
    return state;
  }

  const app = new App(
    { name: "Sidecar Widget", version: "0.0.0-dev" },
    {},
    { autoResize: typeof ResizeObserver !== "undefined" },
  ) as unknown as McpAppsRuntime;
  state.app = app;

  app.ontoolinput = (params) => {
    notifySet(state.toolInputListeners, params);
  };
  app.ontoolinputpartial = (params) => {
    notifySet(state.toolInputPartialListeners, params);
  };
  app.ontoolresult = (params) => {
    state.toolResult = normalizeToolResult(params);
    notifyToolResultListeners(state);
  };
  app.ontoolcancelled = (params) => {
    state.toolResult = normalizeToolResult({
      content: [{ type: "text", text: params.reason ?? "Tool execution was cancelled." }],
      isError: true,
    });
    notifySet(state.toolCancelledListeners, params);
    notifyToolResultListeners(state);
  };
  app.onhostcontextchanged = (params) => updateMcpHostContext(state, params);
  app.onteardown = async () => ({});

  state.connectPromise = app
    .connect(new PostMessageTransport(window.parent, window.parent))
    .then(() => {
      state.connected = true;
      state.failed = false;
      updateMcpHostContext(state, app.getHostContext() ?? {});
      return app;
    })
    .catch(() => {
      state.failed = true;
      return undefined;
    });
  void state.connectPromise;

  return state;
}

/** Calls the originating MCP server through the standard Apps host bridge. */
async function callServerTool<
  TParams extends Record<string, unknown>,
  Structured,
  Meta = Record<string, unknown>,
>(
  state: McpAppsState,
  params: { name: string; arguments?: TParams },
): Promise<WidgetToolResult<Structured, Meta>> {
  const app = await readyMcpApp(state);
  if (app?.getHostCapabilities()?.serverTools) {
    const result = await app.callServerTool({
      name: params.name,
      arguments: params.arguments,
    });
    state.toolResult = normalizeToolResult(result);
    notifyToolResultListeners(state);
    return state.toolResult as WidgetToolResult<Structured, Meta>;
  }

  throw new Error("This host does not expose widget tool calls.");
}

/** Resolves the standard MCP Apps app if its initialization has completed. */
async function readyMcpApp(state: McpAppsState): Promise<McpAppsRuntime | undefined> {
  if (state.connected && state.app) {
    return state.app;
  }
  if (state.failed || !state.connectPromise) {
    return undefined;
  }

  return timeout(state.connectPromise, MCP_APPS_READY_TIMEOUT_MS, undefined);
}

/** Returns true when a browser iframe can attempt MCP Apps postMessage transport. */
function canUseMcpAppsBridge(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

/** Updates raw host context and notifies React/native subscribers. */
function updateMcpHostContext(state: McpAppsState, context: McpAppsHostContext): void {
  state.hostContext = {
    ...(state.hostContext ?? {}),
    ...context,
    styles: {
      ...(state.hostContext?.styles ?? {}),
      ...(context.styles ?? {}),
      css: {
        ...(state.hostContext?.styles?.css ?? {}),
        ...(context.styles?.css ?? {}),
      },
      variables: {
        ...(state.hostContext?.styles?.variables ?? {}),
        ...(context.styles?.variables ?? {}),
      },
    },
  };
  applyHostPresentation(state.hostContext);
  notifyHostContextListeners(state);
}

/** Notifies subscribers of the normalized Sidecar host context. */
function notifyHostContextListeners(state: McpAppsState): void {
  const context = detectHostContext();
  for (const listener of state.hostContextListeners) {
    listener(context);
  }
}

/** Notifies subscribers of the latest normalized MCP tool result. */
function notifyToolResultListeners(state: McpAppsState): void {
  if (!state.toolResult) {
    return;
  }
  notifySet(state.toolResultListeners, state.toolResult);
}

/** Notifies all listeners in one set without exposing mutation during dispatch. */
function notifySet<T>(listeners: Set<(value: T) => void>, value: T): void {
  for (const listener of [...listeners]) {
    listener(value);
  }
}

/** Detects the active widget host without relying on build-time target flags. */
export function detectHostContext(): SidecarHostContext {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { name: "generic", theme: "light", source: "fallback" };
  }

  const state = defaultState;
  if (state?.hostContext) {
    return normalizeHostContext(state.hostContext, "mcp-apps");
  }

  if (looksLikeClaudeTheme()) {
    return {
      name: "claude",
      theme: inferTheme(),
      source: "claude-css",
    };
  }

  return {
    name: "generic",
    theme: inferTheme(),
    source: "media-query",
  };
}

/** Subscribes to host context/theme changes from the MCP Apps bridge and media queries. */
export function subscribeHostContext(
  listener: HostContextListener,
  state = createMcpAppsState(),
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  state.hostContextListeners.add(listener);
  const notify = () => listener(detectHostContext());
  for (const eventName of hostContextEventNames) {
    window.addEventListener(eventName, notify);
  }

  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", notify);

  return () => {
    state.hostContextListeners.delete(listener);
    for (const eventName of hostContextEventNames) {
      window.removeEventListener(eventName, notify);
    }
    media?.removeEventListener?.("change", notify);
  };
}

/** Converts unknown host context shapes into Sidecar's stable context contract. */
function normalizeHostContext(
  context: McpAppsHostContext,
  source: SidecarHostContext["source"],
): SidecarHostContext {
  const name = inferHostName(context);
  const theme = context.theme === "dark" || context.theme === "light"
    ? context.theme
    : inferTheme();

  return {
    name,
    theme,
    source,
    raw: context,
  };
}

/** Infers ChatGPT/Claude from standard host context and runtime hints. */
function inferHostName(context: McpAppsHostContext): SidecarHostName {
  const userAgent = String(context.userAgent ?? "").toLowerCase();
  if (userAgent.includes("claude") || contextHasClaudeStyles(context) || looksLikeClaudeTheme()) {
    return "claude";
  }
  if (userAgent.includes("chatgpt") || userAgent.includes("openai")) {
    return "chatgpt";
  }
  return "generic";
}

/** Applies host-provided MCP Apps theme variables and font faces to the widget document. */
function applyHostPresentation(context: McpAppsHostContext): void {
  if (typeof document === "undefined") {
    return;
  }

  try {
    if (context.theme) {
      applyDocumentTheme(context.theme);
    }
    if (context.styles?.variables) {
      applyHostStyleVariables(context.styles.variables);
    }
    if (context.styles?.css?.fonts) {
      applyHostFonts(context.styles.css.fonts);
    }
  } catch {
    // Host styling is best-effort; widget bridge behavior must keep working.
  }
}

/** Detects Claude's documented MCP Apps style payload before it reaches the DOM. */
function contextHasClaudeStyles(context: McpAppsHostContext): boolean {
  const variables = context.styles?.variables;
  const fontStack = variables?.["--font-sans"]?.toLowerCase() ?? "";
  const fontCss = context.styles?.css?.fonts?.toLowerCase() ?? "";
  return fontStack.includes("anthropic") || fontCss.includes("anthropic sans");
}

/** Converts a standard MCP tool result into Sidecar's hook-friendly result. */
function normalizeToolResult<
  Structured = unknown,
  Meta = Record<string, unknown>,
>(result: McpAppsToolResult): WidgetToolResult<Structured, Meta> {
  const structuredContent = result.structuredContent as Structured | undefined;
  const meta = (result._meta ?? {}) as Meta;
  return {
    structuredContent,
    structured: structuredContent,
    content: result.content ?? [],
    meta,
    _meta: meta,
    isError: result.isError,
  };
}

/** Normalizes Sidecar's convenient message object to the standard MCP Apps shape. */
function normalizeMessageContent(message: ModelMessage): ClientContentBlock[] {
  if (message.content?.length) {
    return message.content;
  }
  return [{ type: "text", text: message.text ?? "" }];
}

/** Infers light/dark when the host did not provide an explicit theme. */
function inferTheme(): SidecarTheme {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Detects Claude-like host theming through documented CSS custom properties. */
function looksLikeClaudeTheme(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const style = getComputedStyle(document.documentElement);
  return Boolean(
    style.getPropertyValue("--claude-text-color").trim() ||
      style.getPropertyValue("--claude-background-color").trim() ||
      style.getPropertyValue("--claude-border-color").trim() ||
      style.getPropertyValue("--font-sans").toLowerCase().includes("anthropic"),
  );
}

/** Allows only URL schemes that are safe for external navigation helpers. */
function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

/** Resolves a promise with a fallback if it does not settle within the timeout. */
function timeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
