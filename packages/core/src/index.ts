/**
 * Core Sidecar authoring primitives.
 *
 * This package intentionally has no host or transport dependency. It defines
 * the stable contracts used by the compiler, MCP runtime, auth package, and
 * widget bridge.
 */
export type JsonPrimitive = string | number | boolean | null;

/** JSON-compatible data accepted in MCP structured content and metadata. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** JSON object shorthand used by MCP content blocks and descriptors. */
export type JsonObject = { [key: string]: JsonValue };

/** Value that may be returned synchronously or asynchronously. */
export type MaybePromise<T> = T | Promise<T>;

/** MIME type required for HTML MCP Apps resources. */
export const MCP_APP_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

/** Project-level metadata declared from `sidecar.config.ts`. */
export type SidecarConfig = {
  /** Human-readable app/server name used in generated manifests. */
  name: string;
  /** Semver-ish app version used in generated manifests and plugin output. */
  version: string;
  /** Short app description used by hosts and generated install docs. */
  description: string;
  /** Build defaults used when CLI flags do not override them. */
  build?: BuildConfig;
  /** Server-level MCP resource capabilities. */
  resources?: ResourceCapabilityConfig;
  /** Server-level MCP prompt capabilities. */
  prompts?: PromptCapabilityConfig;
  /** Server-level MCP tool capabilities. */
  tools?: ToolCapabilityConfig;
  /** Cursor pagination defaults for MCP list operations. */
  pagination?: PaginationConfig;
  /** Optional code-mode transform that exposes a small tool catalog backed by generated code. */
  codeMode?: boolean | CodeModeConfig;
  /** Enables project-owned remote execution through reserved `remote.ts`. */
  remoteExecution?: boolean;
};

/** Build target profile selected by reserved platform file suffixes. */
export type BuildTarget = "mcp" | "chatgpt" | "claude";

/** Host runtime artifact emitted for a build output. */
export type BuildHost = "node" | "vercel";

/** Project-level build defaults. CLI flags always take precedence. */
export type BuildConfig = {
  /** Default target profile for `sidecar build`. */
  target?: BuildTarget;
  /** Default host artifact for `sidecar build`. Vercel also auto-selects this when `VERCEL=1`. */
  host?: BuildHost;
  /** Default output directory. Leave unset for host-specific defaults. */
  outDir?: string;
  /** Whether `sidecar build` should emit installable plugin packages by default. */
  plugins?: boolean;
  /** Hosted MCP URL embedded in generated plugin packages. */
  pluginMcpUrl?: string;
  /** Optional widget bundler extensions. Sidecar still owns the wrapper and output shape. */
  widgets?: WidgetBuildConfig;
};

/** Project-level widget bundler extensions. */
export type WidgetBuildConfig = {
  /** Static esbuild option extensions for every widget bundle. */
  esbuild?: WidgetEsbuildConfig;
  /** Optional TS/JS module path that default-exports a widget bundler hook. */
  configure?: string;
};

/** Serializable esbuild options Sidecar can read statically from config. */
export type WidgetEsbuildConfig = {
  /** Package/path aliases merged with Sidecar's own aliases. Relative replacements resolve from the project root. */
  alias?: Record<string, string>;
  /** Compile-time constants, usually JSON.stringify(...) values. */
  define?: Record<string, string>;
  /** Package names or paths to keep external. */
  external?: string[];
  /** Extra esbuild loaders keyed by extension, for example `{ ".svg": "text" }`. */
  loader?: Record<string, string>;
  /** Package export conditions. */
  conditions?: string[];
  /** Package main fields. */
  mainFields?: string[];
  /** JSX transform mode. Defaults to `automatic`. */
  jsx?: "automatic" | "transform" | "preserve";
  /** JSX import source used with the automatic runtime. */
  jsxImportSource?: string;
};

/** Esbuild-like option bag exposed to `defineWidgetBundler()` without making core depend on esbuild. */
export type WidgetBundlerEsbuildOptions = WidgetEsbuildConfig & {
  nodePaths?: string[];
  plugins?: unknown[];
  [key: string]: unknown;
};

/** Widget identity passed to a project-level bundler hook. */
export type WidgetBundlerHookWidget = {
  toolId: string;
  toolName: string;
  target: BuildTarget;
  sourceFile: string;
};

/** Input passed to a project-level bundler hook. */
export type WidgetBundlerHookInput<Options = WidgetBundlerEsbuildOptions> = {
  rootDir: string;
  outDir: string;
  entryFile: string;
  widget: WidgetBundlerHookWidget;
  esbuildOptions: Options;
};

/** Result returned by a project-level bundler hook. */
export type WidgetBundlerHookResult<Options = WidgetBundlerEsbuildOptions> =
  | void
  | Options
  | {
      esbuildOptions?: Options;
    };

/** Project-level hook for extending widget bundling without replacing Sidecar's wrapper. */
export type WidgetBundlerHook<Options = WidgetBundlerEsbuildOptions> = (
  input: WidgetBundlerHookInput<Options>
) => MaybePromise<WidgetBundlerHookResult<Options>>;

/** MCP list operations that support cursor pagination. */
export type McpListOperation =
  | "tools/list"
  | "resources/list"
  | "resources/templates/list"
  | "prompts/list";

/** Configures server-level resource capabilities. */
export type ResourceCapabilityConfig = {
  /** Whether the runtime accepts `resources/subscribe` and `resources/unsubscribe`. */
  subscribe?: boolean;
  /** Whether the runtime may emit `notifications/resources/list_changed`. */
  listChanged?: boolean;
};

/** Configures server-level prompt capabilities. */
export type PromptCapabilityConfig = {
  /** Whether the runtime may emit `notifications/prompts/list_changed`. */
  listChanged?: boolean;
};

/** Configures server-level tool capabilities. */
export type ToolCapabilityConfig = {
  /** Whether the runtime may emit `notifications/tools/list_changed`. */
  listChanged?: boolean;
};

/** Context passed to project-level pagination overrides. */
export type PaginationContext<Auth = unknown> = {
  operation: McpListOperation;
  cursor?: string;
  pageSize: number;
  auth?: Auth;
};

/** Input accepted by a project-level pagination override. */
export type PaginationOverrideInput<Item = unknown, Auth = unknown> =
  PaginationContext<Auth> & {
    items: readonly Item[];
  };

/** Result returned by a project-level pagination override. */
export type PaginationResult<Item = unknown> = {
  items: readonly Item[];
  nextCursor?: string;
};

/** Custom pagination function used for one or more MCP list operations. */
export type PaginationOverride<Item = unknown, Auth = unknown> = (
  input: PaginationOverrideInput<Item, Auth>
) => MaybePromise<PaginationResult<Item>>;

/** Operation-specific pagination overrides. Specific keys win over `default`. */
export type PaginationOverrideMap<Auth = unknown> = {
  default?: PaginationOverride<unknown, Auth>;
  toolsList?: PaginationOverride<unknown, Auth>;
  resourcesList?: PaginationOverride<unknown, Auth>;
  resourceTemplatesList?: PaginationOverride<unknown, Auth>;
  promptsList?: PaginationOverride<unknown, Auth>;
};

