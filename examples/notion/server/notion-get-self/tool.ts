/** Wraps Notion MCP `notion-get-self`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/notion.js";

type GetSelfParams = Record<string, never>;

export default tool({
  name: "Get Notion Self",
  description:
    "Use this when the user wants to retrieve the current bot/user and workspace information for the connected Notion MCP session.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  },
  async execute(params: GetSelfParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-get-self",
      title: "Notion workspace identity",
      previewKind: "metadata",
      args: params,
      ctx
    }));
  }
});
