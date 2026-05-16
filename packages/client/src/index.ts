export type HostFeatureResult<T = void> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "unsupported" | "denied" | "cancelled" | "failed";
      message?: string;
    };

export type WidgetToolResult<
  Structured = unknown,
  Meta = Record<string, unknown>,
> = {
  structured: Structured;
  content: unknown[];
  meta: Meta;
};

export type ModelMessage = {
  text: string;
  context?: Record<string, unknown>;
};

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

export type ToolClientShape = object;

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

export const browserBridge = createBrowserBridge();

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

export function getToolResult<
  Structured,
  Meta = Record<string, unknown>,
>(): WidgetToolResult<Structured, Meta> {
  return browserBridge.getToolResult<Structured, Meta>();
}

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

function readStandardBridge(): StandardBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as unknown as { sidecar?: StandardBridge }).sidecar;
}

function readOpenAI(): OpenAIBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as unknown as { openai?: OpenAIBridge }).openai;
}
