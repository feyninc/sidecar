/** Shared upstream MCP client helpers for the Notion example. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  toolResult,
  type McpContentBlock,
  type StructuredToolResultInput,
  type ToolContext
} from "sidecar-ai";
import type { NotionSession } from "../auth.js";

const DEFAULT_NOTION_MCP_URL = "https://mcp.notion.com/mcp";

const WRITE_TOOL_IDS = new Set([
  "notion-create-pages",
  "notion-update-page",
  "notion-move-pages",
  "notion-duplicate-page",
  "notion-create-database",
  "notion-update-data-source",
  "notion-create-view",
  "notion-update-view",
  "notion-create-comment"
]);

/** JSON object accepted by the upstream Notion MCP tool calls. */
export type NotionToolParams = Record<string, unknown>;

/** Structured content returned to widgets by every wrapped Notion tool. */
export type NotionToolOutput = {
  tool: string;
  ok: boolean;
  text: string;
  preview: NotionPreview;
  upstream: {
    structuredContent?: unknown;
    meta?: Record<string, unknown>;
    isError?: boolean;
  };
};

/** View model used by the example widgets. */
export type NotionPreview = {
  kind: "search" | "read" | "write" | "metadata";
  title: string;
  summary: string;
  content: string;
  url?: string;
  stats?: Record<string, number>;
};

/** Options for one upstream Notion tool call. */
export type CallNotionToolOptions = {
  toolName: string;
  args: NotionToolParams;
  ctx: ToolContext<NotionSession>;
  title: string;
  previewKind?: NotionPreview["kind"];
};

/**
 * Calls the hosted Notion MCP using the official MCP TypeScript SDK.
 *
 * The Sidecar tool remains simple: it validates/normalizes its own input and
 * delegates execution to the upstream Streamable HTTP server with the user's
 * Notion OAuth token.
 */
