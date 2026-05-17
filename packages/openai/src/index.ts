/**
 * Typed ChatGPT compatibility helpers.
 *
 * Sidecar emits standard MCP Apps metadata first. This package exists for the
 * optional ChatGPT fields and runtime globals that still need OpenAI-specific
 * names on the wire.
 */
import type { ChatGptToolOptions } from "@sidecar/core";

/** CSP domains supported by ChatGPT widget metadata. */
export type ChatGptWidgetCsp = {
  /** Domains the widget may contact with fetch/XHR. */
  connectDomains?: readonly string[];
  /** Domains the widget may use for images, fonts, scripts, and styles. */
  resourceDomains?: readonly string[];
  /** Origins allowed for iframe embeds. Omit unless the widget needs subframes. */
  frameDomains?: readonly string[];
  /** Redirect targets for ChatGPT `openExternal` links. */
  redirectDomains?: readonly string[];
};

/** Resource-level ChatGPT widget metadata. */
export type ChatGptWidgetOptions = {
  /** Short host-facing summary of what the rendered widget shows. */
  description?: string;
  /** Preferred dedicated widget origin for broad distribution. */
  domain?: string;
  /** Whether the widget prefers a host-provided border. */
  prefersBorder?: boolean;
  /** CSP allowlists for network, static assets, iframes, and external links. */
  csp?: ChatGptWidgetCsp;
};

/** Standard result shape for ChatGPT-only host features. */
export type ChatGptFeatureResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; reason: "unsupported" | "denied" | "cancelled" | "failed"; message?: string };

/** Display modes exposed by ChatGPT's host bridge. */
export type ChatGptDisplayMode = "inline" | "fullscreen" | "pip";

/** File picker options accepted by ChatGPT's host bridge. */
export type ChatGptFileSelectOptions = {
  accept?: string[];
  multiple?: boolean;
};

/** Widget result state exposed by ChatGPT's host bridge. */
export type ChatGptToolResult<
  Structured = unknown,
  Meta = Record<string, unknown>,
> = {
  structuredContent: Structured | undefined;
  content: unknown[];
  meta: Meta;
  _meta?: Meta;
};

/** ChatGPT-only `window.openai` bridge shape used by this package. */
export type ChatGptBridge = {
  callTool?: (name: string, params: Record<string, unknown>) => Promise<unknown>;
  sendFollowUpMessage?: (message: { text: string }) => Promise<void>;
  setWidgetState?: (context: Record<string, unknown>) => Promise<void>;
  requestDisplayMode?: (request: { mode: ChatGptDisplayMode }) => Promise<void>;
  openExternal?: (request: { href: string }) => Promise<void>;
  selectFiles?: (options: ChatGptFileSelectOptions) => Promise<File[]>;
  toolOutput?: unknown;
  toolResponseMetadata?: Record<string, unknown>;
};

