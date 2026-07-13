/**
 * Local Sidecar dev harness.
 *
 * The harness is a browser-based MCP client plus MCP Apps host simulator. It
 * lets authors iterate on tools and widgets locally without creating an HTTPS
 * tunnel or switching into ChatGPT/Claude for every UI check.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SidecarTarget } from "@sidecar-ai/compiler";

const require = createRequire(import.meta.url);

/** Host skin simulated by the dev harness. */
export type DevHarnessHost = "chatgpt" | "claude" | "generic";

/** Theme simulated by the dev harness. */
export type DevHarnessTheme = "light" | "dark";

/** Device viewport simulated by the dev harness. */
export type DevHarnessDevice = "desktop" | "mobile";

/** Options used to start the dev harness. */
export type DevHarnessOptions = {
  /** Sidecar project root, used only for loading local env files. */
  rootDir: string;
  /** Local MCP Streamable HTTP endpoint. */
  mcpUrl: string;
  /** Initial host recipe selected in the browser UI. */
  host: DevHarnessHost;
  /** Initial light/dark mode selected in the browser UI. */
  theme: DevHarnessTheme;
  /** Initial device viewport selected in the browser UI. */
  device: DevHarnessDevice;
  /** Build target currently served by the MCP process. */
  target: SidecarTarget;
  /** Local port for the browser harness. Use 0 for an ephemeral port. */
  port: number;
  /** OpenAI model used by the local chat loop. */
  model: string;
  /** OpenAI-compatible API key. Defaults to process.env.OPENAI_API_KEY. */
  openAiApiKey?: string;
  /** OpenAI-compatible Chat Completions base URL. Intended for tests/advanced users. */
  openAiBaseUrl?: string;
  /** Initial MCP bearer token for local harness calls. */
  initialBearerToken?: string;
};

/** Running dev harness server handle. */
export type DevHarnessSession = {
  port: number;
  url: string;
  close(): Promise<void>;
};

type HarnessState = {
  host: DevHarnessHost;
  theme: DevHarnessTheme;
  device: DevHarnessDevice;
  target: SidecarTarget;
  model: string;
};

type RpcBody = {
  method?: unknown;
  params?: unknown;
  authToken?: unknown;
};

type ChatBody = {
  messages?: unknown;
  authToken?: unknown;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type OpenAiChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type McpToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
};

type McpToolResult = {
  structuredContent?: unknown;
  content?: unknown[];
  _meta?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
};

type ToolNameMap = {
  byOpenAiName: Map<string, McpToolDescriptor>;
  tools: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
};

type ServerSentEventSink = {
  send(event: string, data: unknown): void;
};

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const MCP_PROTOCOL_VERSION = "2025-11-25";
const MCP_APPS_PROTOCOL_VERSION = "2026-01-26";
const MAX_CHAT_TOOL_ITERATIONS = 4;
let streamdownClientScriptPromise: Promise<string> | undefined;

/** Starts the browser dev harness on localhost. */
export async function startDevHarness(options: DevHarnessOptions): Promise<DevHarnessSession> {
  const state: HarnessState = {
    host: options.host,
    theme: options.theme,
    device: options.device,
    target: options.target,
    model: options.model,
  };
  const stateClients = new Set<ServerResponse>();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        sendHtml(response, renderDevHarnessHtml(state, { initialBearerToken: options.initialBearerToken }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/__sidecar/dev/streamdown-client.js") {
        response.writeHead(200, {
          "cache-control": "no-cache",
          "content-type": "text/javascript; charset=utf-8",
        });
        response.end(await streamdownClientScript());
        return;
      }

      if (request.method === "GET" && url.pathname === "/__sidecar/dev/state") {
        sendJson(response, devStatePayload(state, options.mcpUrl));
        return;
      }

      if (request.method === "POST" && url.pathname === "/__sidecar/dev/state") {
        const body = await readJson(request);
        updateDevState(state, body as Record<string, unknown>);
        sendJson(response, devStatePayload(state, options.mcpUrl));
        broadcastState(stateClients, state, options.mcpUrl);
        return;
      }

      if (request.method === "GET" && url.pathname === "/__sidecar/dev/events") {
        openStateEvents(response, stateClients, state, options.mcpUrl);
        return;
      }

      if (request.method === "GET" && url.pathname === "/__sidecar/dev/resource") {
        const uri = url.searchParams.get("uri");
        const authToken = readBearerFromCookie(request);
        if (!uri) {
          sendJson(response, { error: "missing_resource_uri" }, 400);
          return;
        }
        const resource = await readMcpResource(options.mcpUrl, uri, authToken);
        response.writeHead(200, { "content-type": resource.mimeType ?? "text/html; charset=utf-8" });
        response.end(resource.text ?? "");
        return;
      }

      if (request.method === "POST" && url.pathname === "/__sidecar/dev/rpc") {
        const body = await readJson(request) as RpcBody;
        const method = typeof body.method === "string" ? body.method : undefined;
        if (!method) {
          sendJson(response, { error: "missing_method" }, 400);
          return;
        }
        const result = await callMcp(options.mcpUrl, method, body.params, readAuthToken(body.authToken));
        sendJson(response, { result });
        return;
      }

      if (request.method === "POST" && url.pathname === "/__sidecar/dev/chat") {
        await handleChatRequest(request, response, options);
        return;
      }

      sendJson(response, { error: "not_found" }, 404);
    } catch (error) {
      sendJson(response, normalizeHttpError(error), error instanceof HttpError ? error.status : 500);
    }
  });

  const port = await listenOnLocalhost(server, options.port);
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
  };
}

/** Converts MCP tool descriptors into OpenAI Chat Completions function tools. */
export function mcpToolsToOpenAiTools(tools: readonly McpToolDescriptor[]): ToolNameMap {
  const used = new Set<string>();
  const byOpenAiName = new Map<string, McpToolDescriptor>();
  const openAiTools = tools.map((tool) => {
    const name = uniqueOpenAiToolName(tool.name, used);
    byOpenAiName.set(name, tool);
    return {
      type: "function" as const,
      function: {
        name,
        description: tool.description ?? tool.title ?? tool.name,
        parameters: normalizeToolParameters(tool.inputSchema),
      },
    };
  });

  return { byOpenAiName, tools: openAiTools };
}

/** Returns the widget resource URI advertised by a tool descriptor, when present. */
export function toolResourceUri(tool: McpToolDescriptor): string | undefined {
  const meta = tool._meta;
  const nested = meta?.ui && typeof meta.ui === "object"
    ? (meta.ui as { resourceUri?: unknown }).resourceUri
    : undefined;
  const uri = nested ?? meta?.["ui/resourceUri"] ?? meta?.["openai/outputTemplate"];
  return typeof uri === "string" && uri ? uri : undefined;
}

