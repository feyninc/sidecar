/** Wraps Notion MCP `notion-get-user`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/official-mcp-client.js";

type GetUserParams = {
  /** Notion user id, or self for the current user when supported upstream. */
  user_id: string;
};

export default tool({
  name: "Get Notion User",
  description:
    "Use this when the user wants to retrieve one Notion user by id. Use get-users first when you only have a name or email.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  },
  async execute(params: GetUserParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-get-user",
      title: "Notion user",
      previewKind: "metadata",
      args: params,
      ctx
    }));
  }
});
