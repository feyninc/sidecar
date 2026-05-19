/**
 * HTTP routes for the Notion OAuth callback.
 *
 * Sidecar's MCP runtime owns `/mcp`; this proxy middleware handles the small
 * browser callback needed to link the official hosted Notion MCP.
 */
import { proxy, type ProxyMiddleware } from "@sidecar-ai/server/proxy";
import { completeNotionAuthorization } from "./lib/notion-oauth.js";

/** Callback path registered with Notion dynamic client registration. */
const NOTION_CALLBACK_PATH = "/notion/oauth/callback";

/** Intercepts the Notion OAuth callback before the MCP handler returns 404. */
const notionOAuthCallback: ProxyMiddleware = async (request) => {
  const url = requestUrl(request);
  if (request.method !== "GET" || url.pathname !== NOTION_CALLBACK_PATH) {
    return undefined;
  }

  try {
    await completeNotionAuthorization(url);
    return html(200, "Notion linked", "Notion is linked. You can close this tab and retry the MCP tool call.");
  } catch (error) {
    return html(400, "Notion link failed", error instanceof Error ? error.message : "Unknown Notion OAuth error.");
  }
};

export default proxy({
  before: [notionOAuthCallback],
});

/** Builds a URL from the incoming request line and forwarded host/proto. */
function requestUrl(request: Parameters<ProxyMiddleware>[0]): URL {
  const host = singleHeader(request.headers["x-forwarded-host"]) ?? singleHeader(request.headers.host) ?? "127.0.0.1";
  const proto = singleHeader(request.headers["x-forwarded-proto"]) ?? (host.startsWith("127.") ? "http" : "https");
  return new URL(request.url ?? "/", `${proto}://${host}`);
}

/** Returns a tiny browser page for human OAuth callbacks. */
function html(status: number, title: string, message: string) {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family: system-ui, sans-serif; margin: 3rem; line-height: 1.5;"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`,
  };
}

/** Reads the first value from possibly repeated HTTP headers. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Escapes text before embedding it into the callback HTML. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}