/** Renders the browser chat harness. */
export function renderDevHarnessHtml(
  state: HarnessState,
  options: { initialBearerToken?: string } = {},
): string {
  return `<!doctype html>
<html lang="en" data-sidecar-host="${state.host}" data-sidecar-theme="${state.theme}" data-sidecar-device="${state.device}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sidecar dev</title>
    <style>
      :root {
        color-scheme: light dark;
        --radius: 12px;
        --bg: #f8f9fa;
        --text: #18181b;
        --panel: #ffffff;
        --panel-soft: #f4f4f5;
        --muted: #71717a;
        --border: #e4e4e7;
        --accent: #2563eb;
        --accent-text: #ffffff;
        --control-bg: #18181b;
        --control-text: #ffffff;
        --send-bg: var(--accent);
        --send-text: var(--accent-text);
        --ring: rgba(37, 99, 235, 0.16);
        --widget-bg: #ffffff;
        --user-bubble-bg: #f4f4f5;
        --code-bg: #f4f4f5;
        --code-inline-bg: rgba(0, 0, 0, 0.04);
        --sidebar-width: 80px;
        --chat-width: 420px;
        --mobile-width: min(430px, calc(100vw - 28px));
        --shadow: 0 16px 48px rgba(0, 0, 0, 0.06);
      }
      :root[data-sidecar-theme="dark"] {
        --bg: #0b0b0f;
        --text: #f4f4f5;
        --panel: #16161a;
        --panel-soft: #1e1e24;
        --muted: #8a8a93;
        --border: #232329;
        --accent: #3b82f6;
        --accent-text: #ffffff;
        --control-bg: #f4f4f5;
        --control-text: #0b0b0f;
        --send-bg: var(--accent);
        --send-text: var(--accent-text);
        --ring: rgba(59, 130, 246, 0.2);
        --widget-bg: #16161a;
        --user-bubble-bg: #1c1c21;
        --code-bg: #121216;
        --code-inline-bg: rgba(255, 255, 255, 0.06);
        --shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
      }
      :root[data-sidecar-host="claude"] {
        --accent: #c96442;
        --accent-text: #fffaf4;
        --ring: rgba(201, 100, 66, 0.2);
      }
      :root[data-sidecar-host="claude"][data-sidecar-theme="dark"] {
        --accent: #d97757;
        --accent-text: #ffffff;
        --ring: rgba(217, 119, 87, 0.24);
      }
      :root[data-sidecar-host="chatgpt"] {
        --accent: #10a37f;
        --accent-text: #ffffff;
        --ring: rgba(16, 163, 127, 0.2);
      }
      * { box-sizing: border-box; }
      *::-webkit-scrollbar { height: 6px; width: 6px; }
      *::-webkit-scrollbar-track { background: transparent; }
      *::-webkit-scrollbar-thumb { background: var(--border); border-radius: 999px; }
      
      body {
        background: var(--bg);
        color: var(--text);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        margin: 0;
        overflow: hidden;
      }
      .shell {
        display: flex;
        height: 100vh;
        min-height: 0;
      }
      .content-shell {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        min-width: 0;
      }
      .topbar {
        align-items: center;
        background: var(--bg);
        border-bottom: 1px solid var(--border);
        display: flex;
        gap: 16px;
        justify-content: space-between;
        min-height: 56px;
        padding: 8px 24px;
      }
      .brand { display: flex; align-items: center; }
      h1 { font-size: 14px; font-weight: 600; letter-spacing: 0; margin: 0; color: var(--text); }
      
      .controls { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-end; }
      .control-group { align-items: center; display: flex; }
      
      .segmented {
        background: var(--panel-soft);
        border: 1px solid var(--border);
        border-radius: 8px;
        display: grid;
        gap: 0;
        grid-template-columns: repeat(var(--segments, 2), 32px);
        padding: 2px;
        position: relative;
      }
      .segmented::before {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 6px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
        content: "";
        inset: 2px auto 2px 2px;
        position: absolute;
        transform: translateX(calc(var(--active-index, 0) * 32px));
        transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
        width: 32px;
      }
      .segmented button, .send, .icon-button, .auth-trigger, .modal-button {
        appearance: none;
        cursor: pointer;
        font: inherit;
        outline: none;
      }
      .segmented button {
        align-items: center;
        background: transparent;
        border: 0;
        border-radius: 6px;
        color: var(--muted);
        display: inline-flex;
        font-weight: 500;
        justify-content: center;
        min-height: 32px;
        min-width: 32px;
        padding: 0;
        position: relative;
        transition: color 140ms ease;
        z-index: 1;
      }
      .segmented button[aria-pressed="true"] {
        color: var(--text);
      }
      .auth-trigger {
        align-items: center;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 8px;
        color: var(--text);
        display: inline-flex;
        font-size: 12px;
        font-weight: 500;
        min-height: 36px;
        padding: 0 14px;
        transition: background 120ms ease, border-color 120ms ease;
      }
      .auth-trigger:hover {
        background: var(--panel-soft);
        border-color: var(--muted);
      }
      .auth-trigger:focus-visible, .modal-button:focus-visible, .modal-close:focus-visible {
        box-shadow: 0 0 0 3px var(--ring);
      }
      .icon {
        align-items: center;
        display: inline-flex;
        height: 16px;
        justify-content: center;
        line-height: 1;
        width: 16px;
      }
      .icon svg {
        display: block;
        height: 16px;
        stroke: currentColor;
        width: 16px;
      }
      .button-text { display: none; }
      
      .modal-input, textarea {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 8px;
        color: var(--text);
        font: inherit;
        outline: 0;
      }
      .modal-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
      .modal-input { min-height: 38px; padding: 0 12px; width: 100%; }
      
      .modal-overlay {
        align-items: center;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        inset: 0;
        justify-content: center;
        opacity: 0;
        padding: 24px;
        pointer-events: none;
        position: fixed;
        transition: opacity 250ms cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 100;
      }
      .modal-overlay[data-open="true"] {
        opacity: 1;
        pointer-events: auto;
      }
      .modal-panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 16px;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.25);
        display: grid;
        gap: 20px;
        max-width: 400px;
        opacity: 0;
        padding: 24px;
        transform: translateY(12px) scale(0.97);
        transition: opacity 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1);
        width: 100%;
      }
      .modal-overlay[data-open="true"] .modal-panel {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      .modal-head {
        align-items: start;
        display: flex;
        gap: 16px;
        justify-content: space-between;
      }
      .modal-title { font-size: 16px; font-weight: 600; letter-spacing: 0; margin: 0; }
      .modal-description { color: var(--muted); font-size: 13px; margin: 4px 0 0; line-height: 1.4; }
      .modal-close {
        align-items: center;
        appearance: none;
        background: transparent;
        border: 0;
        border-radius: 999px;
        color: var(--muted);
        cursor: pointer;
        display: inline-flex;
        height: 24px;
        justify-content: center;
        padding: 0;
        width: 24px;
        transition: background 120ms ease, color 120ms ease;
      }
      .modal-close:hover { background: var(--panel-soft); color: var(--text); }
      .modal-close svg {
        display: block;
        height: 14px;
        width: 14px;
      }
      .modal-field { display: grid; gap: 6px; }
      .modal-label { font-size: 12px; font-weight: 600; color: var(--muted); }
      .modal-error { color: #ef4444; display: none; font-size: 13px; font-weight: 500; }
      .modal-error[data-visible="true"] { display: block; }
      .modal-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
      }
      .modal-button {
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        min-height: 36px;
        padding: 0 14px;
        transition: background 120ms ease, transform 100ms ease;
      }
      .modal-button:active { transform: scale(0.98); }
      .modal-button[data-variant="secondary"] {
        background: transparent;
        border: 1px solid var(--border);
        color: var(--text);
      }
      .modal-button[data-variant="secondary"]:hover {
        background: var(--panel-soft);
      }
      .modal-button[data-variant="primary"] {
        background: var(--control-bg);
        border: 1px solid var(--control-bg);
        color: var(--control-text);
      }
      .modal-button[data-variant="primary"]:hover {
        opacity: 0.9;
      }
      .modal-button:disabled {
        cursor: wait;
        opacity: .68;
      }
      
      .stage {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
      }
      .surface {
        background: var(--bg);
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        margin: 0 auto;
        max-width: 800px;
        width: 100%;
        transition: width 160ms ease, height 160ms ease, border-radius 160ms ease, box-shadow 160ms ease;
      }
      :root[data-sidecar-device="mobile"] .surface {
        border: 1px solid var(--border);
        border-radius: 24px;
        box-shadow: var(--shadow);
        height: min(800px, calc(100dvh - 112px));
        width: var(--mobile-width);
        max-width: var(--mobile-width);
      }
      :root[data-sidecar-device="mobile"] .stage {
        align-items: center;
        display: flex;
        justify-content: center;
        padding: 18px;
      }
      .surface-bar {
        align-items: center;
        background: var(--bg);
        border-bottom: 1px solid var(--border);
        display: flex;
        gap: 10px;
        justify-content: space-between;
        min-height: 48px;
        padding: 0 20px;
      }
      .surface-title { align-items: center; display: flex; gap: 8px; font-weight: 600; font-size: 13px; color: var(--text); }
      .surface-dot {
        background: var(--accent);
        border-radius: 999px;
        box-shadow: 0 0 0 3px var(--ring);
        height: 6px;
        width: 6px;
        transition: background 150ms ease, box-shadow 150ms ease;
      }
      .surface-meta { color: var(--muted); font-size: 11px; font-weight: 500; }
      
      .messages {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        gap: 24px;
        min-height: 0;
        overflow: auto;
        padding: 24px 20px;
        width: 100%;
      }
      .message {
        display: grid;
        flex: 0 0 auto;
        gap: 8px;
        max-width: 100%;
      }
      .message[data-role="user"] {
        background: var(--user-bubble-bg);
        border: 1px solid var(--border);
        border-radius: 16px;
        color: var(--text);
        justify-self: end;
        margin-left: auto;
        max-width: 80%;
        padding: 12px 16px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }
      :root[data-sidecar-device="mobile"] .message[data-role="user"] { max-width: 90%; }
      
      .message[data-role="assistant"] {
        justify-self: start;
        margin-right: auto;
        width: 100%;
        padding: 0 4px;
      }
      .role { display: none; }
      
      .content {
        font-size: 14px;
        line-height: 1.55;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
      }
      .content.error {
        color: #ef4444;
      }
      .content.markdown {
        display: grid;
        gap: 12px;
        white-space: normal;
      }
      .content.markdown p {
        margin: 0;
        line-height: 1.55;
      }
      .content.markdown ul, .content.markdown ol {
        margin: 0;
        padding-left: 20px;
      }
      .content.markdown li {
        margin-bottom: 4px;
      }
      .content.markdown pre {
        background: var(--code-bg);
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: auto;
        padding: 14px;
        margin: 8px 0;
      }
      .content.markdown code {
        background: var(--code-inline-bg);
        border-radius: 4px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 0.88em;
        padding: 2px 5px;
      }
      .content.markdown pre code {
        background: transparent;
        padding: 0;
        font-size: 0.88em;
        line-height: 1.5;
      }
      .content.markdown table {
        border-collapse: collapse;
        display: block;
        max-width: 100%;
        overflow-x: auto;
        margin: 12px 0;
      }
      .content.markdown th, .content.markdown td {
        border: 1px solid var(--border);
        padding: 8px 12px;
        text-align: left;
      }
      .content.markdown th {
        background: var(--panel-soft);
        font-weight: 600;
      }
      
      .tool-card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 14px;
        flex: 0 0 auto;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
        margin: 8px 0;
        width: 100%;
      }
      .tool-head {
        align-items: center;
        background: var(--panel-soft);
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        padding: 10px 14px;
      }
      .tool-title {
        color: var(--text);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0;
      }
      .tool-head .status {
        font-size: 11px;
        font-weight: 500;
        background: rgba(0, 0, 0, 0.04);
        padding: 2px 8px;
        border-radius: 6px;
        color: var(--muted);
      }
      :root[data-sidecar-theme="dark"] .tool-head .status {
        background: rgba(255, 255, 255, 0.05);
      }
      .tool-body {
        background: var(--panel);
        display: grid;
        gap: 10px;
        min-width: 0;
        padding: 14px;
      }
      
      .tool-body iframe {
        background: var(--widget-bg);
        border: 1px solid var(--border);
        border-radius: 10px;
        display: block;
        height: 360px;
        min-height: 0;
        overflow: auto;
        transition: height 120ms ease;
        width: 100%;
      }
      :root[data-sidecar-device="mobile"] .tool-body iframe {
        height: 440px;
      }
      
      .composer {
        background: var(--bg);
        padding: 14px 20px 24px;
        flex: 0 0 auto;
      }
      form {
        display: flex;
        width: 100%;
      }
      .composer-container {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        width: 100%;
        transition: border-color 150ms ease, box-shadow 150ms ease;
      }
      .composer-container:focus-within {
        border-color: var(--accent);
        box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px var(--ring);
      }
      textarea {
        background: transparent;
        border: 0;
        color: var(--text);
        font: inherit;
        font-size: 14px;
        min-height: 56px;
        max-height: 160px;
        padding: 14px 16px 8px;
        resize: none;
        width: 100%;
        outline: none;
      }
      .composer-toolbar {
        align-items: center;
        display: flex;
        justify-content: space-between;
        min-height: 44px;
        padding: 4px 8px 8px 16px;
      }
      .send {
        align-items: center;
        aspect-ratio: 1;
        background: var(--send-bg);
        border: 0;
        border-radius: 999px;
        color: var(--send-text);
        display: inline-flex;
        height: 32px;
        justify-content: center;
        padding: 0;
        width: 32px;
        transition: transform 120ms ease, opacity 120ms ease;
      }
      .send:hover {
        transform: scale(1.04);
        filter: brightness(1.1);
      }
      .send:active {
        transform: scale(0.96);
      }
      .send svg {
        display: block;
        height: 16px;
        stroke-width: 2.5;
        width: 16px;
      }
      .status {
        color: var(--muted);
        font-size: 12px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .status.error {
        color: #ef4444;
      }
      .empty {
        align-self: center;
        color: var(--muted);
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: auto 0;
        max-width: 320px;
        padding: 40px 16px;
        text-align: center;
      }
      .empty strong {
        color: var(--text);
        font-size: 16px;
        font-weight: 500;
        letter-spacing: 0;
      }
      .empty span {
        font-size: 13px;
        line-height: 1.5;
      }
      pre {
        background: var(--panel-soft);
        border-radius: 10px;
        margin: 0;
        overflow: auto;
        padding: 12px;
      }
      @media (max-width: 760px) {
        .shell { display: flex; flex-direction: column; }
        .topbar { align-items: stretch; flex-direction: column; min-height: 0; padding: 12px; }
        .brand { min-width: 0; }
        .controls { justify-content: flex-start; }
        .auth-trigger { min-height: 36px; }
        .stage { display: flex; justify-content: center; padding: 12px; }
        .surface { border: 1px solid var(--border); border-radius: 20px; box-shadow: var(--shadow); width: calc(100vw - 24px); }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="content-shell">
        <div class="topbar">
          <div class="brand">
            <h1>Sidecar dev</h1>
          </div>
          <div class="controls">
            <div class="control-group">
              <div class="segmented" aria-label="Host">
                <button type="button" data-host="chatgpt" aria-label="ChatGPT preview" title="ChatGPT"><span class="icon">${iconSvg("chatgpt")}</span><span class="button-text">ChatGPT</span></button>
                <button type="button" data-host="claude" aria-label="Claude preview" title="Claude"><span class="icon">${iconSvg("claude")}</span><span class="button-text">Claude</span></button>
                <button type="button" data-host="generic" aria-label="Generic MCP preview" title="MCP"><span class="icon">${iconSvg("braces")}</span><span class="button-text">MCP</span></button>
              </div>
            </div>
            <div class="control-group">
              <div class="segmented" aria-label="Theme">
                <button type="button" data-theme="light" aria-label="Light theme" title="Light"><span class="icon">${iconSvg("sun")}</span><span class="button-text">Light</span></button>
                <button type="button" data-theme="dark" aria-label="Dark theme" title="Dark"><span class="icon">${iconSvg("moon")}</span><span class="button-text">Dark</span></button>
              </div>
            </div>
            <div class="control-group">
              <div class="segmented" aria-label="Device">
                <button type="button" data-device="desktop" aria-label="Desktop preview" title="Desktop"><span class="icon">${iconSvg("monitor")}</span><span class="button-text">Desktop</span></button>
                <button type="button" data-device="mobile" aria-label="Mobile preview" title="Mobile"><span class="icon">${iconSvg("phone")}</span><span class="button-text">Mobile</span></button>
              </div>
            </div>
            <button id="authTrigger" class="auth-trigger" type="button" data-token-set="false">
              <span>Set Bearer Token</span>
            </button>
          </div>
        </div>
        <section class="stage">
          <aside class="surface" aria-label="Sidecar chat preview">
            <div class="surface-bar">
              <div class="surface-title"><span class="surface-dot"></span><span id="surfaceTitle">Claude preview</span></div>
              <div id="surfaceMeta" class="surface-meta">Desktop</div>
            </div>
            <section id="messages" class="messages">
              <div class="empty"><strong>Start a local MCP run.</strong><span>Ask for a tool call, then inspect model text and widget output here.</span></div>
            </section>
            <section class="composer">
              <form id="chatForm">
                <div class="composer-container">
                  <textarea id="prompt" placeholder="Ask a question or request a tool call..."></textarea>
                  <div class="composer-toolbar">
                    <div id="status" class="status"></div>
                    <button class="send" type="submit" aria-label="Send">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 19V5" />
                        <path d="m5 12 7-7 7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </form>
            </section>
          </aside>
        </section>
      </section>
    </main>
    <div id="authModal" class="modal-overlay" data-open="false" aria-hidden="true">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="authModalTitle" aria-describedby="authModalDescription">
        <div class="modal-head">
          <div>
            <h2 id="authModalTitle" class="modal-title">Set bearer token</h2>
            <p id="authModalDescription" class="modal-description">Sidecar will test this token against the local MCP server before saving it.</p>
          </div>
          <button id="authClose" class="modal-close" type="button" aria-label="Close bearer token dialog">${iconSvg("x")}</button>
        </div>
        <label class="modal-field" for="authToken">
          <span class="modal-label">Bearer token</span>
          <input id="authToken" class="modal-input" type="password" autocomplete="off" placeholder="Paste a bearer token" />
        </label>
        <div id="authError" class="modal-error" role="status"></div>
        <div class="modal-actions">
          <button id="authCancel" class="modal-button" data-variant="secondary" type="button">Cancel</button>
          <button id="authSave" class="modal-button" data-variant="primary" type="button">Save</button>
        </div>
      </section>
    </div>
    <script>
      ${devHarnessBrowserScript(options.initialBearerToken)}
    </script>
  </body>
</html>`;
}

