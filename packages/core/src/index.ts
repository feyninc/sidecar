export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type MaybePromise<T> = T | Promise<T>;

export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource"; resource: JsonObject };

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

export type ToolVisibility = {
  model?: boolean;
  widgets?: boolean | string[];
  tools?: boolean | string[];
};

export type ResultOptions = {
  content?: string | McpContentBlock | McpContentBlock[];
  meta?: Record<string, unknown>;
  isError?: boolean;
};

export type ToolResult<Structured = unknown> = {
  structuredContent?: Structured;
  content?: McpContentBlock[];
  _meta?: Record<string, unknown>;
  isError?: boolean;
};

export type McpToolResult = {
  structuredContent?: unknown;
  content: McpContentBlock[];
  _meta?: Record<string, unknown>;
  isError?: boolean;
};

export type ResultFactory = {
  <Structured>(structured: Structured, options?: ResultOptions): ToolResult<Structured>;
  text(text: string): McpContentBlock;
  error(message: string, options?: Omit<ResultOptions, "content" | "isError">): ToolResult;
};

export type Logger = {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
};

export type Trace = {
  span<T>(name: string, run: () => MaybePromise<T>): Promise<T>;
};

export type ScopedStorage = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
};

export type ToolRequestContext = {
  id: string;
  signal: AbortSignal;
  host: "chatgpt" | "claude" | "codex-plugin" | "claude-plugin" | "unknown";
  transport: "streamable-http" | "stdio";
};

export type ToolContext<Auth = unknown, Services = unknown, Tools = unknown> = {
  auth: Auth;
  request: ToolRequestContext;
  services: Services;
  tools: Tools;
  result: ResultFactory;
  log: Logger;
  trace: Trace;
  storage: ScopedStorage;
  env: Readonly<Record<string, string | undefined>>;
};

export type ZodLikeSchema<T = unknown> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
};

export type InferParams<T> = T extends ZodLikeSchema<infer Output> ? Output : T;

export type ToolExecute<Params, Output, Auth = unknown, Services = unknown, Tools = unknown> = (
  params: Params,
  ctx: ToolContext<Auth, Services, Tools>
) => MaybePromise<Output | ToolResult<Output>>;

export type ToolDefinition<Params = unknown, Output = unknown, Auth = unknown, Services = unknown, Tools = unknown> = {
  /** Human-readable name shown to users and models. Sidecar derives the MCP machine id from it by default. */
  name: string;
  /** Optional MCP machine id. If omitted, Sidecar snake-cases `name`. */
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
  /** Tool implementation. It may be synchronous or asynchronous. */
  execute: ToolExecute<Params, Output, Auth, Services, Tools> | ((params: Params) => MaybePromise<Output | ToolResult<Output>>);
};

export type SidecarTool<Params = unknown, Output = unknown> = ToolDefinition<Params, Output> & {
  readonly kind: "sidecar.tool";
};

export type McpToolDescriptor = {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
};

export type SkillDefinition = {
  /** Stable skill folder/name. */
  name: string;
  /** Short routing description for the host/model. */
  description: string;
  /** Markdown body emitted to SKILL.md. */
  body: string;
};

const toolBrand = Symbol.for("sidecar.tool");
const resultBrand = Symbol.for("sidecar.result");
const skillBrand = Symbol.for("sidecar.skill");

export function tool<Params, Output>(
  definition: ToolDefinition<Params, Output>
): SidecarTool<Params, Output> {
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
  }) as SidecarTool<Params, Output>;
}

export function isSidecarTool(value: unknown): value is SidecarTool {
  return Boolean(value && typeof value === "object" && (value as Record<symbol, unknown>)[toolBrand]);
}

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

export const result: ResultFactory = Object.assign(
  <Structured>(structured: Structured, options: ResultOptions = {}): ToolResult<Structured> => {
    const toolResult: ToolResult<Structured> = {
      structuredContent: structured,
      content: normalizeContent(options.content),
      _meta: options.meta,
      isError: options.isError
    };

    Object.defineProperty(toolResult, resultBrand, {
      enumerable: false,
      value: true
    });

    return toolResult;
  },
  {
    text(text: string): McpContentBlock {
      return { type: "text", text };
    },
    error(message: string, options: Omit<ResultOptions, "content" | "isError"> = {}): ToolResult {
      return result(undefined, {
        ...options,
        content: message,
        isError: true
      });
    }
  }
);

export function isToolResult(value: unknown): value is ToolResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      (resultBrand in value ||
        "structuredContent" in value ||
        "content" in value ||
        "_meta" in value ||
        "isError" in value)
  );
}

export function normalizeToolResult(value: unknown): McpToolResult {
  if (isToolResult(value)) {
    const content = value.content?.length
      ? value.content
      : createStructuredFallback(value.structuredContent);

    return stripUndefined({
      structuredContent: value.structuredContent,
      content,
      _meta: value._meta,
      isError: value.isError
    });
  }

  return stripUndefined({
    structuredContent: value,
    content: createStructuredFallback(value)
  });
}

export async function executeTool<Params, Output>(
  sidecarTool: SidecarTool<Params, Output>,
  params: unknown,
  ctx: ToolContext
): Promise<McpToolResult> {
  const parsedParams = validateParams(sidecarTool, params);
  const value = await sidecarTool.execute(parsedParams, ctx);
  return normalizeToolResult(value);
}

export function createToolDescriptor(definition: {
  name: string;
  id?: string;
  description: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  meta?: Record<string, unknown>;
}): McpToolDescriptor {
  const machineName = definition.id ?? toMachineName(definition.name);

  validateToolId(machineName);

  return stripUndefined({
    name: machineName,
    title: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema ?? emptyObjectSchema(),
    outputSchema: definition.outputSchema,
    annotations: withAnnotationDefaults(definition.annotations),
    _meta: definition.meta
  });
}

export function emptyObjectSchema(): JsonSchema {
  return {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  };
}

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

export function validateToolId(id: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) {
    throw new SidecarDefinitionError(
      `Invalid tool id "${id}". Tool ids must be 1-128 ASCII letters, digits, dots, hyphens, or underscores.`
    );
  }
}

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

export class SidecarDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarDefinitionError";
  }
}

export class SidecarRuntimeError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "SidecarRuntimeError";
  }
}

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

function normalizeContent(content: ResultOptions["content"]): McpContentBlock[] | undefined {
  if (content === undefined) {
    return undefined;
  }
  if (typeof content === "string") {
    return [result.text(content)];
  }
  if (Array.isArray(content)) {
    return content;
  }
  return [content];
}

function createStructuredFallback(value: unknown): McpContentBlock[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return [result.text(value)];
  }
  return [result.text(JSON.stringify(value))];
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
