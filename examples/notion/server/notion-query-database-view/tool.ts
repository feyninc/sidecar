/** Wraps Notion MCP `notion-query-database-view`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/official-mcp-client.js";

type QueryDatabaseViewParams = {
  /** Notion database view URL, id, or view:// URI. */
  view_id?: string;
  /** Some clients pass a full view URL under view_url. */
  view_url?: string;
  /** Optional number of rows requested from the upstream view query. */
  page_size?: number;
  /** Optional cursor when the upstream tool supports paginated results. */
  start_cursor?: string;
};

export default tool({
  name: "Query Notion Database View",
  description:
    "Use this when the user wants to query a predefined Notion database view and the newer data-source query tool is unavailable. Fetch the database first to identify the exact view URL or id.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  },
  async execute(params: QueryDatabaseViewParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-query-database-view",
      title: "Queried Notion database view",
      previewKind: "read",
      args: params,
      ctx
    }));
  }
});
