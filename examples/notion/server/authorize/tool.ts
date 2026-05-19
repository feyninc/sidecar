/** Creates an explicit Notion OAuth link for the authenticated Sidecar user. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { createNotionAuthorizationToolResult } from "../../lib/official-mcp-client.js";

export default tool({
  name: "Authorize",
  description:
    "Use this when the user wants to connect, authorize, link, or reauthorize Notion before calling other Notion tools. Returns a Notion OAuth link for the current authenticated Sidecar user.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  },
  async execute(_params: Record<string, never>, ctx: ToolContext<NotionSession>) {
    return toolResult(await createNotionAuthorizationToolResult(ctx));
  }
});