const lobeIconCache = new Map<string, string>();

function iconSvg(name: "braces" | "chatgpt" | "claude" | "monitor" | "moon" | "phone" | "sun" | "x"): string {
  const common = `viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  switch (name) {
    case "chatgpt":
      return lobeIconSvg("openai.svg") ?? `<svg ${common}><path d="M7.5 8.5a5 5 0 0 1 8.6-3.5 4.2 4.2 0 0 1 5.1 5.1 5 5 0 0 1-3.6 8.5 4.2 4.2 0 0 1-6.8 2.2 5 5 0 0 1-8-4.3 4.2 4.2 0 0 1-1-6.9 5 5 0 0 1 5.7-1.1Z"/></svg>`;
    case "claude":
      return lobeIconSvg("claude.svg") ?? `<svg ${common}><path d="M12 3v18"/><path d="m5.6 5.6 12.8 12.8"/><path d="M3 12h18"/><path d="M5.6 18.4 18.4 5.6"/></svg>`;
    case "braces":
      return `<svg ${common}><path d="M8 4c-2 1.3-3 2.8-3 4.7v1.1c0 1-.7 1.8-1.7 2.2C4.3 12.4 5 13.2 5 14.2v1.1c0 1.9 1 3.4 3 4.7"/><path d="M16 4c2 1.3 3 2.8 3 4.7v1.1c0 1 .7 1.8 1.7 2.2-1 .4-1.7 1.2-1.7 2.2v1.1c0 1.9-1 3.4-3 4.7"/></svg>`;
    case "sun":
      return `<svg ${common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
    case "moon":
      return `<svg ${common}><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 7 7 0 1 0 20.5 14.5Z"/></svg>`;
    case "monitor":
      return `<svg ${common}><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/></svg>`;
    case "phone":
      return `<svg ${common}><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/></svg>`;
    case "x":
      return `<svg ${common}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  }
}

function lobeIconSvg(fileName: string): string | undefined {
  const cached = lobeIconCache.get(fileName);
  if (cached) {
    return cached;
  }

  try {
    const file = require.resolve(`@lobehub/icons-static-svg/icons/${fileName}`);
    const svg = readFileSync(file, "utf8")
      .replace(/\s+xmlns="[^"]*"/, "")
      .replace("<svg ", '<svg aria-hidden="true" ');
    lobeIconCache.set(fileName, svg);
    return svg;
  } catch {
    return undefined;
  }
}

async function handleChatRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: DevHarnessOptions,
): Promise<void> {
  const body = await readJson(request) as ChatBody;
  const messages = readChatMessages(body.messages);
  const authToken = readAuthToken(body.authToken);
  const apiKey = options.openAiApiKey ?? process.env.OPENAI_API_KEY;

  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  const sink = createSseSink(response);

  if (!apiKey) {
    sink.send("error", {
      message: "OPENAI_API_KEY is required for sidecar dev chat.",
    });
    response.end();
    return;
  }

  try {
    const mcpTools = await listAllMcpTools(options.mcpUrl, authToken);
    const toolMap = mcpToolsToOpenAiTools(mcpTools);
    await streamChatWithTools({
      apiKey,
      baseUrl: options.openAiBaseUrl ?? process.env.OPENAI_BASE_URL ?? OPENAI_CHAT_COMPLETIONS_URL,
      model: options.model,
      messages: toOpenAiMessages(messages),
      tools: toolMap,
      mcpUrl: options.mcpUrl,
      authToken,
      sink,
    });
    sink.send("done", {});
  } catch (error) {
    sink.send("error", normalizeHttpError(error));
  } finally {
    response.end();
  }
}

async function streamChatWithTools(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: OpenAiChatMessage[];
  tools: ToolNameMap;
  mcpUrl: string;
  authToken?: string;
  sink: ServerSentEventSink;
}): Promise<void> {
  const messages = [...options.messages];
  for (let iteration = 0; iteration < MAX_CHAT_TOOL_ITERATIONS; iteration += 1) {
    const assistant = await streamOpenAiChat({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      messages,
      tools: options.tools.tools,
      sink: options.sink,
    });
    messages.push(assistant.message);

    if (!assistant.toolCalls.length) {
      return;
    }

    for (const toolCall of assistant.toolCalls) {
      const descriptor = options.tools.byOpenAiName.get(toolCall.function.name);
      if (!descriptor) {
        throw new HttpError(500, `Unknown model tool call "${toolCall.function.name}".`);
      }
      const args = parseToolArguments(toolCall.function.arguments);
      options.sink.send("tool_start", {
        id: toolCall.id,
        name: descriptor.name,
        title: descriptor.title ?? descriptor.name,
        arguments: args,
      });
      const result = await callMcp(
        options.mcpUrl,
        "tools/call",
        { name: descriptor.name, arguments: args },
        options.authToken,
      ) as McpToolResult;
      options.sink.send("tool_result", {
        id: toolCall.id,
        tool: {
          name: descriptor.name,
          title: descriptor.title ?? descriptor.name,
          resourceUri: toolResourceUri(descriptor),
        },
        result,
      });
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResultForModel(result),
      });
    }
  }

  throw new HttpError(500, "The model kept requesting tools and hit the dev harness iteration limit.");
}

async function streamOpenAiChat(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: OpenAiChatMessage[];
  tools: ToolNameMap["tools"];
  sink: ServerSentEventSink;
}): Promise<{ message: OpenAiChatMessage; toolCalls: OpenAiToolCall[] }> {
  const response = await fetch(options.baseUrl, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
      tools: options.tools,
      tool_choice: "auto",
    }),
  });
  if (!response.ok || !response.body) {
    throw new HttpError(
      response.status,
      `OpenAI chat request failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }

  let content = "";
  const toolCalls = new Map<number, OpenAiToolCall>();
  for await (const event of readOpenAiSse(response.body)) {
    if (event === "[DONE]") {
      break;
    }
    const parsed = JSON.parse(event) as {
      choices?: Array<{
        delta?: {
          content?: string;
          tool_calls?: Array<{
            index: number;
            id?: string;
            type?: "function";
            function?: {
              name?: string;
              arguments?: string;
            };
          }>;
        };
      }>;
    };
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) {
      continue;
    }
    if (delta.content) {
      content += delta.content;
      options.sink.send("delta", { text: delta.content });
    }
    for (const chunk of delta.tool_calls ?? []) {
      const current = toolCalls.get(chunk.index) ?? {
        id: chunk.id ?? `call_${chunk.index}`,
        type: "function" as const,
        function: {
          name: "",
          arguments: "",
        },
      };
      current.id = chunk.id ?? current.id;
      current.type = chunk.type ?? current.type;
      current.function.name += chunk.function?.name ?? "";
      current.function.arguments += chunk.function?.arguments ?? "";
      toolCalls.set(chunk.index, current);
    }
  }

  const calls = [...toolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, call]) => call);

  return {
    message: {
      role: "assistant",
      content: content || null,
      ...(calls.length ? { tool_calls: calls } : {}),
    },
    toolCalls: calls,
  };
}

