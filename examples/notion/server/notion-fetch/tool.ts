/** Wraps Notion MCP `notion-fetch`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/official-mcp-client.js";

type FetchParams = {
  /** Notion page, database, data source URL, raw UUID, or collection://... id. */
  id: string;
  /** Include discussion anchors and discussion summary markers. */
  include_discussions?: boolean;
  /** Include transcript data when the fetched object supports it. */
  include_transcript?: boolean;
};

export default tool({
  name: "Fetch Notion Content",
  description:
    "Use this when the user wants to fetch a Notion page, database, or data source by URL or id. Use this before creating or updating database-backed content so exact schema names and templates are available.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  },
  async execute(params: FetchParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-fetch",
      title: "Fetched Notion content",
      previewKind: "read",
      args: params,
      ctx
    }));
  }
});