/** Project-level cursor pagination config. */
export type PaginationConfig<Auth = unknown> = {
  /** Server-chosen page size. Clients must treat cursors as opaque and must not assume this value. */
  pageSize?: number;
  /** One override for all list operations, or specific overrides keyed by operation. */
  override?: PaginationOverride<unknown, Auth> | PaginationOverrideMap<Auth>;
};

/** Strategy used by the generated code-mode widget when several internal tools can render UI. */
export type CodeModeRenderStrategy =
  | "last-renderable"
  | "first-renderable"
  | "explicit";

/** UI rendering behavior for code-mode tool results. */
export type CodeModeRenderConfig = {
  /** Whether the public `execute_code` tool should advertise a dynamic widget. */
  enabled?: boolean;
  /** How Sidecar chooses an internal widget result when generated code calls several tools. */
  strategy?: CodeModeRenderStrategy;
};

/** Configures Sidecar's code-mode transform. */
export type CodeModeConfig = {
  /** Runs generated code directly in the MCP server process. Intended only for trusted/local use. */
  unsafe?: boolean;
  /** Dynamic widget selection behavior for code-mode results. */
  render?: boolean | CodeModeRenderConfig;
};

/** File emitted into a remote executor workspace for one code-mode run. */
export type RemoteRunFile = {
  path: string;
  text: string;
};

/** Code-mode work package passed to `remote.ts`. */
export type RemoteCodeRun = {
  /** Stable id for this code-mode invocation. */
  id: string;
  /** Files Sidecar generated for the remote executor. */
  files: RemoteRunFile[];
  /** Command the executor should run after writing `files`. */
  command: string[];
  /** Sidecar-generated environment only. App/provider secrets are intentionally not included. */
  env: Record<string, string>;
  /** Maximum runtime Sidecar expects the executor to enforce. */
  timeoutMs: number;
};

/** Result returned by `remote.ts` after the generated runner exits. */
export type RemoteExecutionResult = {
  exitCode: number;
  stdout: string;
  stderr?: string;
};

/** Context passed to a project-owned remote executor. */
export type RemoteExecutionContext = {
  log: Logger;
};

/** Reserved `remote.ts` definition used by code mode remote execution. */
export type RemoteExecutionDefinition = {
  execute(
    run: RemoteCodeRun,
    ctx: RemoteExecutionContext,
  ): MaybePromise<RemoteExecutionResult>;
};

/** Options accepted by the built-in offset cursor pagination helper. */
export type OffsetPaginationOptions<Item> = {
  items: readonly Item[];
  cursor?: string;
  pageSize: number;
};

/**
 * Paginates an in-memory list with opaque offset cursors.
 *
 * Use this inside `pagination.override` when you want Sidecar's standard
 * cursor behavior after applying app-specific filtering or sorting.
 */
export function offsetPagination<Item>(
  options: OffsetPaginationOptions<Item>,
): PaginationResult<Item> {
  const offset = options.cursor ? decodeOffsetCursor(options.cursor) : 0;
  const pageSize = options.pageSize > 0 ? Math.floor(options.pageSize) : 50;
  const page = options.items.slice(offset, offset + pageSize);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < options.items.length
      ? encodeOffsetCursor(nextOffset)
      : undefined,
  };
}

/** MCP content block variants Sidecar currently normalizes. */
export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource"; resource: JsonObject };

/** Minimal JSON Schema shape Sidecar needs for MCP tool descriptors. */
export type JsonSchema = {
  $schema?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: JsonValue[];
  const?: JsonValue;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  default?: JsonValue;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
};

/** Descriptor-level auth scheme advertised to MCP/App clients. */
export type SecurityScheme =
  | { type: "noauth" }
  | {
      type: "oauth2";
      scopes: string[];
    };

/** MCP tool annotation hints used by hosts to understand tool behavior. */
export type ToolAnnotations = {
  /** Human-facing display title. Defaults to the tool name. */
  title?: string;
  /** True when the tool only reads data and has no side effects. */
  readOnlyHint?: boolean;
  /** True when the tool may perform destructive updates. Meaningful only for non-read-only tools. */
  destructiveHint?: boolean;
  /** True when repeating the same call has no extra effect. Meaningful only for non-read-only tools. */
  idempotentHint?: boolean;
  /** True when the tool may interact with external systems outside the current account/control boundary. */
  openWorldHint?: boolean;
};

/** Shared MCP annotations for resources, resource contents, and prompt content. */
export type ResourceAnnotations = {
  /** Intended audience for the annotated content. */
  audience?: readonly ("user" | "assistant")[];
  /** Relative importance from 0.0 to 1.0. */
  priority?: number;
  /** ISO 8601 timestamp describing when the content last changed. */
  lastModified?: string | Date;
};

/** Icon metadata supported by MCP resources and prompts. */
export type McpIcon = {
  src: string;
  mimeType?: string;
  sizes?: readonly string[];
};

/** User-friendly input accepted by `resourceResult()`. */
export type ResourceResultContentInput<
  Meta extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** Text, JSON-compatible data, or bytes returned by the resource. */
  content: string | JsonValue | Uint8Array | ArrayBuffer;
  /** Optional MIME type. Sidecar infers a conservative value when omitted. */
  mimeType?: string;
  /** Optional MCP annotations for this returned content block. */
  annotations?: ResourceAnnotations;
  /** Optional host/client-only metadata emitted as MCP `_meta`. */
  meta?: Meta;
};

/** Options accepted by `resourceResult()`. */
export type ResourceResultInput<
  Meta extends Record<string, unknown> = Record<string, unknown>,
> = ResourceResultContentInput<Meta> | readonly ResourceResultContentInput<Meta>[];

declare const resourceResultTypeBrand: unique symbol;

/** Branded Sidecar result returned by every resource read. */
export type ResourceResult<
  Meta extends Record<string, unknown> = Record<string, unknown>,
> = {
  readonly [resourceResultTypeBrand]: true;
  contents: ResourceResultContentInput<Meta>[];
};

/** MCP resource content emitted on the wire. */
export type McpResourceContent =
  | {
      uri: string;
      mimeType?: string;
      text: string;
      annotations?: ResourceAnnotations;
      _meta?: Record<string, unknown>;
    }
  | {
      uri: string;
      mimeType: string;
      blob: string;
      annotations?: ResourceAnnotations;
      _meta?: Record<string, unknown>;
    };

/** Normalized MCP resource read result returned by the runtime. */
export type McpResourceReadResult = {
  contents: McpResourceContent[];
  _meta?: Record<string, unknown>;
};

/** Helper used by resources to return MCP-compliant content. */
export type ResourceResultFactory = {
  <Meta extends Record<string, unknown> = Record<string, unknown>>(
    input: ResourceResultInput<Meta>
  ): ResourceResult<Meta>;
  many<Meta extends Record<string, unknown> = Record<string, unknown>>(
    input: readonly ResourceResultContentInput<Meta>[]
  ): ResourceResult<Meta>;
};

