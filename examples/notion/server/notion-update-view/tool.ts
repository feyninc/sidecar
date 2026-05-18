/** Wraps Notion MCP `notion-update-view`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/notion.js";

type UpdateViewParams = {
  /** View id, view:// URI, or Notion URL with ?v=. */
  view_id: string;
  /** Optional new name. */
  name?: string;
  /** Optional view DSL configuration or CLEAR directives. */
  configure?: string;
};

export default tool({
  name: "Update Notion View",
  description:
    "Use this when the user wants to update a Notion view's name, filters, sorts, grouping, or display configuration. Fetch the database/view context first and ask clarifying questions before replacing or clearing important view settings.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  },
  async execute(params: UpdateViewParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-update-view",
      title: "Updated Notion view",
      previewKind: "write",
      args: params,
      ctx
    }));
  }
});
