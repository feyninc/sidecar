/** Wraps Notion MCP `notion-get-teams`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/official-mcp-client.js";

type GetTeamsParams = {
  /** Optional case-insensitive teamspace search query. */
  query?: string;
};

export default tool({
  name: "Get Notion Teams",
  description:
    "Use this when the user wants to retrieve Notion teamspaces and membership details. Use this before filtering searches by teamspace id.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  },
  async execute(params: GetTeamsParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-get-teams",
      title: "Notion teams",
      previewKind: "metadata",
      args: params,
      ctx
    }));
  }
});
