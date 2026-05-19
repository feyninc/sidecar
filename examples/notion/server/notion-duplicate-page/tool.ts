/** Wraps Notion MCP `notion-duplicate-page`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/official-mcp-client.js";

type DuplicatePageParams = {
  /** Page id to duplicate. */
  page_id: string;
};

export default tool({
  name: "Duplicate Notion Page",
  description:
    "Use this when the user wants to duplicate a Notion page. The upstream operation is asynchronous, so tell the user the copy may take time to populate and can be checked later with fetch.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  },
  async execute(params: DuplicatePageParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-duplicate-page",
      title: "Duplicated Notion page",
      previewKind: "write",
      args: params,
      ctx
    }));
  }
});
