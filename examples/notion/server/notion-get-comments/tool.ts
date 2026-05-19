/** Wraps Notion MCP `notion-get-comments`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/official-mcp-client.js";

type GetCommentsParams = {
  /** Page id with or without dashes. */
  page_id: string;
  /** Include comments on child blocks. */
  include_all_blocks?: boolean;
  /** Include resolved discussion threads. */
  include_resolved?: boolean;
  /** Optional specific discussion id or discussion:// URL. */
  discussion_id?: string;
};

export default tool({
  name: "Get Notion Comments",
  description:
    "Use this when the user wants to get comments and discussion threads from a Notion page. Use fetch with include_discussions first when you need to identify anchored discussions in page content.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  },
  async execute(params: GetCommentsParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-get-comments",
      title: "Notion comments",
      previewKind: "read",
      args: params,
      ctx
    }));
  }
});
