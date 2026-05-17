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

/** Project-level metadata declared from `sidecar.config.ts`. */
export type SidecarConfig = {
  /** Human-readable app/server name used in generated manifests. */
  name: string;
  /** Semver-ish app version used in generated manifests and plugin output. */
  version: string;
  /** Short app description used by hosts and generated install docs. */
  description: string;
};

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
  /** Standard MCP Apps CSP allowlists. */
  csp?: WidgetCspOptions;
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
const toolResultBrand = Symbol.for("sidecar.toolResult");
const skillBrand = Symbol.for("sidecar.skill");

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

  return Object.freeze({
    ...definition,
    kind: "sidecar.tool" as const,
    [toolBrand]: true
  }) as SidecarTool<Params, Output, Auth>;
}

/** Returns true when a value was produced by `tool()`. */
export function isSidecarTool(value: unknown): value is SidecarTool {
  return Boolean(value && typeof value === "object" && (value as Record<symbol, unknown>)[toolBrand]);
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

/** Creates and brands one standardized Sidecar tool result. */
function createToolResult<
  Structured,
  Meta extends Record<string, unknown> = Record<string, unknown>,
>(input: ToolResultInput<Structured, Meta>): ToolResult<Structured, Meta> {
  const resultEnvelope = stripUndefined({
    structuredContent: input.structuredContent,
    content: normalizeRequiredContent(input.content),
    _meta: input.meta,
    isError: input.isError
  }) as unknown as ToolResult<Structured, Meta>;

  Object.defineProperty(resultEnvelope, toolResultBrand, {
    enumerable: false,
    value: true
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

/** Converts a branded Sidecar tool result into an MCP-compliant tool result. */
export function normalizeToolResult(value: unknown): McpToolResult {
  if (!isToolResult(value)) {
    throw new SidecarRuntimeError(
      "Tool execute() must return toolResult({ structuredContent, content, meta }).",
      "invalid_tool_result",
    );
  }

  return stripUndefined({
    structuredContent: value.structuredContent,
    content: value.content ?? [],
    _meta: value._meta,
    isError: value.isError
  });
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

/** Removes `undefined` keys so JSON serialization matches MCP expectations. */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
