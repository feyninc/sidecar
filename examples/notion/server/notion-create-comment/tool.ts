/** Wraps Notion MCP `notion-create-comment`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/notion.js";

type CreateCommentParams = {
  /** Page id with or without dashes. */
  page_id: string;
  /** Comment body. */
  rich_text: string[];
  /** Optional discussion id or discussion:// URL when replying. */
  discussion_id?: string;
  /** Optional abbreviated selection target, for example "# Heading...last words". */
  selection_with_ellipsis?: string;
};

export default tool({
  name: "Create Notion Comment",
  description:
    "Use this when the user wants to add a Notion comment or reply. Ask clarifying questions before posting subjective feedback, and use fetch/get-comments first when anchoring to a specific block or discussion.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  },
  async execute(params: CreateCommentParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-create-comment",
      title: "Created Notion comment",
      previewKind: "write",
      args: params,
      ctx
    }));
  }
});