export async function callNotionTool(
  options: CallNotionToolOptions,
): Promise<StructuredToolResultInput<NotionToolOutput, { notion: Record<string, unknown> }>> {
  const upstreamUrl = notionMcpUrl();
  const client = new Client({
    name: "sidecar-notion",
    version: "0.1.0-alpha.1"
  });
  const transport = new StreamableHTTPClientTransport(upstreamUrl, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${options.ctx.auth.notionAccessToken}`,
        "User-Agent": "Sidecar-Notion-Wrapper/0.1"
      }
    }
  });

  try {
    await client.connect(transport);
    const upstream = await client.callTool({
      name: options.toolName,
      arguments: options.args
    });
    const blocks = sidecarContentBlocks(upstream);
    const text = blocksToText(blocks);
    const structuredContent = "structuredContent" in upstream
      ? upstream.structuredContent
      : undefined;
    const meta = "_meta" in upstream ? upstream._meta : undefined;
    const isError = "isError" in upstream ? Boolean(upstream.isError) : false;
    const output: NotionToolOutput = {
      tool: options.toolName,
      ok: !isError,
      text,
      preview: buildPreview({
        toolName: options.toolName,
        title: options.title,
        kind: options.previewKind ?? inferPreviewKind(options.toolName),
        args: options.args,
        text
      }),
      upstream: {
        structuredContent,
        meta,
        isError
      }
    };

    return {
      structuredContent: output,
      content: blocks.length ? blocks : "Notion returned no model-visible content.",
      meta: {
        notion: {
          upstreamTool: options.toolName,
          upstreamMeta: meta
        }
      },
      isError
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Returns the HTTPS-only hosted Notion MCP URL for this example. */
function notionMcpUrl(): URL {
  const url = new URL(process.env.NOTION_MCP_URL ?? DEFAULT_NOTION_MCP_URL);
  if (url.protocol !== "https:") {
    throw new Error("NOTION_MCP_URL must be an https:// Streamable HTTP URL.");
  }
  return url;
}

/** Converts SDK tool content into the Sidecar-supported MCP content subset. */
function sidecarContentBlocks(upstream: unknown): McpContentBlock[] {
  const content = valueAt(upstream, "content");
  if (!Array.isArray(content)) {
    return [toolResult.text(JSON.stringify(upstream, null, 2))];
  }

  return content.flatMap((block) => {
    if (!isRecord(block) || typeof block.type !== "string") {
      return [];
    }
    if (block.type === "text" && typeof block.text === "string") {
      return [toolResult.text(block.text)];
    }
    if (
      (block.type === "image" || block.type === "audio") &&
      typeof block.data === "string" &&
      typeof block.mimeType === "string"
    ) {
      return [block as McpContentBlock];
    }
    if (block.type === "resource" && isRecord(block.resource)) {
      return [block as McpContentBlock];
    }
    if (block.type === "resource_link") {
      return [toolResult.text(JSON.stringify(block, null, 2))];
    }
    return [];
  });
}

/** Extracts readable text from normalized MCP content blocks. */
function blocksToText(blocks: McpContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "resource") {
        return JSON.stringify(block.resource, null, 2);
      }
      return `[${block.type}: ${block.mimeType}]`;
    })
    .join("\n\n")
    .trim();
}

/** Builds a widget-oriented preview without hiding the upstream MCP result. */
function buildPreview(input: {
  toolName: string;
  title: string;
  kind: NotionPreview["kind"];
  args: NotionToolParams;
  text: string;
}): NotionPreview {
  const content = input.kind === "write"
    ? writePreviewContent(input.args) ?? input.text
    : input.text;
  return {
    kind: input.kind,
    title: input.title,
    summary: previewSummary(input.toolName, input.args, input.text),
    content: content.trim() || "No preview content returned.",
    url: firstNotionUrl(input.args) ?? firstNotionUrl(input.text),
    stats: previewStats(input.args)
  };
}

/** Chooses a default preview intent from the upstream Notion tool id. */
function inferPreviewKind(toolName: string): NotionPreview["kind"] {
  if (toolName === "notion-search") {
    return "search";
  }
  if (toolName === "notion-fetch") {
    return "read";
  }
  if (WRITE_TOOL_IDS.has(toolName)) {
    return "write";
  }
  return "metadata";
}

/** Pulls the most important new content out of write-tool arguments. */
function writePreviewContent(args: NotionToolParams): string | undefined {
  if (typeof args.new_str === "string") {
    return args.new_str;
  }
  if (typeof args.schema === "string") {
    return args.schema;
  }
  if (typeof args.statements === "string") {
    return args.statements;
  }
  if (typeof args.configure === "string") {
    return args.configure;
  }
  if (Array.isArray(args.rich_text)) {
    return args.rich_text.map(String).join("\n");
  }
  if (Array.isArray(args.content_updates)) {
    return args.content_updates
      .flatMap((entry) => isRecord(entry) && typeof entry.new_str === "string" ? [entry.new_str] : [])
      .join("\n\n---\n\n");
  }
  if (Array.isArray(args.pages)) {
    return args.pages
      .flatMap((page, index) => {
        if (!isRecord(page)) {
          return [];
        }
        const title = pageTitle(page.properties);
        const content = typeof page.content === "string" ? page.content : "";
        return [`Page ${index + 1}${title ? `: ${title}` : ""}\n${content}`.trim()];
      })
      .join("\n\n---\n\n");
  }
  return undefined;
}

/** Creates a concise status line for the widget chrome. */
function previewSummary(
  toolName: string,
  args: NotionToolParams,
  text: string,
): string {
  if (toolName === "notion-search" && typeof args.query === "string") {
    return `Search results for "${args.query}".`;
  }
  if (toolName === "notion-fetch" && typeof args.id === "string") {
    return `Fetched ${args.id}.`;
  }
  if (WRITE_TOOL_IDS.has(toolName)) {
    return "Notion accepted the write request; review the content preview and upstream response.";
  }
  return text.split(/\n+/).find(Boolean)?.slice(0, 180) ?? "Notion returned a response.";
}

/** Counts user-supplied write units without computing a diff locally. */
function previewStats(args: NotionToolParams): Record<string, number> | undefined {
  const stats: Record<string, number> = {};
  if (Array.isArray(args.pages)) {
    stats.pages = args.pages.length;
  }
  if (Array.isArray(args.content_updates)) {
    stats.updates = args.content_updates.length;
  }
  if (Array.isArray(args.page_or_database_ids)) {
    stats.items = args.page_or_database_ids.length;
  }
  return Object.keys(stats).length ? stats : undefined;
}

/** Reads a Notion title from the flexible page properties object. */
function pageTitle(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const title = value.title ?? value.Name ?? value.name;
  return typeof title === "string" ? title : undefined;
}

/** Finds the first Notion URL in nested arguments or response text. */
function firstNotionUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.match(/https:\/\/(?:www\.)?(?:notion\.so|notion\.site)\/\S+/)?.[0];
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstNotionUrl(item);
      if (found) return found;
    }
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      const found = firstNotionUrl(item);
      if (found) return found;
    }
  }
  return undefined;
}

/** Reads a property from an unknown object value. */
function valueAt(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** Returns true for non-array objects. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
