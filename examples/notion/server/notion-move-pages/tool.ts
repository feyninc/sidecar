/** Wraps Notion MCP `notion-move-pages`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/official-mcp-client.js";

type NewParent =
  | { type?: "page_id"; page_id: string }
  | { type?: "database_id"; database_id: string }
  | { type?: "data_source_id"; data_source_id: string }
  | { type: "workspace" };

type MovePagesParams = {
  /** Page or database ids to move. */
  page_or_database_ids: string[];
  /** New parent location. Moving to workspace creates private pages and should be rare. */
  new_parent: NewParent;
};

export default tool({
  name: "Move Notion Pages",
  description:
    "Use this when the user wants to move one or more Notion pages or databases to a new parent. Ask for confirmation if the destination is ambiguous or if moving items to the workspace level.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
  },
  async execute(params: MovePagesParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-move-pages",
      title: "Moved Notion pages",
      previewKind: "write",
      args: params,
      ctx
    }));
  }
});