/** Runtime context passed to a resource's `read` method. */
export type ResourceContext<Auth = unknown, Services = unknown> = {
  auth: Auth;
  request: ToolRequestContext;
  services: Services;
  log: Logger;
  storage: ScopedStorage;
  notify: RuntimeNotifications;
  env: Readonly<Record<string, string | undefined>>;
};

/** Author-facing definition accepted by `resource()`. */
export type ResourceDefinition<Auth = unknown, Services = unknown> = {
  /** Human-readable name shown to users and clients. */
  name: string;
  /** Optional stable MCP resource URI. Defaults to `sidecar://resources/<folder>`. */
  uri?: string;
  /** Optional display title when the machine-facing name is terse. */
  title?: string;
  /** Optional human-readable description. */
  description?: string;
  /** Optional MIME type advertised from `resources/list` and used as a result default. */
  mimeType?: string;
  /** Optional resource size in bytes. */
  size?: number;
  /** Optional MCP display icons. */
  icons?: readonly McpIcon[];
  /** Optional MCP annotations for the listed resource. */
  annotations?: ResourceAnnotations;
  /** Whether this resource is worth subscribing to when server subscribe is enabled. */
  subscribe?: boolean;
  /** Resource implementation. It may be synchronous or asynchronous. */
  read: (ctx: ResourceContext<Auth, Services>) => MaybePromise<ResourceResult>;
};

/** Branded Sidecar resource returned by `resource()`. */
export type SidecarResource<Auth = unknown, Services = unknown> =
  ResourceDefinition<Auth, Services> & {
    readonly kind: "sidecar.resource";
  };

/** MCP descriptor emitted for `resources/list`. */
export type McpResourceDescriptor = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  icons?: McpIcon[];
  annotations?: ResourceAnnotations;
  _meta?: Record<string, unknown>;
};

/** MCP resource template descriptor emitted for `resources/templates/list`. */
export type McpResourceTemplateDescriptor = {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  icons?: McpIcon[];
  annotations?: ResourceAnnotations;
  _meta?: Record<string, unknown>;
};

/** Shorthand argument forms accepted by `prompt({ args })`. */
export type PromptArgInput =
  | string
  | readonly JsonPrimitive[]
  | {
      description?: string;
      required?: boolean;
    };

/** Prompt argument schema declared in normal TypeScript objects. */
export type PromptArgsDefinition = Record<string, PromptArgInput>;

/** MCP prompt argument descriptor emitted for `prompts/list`. */
export type McpPromptArgument = {
  name: string;
  description?: string;
  required?: boolean;
};

/** MCP prompt descriptor emitted for `prompts/list`. */
export type McpPromptDescriptor = {
  name: string;
  title?: string;
  description?: string;
  arguments?: McpPromptArgument[];
  icons?: McpIcon[];
};

/** MCP prompt message content. */
export type McpPromptContent = McpContentBlock;

/** MCP prompt message emitted by `prompts/get`. */
export type McpPromptMessage = {
  role: "user" | "assistant";
  content: McpPromptContent;
};

/** User-friendly value accepted from `prompt().run`. */
export type PromptResultInput =
  | string
  | McpPromptMessage
  | McpPromptMessage[]
  | {
      description?: string;
      messages: McpPromptMessage[];
    };

/** Normalized MCP prompt result returned by the runtime. */
export type McpPromptResult = {
  description?: string;
  messages: McpPromptMessage[];
};

/** Runtime context passed to a prompt's `run` method. */
export type PromptContext<Auth = unknown, Services = unknown> = {
  auth: Auth;
  request: ToolRequestContext;
  services: Services;
  log: Logger;
  storage: ScopedStorage;
  notify: RuntimeNotifications;
  env: Readonly<Record<string, string | undefined>>;
};

/** Author-facing definition accepted by `prompt()`. */
export type PromptDefinition<
  Args extends Record<string, unknown> = Record<string, unknown>,
  Auth = unknown,
  Services = unknown,
> = {
  /** Optional MCP prompt machine name. Defaults to the folder name. */
  name?: string;
  /** Human-readable display title. */
  title: string;
  /** Optional human-readable description. */
  description?: string;
  /** Optional simple argument declarations. */
  args?: PromptArgsDefinition;
  /** Optional MCP display icons. */
  icons?: readonly McpIcon[];
  /** Prompt implementation. Returning a string creates one user text message. */
  run: (args: Args, ctx: PromptContext<Auth, Services>) => MaybePromise<PromptResultInput>;
};

/** Branded Sidecar prompt returned by `prompt()`. */
export type SidecarPrompt<
  Args extends Record<string, unknown> = Record<string, unknown>,
  Auth = unknown,
  Services = unknown,
> = PromptDefinition<Args, Auth, Services> & {
  readonly kind: "sidecar.prompt";
};

/** Controls which callers can see or call a tool. */
export type ToolVisibility = {
  model?: boolean;
  widgets?: boolean | string[];
  tools?: boolean | string[];
};

/** ChatGPT compatibility metadata for tool descriptors. */
export type ChatGptToolOptions = {
  /** Short status shown while ChatGPT is invoking the tool. */
  invoking?: string;
  /** Short status shown after ChatGPT has invoked the tool. */
  invoked?: string;
  /** Compatibility hint for legacy ChatGPT clients that allow widget tool calls. */
  widgetAccessible?: boolean;
  /** Compatibility visibility hint for legacy ChatGPT clients. */
  visibility?: "public" | "private";
  /** Top-level input fields that receive ChatGPT file references. */
  fileParams?: readonly string[];
};

/** Descriptor target used when filtering host-specific metadata. */
export type ToolDescriptorTarget = "mcp" | "chatgpt" | "claude";

/** Widget CSP allowlists emitted on the MCP Apps resource metadata. */
export type WidgetCspOptions = {
  /** Domains the widget may contact with fetch/XHR. */
  connectDomains?: readonly string[];
  /** Domains the widget may use for static resources. */
  resourceDomains?: readonly string[];
  /** Origins allowed for subframes. Omit unless the widget embeds iframes. */
  frameDomains?: readonly string[];
  /** Allowed base URI origins. Omit to let hosts enforce the secure default. */
  baseUriDomains?: readonly string[];
};

/** Browser permissions an MCP Apps host may grant to a widget iframe. */
export type WidgetPermissionOptions = {
  camera?: boolean;
  microphone?: boolean;
  geolocation?: boolean;
  clipboardWrite?: boolean;
};

/** ChatGPT-only widget compatibility options. */
export type ChatGptWidgetOptions = {
  /** Dedicated widget origin for broad ChatGPT distribution. */
  domain?: string;
  /** Redirect targets for ChatGPT external-link handling. */
  redirectDomains?: readonly string[];
};

