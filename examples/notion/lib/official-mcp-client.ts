/**
 * Official hosted Notion MCP client used by the Sidecar Notion example.
 *
 * Sidecar remains the MCP server exposed to Claude/ChatGPT. This module is the
 * internal MCP client that delegates execution to `https://mcp.notion.com/mcp`.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  toolResult,
  type McpContentBlock,
  type StructuredToolResultInput,
  type ToolContext
} from "sidecar-ai";
import type { NotionSession } from "../auth.js";
import { createNotionAuthorizationUrl, readUsableNotionToken } from "./notion-oauth.js";

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
  items?: NotionPreviewItem[];
};

/** Lightweight item extracted from Notion text for list-oriented widgets. */
export type NotionPreviewItem = {
  title: string;
  body?: string;
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
 * Calls the official hosted Notion MCP using the official MCP TypeScript SDK.
 *
 * The Sidecar tool remains simple: it validates/normalizes its own input and
 * delegates execution to Notion's Streamable HTTP server with the user's
 * refreshed Notion OAuth token from WorkOS Vault.
 */
export async function callNotionTool(
  options: CallNotionToolOptions,
): Promise<StructuredToolResultInput<NotionToolOutput, { notion: Record<string, unknown> }>> {
  const notionToken = await readUsableNotionToken(options.ctx.auth);
  if (!notionToken) {
    return await missingNotionLinkResult(options);
  }

  const upstreamUrl = notionMcpUrl();
  const client = new Client({
    name: "sidecar-notion",
    version: "0.1.0-alpha.1"
  });
  const transport = new StreamableHTTPClientTransport(upstreamUrl, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${notionToken.accessToken}`,
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

/** Creates a user-facing Notion OAuth link for the authenticated WorkOS user. */
export async function createNotionAuthorizationToolResult(
  ctx: ToolContext<NotionSession>,
): Promise<StructuredToolResultInput<NotionToolOutput, { notion: Record<string, unknown> }>> {
  const existingToken = await readUsableNotionToken(ctx.auth);
  if (existingToken) {
    const content = "Notion is already linked for this authenticated Sidecar user. You can call the Notion tools now.";
    return {
      structuredContent: {
        tool: "authorize",
        ok: true,
        text: content,
        preview: {
          kind: "metadata",
          title: "Notion linked",
          summary: "A Notion MCP token is already stored for this user.",
          content
        },
        upstream: {
          isError: false
        }
      },
      content,
      meta: {
        notion: {
          linked: true,
          workosUserId: ctx.auth.workosUserId
        }
      }
    };
  }

  const linkUrl = await createLinkUrl({ ctx });
  if (!linkUrl) {
    return missingNotionConfigurationResult(ctx);
  }

  const content = [
    "Open this link to authorize Notion for the current Sidecar user:",
    "",
    linkUrl,
    "",
    "After authorizing Notion, retry the Notion request."
  ].join("\n");
  return {
    structuredContent: {
      tool: "authorize",
      ok: true,
      text: content,
      preview: {
        kind: "metadata",
        title: "Authorize Notion",
        summary: "Open the OAuth link, authorize Notion, then retry the Notion tool call.",
        content,
        url: linkUrl
      },
      upstream: {
        isError: false
      }
    },
    content,
    meta: {
      notion: {
        linked: false,
        workosUserId: ctx.auth.workosUserId,
        linkUrl
      }
    }
  };
}

/** Returns a model-visible error when the WorkOS user has not linked Notion. */
async function missingNotionLinkResult(
  options: CallNotionToolOptions,
): Promise<StructuredToolResultInput<NotionToolOutput, { notion: Record<string, unknown> }>> {
  const linkUrl = await createLinkUrl(options);
  const message = linkUrl
    ? "This WorkOS user is authenticated, but Notion is not linked yet. Open the link to authorize Notion, then retry the tool call."
    : "This WorkOS user is authenticated, but Notion is not linked and Sidecar could not create a link URL. Check WorkOS Vault and public URL configuration.";
  const content = linkUrl ? `${message}\n\n${linkUrl}` : message;
  return {
    structuredContent: {
      tool: options.toolName,
      ok: false,
      text: content,
      preview: {
        kind: "metadata",
        title: options.title,
        summary: "Notion is not linked for this authenticated user.",
        content,
        ...(linkUrl ? { url: linkUrl } : {})
      },
      upstream: {
        isError: true
      }
    },
    content,
    meta: {
      notion: {
        linked: false,
        workosUserId: options.ctx.auth.workosUserId,
        ...(linkUrl ? { linkUrl } : {})
      }
    },
    isError: true
  };
}

/** Returns a typed tool error when Notion OAuth link generation is unavailable. */
function missingNotionConfigurationResult(
  ctx: ToolContext<NotionSession>,
): StructuredToolResultInput<NotionToolOutput, { notion: Record<string, unknown> }> {
  const content = "Sidecar could not create a Notion authorization link. Check the public URL, WorkOS Vault, and Notion MCP OAuth configuration.";
  return {
    structuredContent: {
      tool: "authorize",
      ok: false,
      text: content,
      preview: {
        kind: "metadata",
        title: "Notion authorization unavailable",
        summary: "The Notion OAuth link could not be created.",
        content
      },
      upstream: {
        isError: true
      }
    },
    content,
    meta: {
      notion: {
        linked: false,
        workosUserId: ctx.auth.workosUserId
      }
    },
    isError: true
  };
}

/** Creates a Notion OAuth link, returning undefined when configuration is incomplete. */
async function createLinkUrl(options: Pick<CallNotionToolOptions, "ctx">): Promise<string | undefined> {
  try {
    return await createNotionAuthorizationUrl(options.ctx.auth);
  } catch {
    return undefined;
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
  const parsed = parseNotionResponseText(input.text);
  const writeContent = input.kind === "write" ? writePreviewContent(input.args) : undefined;
  const content = writeContent ?? parsed.content;
  const title = parsed.title ?? input.title;
  const url = firstNotionUrl(input.args) ?? parsed.url ?? firstNotionUrl(input.text);
  return {
    kind: input.kind,
    title,
    summary: previewSummary({
      toolName: input.toolName,
      args: input.args,
      text: input.text,
      previewTitle: title,
      parsedSummary: parsed.summary
    }),
    content: content.trim() || "No preview content returned.",
    ...(url ? { url } : {}),
    ...(parsed.items.length ? { items: parsed.items } : {})
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
function previewSummary(input: {
  toolName: string;
  args: NotionToolParams;
  text: string;
  previewTitle: string;
  parsedSummary?: string;
}): string {
  const { args, toolName } = input;
  if (toolName === "notion-search" && typeof args.query === "string") {
    return `Search results for "${args.query}".`;
  }
  if (toolName === "notion-fetch") {
    return input.previewTitle === "Fetched Notion content"
      ? "Fetched content from Notion."
      : `Fetched "${input.previewTitle}" from Notion.`;
  }
  if (WRITE_TOOL_IDS.has(toolName)) {
    return "Notion accepted the write request. Review the submitted content below.";
  }
  return input.parsedSummary ?? input.text.split(/\n+/).find(Boolean)?.slice(0, 180) ?? "Notion returned a response.";
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
    const found = value.match(/https:\/\/(?:www\.)?(?:notion\.so|notion\.site)\/[^\s"'<>\\)]+/i)?.[0];
    return found?.replace(/[.,;:]+$/, "");
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

type ParsedNotionText = {
  title?: string;
  summary?: string;
  content: string;
  url?: string;
  items: NotionPreviewItem[];
};

/** Converts Notion's XML-like MCP text into a widget-safe document preview. */
function parseNotionResponseText(rawText: string): ParsedNotionText {
  const raw = rawText.trim();
  const outer = parseJsonRecord(raw);
  const metadata = isRecord(outer?.metadata) ? outer.metadata : undefined;
  const body = typeof outer?.text === "string" ? outer.text : raw;
  const properties = parseProperties(extractTag(body, "properties"));
  const title = stringValue(metadata?.title)
    ?? compactPropertyValue(properties?.["Doc name"])
    ?? compactPropertyValue(properties?.Name)
    ?? compactPropertyValue(properties?.title)
    ?? attributeValue(body, "title");
  const url = stringValue(metadata?.url) ?? firstNotionUrl(body);
  const contentBlock = extractTag(body, "content");
  const bodyWithoutMetadata = removeTag(removeTag(body, "ancestor-path"), "properties");
  const content = cleanNotionMarkup(contentBlock ?? bodyWithoutMetadata);
  const summary = firstParagraph(content);
  const items = previewItems(content);

  return {
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    content: content || raw || "No preview content returned.",
    ...(url ? { url } : {}),
    items
  };
}

/** Parses a JSON object without surfacing malformed upstream data as an error. */
function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Extracts the first XML-ish tag body from the Notion MCP text format. */
function extractTag(text: string, tagName: string): string | undefined {
  const match = text.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1]?.trim();
}

/** Removes every XML-ish tag section with the provided name. */
function removeTag(text: string, tagName: string): string {
  return text.replace(new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi"), "");
}

/** Reads a simple attribute value from the first matching XML-ish tag. */
function attributeValue(text: string, attribute: string): string | undefined {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}="([^"]+)"`, "i"));
  return match ? decodeEntities(match[1]) : undefined;
}

