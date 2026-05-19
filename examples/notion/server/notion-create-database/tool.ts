/** Wraps Notion MCP `notion-create-database`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/official-mcp-client.js";

type CreateDatabaseParams = {
  /** SQL DDL CREATE TABLE statement defining the database schema. */
  schema: string;
  /** Optional database title. */
  title?: string;
  /** Optional description. */
  description?: string;
  /** Optional parent page. Omit to create a private database. */
  parent?: { type?: "page_id"; page_id: string };
};

export default tool({
  name: "Create Notion Database",
  description:
    "Use this when the user wants to create a Notion database using SQL DDL. Ask clarifying questions before choosing schema, property names, relation structure, or parent location. Fetch related data sources before creating relations.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  },
  async execute(params: CreateDatabaseParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-create-database",
      title: "Created Notion database",
      previewKind: "write",
      args: params,
      ctx
    }));
  }
});