async function* readOpenAiSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = value;
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith("data:")) {
          yield line.slice(5).trim();
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const line of buffer.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        yield line.slice(5).trim();
      }
    }
  }
}

async function listAllMcpTools(mcpUrl: string, authToken?: string): Promise<McpToolDescriptor[]> {
  const tools: McpToolDescriptor[] = [];
  let cursor: string | undefined;
  do {
    const result = await callMcp(
      mcpUrl,
      "tools/list",
      cursor ? { cursor } : {},
      authToken,
    ) as { tools?: McpToolDescriptor[]; nextCursor?: string };
    tools.push(...(result.tools ?? []));
    cursor = result.nextCursor;
  } while (cursor);
  return tools;
}

async function readMcpResource(
  mcpUrl: string,
  uri: string,
  authToken?: string,
): Promise<{ text?: string; mimeType?: string }> {
  const result = await callMcp(mcpUrl, "resources/read", { uri }, authToken) as {
    contents?: Array<{ text?: string; mimeType?: string }>;
  };
  const content = result.contents?.find((entry) => typeof entry.text === "string") ?? result.contents?.[0];
  return {
    text: content?.text ?? "",
    mimeType: content?.mimeType,
  };
}

async function callMcp(
  mcpUrl: string,
  method: string,
  params: unknown,
  authToken?: string,
): Promise<unknown> {
  const requestId = randomUUID();
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "accept": "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method,
      params,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, `MCP ${method} failed with HTTP ${response.status}: ${text}`);
  }
  const json = parseMcpResponse(text, response.headers.get("content-type"), requestId) as {
    result?: unknown;
    error?: {
      message?: string;
    };
  };
  if (json.error) {
    throw new HttpError(502, json.error.message ?? `MCP ${method} returned an error.`);
  }
  return json.result;
}

