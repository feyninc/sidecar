/** Wraps Notion MCP `notion-create-pages`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/official-mcp-client.js";

type Parent =
  | { type?: "page_id"; page_id: string }
  | { type?: "database_id"; database_id: string }
  | { type?: "data_source_id"; data_source_id: string };

type PageInput = {
  /** Page properties. Standalone pages must include title. Database pages must match fetched schema names. */
  properties?: Record<string, unknown>;
  /** New page body in Notion-flavored Markdown. */
  content?: string;
  /** Template id to apply asynchronously. Do not provide content when using a template. */
  template_id?: string;
  /** Emoji, custom emoji name, external image URL, or none. */
  icon?: string;
  /** External image URL or none. */
  cover?: string;
};

type CreatePagesParams = {
  /** Optional parent. Omit to create private workspace pages. */
  parent?: Parent;
  /** One or more pages to create. */
  pages: PageInput[];
};

export default tool({
  name: "Create Notion Pages",
  description:
    "Use this when the user wants to create one or more Notion pages. Ask clarifying questions before drafting substantial page content, choosing a destination, applying a template, or setting database properties. Fetch database/data-source schema first when creating inside a database.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  },
  async execute(params: CreatePagesParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-create-pages",
      title: "Created Notion pages",
      previewKind: "write",
      args: params,
      ctx
    }));
  }
});