/** Widget resource metadata declared by `widget(...)` in a sibling widget file. */
export type ToolWidgetOptions = {
  /** Host-facing summary of what the rendered widget shows. */
  description?: string;
  /** Whether the widget prefers a host-provided border. */
  prefersBorder?: boolean;
  /** Optional dedicated sandbox origin. Host-specific validation still applies. */
  domain?: string;
  /** Standard MCP Apps CSP allowlists. */
  csp?: WidgetCspOptions;
  /** Standard MCP Apps iframe permission requests. */
  permissions?: WidgetPermissionOptions;
  /** Host-specific widget compatibility metadata. */
  hosts?: {
    chatgpt?: ChatGptWidgetOptions;
  };
};

/** Host-specific extension options. Keep standard MCP fields primary. */
export type ToolHostExtensions = {
  chatgpt?: ChatGptToolOptions;
};

/** Typed auth scope object imported by tool files. */
export type AuthScopeDefinition<
  Id extends string = string,
  Auth = unknown,
> = {
  readonly kind: "sidecar.scope";
  readonly id: Id;
  readonly description: string;
  readonly __auth?: Auth;
};

/** Per-tool authorization policy. Omitted policy means public tool. */
export type ToolAuthPolicy<Auth = unknown> =
  | {
      /** This tool intentionally does not require an authenticated session. */
      public: true;
      authenticated?: never;
      scopes?: never;
    }
  | {
      /** This tool requires a valid authenticated session but no specific scope. */
      authenticated: true;
      public?: false;
      scopes?: never;
    }
  | {
      /** This tool requires an authenticated session with every listed scope. */
      scopes: readonly AuthScopeDefinition<string, Auth>[];
      public?: false;
      authenticated?: true;
    };

declare const toolResultTypeBrand: unique symbol;

/** User-friendly content accepted by `toolResult()`. */
export type ToolResultContent = string | McpContentBlock | McpContentBlock[];

/** Options for a tool result that only needs model-visible content. */
export type TextToolResultInput<
  Meta extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** Required model-visible content. Sidecar normalizes strings to MCP text blocks. */
  content: ToolResultContent;
  /** Optional host/widget-only data emitted as MCP `_meta`. */
  meta?: Meta;
  /** Marks the tool result as an error while preserving normal MCP result channels. */
  isError?: boolean;
  /** Omitted for content-only results. */
  structuredContent?: undefined;
};

/** Options for a tool result with typed structured content. */
export type StructuredToolResultInput<
  Structured,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** Typed machine-readable output validated against the tool output schema when present. */
  structuredContent: Structured;
  /** Required model-visible content. Sidecar normalizes strings to MCP text blocks. */
  content: ToolResultContent;
  /** Optional host/widget-only data emitted as MCP `_meta`. */
  meta?: Meta;
  /** Marks the tool result as an error while preserving normal MCP result channels. */
  isError?: boolean;
};

/** Options accepted by `toolResult()`. */
export type ToolResultInput<
  Structured = undefined,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> = [Structured] extends [undefined]
  ? TextToolResultInput<Meta>
  : StructuredToolResultInput<Structured, Meta>;

/** Branded Sidecar result returned by every tool execution. */
export type ToolResult<
  Structured = undefined,
  Meta extends Record<string, unknown> = Record<string, unknown>,
> = {
  readonly [toolResultTypeBrand]: true;
  content: McpContentBlock[];
  _meta?: Meta;
  isError?: boolean;
} & ([Structured] extends [undefined]
  ? { structuredContent?: Structured }
  : { structuredContent: Structured });

/** Normalized MCP tool result returned by the runtime. */
export type McpToolResult = {
  structuredContent?: unknown;
  content: McpContentBlock[];
  _meta?: Record<string, unknown>;
  isError?: boolean;
};

/** Helper used by tools to return MCP-compliant result envelopes. */
export type ToolResultFactory = {
  <Meta extends Record<string, unknown> = Record<string, unknown>>(
    input: TextToolResultInput<Meta>
  ): ToolResult<undefined, Meta>;
  <Structured, Meta extends Record<string, unknown> = Record<string, unknown>>(
    input: StructuredToolResultInput<Structured, Meta>
  ): ToolResult<Structured, Meta>;
  text(text: string): McpContentBlock;
  error<
    Structured = undefined,
    Meta extends Record<string, unknown> = Record<string, unknown>,
  >(
    message: string,
    options?: Omit<ToolResultInput<Structured, Meta>, "content" | "isError">
  ): ToolResult<Structured, Meta>;
};

/** Logger surface exposed in `ToolContext`. */
export type Logger = {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
};

/** Minimal tracing hook exposed in `ToolContext`. */
export type Trace = {
  span<T>(name: string, run: () => MaybePromise<T>): Promise<T>;
};

/** Tool-scoped storage abstraction for runtimes that provide persistence. */
export type ScopedStorage = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
};

/** Opaque MCP progress token supplied by a client in request `_meta`. */
export type ProgressToken = string | number;

/** Progress update payload emitted as `notifications/progress`. */
export type ToolProgressUpdate = {
  /** Monotonically increasing progress value for the active request. */
  progress: number;
  /** Optional total value when the total work is known. */
  total?: number;
  /** Optional short human-readable progress message. */
  message?: string;
};

/** Typed notification helpers exposed to runtime code. */
export type RuntimeNotifications = {
  /** Emits `notifications/progress` when the client supplied a progress token. */
  progress(update: ToolProgressUpdate): MaybePromise<void>;
  /** Emits `notifications/tools/list_changed` on an available server SSE stream. */
  toolsChanged(): MaybePromise<void>;
  /** Emits `notifications/resources/list_changed` on an available server SSE stream. */
  resourcesChanged(): MaybePromise<void>;
  /** Emits `notifications/prompts/list_changed` on an available server SSE stream. */
  promptsChanged(): MaybePromise<void>;
  /** Emits `notifications/resources/updated` for one resource URI. */
  resourceUpdated(uri: string): MaybePromise<void>;
};

/** Request metadata supplied to each tool invocation. */
export type ToolRequestContext = {
  id: string;
  signal: AbortSignal;
  host: "chatgpt" | "claude" | "unknown";
  transport: "streamable-http" | "stdio";
};

/** Runtime context passed to a tool's `execute` method. */
export type ToolContext<Auth = unknown, Services = unknown, Tools = unknown> = {
  auth: Auth;
  request: ToolRequestContext;
  services: Services;
  tools: Tools;
  log: Logger;
  trace: Trace;
  storage: ScopedStorage;
  notify: RuntimeNotifications;
  env: Readonly<Record<string, string | undefined>>;
};

/** Small subset of Zod-like validation Sidecar can consume without depending on Zod. */
export type ZodLikeSchema<T = unknown> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
};

/** Infers a params type from a validator if one is supplied. */
export type InferParams<T> = T extends ZodLikeSchema<infer Output> ? Output : T;

/** Function signature for tool execution. */
export type ToolExecute<Params, Output, Auth = unknown, Services = unknown, Tools = unknown> = (
  params: Params,
  ctx: ToolContext<Auth, Services, Tools>
) => MaybePromise<ToolResult<Output>>;

/** Tool execute function with a runtime params validator attached. */
export type ToolExecuteWithParams<
  Schema extends ZodLikeSchema,
  Output,
  Auth = unknown,
  Services = unknown,
  Tools = unknown,
