/** Wraps Notion MCP `notion-search`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/official-mcp-client.js";

type SearchParams = {
  /** Semantic search query. Use one question or lookup per call. */
  query: string;
  /** Search internal content or users. Defaults to internal content. */
  query_type?: "internal" | "user";
  /** Optional search mode override when the workspace has Notion AI access. */
  content_search_mode?: "workspace_search" | "ai_search";
  /** Optional data source URL, for example collection://... from a fetch response. */
  data_source_url?: string;
  /** Optional page URL or page id to search within. */
  page_url?: string;
  /** Optional teamspace id to restrict search results. */
  teamspace_id?: string;
  /** Optional Notion search filters. */
  filters?: Record<string, unknown>;
  /** Maximum number of results to return. Keep this low unless the user asked for breadth. */
  page_size?: number;
  /** Maximum highlight length. Use 0 when highlights are unnecessary. */
  max_highlight_length?: number;
};

export default tool({
  name: "Search Notion",
  description:
    "Use this when the user wants to search Notion workspace content, connected sources, or users. Use focused queries and low page_size values. Fetch promising Notion results before answering with details.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  },
  async execute(params: SearchParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-search",
      title: "Notion search",
      previewKind: "search",
      args: params,
      ctx
    }));
  }
});
