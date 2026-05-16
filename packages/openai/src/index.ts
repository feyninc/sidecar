/**
 * Typed ChatGPT compatibility helpers.
 *
 * Sidecar emits standard MCP Apps metadata first. This package exists for the
 * optional ChatGPT fields that still need OpenAI-specific names on the wire.
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
};

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

export type { ChatGptToolOptions };
