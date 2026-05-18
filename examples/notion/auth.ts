/**
 * Intentionally spec-impure OAuth pass-through for the hosted Notion MCP.
 *
 * Notion's hosted MCP server already owns the real OAuth app, permissions, and
 * tool behavior. This example deliberately advertises Notion's MCP resource so
 * clients request a Notion-audience token, then forwards that exact bearer
 * token upstream from each tool call.
 *
 * Do not copy this pattern into normal Sidecar apps. Standard MCP auth forbids
 * token pass-through between resource servers; this file exists only to keep
 * the Notion example credential-light while exercising Sidecar's UI layer.
 */
import { auth, type AuthSession } from "sidecar-ai";

export type NotionSession = AuthSession<
  { issuer: "https://mcp.notion.com" },
  { notionAccessToken: string }
>;

const NOTION_MCP_RESOURCE = "https://mcp.notion.com/mcp";

const passthroughAuth = auth({
  resource: NOTION_MCP_RESOURCE,
  authorizationServers: ["https://mcp.notion.com"],
  scopes: {},
  async session(request): Promise<NotionSession | null> {
    const token = request.bearerToken();
    if (!token) {
      return null;
    }

    return {
      userId: "notion-oauth-user",
      subject: "notion-oauth-user",
      scopes: [],
      token,
      notionAccessToken: token,
      claims: {
        issuer: "https://mcp.notion.com"
      }
    };
  }
});

let notionAuth: typeof passthroughAuth;
notionAuth = Object.freeze({
  ...passthroughAuth,
  /**
   * `sidecar dev --tunnel` normally rewrites auth resources to the public
   * tunnel URL. This proxy example must keep Notion's resource so the upstream
   * authorization server does not reject the OAuth target.
   */
  withResource() {
    return notionAuth;
  }
});

export default notionAuth;
