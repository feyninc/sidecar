# Notion

This example exposes the public hosted Notion MCP tools through a Sidecar MCP
server and adds native React widgets for the tool results.

## What It Shows

- 1:1 Sidecar tool folders for the public Notion MCP tool names.
- WorkOS AuthKit as the MCP authorization server.
- WorkOS Vault storage for each user's upstream Notion MCP token.
- Streamable HTTP calls to `https://mcp.notion.com/mcp` with the official MCP
  TypeScript SDK.
- Native widgets for search, fetch, read/query, metadata, and write results.
- Write previews that focus on new content instead of burying the user in
  metadata.

## Run Locally

```sh
npm install
npm run dev
```

For ChatGPT or Claude connector testing, use an HTTPS tunnel:

```sh
npm run dev:https
```

The tunnel URL is public while it is running. Do not use it with sensitive
workspace data unless you understand the exposure.

## Auth

Hosted Notion MCP requires a Notion-audience OAuth token. This example keeps
Sidecar spec-compliant by making this MCP server the resource server and using
WorkOS AuthKit as its authorization server. It stores the separate upstream
Notion MCP token in WorkOS Vault, keyed by the authenticated WorkOS user id.

Configure:

```sh
WORKOS_AUTHKIT_ISSUER=https://<subdomain>.authkit.app
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY_NOTION=sk_...
```

`auth.ts` verifies AuthKit access tokens against
`WORKOS_AUTHKIT_ISSUER/oauth2/jwks`. Tool execution reads the user's Notion MCP
token from WorkOS Vault with an object name derived from the WorkOS user id and
a Vault key context containing `user_id` and `data_type=notion_mcp_token`.

When a user has no stored Notion token, the tool result includes a Notion OAuth
link. That flow uses Notion's MCP OAuth discovery, dynamic client registration,
PKCE, and the local callback route at `/notion/oauth/callback`. The callback
stores the Notion access token and refresh token in WorkOS Vault. Access tokens
are refreshed from Vault before upstream tool calls when they are close to
expiry.