> = ToolExecute<InferParams<Schema>, Output, Auth, Services, Tools> & {
  readonly kind: "sidecar.withParams";
  readonly params: Schema;
};

/** Author-facing definition accepted by `tool()`. */
export type ToolDefinition<Params = unknown, Output = unknown, Auth = unknown, Services = unknown, Tools = unknown> = {
  /** Human-readable name shown to users and models. */
  name: string;
  /** Optional MCP machine id. If omitted in a reserved tool file, Sidecar uses the folder name. */
  id?: string;
  /** Model-facing description. This should be specific enough for reliable tool selection. */
  description: string;
  /** Optional runtime validation schema. Zod schemas are supported directly. */
  params?: ZodLikeSchema<Params>;
  /** Optional output schema escape hatch. The compiler normally derives this from `execute`. */
  output?: JsonSchema;
  /** MCP tool behavior hints. */
  annotations?: ToolAnnotations;
  /** Optional visibility policy for model, widget, and tool callers. */
  visibility?: ToolVisibility;
  /** Optional host-specific compatibility metadata. */
  hosts?: ToolHostExtensions;
  /** Low-level descriptor metadata escape hatch. Prefer typed fields when available. */
  meta?: Record<string, unknown>;
  /** Optional authorization policy. Tools are public unless this is declared. */
  auth?: ToolAuthPolicy<Auth>;
  /** Tool implementation. It may be synchronous or asynchronous. */
  execute: ToolExecute<Params, Output, Auth, Services, Tools>;
};

/** Branded Sidecar tool returned by `tool()`. */
export type SidecarTool<Params = unknown, Output = unknown, Auth = unknown> = ToolDefinition<Params, Output, Auth> & {
  readonly kind: "sidecar.tool";
};

/** MCP descriptor emitted for `tools/list`. */
export type McpToolDescriptor = {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  securitySchemes?: SecurityScheme[];
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
};

/** Typed skill declaration used by plugin generation. */
export type SkillDefinition = {
  /** Stable skill folder/name. */
  name: string;
  /** Short routing description for the host/model. */
  description: string;
  /** Markdown body emitted to SKILL.md. */
  body: string;
};

const toolBrand = Symbol.for("sidecar.tool");
const toolExecuteParamsBrand = Symbol.for("sidecar.withParams");
const toolResultBrand = Symbol.for("sidecar.toolResult");
const resourceBrand = Symbol.for("sidecar.resource");
const resourceResultBrand = Symbol.for("sidecar.resourceResult");
const promptBrand = Symbol.for("sidecar.prompt");
const skillBrand = Symbol.for("sidecar.skill");
const remoteBrand = Symbol.for("sidecar.remote");

/**
 * Declares app identity in `sidecar.config.ts`.
 *
 * The compiler reads the object statically, while the helper gives authors
 * editor completions for every supported config field.
 */
export function defineConfig(config: SidecarConfig): SidecarConfig {
  if (!config.name.trim()) {
    throw new SidecarDefinitionError("Project name is required.");
  }
  if (!config.version.trim()) {
    throw new SidecarDefinitionError(`Project "${config.name}" must include a version.`);
  }
  if (!config.description.trim()) {
    throw new SidecarDefinitionError(`Project "${config.name}" must include a description.`);
  }

  return Object.freeze({ ...config });
}

/** Gives TS users completion when authoring `build.widgets.configure` modules. */
export function defineWidgetBundler<Options = WidgetBundlerEsbuildOptions>(
  hook: WidgetBundlerHook<Options>,
): WidgetBundlerHook<Options> {
  return hook;
}

/** Declares the project-owned remote code executor in reserved `remote.ts`. */
export function remote(definition: RemoteExecutionDefinition): RemoteExecutionDefinition {
  if (typeof definition.execute !== "function") {
    throw new SidecarDefinitionError("remote({ ... }) must include an execute function.");
  }

  return Object.freeze({
    ...definition,
    [remoteBrand]: true,
  });
}

/** Returns true when a value was produced by `remote()`. */
export function isSidecarRemote(value: unknown): value is RemoteExecutionDefinition {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<symbol, unknown>)[remoteBrand] === true,
  );
}

/**
 * Attaches a runtime params validator directly to a tool execute function.
 *
 * This is the preferred Zod authoring path: `withParams(schema, execute)` keeps
 * runtime validation, JSON Schema generation, and TypeScript inference tied to
 * one schema value.
 */
export function withParams<
  Schema extends ZodLikeSchema,
  Output,
  Auth = unknown,
  Services = unknown,
  Tools = unknown,
>(
  params: Schema,
  execute: ToolExecute<InferParams<Schema>, Output, Auth, Services, Tools>,
): ToolExecuteWithParams<Schema, Output, Auth, Services, Tools> {
  Object.defineProperties(execute, {
    kind: {
      value: "sidecar.withParams",
      enumerable: false,
    },
    params: {
      value: params,
      enumerable: false,
    },
    [toolExecuteParamsBrand]: {
      value: true,
      enumerable: false,
    },
  });

  return execute as ToolExecuteWithParams<Schema, Output, Auth, Services, Tools>;
}

/**
 * Declares a Sidecar MCP tool.
 *
 * The compiler reads this object statically, while the server executes the
 * returned branded value at runtime.
 */
export function tool<Params, Output, Auth = unknown>(
  definition: ToolDefinition<Params, Output, Auth>
): SidecarTool<Params, Output, Auth> {
  if (!definition.name.trim()) {
    throw new SidecarDefinitionError("Tool name is required.");
  }
  if (!definition.description.trim()) {
    throw new SidecarDefinitionError(`Tool "${definition.name}" must include a description.`);
  }

  const executeParams = readExecuteParams(definition.execute);
  if (definition.params && executeParams) {
    throw new SidecarDefinitionError(
      `Tool "${definition.name}" declares params twice. Use either params: schema or execute: withParams(schema, fn), not both.`,
    );
  }

  return Object.freeze({
    ...definition,
    params: definition.params ?? executeParams,
    kind: "sidecar.tool" as const,
    [toolBrand]: true
  }) as SidecarTool<Params, Output, Auth>;
}

/** Returns true when a value was produced by `tool()`. */
export function isSidecarTool(value: unknown): value is SidecarTool {
  return Boolean(
    value &&
      typeof value === "object" &&
      ((value as Record<symbol, unknown>)[toolBrand] ||
        (value as { kind?: unknown }).kind === "sidecar.tool"),
  );
}

/** Reads the validator attached by `withParams()`, if present. */
function readExecuteParams<Params, Output, Auth, Services, Tools>(
  execute: ToolExecute<Params, Output, Auth, Services, Tools>,
): ZodLikeSchema<Params> | undefined {
  if (
    !execute ||
    typeof execute !== "function" ||
    !((execute as unknown as Record<symbol, unknown>)[toolExecuteParamsBrand])
  ) {
    return undefined;
  }

  return (execute as ToolExecuteWithParams<ZodLikeSchema<Params>, unknown>).params;
}

