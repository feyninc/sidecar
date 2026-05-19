/** Wraps Notion MCP `notion-update-data-source`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/official-mcp-client.js";

type UpdateDataSourceParams = {
  /** Data source id, collection:// URI, or single-source database id. */
  data_source_id: string;
  /** Semicolon-separated SQL DDL statements. */
  statements?: string;
  /** New data source title. */
  title?: string;
  /** New data source description. */
  description?: string;
  /** Move the data source to or from trash. */
  in_trash?: boolean;
  /** Whether the data source is inline. */
  is_inline?: boolean;
};

export default tool({
  name: "Update Notion Data Source",
  description:
    "Use this when the user wants to update a Notion data source schema, title, description, or trash state. Fetch the data source first. Ask clarifying questions before changing schemas, dropping columns, renaming properties, or trashing data.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true
  },
  async execute(params: UpdateDataSourceParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-update-data-source",
      title: "Updated Notion data source",
      previewKind: "write",
      args: params,
      ctx
    }));
  }
});