/** Namespace matching the user-facing platform name. */
export const chatgpt = {
  /** Returns typed tool options for `tool({ hosts: { chatgpt: ... } })`. */
  tool(options: ChatGptToolOptions): ChatGptToolOptions {
    return options;
  },

  /** Returns resource metadata for custom resource emitters. */
  widget(options: ChatGptWidgetOptions): Record<string, unknown> {
    return chatGptWidgetMeta(options);
  },

  /** ChatGPT-only runtime capabilities backed by `window.openai`. */
  runtime: {
    /** Returns true when ChatGPT's host-specific bridge is present. */
    available(): boolean {
      return Boolean(readChatGptBridge());
    },

    /** Calls a tool through ChatGPT's host-specific bridge. Prefer standard MCP Apps calls when portable. */
    async callTool<TParams extends Record<string, unknown>, Structured = unknown>(
      name: string,
      params: TParams,
    ): Promise<ChatGptFeatureResult<Structured>> {
      const bridge = readChatGptBridge();
      if (!bridge?.callTool) {
        return unsupported();
      }

      try {
        return { ok: true, value: await bridge.callTool(name, params) as Structured };
      } catch (error) {
        return normalizeHostError<Structured>(error);
      }
    },

    /** Reads the initial tool result values ChatGPT exposes to widgets. */
    toolResult<Structured, Meta = Record<string, unknown>>(): ChatGptToolResult<Structured, Meta> {
      const bridge = readChatGptBridge();
      const meta = (bridge?.toolResponseMetadata ?? {}) as Meta;
      return {
        structuredContent: bridge?.toolOutput as Structured | undefined,
        content: [],
        meta,
        _meta: meta,
      };
    },

    /** Sends a follow-up user message through ChatGPT's host-specific bridge. */
    async sendFollowUpMessage(text: string): Promise<ChatGptFeatureResult> {
      const bridge = readChatGptBridge();
      if (!bridge?.sendFollowUpMessage) {
        return unsupported();
      }

      try {
        await bridge.sendFollowUpMessage({ text });
        return { ok: true, value: undefined };
      } catch (error) {
        return normalizeHostError(error);
      }
    },

    /** Stores widget state through ChatGPT's host-specific bridge. */
    async setWidgetState(context: Record<string, unknown>): Promise<ChatGptFeatureResult> {
      const bridge = readChatGptBridge();
      if (!bridge?.setWidgetState) {
        return unsupported();
      }

      try {
        await bridge.setWidgetState(context);
        return { ok: true, value: undefined };
      } catch (error) {
        return normalizeHostError(error);
      }
    },

    /** Requests an OpenAI-supported widget display mode. */
    async requestDisplayMode(mode: ChatGptDisplayMode): Promise<ChatGptFeatureResult> {
      const bridge = readChatGptBridge();
      if (!bridge?.requestDisplayMode) {
        return unsupported();
      }

      try {
        await bridge.requestDisplayMode({ mode });
        return { ok: true, value: undefined };
      } catch (error) {
        return normalizeHostError(error);
      }
    },

    /** Opens an external URL through ChatGPT's host-specific bridge. */
    async openExternal(url: string): Promise<ChatGptFeatureResult> {
      if (!isAllowedExternalUrl(url)) {
        return {
          ok: false,
          reason: "denied",
          message: "Only http, https, and mailto URLs can be opened externally.",
        };
      }

      const bridge = readChatGptBridge();
      if (!bridge?.openExternal) {
        return unsupported();
      }

      try {
        await bridge.openExternal({ href: url });
        return { ok: true, value: undefined };
      } catch (error) {
        return normalizeHostError(error);
      }
    },

    /** Opens ChatGPT's native file picker. */
    async selectFiles(options: ChatGptFileSelectOptions = {}): Promise<ChatGptFeatureResult<File[]>> {
      const bridge = readChatGptBridge();
      if (!bridge?.selectFiles) {
        return unsupported();
      }

      try {
        return { ok: true, value: await bridge.selectFiles(options) };
      } catch (error) {
        return normalizeHostError<File[]>(error);
      }
    },
  },
};

/** Reads ChatGPT's host-specific bridge. Generic Sidecar packages intentionally do not call this. */
export function readChatGptBridge(): ChatGptBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as unknown as { openai?: ChatGptBridge }).openai;
}

/** Converts typed widget options into standard and ChatGPT compatibility metadata. */
export function chatGptWidgetMeta(options: ChatGptWidgetOptions): Record<string, unknown> {
  return stripUndefined({
    ui: stripUndefined({
      prefersBorder: options.prefersBorder,
      csp: options.csp
        ? stripUndefined({
            connectDomains: options.csp.connectDomains ? [...options.csp.connectDomains] : undefined,
            resourceDomains: options.csp.resourceDomains ? [...options.csp.resourceDomains] : undefined,
            frameDomains: options.csp.frameDomains ? [...options.csp.frameDomains] : undefined,
          })
        : undefined,
    }),
    "openai/widgetDescription": options.description,
    "openai/widgetDomain": options.domain,
    "openai/widgetCSP": options.csp
      ? stripUndefined({
          connect_domains: options.csp.connectDomains ? [...options.csp.connectDomains] : undefined,
          resource_domains: options.csp.resourceDomains ? [...options.csp.resourceDomains] : undefined,
          frame_domains: options.csp.frameDomains ? [...options.csp.frameDomains] : undefined,
          redirect_domains: options.csp.redirectDomains ? [...options.csp.redirectDomains] : undefined,
        })
      : undefined,
  });
}

/** Drops undefined metadata keys before JSON serialization. */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

/** Returns a stable unsupported result for absent ChatGPT-only host APIs. */
function unsupported<T = void>(): ChatGptFeatureResult<T> {
  return { ok: false, reason: "unsupported" };
}

/** Converts host exceptions into stable capability results. */
function normalizeHostError<T = void>(error: unknown): ChatGptFeatureResult<T> {
  if (isAbortError(error)) {
    return { ok: false, reason: "cancelled" };
  }
  if (error instanceof Error) {
    return { ok: false, reason: "failed", message: error.message };
  }
  return { ok: false, reason: "failed" };
}

/** Returns true for browser cancellation errors. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
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

export type { ChatGptToolOptions };
