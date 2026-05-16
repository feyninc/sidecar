/**
 * Framework-agnostic widget bridge.
 *
 * This package is intentionally browser/iframe oriented and does not import
 * React. Framework-specific packages wrap these primitives.
 */

/** Standard result shape for host-only capabilities that may not exist everywhere. */
export type HostFeatureResult<T = void> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "unsupported" | "denied" | "cancelled" | "failed";
      message?: string;
    };

/** Tool result data made available to a rendered widget. */
export type WidgetToolResult<
  Structured = unknown,
  Meta = Record<string, unknown>,
> = {
  structured: Structured;
  content: unknown[];
  meta: Meta;
};

/** Message a widget wants to send back into the model conversation. */
export type ModelMessage = {
  text: string;
  context?: Record<string, unknown>;
};

/** Host bridge capabilities available to widget code. */
export type WidgetBridge = {
  callTool<TParams extends Record<string, unknown>, TResult>(
    name: string,
    params: TParams,
  ): Promise<TResult>;
  sendMessage(message: ModelMessage): Promise<HostFeatureResult>;
  updateModelContext(
    context: Record<string, unknown>,
  ): Promise<HostFeatureResult>;
  getToolResult<Structured, Meta = Record<string, unknown>>(): WidgetToolResult<
    Structured,
    Meta
  >;
};

/** Structural constraint for generated typed tool clients. */
export type ToolClientShape = object;

/** Creates a browser bridge that feature-detects standard and ChatGPT globals. */
export function createBrowserBridge(): WidgetBridge {
  return {
    async callTool(name, params) {
      const bridge = readStandardBridge();
      if (bridge?.callServerTool) {
        return bridge.callServerTool(name, params) as Promise<never>;
      }

      const openai = readOpenAI();
      if (openai?.callTool) {
        return openai.callTool(name, params) as Promise<never>;
      }

      throw new Error("This host does not expose widget tool calls.");
    },

    async sendMessage(message) {
      const bridge = readStandardBridge();
      if (bridge?.sendMessage) {
        await bridge.sendMessage(message);
        return { ok: true, value: undefined };
      }

      const openai = readOpenAI();
      if (openai?.sendFollowUpMessage) {
        await openai.sendFollowUpMessage(message);
        return { ok: true, value: undefined };
      }

      return { ok: false, reason: "unsupported" };
    },

    async updateModelContext(context) {
      const bridge = readStandardBridge();
      if (bridge?.updateModelContext) {
        await bridge.updateModelContext(context);
        return { ok: true, value: undefined };
      }

      const openai = readOpenAI();
      if (openai?.setWidgetState) {
        await openai.setWidgetState(context);
        return { ok: true, value: undefined };
      }

      return { ok: false, reason: "unsupported" };
    },

    getToolResult() {
      const bridge = readStandardBridge();
      if (bridge?.toolResult) {
        return bridge.toolResult as never;
      }

      const openai = readOpenAI();
      return {
        structured: openai?.toolOutput as never,
        content: [],
        meta: (openai?.toolResponseMetadata ?? {}) as never,
      };
    },
  };
}

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
        const method = property as Extract<keyof TTools, string>;
        return (params: Record<string, unknown>) =>
          bridge.callTool(String(names[method]), params);
      },
    },
  ) as TTools;
}

type StandardBridge = {
  callServerTool?: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
  sendMessage?: (message: ModelMessage) => Promise<void>;
  updateModelContext?: (context: Record<string, unknown>) => Promise<void>;
  toolResult?: WidgetToolResult;
};

type OpenAIBridge = {
  callTool?: (name: string, params: Record<string, unknown>) => Promise<unknown>;
  sendFollowUpMessage?: (message: ModelMessage) => Promise<void>;
  setWidgetState?: (context: Record<string, unknown>) => Promise<void>;
  toolOutput?: unknown;
  toolResponseMetadata?: Record<string, unknown>;
};

/** Reads a future standard Sidecar bridge from `window.sidecar`. */
function readStandardBridge(): StandardBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as unknown as { sidecar?: StandardBridge }).sidecar;
}

/** Reads the ChatGPT-specific bridge from `window.openai` when present. */
function readOpenAI(): OpenAIBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as unknown as { openai?: OpenAIBridge }).openai;
}