/**
 * Declares a Sidecar MCP resource.
 *
 * The compiler fills default URIs from the reserved folder name, while the
 * runtime executes the returned branded value for `resources/read`.
 */
export function resource<Auth = unknown, Services = unknown>(
  definition: ResourceDefinition<Auth, Services>
): SidecarResource<Auth, Services> {
  if (!definition.name.trim()) {
    throw new SidecarDefinitionError("Resource name is required.");
  }
  if (definition.uri) {
    validateResourceUri(definition.uri);
  }

  return Object.freeze({
    ...definition,
    kind: "sidecar.resource" as const,
    [resourceBrand]: true
  }) as SidecarResource<Auth, Services>;
}

/** Returns true when a value was produced by `resource()`. */
export function isSidecarResource(value: unknown): value is SidecarResource {
  return Boolean(
    value &&
      typeof value === "object" &&
      ((value as Record<symbol, unknown>)[resourceBrand] ||
        (value as { kind?: unknown }).kind === "sidecar.resource"),
  );
}

/**
 * Declares a Sidecar MCP prompt.
 *
 * The compiler fills default machine names from the reserved folder name and
 * converts `args` into MCP prompt argument descriptors.
 */
export function prompt<Args extends Record<string, unknown> = Record<string, unknown>, Auth = unknown>(
  definition: PromptDefinition<Args, Auth>
): SidecarPrompt<Args, Auth> {
  if (!definition.title.trim()) {
    throw new SidecarDefinitionError("Prompt title is required.");
  }

  return Object.freeze({
    ...definition,
    kind: "sidecar.prompt" as const,
    [promptBrand]: true
  }) as SidecarPrompt<Args, Auth>;
}

/** Returns true when a value was produced by `prompt()`. */
export function isSidecarPrompt(value: unknown): value is SidecarPrompt {
  return Boolean(
    value &&
      typeof value === "object" &&
      ((value as Record<symbol, unknown>)[promptBrand] ||
        (value as { kind?: unknown }).kind === "sidecar.prompt"),
  );
}

/** Declares a generated skill that can be emitted as `SKILL.md`. */
export function skill(definition: SkillDefinition): SkillDefinition {
  if (!definition.name.trim()) {
    throw new SidecarDefinitionError("Skill name is required.");
  }
  if (!definition.description.trim()) {
    throw new SidecarDefinitionError(`Skill "${definition.name}" must include a description.`);
  }

  return Object.freeze({
    ...definition,
    [skillBrand]: true
  });
}

/** Factory for standardized tool results and common content blocks. */
export const toolResult = Object.assign(
  createToolResult,
  {
    text(text: string): McpContentBlock {
      return { type: "text", text };
    },
    error<
      Structured = undefined,
      Meta extends Record<string, unknown> = Record<string, unknown>,
    >(
      message: string,
      options: Omit<ToolResultInput<Structured, Meta>, "content" | "isError"> = {} as Omit<
        ToolResultInput<Structured, Meta>,
        "content" | "isError"
      >,
    ): ToolResult<Structured, Meta> {
      return createToolResult({
        ...options,
        structuredContent: (options as { structuredContent?: Structured }).structuredContent,
        content: message,
        isError: true
      } as ToolResultInput<Structured, Meta>);
    }
  }
) as ToolResultFactory;

/** Factory for standardized resource results. */
export const resourceResult = Object.assign(
  createResourceResult,
  {
    many<Meta extends Record<string, unknown> = Record<string, unknown>>(
      input: readonly ResourceResultContentInput<Meta>[],
    ): ResourceResult<Meta> {
      return createResourceResult(input);
    },
  },
) as ResourceResultFactory;

/** Creates and brands one standardized Sidecar tool result. */
function createToolResult<
  Structured,
  Meta extends Record<string, unknown> = Record<string, unknown>,
>(input: ToolResultInput<Structured, Meta>): ToolResult<Structured, Meta> {
  const resultEnvelope = stripUndefined({
    structuredContent: stripJsonUndefined(input.structuredContent),
    content: normalizeRequiredContent(input.content),
    _meta: stripJsonUndefined(input.meta) as Meta | undefined,
    isError: input.isError
  }) as unknown as ToolResult<Structured, Meta>;

  Object.defineProperty(resultEnvelope, toolResultBrand, {
    enumerable: false,
    value: true
  });

  return resultEnvelope;
}

/** Creates and brands one standardized Sidecar resource result. */
function createResourceResult<
  Meta extends Record<string, unknown> = Record<string, unknown>,
>(input: ResourceResultInput<Meta>): ResourceResult<Meta> {
  const contents = Array.isArray(input) ? [...input] : [input];
  if (!contents.length) {
    throw new SidecarRuntimeError(
      "resourceResult(...) must include at least one content item.",
      "invalid_resource_result",
    );
  }

  const resultEnvelope = {
    contents,
  } as ResourceResult<Meta>;

  Object.defineProperty(resultEnvelope, resourceResultBrand, {
    enumerable: false,
    value: true,
  });

  return resultEnvelope;
}

/** Returns true when a value was produced by `toolResult()`. */
export function isToolResult(value: unknown): value is ToolResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<symbol, unknown>)[toolResultBrand] === true
  );
}

/** Returns true when a value was produced by `resourceResult()`. */
export function isResourceResult(value: unknown): value is ResourceResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<symbol, unknown>)[resourceResultBrand] === true
  );
}

/** Converts a branded Sidecar tool result into an MCP-compliant tool result. */
export function normalizeToolResult(value: unknown): McpToolResult {
  if (!isToolResult(value)) {
    throw new SidecarRuntimeError(
      "Tool execute() must return toolResult({ structuredContent, content, meta }).",
      "invalid_tool_result",
    );
  }

  return stripUndefined({
    structuredContent: stripJsonUndefined(value.structuredContent),
    content: value.content ?? [],
    _meta: stripJsonUndefined(value._meta) as Record<string, unknown> | undefined,
    isError: value.isError
  });
}

/** Converts a branded Sidecar resource result into an MCP-compliant read result. */
export function normalizeResourceResult(
  value: unknown,
  uri: string,
  defaultMimeType?: string,
): McpResourceReadResult {
  if (!isResourceResult(value)) {
    throw new SidecarRuntimeError(
      "Resource read() must return resourceResult(...).",
      "invalid_resource_result",
    );
  }

  return {
    contents: value.contents.map((content) =>
      normalizeResourceContent(content, uri, defaultMimeType),
    ),
  };
}

/** Validates params, runs a tool, and normalizes its result for JSON-RPC. */
export async function executeTool<Params, Output>(
  sidecarTool: SidecarTool<Params, Output>,
  params: unknown,
  ctx: ToolContext
): Promise<McpToolResult> {
  const parsedParams = validateParams(sidecarTool, params);
  const value = await sidecarTool.execute(parsedParams, ctx);
  return normalizeToolResult(value);
}

/** Reads a resource and normalizes its result for JSON-RPC. */
export async function executeResource(
  sidecarResource: SidecarResource,
  ctx: ResourceContext,
  options: { uri: string; mimeType?: string },
): Promise<McpResourceReadResult> {
  const value = await sidecarResource.read(ctx);
  return normalizeResourceResult(value, options.uri, sidecarResource.mimeType ?? options.mimeType);
}

