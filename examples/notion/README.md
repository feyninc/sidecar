# Notion

This example exposes the public hosted Notion MCP tools through a Sidecar MCP
server and adds native React widgets for the tool results.

## What It Shows

- 1:1 Sidecar tool folders for the public Notion MCP tool names.
- An explicit `authorize` tool that returns the user's Notion OAuth link before
  they run other Notion tools.
- WorkOS-managed API keys as the MCP bearer credential.
- WorkOS Vault storage for the upstream Notion MCP token, keyed by the API
  key owner.
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

Connect the repo to Vercel. For a normal standalone Sidecar app, no build command
or output directory override is needed: Vercel runs `npm run build`, Sidecar sees
`VERCEL=1`, and the build emits `.vercel/output`.

Because this example lives in a monorepo, set only the Vercel Root Directory to
`examples/notion`. Leave Build Command and Output Directory empty. Set
`SIDECAR_MCP_URL` and `SIDECAR_PUBLIC_URL` to the final Vercel
`https://.../mcp` URL.

To create the same Vercel artifact locally:

```sh
npm run build:vercel
```

Run the example smoke test with:

```sh
npm test
```

This example is intentionally not a root npm workspace, so Vercel installs
`sidecar-ai` from npm the same way a separate consumer project would.

## Auth

Hosted Notion MCP requires a Notion-audience OAuth token. This example uses a
WorkOS-managed API key as the MCP bearer credential. The server validates the
incoming bearer token with WorkOS API Keys and stores the separate upstream
Notion MCP token in WorkOS Vault under the validated key owner.

This keeps the Sidecar dev harness simple: paste the WorkOS organization API key
into the bearer-token field and the harness sends it as the standard MCP
`Authorization: Bearer ...` header.

Configure:

```sh
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY_NOTION=sk_...
SIDECAR_MCP_URL=https://sidecar-notion.vercel.app/mcp
SIDECAR_PUBLIC_URL=https://sidecar-notion.vercel.app
```

Create an organization-owned or user-owned API key in WorkOS AuthKit, then
either paste it into the local harness bearer-token dialog or set it as
`MCP_BEARER` before starting dev. User-owned keys still require an organization
membership; WorkOS uses that membership to decide which organization the key can
access.

`auth.ts` validates `Authorization: Bearer <WorkOS API key>` with WorkOS. Tool
execution reads the Notion MCP token from WorkOS Vault with an object name
derived from the validated key owner and a Vault key context containing
`user_id`, `organization_id` when present, and `data_type=notion_mcp_token`.

When Vault has no stored Notion token for the configured owner id, ask the model
to run `authorize` first. That tool returns a Notion OAuth link. If the user
calls another Notion tool before linking, the tool result also includes the same
authorization link. The flow uses Notion's MCP OAuth discovery, dynamic client
registration, PKCE, and the local callback route at `/notion/oauth/callback`.
The callback stores the Notion access token and refresh token in WorkOS Vault.
Access tokens are refreshed from Vault before upstream tool calls when they are
close to expiry.
