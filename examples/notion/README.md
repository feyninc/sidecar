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

## Build And Host

```sh
npm run build
cd out/mcp
SIDECAR_MCP_URL=https://your-host.example.com/mcp npm start
```

The generated `out/mcp/server/index.js` is a hostable Node Streamable HTTP MCP
server. On your host, set `PORT`, `SIDECAR_MCP_URL`, and `SIDECAR_PUBLIC_URL`
through the platform environment settings. Use `https://your-host.example.com/mcp`
as the connector URL.

For Vercel:

```sh
npm run build:vercel
cd out/vercel
vercel deploy --prod
```

The generated `out/vercel/vercel.json` routes requests to the Sidecar MCP
function at `api/sidecar.js`. Set `SIDECAR_MCP_URL` and `SIDECAR_PUBLIC_URL` to
the final Vercel `https://.../mcp` URL.

Run the example smoke test with:

```sh
npm test
```

When deploying this example directly from the Sidecar monorepo, keep the Vercel
Root Directory set to `examples/notion`, the Build Command set to
`npm run build:vercel`, and the Output Directory set to `out/vercel`. This
example is intentionally not a root npm workspace, so Vercel installs
`sidecar-ai` from npm the same way a separate consumer project would.

## Auth

Hosted Notion MCP requires a Notion-audience OAuth token. This example keeps
Sidecar spec-compliant by making this MCP server the resource server and using
WorkOS AuthKit as its authorization server. It stores the separate upstream
Notion MCP token in WorkOS Vault, keyed by the authenticated WorkOS user id.

Configure:

```sh
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY_NOTION=sk_...
```

By default, `auth.ts` uses WorkOS AuthKit at `https://signin.workos.com` and
verifies access tokens against its JWKS endpoint. Set `WORKOS_AUTHKIT_ISSUER`
or `WORKOS_AUTHKIT_DOMAIN` only if you use a custom AuthKit domain. Tool
execution reads the user's Notion MCP token from WorkOS Vault with an object
name derived from the WorkOS user id and a Vault key context containing
`user_id` and `data_type=notion_mcp_token`.

When a user has no stored Notion token, the tool result includes a Notion OAuth
link. That flow uses Notion's MCP OAuth discovery, dynamic client registration,
PKCE, and the local callback route at `/notion/oauth/callback`. The callback
stores the Notion access token and refresh token in WorkOS Vault. Access tokens
are refreshed from Vault before upstream tool calls when they are close to
expiry.