/** Runs a prompt and normalizes its messages for JSON-RPC. */
export async function executePrompt<Args extends Record<string, unknown>>(
  sidecarPrompt: SidecarPrompt<Args>,
  args: unknown,
  ctx: PromptContext,
): Promise<McpPromptResult> {
  const parsedArgs = validatePromptArgs(sidecarPrompt, args);
  const value = await sidecarPrompt.run(parsedArgs, ctx);
  return normalizePromptResult(value, sidecarPrompt.description);
}

/** Builds an MCP descriptor from a Sidecar tool definition. */
export function createToolDescriptor(definition: {
  name: string;
  id?: string;
  description: string;
  target?: ToolDescriptorTarget;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  visibility?: ToolVisibility;
  hosts?: ToolHostExtensions;
  meta?: Record<string, unknown>;
  auth?: ToolAuthPolicy<unknown>;
}): McpToolDescriptor {
  const machineName = definition.id ?? toMachineName(definition.name);

  validateToolId(machineName);
  const target = definition.target ?? "mcp";

  return stripUndefined({
    name: machineName,
    title: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema ?? emptyObjectSchema(),
    outputSchema: definition.outputSchema,
    securitySchemes: securitySchemes(definition.auth),
    annotations: withAnnotationDefaults(definition.annotations),
    _meta: mergeMeta(
      securitySchemesMeta(definition.auth),
      visibilityMeta(definition.visibility),
      target === "chatgpt" ? chatGptToolMeta(definition.hosts?.chatgpt) : undefined,
      definition.meta
    )
  });
}

/** Builds an MCP resource descriptor from a Sidecar resource definition. */
export function createResourceDescriptor(definition: {
  name: string;
  uri: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  icons?: readonly McpIcon[];
  annotations?: ResourceAnnotations;
  meta?: Record<string, unknown>;
}): McpResourceDescriptor {
  validateResourceUri(definition.uri);

  return stripUndefined({
    uri: definition.uri,
    name: definition.name,
    title: definition.title,
    description: definition.description,
    mimeType: definition.mimeType,
    size: definition.size,
    icons: definition.icons ? [...definition.icons] : undefined,
    annotations: normalizeAnnotations(definition.annotations),
    _meta: definition.meta,
  });
}

/** Builds an MCP prompt descriptor from a Sidecar prompt definition. */
export function createPromptDescriptor(definition: {
  name: string;
  title: string;
  description?: string;
  args?: PromptArgsDefinition;
  icons?: readonly McpIcon[];
}): McpPromptDescriptor {
  validatePromptName(definition.name);

  return stripUndefined({
    name: definition.name,
    title: definition.title,
    description: definition.description,
    arguments: promptArguments(definition.args),
    icons: definition.icons ? [...definition.icons] : undefined,
  });
}

/** Converts a Sidecar auth policy into descriptor security schemes. */
function securitySchemes(policy: ToolAuthPolicy<unknown> | undefined): SecurityScheme[] {
  if (!policy || policy.public === true) {
    return [{ type: "noauth" }];
  }

  if ("scopes" in policy && policy.scopes?.length) {
    return [{ type: "oauth2", scopes: policy.scopes.map((entry) => entry.id) }];
  }

  return [{ type: "oauth2", scopes: [] }];
}

/** Mirrors security schemes into `_meta` for older Apps clients. */
function securitySchemesMeta(policy: ToolAuthPolicy<unknown> | undefined): Record<string, unknown> {
  return {
    securitySchemes: securitySchemes(policy),
  };
}

/** Returns scope ids required by a tool's auth policy. */
export function toolAuthScopes(toolDefinition: Pick<ToolDefinition, "auth">): string[] {
  const authPolicy = toolDefinition.auth;
  if (!authPolicy || authPolicy.public === true || !authPolicy.scopes) {
    return [];
  }

  return authPolicy.scopes.map((entry) => entry.id);
}

/** Converts visibility booleans into the standard MCP Apps `_meta.ui.visibility` list. */
function visibilityMeta(visibility: ToolVisibility | undefined): Record<string, unknown> | undefined {
  if (!visibility) {
    return undefined;
  }

  const uiVisibility = [
    visibility.model !== false ? "model" : undefined,
    visibility.widgets !== false ? "app" : undefined
  ].filter(Boolean) as string[];

  return {
    ui: {
      visibility: uiVisibility
    }
  };
}

/** Converts typed ChatGPT options into optional OpenAI compatibility metadata. */
function chatGptToolMeta(options: ChatGptToolOptions | undefined): Record<string, unknown> | undefined {
  if (!options) {
    return undefined;
  }

  return stripUndefined({
    "openai/widgetAccessible": options.widgetAccessible,
    "openai/visibility": options.visibility,
    "openai/toolInvocation/invoking": options.invoking,
    "openai/toolInvocation/invoked": options.invoked,
    "openai/fileParams": options.fileParams ? [...options.fileParams] : undefined
  });
}

/** Merges descriptor metadata while preserving nested standard `ui` metadata. */
function mergeMeta(
  ...entries: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {};

  for (const entry of entries) {
    if (!entry) {
      continue;
    }

    for (const [key, value] of Object.entries(entry)) {
      if (key === "ui" && isRecord(value) && isRecord(merged.ui)) {
        merged.ui = { ...merged.ui, ...value };
      } else {
        merged[key] = value;
      }
    }
  }

  return Object.keys(merged).length ? stripUndefined(merged) : undefined;
}

/** Returns true for plain metadata objects. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** JSON Schema for a tool with no input parameters. */
export function emptyObjectSchema(): JsonSchema {
  return {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  };
}

/** Converts a human tool name into a stable MCP machine name. */
export function toMachineName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .toLowerCase();
}

/** Throws when a machine tool id is not MCP-safe. */
export function validateToolId(id: string): void {
  if (
    !/^[A-Za-z0-9._-]{1,128}$/.test(id) ||
    id === "." ||
    id === ".." ||
    id.includes("/..") ||
    id.includes("../")
  ) {
    throw new SidecarDefinitionError(
      `Invalid tool id "${id}". Tool ids must be 1-128 ASCII letters, digits, dots, hyphens, or underscores.`
    );
  }
}

/** Throws when a resource URI is not a valid absolute URI. */
export function validateResourceUri(uri: string): void {
  try {
    const parsed = new URL(uri);
    if (!parsed.protocol || parsed.hash) {
      throw new Error("invalid uri");
    }
  } catch {
    throw new SidecarDefinitionError(
      `Invalid resource uri "${uri}". Resource URIs must be absolute and must not include fragments.`
    );
  }
}

/** Throws when a prompt machine name is not MCP-safe. */
export function validatePromptName(name: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(name) || name === "." || name === "..") {
    throw new SidecarDefinitionError(
      `Invalid prompt name "${name}". Prompt names must be 1-128 ASCII letters, digits, dots, hyphens, or underscores.`
    );
  }
}