/** Reads either a plain JSON response or the final JSON-RPC message in an MCP SSE response. */
function parseMcpResponse(text: string, contentType: string | null, requestId: string): unknown {
  if (!contentType?.toLowerCase().includes("text/event-stream")) {
    return JSON.parse(text);
  }

  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data.trim()) continue;
    const message = JSON.parse(data) as { id?: unknown };
    if (message && typeof message === "object" && message.id === requestId) {
      return message;
    }
  }

  throw new Error(`MCP response stream did not contain a result for request "${requestId}".`);
}

function toOpenAiMessages(messages: ChatMessage[]): OpenAiChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are Sidecar dev, a local test harness for an MCP server.",
        "Use the available MCP tools whenever they are relevant.",
        "When a tool renders UI, keep your text concise because the harness displays the widget separately.",
        "Do not claim to be ChatGPT or Claude; the host selector only changes widget styling.",
      ].join(" "),
    },
    ...messages.map((message): OpenAiChatMessage => ({
      role: message.role,
      content: message.content,
    })),
  ];
}

function readChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): ChatMessage[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return [];
    }
    return [{ role, content }];
  });
}

function normalizeToolParameters(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  const record = schema as Record<string, unknown>;
  if (record.type === "object" || record.properties) {
    return record;
  }
  return {
    type: "object",
    properties: {},
  };
}

