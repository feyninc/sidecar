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

/** Host families Sidecar can theme and feature-detect at runtime. */
export type SidecarHostName = "chatgpt" | "claude" | "generic";

/** Display theme reported by the host or inferred from browser settings. */
export type SidecarTheme = "light" | "dark";

/** Runtime host information used by React/native packages. */
export type SidecarHostContext = {
  /** Host family currently embedding the widget. */
  name: SidecarHostName;
  /** Light/dark theme for host-aligned native components. */
  theme: SidecarTheme;
  /** Whether the context came from an explicit host bridge rather than fallback inference. */
  source: "sidecar" | "openai" | "claude-css" | "media-query" | "fallback";
  /** Raw host context when a future MCP Apps bridge exposes one. */
  raw?: unknown;
};

/** Listener called when the embedding host changes theme or capability context. */
export type HostContextListener = (context: SidecarHostContext) => void;

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
  getHostContext(): SidecarHostContext;
  subscribeHostContext(listener: HostContextListener): () => void;
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

    getHostContext() {
      return detectHostContext();
    },

    subscribeHostContext(listener) {
      return subscribeHostContext(listener);
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

type StandardBridge = {
  callServerTool?: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
  sendMessage?: (message: ModelMessage) => Promise<void>;
  updateModelContext?: (context: Record<string, unknown>) => Promise<void>;
  toolResult?: WidgetToolResult;
  hostContext?: Partial<SidecarHostContext> & Record<string, unknown>;
};

type OpenAIBridge = {
  callTool?: (name: string, params: Record<string, unknown>) => Promise<unknown>;
  sendFollowUpMessage?: (message: ModelMessage) => Promise<void>;
  setWidgetState?: (context: Record<string, unknown>) => Promise<void>;
  toolOutput?: unknown;
  toolResponseMetadata?: Record<string, unknown>;
};

const hostContextEventNames = [
  "hostcontextchanged",
  "sidecar:hostcontextchanged",
] as const;

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

/** Detects the active widget host without relying on build-time target flags. */
export function detectHostContext(): SidecarHostContext {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { name: "generic", theme: "light", source: "fallback" };
  }

  const standard = readStandardBridge();
  if (standard?.hostContext) {
    return normalizeHostContext(standard.hostContext, "sidecar");
  }

  if (readOpenAI()) {
    return {
      name: "chatgpt",
      theme: inferTheme(),
      source: "openai",
    };
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

/** Subscribes to host context/theme changes from standard events and media queries. */
export function subscribeHostContext(listener: HostContextListener): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const notify = () => listener(detectHostContext());
  for (const eventName of hostContextEventNames) {
    window.addEventListener(eventName, notify);
  }

  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", notify);

  return () => {
    for (const eventName of hostContextEventNames) {
      window.removeEventListener(eventName, notify);
    }
    media?.removeEventListener?.("change", notify);
  };
}

/** Converts unknown host context shapes into Sidecar's stable context contract. */
function normalizeHostContext(
  context: Partial<SidecarHostContext> & Record<string, unknown>,
  source: SidecarHostContext["source"],
): SidecarHostContext {
  const name = context.name === "chatgpt" || context.name === "claude"
    ? context.name
    : "generic";
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
      style.getPropertyValue("--claude-border-color").trim(),
  );
}