/** Applies conservative annotation defaults when a tool omits them. */
export function withAnnotationDefaults(annotations: ToolAnnotations | undefined): ToolAnnotations {
  const readOnlyHint = annotations?.readOnlyHint ?? false;

  return {
    title: annotations?.title,
    readOnlyHint,
    destructiveHint: annotations?.destructiveHint ?? !readOnlyHint,
    idempotentHint: annotations?.idempotentHint ?? false,
    openWorldHint: annotations?.openWorldHint ?? true
  };
}

/** Error thrown for invalid Sidecar declarations. */
export class SidecarDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarDefinitionError";
  }
}

/** Error thrown while executing a tool. */
export class SidecarRuntimeError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "SidecarRuntimeError";
  }
}

/** Runs optional runtime schema validation before tool execution. */
function validateParams<Params>(sidecarTool: SidecarTool<Params>, params: unknown): Params {
  if (!sidecarTool.params) {
    return (params ?? {}) as Params;
  }

  const parsed = sidecarTool.params.safeParse(params ?? {});
  if (parsed.success) {
    return parsed.data;
  }

  throw new SidecarRuntimeError(`Invalid parameters for tool "${sidecarTool.name}".`, "invalid_tool_params");
}

/** Normalizes required user-friendly result content into MCP content blocks. */
function normalizeRequiredContent(content: ToolResultContent): McpContentBlock[] {
  if (typeof content === "string") {
    return [toolResult.text(content)];
  }
  const blocks = Array.isArray(content) ? content : [content];
  if (blocks.length > 0) {
    return blocks;
  }

  throw new SidecarRuntimeError(
    "toolResult({ content }) must include at least one MCP content block.",
    "invalid_tool_result",
  );
}

/** Converts one friendly resource content item to the MCP wire shape. */
function normalizeResourceContent(
  content: ResourceResultContentInput,
  uri: string,
  defaultMimeType?: string,
): McpResourceContent {
  const annotations = normalizeAnnotations(content.annotations);
  const meta = content.meta;
  if (isBinaryLike(content.content)) {
    return stripUndefined({
      uri,
      mimeType: content.mimeType ?? defaultMimeType ?? "application/octet-stream",
      blob: bytesToBase64(content.content),
      annotations,
      _meta: meta,
    });
  }

  if (typeof content.content === "string") {
    return stripUndefined({
      uri,
      mimeType: content.mimeType ?? defaultMimeType ?? "text/plain",
      text: content.content,
      annotations,
      _meta: meta,
    });
  }

  return stripUndefined({
    uri,
    mimeType: content.mimeType ?? defaultMimeType ?? "application/json",
    text: JSON.stringify(content.content),
    annotations,
    _meta: meta,
  });
}

/** Returns true for byte containers that MCP resources must expose as base64 blobs. */
function isBinaryLike(value: unknown): value is Uint8Array | ArrayBuffer {
  return value instanceof ArrayBuffer || value instanceof Uint8Array;
}

/** Encodes bytes as base64 in Node and browser-compatible runtimes. */
function bytesToBase64(value: Uint8Array | ArrayBuffer): string {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Encodes an offset as an opaque base64url cursor. */
function encodeOffsetCursor(offset: number): string {
  return base64UrlEncode(JSON.stringify({ offset }));
}

/** Decodes an opaque offset cursor produced by `offsetPagination()`. */
function decodeOffsetCursor(cursor: string): number {
  try {
    const decoded = JSON.parse(base64UrlDecode(cursor)) as { offset?: unknown };
    if (typeof decoded.offset !== "number" || !Number.isInteger(decoded.offset) || decoded.offset < 0) {
      throw new Error("invalid offset");
    }
    return decoded.offset;
  } catch {
    throw new SidecarRuntimeError("Invalid pagination cursor.", "invalid_pagination_cursor");
  }
}

/** Base64url-encodes UTF-8 text in Node and browser-compatible runtimes. */
function base64UrlEncode(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf8").toString("base64url");
  }
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

/** Base64url-decodes UTF-8 text in Node and browser-compatible runtimes. */
function base64UrlDecode(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64url").toString("utf8");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

/** Converts Date annotations to the protocol's ISO timestamp string. */
function normalizeAnnotations(
  annotations: ResourceAnnotations | undefined,
): ResourceAnnotations | undefined {
  if (!annotations) {
    return undefined;
  }

  return stripUndefined({
    audience: annotations.audience ? [...annotations.audience] : undefined,
    priority: annotations.priority,
    lastModified: annotations.lastModified instanceof Date
      ? annotations.lastModified.toISOString()
      : annotations.lastModified,
  });
}

/** Converts friendly prompt argument declarations to MCP descriptors. */
function promptArguments(args: PromptArgsDefinition | undefined): McpPromptArgument[] | undefined {
  if (!args) {
    return undefined;
  }

  const entries = Object.entries(args).map(([name, value]) => {
    if (typeof value === "string") {
      return { name, description: value, required: true };
    }
    if (isReadonlyArray(value)) {
      return {
        name,
        description: value.length
          ? `One of: ${value.map(String).join(", ")}.`
          : undefined,
        required: true,
      };
    }
    return {
      name,
      description: value.description,
      required: value.required ?? true,
    };
  });

  return entries.length ? entries : undefined;
}

/** Narrows readonly argument enum arrays. */
function isReadonlyArray(value: PromptArgInput): value is readonly JsonPrimitive[] {
  return Array.isArray(value);
}

/** Validates required prompt arguments before running a prompt. */
function validatePromptArgs<Args extends Record<string, unknown>>(
  promptDefinition: SidecarPrompt<Args>,
  args: unknown,
): Args {
  const input = args && typeof args === "object" && !Array.isArray(args)
    ? args as Record<string, unknown>
    : {};
  for (const argument of promptArguments(promptDefinition.args) ?? []) {
    if (argument.required !== false && !(argument.name in input)) {
      throw new SidecarRuntimeError(
        `Prompt "${promptDefinition.name ?? promptDefinition.title}" is missing required argument "${argument.name}".`,
        "invalid_prompt_args",
      );
    }
  }
  return input as Args;
}

/** Converts a prompt's friendly return value into MCP messages. */
function normalizePromptResult(value: PromptResultInput, defaultDescription?: string): McpPromptResult {
  if (typeof value === "string") {
    return {
      description: defaultDescription,
      messages: [{
        role: "user",
        content: toolResult.text(value),
      }],
    };
  }

  if (Array.isArray(value)) {
    return {
      description: defaultDescription,
      messages: value,
    };
  }

  if ("messages" in value) {
    return {
      description: value.description ?? defaultDescription,
      messages: value.messages,
    };
  }

  return {
    description: defaultDescription,
    messages: [value],
  };
}

/** Removes `undefined` keys so JSON serialization matches MCP expectations. */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** Recursively removes undefined values from JSON-like result channels. */
function stripJsonUndefined(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => stripJsonUndefined(entry))
      .filter((entry) => entry !== undefined);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, stripJsonUndefined(entry)] as const)
      .filter(([, entry]) => entry !== undefined),
  );
}