/** Parses Notion's properties payload when the upstream server includes it. */
function parseProperties(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) {
    return undefined;
  }
  const parsed = parseJsonRecord(text);
  return parsed;
}

/** Turns flexible Notion property values into concise display text. */
function compactPropertyValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const cleaned = cleanNotionMarkup(value);
    return cleaned && cleaned !== "<omitted />" ? cleaned : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value.flatMap((item) => {
      const text = compactPropertyValue(item);
      return text ? [text] : [];
    });
    return parts.length ? parts.join(", ") : undefined;
  }
  if (isRecord(value)) {
    const preferred = value.name ?? value.title ?? value.plain_text ?? value.content;
    const compact = compactPropertyValue(preferred);
    if (compact) {
      return compact;
    }
    const serialized = JSON.stringify(value);
    return serialized.length <= 120 ? serialized : undefined;
  }
  return undefined;
}

/** Strips Notion's XML-ish wrapper while keeping readable text. */
function cleanNotionMarkup(text: string): string {
  return decodeEntities(text)
    .replace(/^Here is the result[\s\S]*?\n(?=<[a-z-]+\b)/i, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extracts simple list items for widgets that should not render a long document. */
function previewItems(content: string): NotionPreviewItem[] {
  const sections = content
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);

  const candidates = sections.length > 1
    ? sections
    : content.split(/\n(?=(?:[-*]|\d+[.)])\s+)/).map((section) => section.trim()).filter(Boolean);

  return candidates
    .map((section) => {
      const lines = section.split("\n").map((line) => line.trim()).filter(Boolean);
      const title = stripListPrefix(lines[0] ?? "");
      const body = lines.slice(1).join("\n").trim();
      return {
        title: title ? truncate(title, 100) : "Untitled Notion result",
        ...(body ? { body: truncate(body, 260) } : {})
      };
    })
    .filter((item) => item.title || item.body)
    .slice(0, 12);
}

/** Removes markdown and numbered-list prefixes from extracted item titles. */
function stripListPrefix(value: string): string {
  return value
    .replace(/^(?:[-*]|\d+[.)])\s+/, "")
    .replace(/^#+\s+/, "")
    .trim();
}

/** Decodes the entity subset commonly present in Notion MCP markup. */
function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Returns the first useful paragraph from a larger body. */
function firstParagraph(text: string): string | undefined {
  const paragraph = text.split(/\n{2,}/).map((entry) => entry.trim()).find(Boolean);
  return paragraph ? truncate(paragraph, 160) : undefined;
}

/** Normalizes optional string-like values from unknown objects. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Truncates without splitting code units into a noisy long summary. */
function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}...`;
}