function uniqueOpenAiToolName(name: string, used: Set<string>): string {
  const base = name
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[-_]+/, "")
    .slice(0, 58) || "tool";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const tag = `_${suffix}`;
    candidate = `${base.slice(0, 64 - tag.length)}${tag}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function parseToolArguments(value: string): Record<string, unknown> {
  if (!value.trim()) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function toolResultForModel(result: McpToolResult): string {
  const text = (result.content ?? [])
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
        return (block as { text: string }).text;
      }
      return JSON.stringify(block);
    })
    .filter(Boolean)
    .join("\n");
  const structured = result.structuredContent === undefined
    ? ""
    : `\n\nstructuredContent:\n${JSON.stringify(result.structuredContent, null, 2)}`;
  return `${text || "Tool returned no model-visible content."}${structured}`.slice(0, 80_000);
}

function createSseSink(response: ServerResponse): ServerSentEventSink {
  return {
    send(event, data) {
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(data)}\n\n`);
    },
  };
}

function updateDevState(state: HarnessState, body: Record<string, unknown>): void {
  if (body.host === "chatgpt" || body.host === "claude" || body.host === "generic") {
    state.host = body.host;
  }
  if (body.theme === "light" || body.theme === "dark") {
    state.theme = body.theme;
  }
  if (body.device === "desktop" || body.device === "mobile") {
    state.device = body.device;
  }
}

function devStatePayload(state: HarnessState, mcpUrl: string): Record<string, unknown> {
  return {
    host: state.host,
    theme: state.theme,
    device: state.device,
    target: state.target,
    model: state.model,
    mcpUrl,
  };
}

function openStateEvents(
  response: ServerResponse,
  clients: Set<ServerResponse>,
  state: HarnessState,
  mcpUrl: string,
): void {
  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });
  clients.add(response);
  createSseSink(response).send("state", devStatePayload(state, mcpUrl));
  response.on("close", () => clients.delete(response));
}

