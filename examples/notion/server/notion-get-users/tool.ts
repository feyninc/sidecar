/** Wraps Notion MCP `notion-get-users`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/notion.js";

type GetUsersParams = {
  /** Optional search query matching name or email. */
  query?: string;
  /** Number of users to return, max 100 upstream. */
  page_size?: number;
  /** Pagination cursor from the upstream response. */
  start_cursor?: string;
  /** Specific user id, or self for the current user. */
  user_id?: string;
};

export default tool({
  name: "Get Notion Users",
  description:
    "Use this when the user wants to list or fetch Notion workspace users. Use user_id self for the current user or query to find people by name or email.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  },
  async execute(params: GetUsersParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-get-users",
      title: "Notion users",
      previewKind: "metadata",
      args: params,
      ctx
    }));
  }
});
