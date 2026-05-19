/** Wraps Notion MCP `notion-create-view`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/official-mcp-client.js";

type CreateViewParams = {
  /** Existing database id or URL. Mutually exclusive with parent_page_id. */
  database_id?: string;
  /** Page id or URL for an inline linked database view. Mutually exclusive with database_id. */
  parent_page_id?: string;
  /** Data source id or collection:// URI from fetch output. */
  data_source_id: string;
  /** New view name. */
  name: string;
  /** View type. */
  type: "table" | "board" | "list" | "calendar" | "timeline" | "gallery" | "form" | "chart" | "map" | "dashboard";
  /** Optional view DSL configuration for filters, sorts, grouping, and display options. */
  configure?: string;
};

export default tool({
  name: "Create Notion View",
  description:
    "Use this when the user wants to create a Notion database view or linked view. Fetch the database first, then ask clarifying questions before choosing view type, grouping, filters, sorts, chart settings, or form permissions.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  },
  async execute(params: CreateViewParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-create-view",
      title: "Created Notion view",
      previewKind: "write",
      args: params,
      ctx
    }));
  }
});
