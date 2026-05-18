/** Wraps Notion MCP `notion-query-data-sources`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/notion.js";

type QueryDataSourcesParams = {
  /** Query payload in SQL mode or view mode. Fetch the database first to get collection:// URLs. */
  data:
    | {
        mode?: "sql";
        data_source_urls: string[];
        query: string;
        params?: string[];
      }
    | {
        mode: "view";
        view_url: string;
      };
};

export default tool({
  name: "Query Notion Data Sources",
  description:
    "Use this when the user wants to query Notion data sources using SQL or an existing view. Fetch the database first to get data source URLs and schema. Use parameterized params for user-supplied values.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  },
  async execute(params: QueryDataSourcesParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-query-data-sources",
      title: "Queried Notion data sources",
      previewKind: "read",
      args: params,
      ctx
    }));
  }
});