function broadcastState(
  clients: Set<ServerResponse>,
  state: HarnessState,
  mcpUrl: string,
): void {
  for (const client of clients) {
    createSseSink(client).send("state", devStatePayload(state, mcpUrl));
  }
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function sendJson(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 2_000_000) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function readAuthToken(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBearerFromCookie(request: IncomingMessage): string | undefined {
  const cookie = request.headers.cookie;
  if (!cookie) {
    return undefined;
  }
  const match = cookie.match(/(?:^|;\s*)sidecar_dev_bearer=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function normalizeHttpError(error: unknown): Record<string, unknown> {
  if (error instanceof HttpError) {
    return {
      error: "sidecar_dev_error",
      status: error.status,
      message: error.message,
    };
  }
  return {
    error: "sidecar_dev_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function listenOnLocalhost(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address() as AddressInfo | null;
      if (!address) {
        reject(new Error("Dev harness did not expose a bound address."));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function streamdownClientScript(): Promise<string> {
  streamdownClientScriptPromise ??= buildStreamdownClientScript();
  return await streamdownClientScriptPromise;
}

async function buildStreamdownClientScript(): Promise<string> {
  const { build } = await import("esbuild");
  const result = await build({
    bundle: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
    },
    format: "iife",
    globalName: "SidecarStreamdownBundle",
    jsx: "automatic",
    platform: "browser",
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { Streamdown } from "streamdown";

        const roots = new WeakMap();
        window.SidecarStreamdown = {
          render(element, markdown) {
            let root = roots.get(element);
            if (!root) {
              root = createRoot(element);
              roots.set(element, root);
            }
            root.render(React.createElement(Streamdown, { parseIncompleteMarkdown: true }, markdown));
          }
        };
      `,
      loader: "tsx",
      resolveDir: path.dirname(fileURLToPath(import.meta.url)),
    },
    write: false,
  });
  const output = result.outputFiles[0]?.text;
  if (!output) {
    throw new Error("Failed to build the Sidecar dev markdown renderer.");
  }
  return output;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function devHarnessBrowserScript(initialBearerToken: string | undefined): string {
  return String.raw`
const MCP_APPS_PROTOCOL_VERSION = ${JSON.stringify(MCP_APPS_PROTOCOL_VERSION)};
const state = {
  host: document.documentElement.dataset.sidecarHost || "chatgpt",
  theme: document.documentElement.dataset.sidecarTheme || "light",
  device: document.documentElement.dataset.sidecarDevice || "desktop",
};
const messages = [];
const frameContexts = new Map();
const markdownSources = new WeakMap();
let markdownRendererPromise;
const messagesEl = document.getElementById("messages");
const form = document.getElementById("chatForm");
const promptEl = document.getElementById("prompt");
const statusEl = document.getElementById("status");
const authEl = document.getElementById("authToken");
const authTriggerEl = document.getElementById("authTrigger");
const authModalEl = document.getElementById("authModal");
const authCloseEl = document.getElementById("authClose");
const authCancelEl = document.getElementById("authCancel");
const authSaveEl = document.getElementById("authSave");
const authErrorEl = document.getElementById("authError");
const surfaceTitleEl = document.getElementById("surfaceTitle");
const surfaceMetaEl = document.getElementById("surfaceMeta");
const initialBearerToken = ${JSON.stringify(initialBearerToken ?? "")};
let bearerToken = initialBearerToken || localStorage.getItem("sidecar.dev.bearer") || "";

authEl.value = bearerToken;
setAuthCookie(bearerToken);
updateAuthTrigger();
authTriggerEl.addEventListener("click", openAuthModal);
authCloseEl.addEventListener("click", closeAuthModal);
authCancelEl.addEventListener("click", closeAuthModal);
authSaveEl.addEventListener("click", saveBearerToken);
authModalEl.addEventListener("click", (event) => {
  if (event.target === authModalEl) {
    closeAuthModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && authModalEl.dataset.open === "true") {
    closeAuthModal();
  }
});

const resizePrompt = () => {
  promptEl.style.height = "auto";
  promptEl.style.height = promptEl.scrollHeight + "px";
};
promptEl.addEventListener("input", resizePrompt);
promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
resizePrompt();

document.querySelectorAll("[data-host]").forEach((button) => {
  button.addEventListener("click", () => setState({ host: button.dataset.host }));
});
document.querySelectorAll("[data-theme]").forEach((button) => {
  button.addEventListener("click", () => setState({ theme: button.dataset.theme }));
});
document.querySelectorAll("[data-device]").forEach((button) => {
  button.addEventListener("click", () => setState({ device: button.dataset.device }));
});

const events = new EventSource("/__sidecar/dev/events");
events.addEventListener("state", (event) => {
  applyState(JSON.parse(event.data));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptEl.value.trim();
  if (!text) return;
  promptEl.value = "";
  resizePrompt();
  clearEmpty();
  messages.push({ role: "user", content: text });
  appendMessage("user", text);
  statusEl.classList.remove("error");
  statusEl.textContent = "Thinking...";
  try {
    await streamChat();
    statusEl.classList.remove("error");
    statusEl.textContent = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusEl.classList.remove("error");
    statusEl.textContent = "";
    const assistant = appendMessage("assistant", "");
    const assistantError = renderAssistantError(assistant.querySelector(".content"), message);
    messages.push({ role: "assistant", content: assistantError });
  }
});

window.addEventListener("message", async (event) => {
  const message = event.data;
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return;
  }
  const frame = [...frameContexts.entries()].find(([source]) => source === event.source);
  const context = frame?.[1];
  try {
    if (message.method === "ui/initialize") {
      respond(event.source, message.id, {
        protocolVersion: MCP_APPS_PROTOCOL_VERSION,
        hostInfo: { name: "Sidecar dev", version: "0.0.0-dev" },
        hostCapabilities: hostCapabilities(),
        hostContext: hostContext(),
      });
      return;
    }
    if (message.method === "ui/notifications/initialized") {
      sendFrameContext(event.source);
      return;
    }
    if (message.method === "tools/call") {
      const result = await rpc("tools/call", message.params);
      respond(event.source, message.id, result);
      return;
    }
    if (message.method === "resources/list" || message.method === "resources/read") {
      const result = await rpc(message.method, message.params);
      respond(event.source, message.id, result);
      return;
    }
    if (message.method === "ui/open-link") {
      const url = message.params?.url;
      if (typeof url === "string" && /^(https?:|mailto:)/.test(url)) {
        window.open(url, "_blank", "noopener,noreferrer");
        respond(event.source, message.id, { isError: false });
      } else {
        respond(event.source, message.id, { isError: true });
      }
      return;
    }
    if (message.method === "ui/request-display-mode") {
      respond(event.source, message.id, { mode: message.params?.mode || "inline" });
      return;
    }
    if (message.method === "ui/notifications/size-changed") {
      const requestedHeight = Number(message.params?.height);
      const iframe = [...document.querySelectorAll(".tool-body iframe")]
        .find((candidate) => candidate.contentWindow === event.source);
      if (iframe && Number.isFinite(requestedHeight) && requestedHeight > 0) {
        iframe.style.height = Math.min(2000, Math.max(120, Math.ceil(requestedHeight))) + "px";
        iframe.dataset.autoSized = "true";
      }
      return;
    }
    if (message.method === "ui/message" || message.method === "ui/update-model-context") {
      respond(event.source, message.id, { isError: false });
      return;
    }
    if (message.method.startsWith("ui/notifications/") || message.method === "notifications/message") {
      return;
    }
    if (message.id !== undefined) {
      respondError(event.source, message.id, -32601, "Unsupported dev harness method: " + message.method);
    }
  } catch (error) {
    if (message.id !== undefined) {
      respondError(event.source, message.id, -32000, error instanceof Error ? error.message : String(error));
    }
  }
});

async function streamChat() {
  const response = await fetch("/__sidecar/dev/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages,
      authToken: currentAuthToken(),
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error("Chat request failed.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentAssistantContentEl = null;
  let currentAssistantText = "";
  const assistantSegments = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseEvent(raw);
      if (parsed) {
        if (parsed.event === "delta") {
          const text = parsed.data.text || "";
          if (text) {
            currentAssistantText += text;
            currentAssistantContentEl ??= appendMessage("assistant", "").querySelector(".content");
            renderMarkdown(currentAssistantContentEl, currentAssistantText);
          }
        } else if (parsed.event === "tool_start") {
          finalizeAssistantSegment();
          appendToolStart(parsed.data);
        } else if (parsed.event === "tool_result") {
          finalizeAssistantSegment();
          appendToolResult(parsed.data);
        } else if (parsed.event === "error") {
          throw new Error(parsed.data.message || "Sidecar dev chat failed.");
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  finalizeAssistantSegment();
  if (assistantSegments.length) {
    messages.push({ role: "assistant", content: assistantSegments.join("\n\n") });
  }

  function finalizeAssistantSegment() {
    if (currentAssistantText.trim()) {
      assistantSegments.push(currentAssistantText);
    }
    currentAssistantText = "";
    currentAssistantContentEl = null;
  }
}

function parseEvent(raw) {
  let event = "message";
  let data = "";
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  return { event, data: JSON.parse(data) };
}

function appendMessage(role, content) {
  clearEmpty();
  const article = document.createElement("article");
  article.className = "message";
  article.dataset.role = role;
  article.innerHTML = '<div class="role"></div><div class="content"></div>';
  article.querySelector(".role").textContent = role;
  const contentEl = article.querySelector(".content");
  if (role === "assistant") {
    contentEl.classList.add("markdown");
    renderMarkdown(contentEl, content);
  } else {
    contentEl.textContent = content;
  }
  messagesEl.append(article);
  article.scrollIntoView({ block: "end" });
  return article;
}

function renderMarkdown(element, markdown) {
  markdownSources.set(element, markdown);
  if (window.SidecarStreamdown?.render) {
    window.SidecarStreamdown.render(element, markdown);
    return;
  }
  element.textContent = markdown;
  if (!markdownRendererPromise) {
    markdownRendererPromise = import("/__sidecar/dev/streamdown-client.js")
      .then(() => {
        document.querySelectorAll(".content.markdown").forEach((target) => {
          window.SidecarStreamdown?.render(target, markdownSources.get(target) || "");
        });
      })
      .catch((error) => {
        console.warn("Sidecar dev markdown renderer failed to load", error);
      });
  }
}

function renderAssistantError(element, message) {
  const text = "Sidecar dev hit an error:\\n\\n" + message;
  element.classList.add("error");
  renderMarkdown(element, text);
  return text;
}

function appendToolStart(tool) {
  const article = document.createElement("article");
  article.className = "tool-card";
  article.dataset.toolCallId = tool.id;
  article.innerHTML = '<div class="tool-head"><div class="tool-title"></div><div class="status">Running</div></div><div class="tool-body"></div>';
  article.querySelector(".tool-title").textContent = tool.title || tool.name;
  messagesEl.append(article);
  return article;
}

function appendToolResult(event) {
  const article = document.querySelector('[data-tool-call-id="' + CSS.escape(event.id) + '"]') || document.createElement("article");
  if (!article.parentElement) {
    article.className = "tool-card";
    article.dataset.toolCallId = event.id;
    article.innerHTML = '<div class="tool-head"><div class="tool-title"></div><div class="status"></div></div><div class="tool-body"></div>';
    messagesEl.append(article);
  }
  article.querySelector(".tool-title").textContent = event.tool.title || event.tool.name;
  article.querySelector(".status").textContent = event.result?.isError ? "Error" : "Done";
  const body = article.querySelector(".tool-body");
  body.innerHTML = "";
  if (event.tool.resourceUri) {
    const iframe = document.createElement("iframe");
    iframe.src = "/__sidecar/dev/resource?uri=" + encodeURIComponent(event.tool.resourceUri);
    iframe.title = event.tool.title || event.tool.name;
    iframe.setAttribute("scrolling", "auto");
    frameContexts.set(iframe.contentWindow, {
      result: event.result,
      tool: event.tool,
      arguments: event.arguments || {},
    });
    iframe.addEventListener("load", () => {
      frameContexts.set(iframe.contentWindow, {
        result: event.result,
        tool: event.tool,
        arguments: event.arguments || {},
      });
      window.setTimeout(() => sendFrameContext(iframe.contentWindow), 120);
    });
    body.append(iframe);
  } else {
    const pre = document.createElement("pre");
    pre.textContent = toolText(event.result);
    body.append(pre);
  }
  article.scrollIntoView({ block: "end" });
  return article;
}

function toolText(result) {
  const blocks = result?.content || [];
  const text = blocks.map((block) => typeof block === "string" ? block : block?.text || JSON.stringify(block)).join("\n");
  return text || JSON.stringify(result?.structuredContent || result || {}, null, 2);
}

async function rpc(method, params) {
  const response = await fetch("/__sidecar/dev/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params, authToken: currentAuthToken() }),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || json.error || "MCP request failed.");
  }
  return json.result;
}

function openAuthModal() {
  authEl.value = bearerToken;
  authErrorEl.textContent = "";
  authErrorEl.dataset.visible = "false";
  authModalEl.dataset.open = "true";
  authModalEl.setAttribute("aria-hidden", "false");
  window.setTimeout(() => authEl.focus(), 40);
}

function closeAuthModal() {
  authModalEl.dataset.open = "false";
  authModalEl.setAttribute("aria-hidden", "true");
  window.setTimeout(() => authTriggerEl.focus(), 40);
}

async function saveBearerToken() {
  const nextToken = authEl.value.trim();
  authErrorEl.textContent = "";
  authErrorEl.dataset.visible = "false";
  authSaveEl.disabled = true;
  authSaveEl.textContent = nextToken ? "Testing..." : "Saving...";
  try {
    if (nextToken) {
      await testBearerToken(nextToken);
    }
    bearerToken = nextToken;
    if (bearerToken) {
      localStorage.setItem("sidecar.dev.bearer", bearerToken);
    } else {
      localStorage.removeItem("sidecar.dev.bearer");
    }
    setAuthCookie(bearerToken);
    updateAuthTrigger();
    closeAuthModal();
  } catch (error) {
    authErrorEl.textContent = error instanceof Error ? error.message : String(error);
    authErrorEl.dataset.visible = "true";
  } finally {
    authSaveEl.disabled = false;
    authSaveEl.textContent = "Save";
  }
}

async function testBearerToken(token) {
  const response = await fetch("/__sidecar/dev/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "tools/list", params: {}, authToken: token }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.message || json.error || "Bearer token test failed.");
  }
}

function currentAuthToken() {
  return bearerToken.trim() || undefined;
}

function updateAuthTrigger() {
  authTriggerEl.dataset.tokenSet = String(Boolean(currentAuthToken()));
  authTriggerEl.title = currentAuthToken() ? "Bearer token is set" : "Set bearer token";
}

async function setState(next) {
  await fetch("/__sidecar/dev/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(next),
  });
}

function applyState(next) {
  state.host = next.host || state.host;
  state.theme = next.theme || state.theme;
  state.device = next.device || state.device;
  document.documentElement.dataset.sidecarHost = state.host;
  document.documentElement.dataset.sidecarTheme = state.theme;
  document.documentElement.dataset.sidecarDevice = state.device;
  document.querySelectorAll("[data-host]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.host === state.host));
  });
  document.querySelectorAll("[data-theme]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.theme === state.theme));
  });
  document.querySelectorAll("[data-device]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.device === state.device));
  });
  syncSegmentedControl("[data-host]", state.host, "host");
  syncSegmentedControl("[data-theme]", state.theme, "theme");
  syncSegmentedControl("[data-device]", state.device, "device");
  surfaceTitleEl.textContent = (state.host === "generic" ? "MCP" : state.host === "chatgpt" ? "ChatGPT" : "Claude") + " preview";
  surfaceMetaEl.textContent = state.device === "mobile" ? "Mobile" : "Desktop";
  for (const source of frameContexts.keys()) {
    notify(source, "ui/notifications/host-context-changed", hostContext());
  }
}

function syncSegmentedControl(selector, value, datasetKey) {
  const buttons = [...document.querySelectorAll(selector)];
  const segmented = buttons[0]?.closest(".segmented");
  if (!segmented) {
    return;
  }
  const activeIndex = Math.max(0, buttons.findIndex((button) => button.dataset[datasetKey] === value));
  segmented.style.setProperty("--segments", String(buttons.length));
  segmented.style.setProperty("--active-index", String(activeIndex));
}

function sendFrameContext(source) {
  const context = frameContexts.get(source);
  if (!context) {
    return;
  }
  notify(source, "ui/notifications/host-context-changed", hostContext());
  notify(source, "ui/notifications/tool-input", { arguments: context.arguments || {} });
  notify(source, "ui/notifications/tool-result", context.result);
}

function hostContext() {
  return {
    theme: state.theme,
    device: state.device,
    userAgent: "Sidecar Dev " + state.host,
    displayMode: "inline",
    availableDisplayModes: ["inline", "fullscreen", "pip"],
    platform: "web",
    styles: { variables: hostVariables() },
  };
}

function hostVariables() {
  if (state.host === "claude") {
    return state.theme === "dark"
      ? { "--font-sans": '"Anthropic Sans", ui-sans-serif, system-ui, sans-serif', "--color-background-primary": "#30302e", "--color-text-primary": "#faf9f5" }
      : { "--font-sans": '"Anthropic Sans", ui-sans-serif, system-ui, sans-serif', "--color-background-primary": "#ffffff", "--color-text-primary": "#141413" };
  }
  return {};
}

function hostCapabilities() {
  return {
    serverTools: {},
    serverResources: {},
    openLinks: {},
    logging: {},
    message: { text: {}, structuredContent: {} },
    updateModelContext: { structuredContent: {} },
    downloadFile: {},
  };
}

function respond(source, id, result) {
  if (id === undefined) return;
  source?.postMessage({ jsonrpc: "2.0", id, result }, "*");
}

function respondError(source, id, code, message) {
  source?.postMessage({ jsonrpc: "2.0", id, error: { code, message } }, "*");
}

function notify(source, method, params) {
  source?.postMessage({ jsonrpc: "2.0", method, params }, "*");
}

function setAuthCookie(token) {
  document.cookie = "sidecar_dev_bearer=" + encodeURIComponent(token || "") + "; path=/; SameSite=Lax";
}

function clearEmpty() {
  const empty = messagesEl.querySelector(".empty");
  empty?.remove();
}

applyState(state);
`;
}
