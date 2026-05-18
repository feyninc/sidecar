# Notion

This example exposes the public hosted Notion MCP tools through a Sidecar MCP
server and adds native React widgets for the tool results.

## What It Shows

- 1:1 Sidecar tool folders for the public Notion MCP tool names.
- OAuth pass-through auth using Notion's hosted authorization server.
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

Hosted Notion MCP requires user OAuth. It does not support a static bearer token
for fully automated remote use.

This example is intentionally a token pass-through proxy:

1. `auth.ts` advertises Notion's MCP resource,
   `https://mcp.notion.com/mcp`, and Notion's authorization server.
2. The MCP client completes Notion OAuth and receives a Notion-audience bearer
   token.
3. Sidecar accepts that bearer token and forwards it to
   `https://mcp.notion.com/mcp` for each upstream tool call.

That keeps this example from storing or brokering Notion credentials, but it is
not the normal Sidecar auth pattern. Standard MCP authorization expects the MCP
server receiving a token to be the resource server the token was issued for, and
forbids passing a client token through to another resource server. Use this
example for private experiments and framework/UI validation, not as a general
auth architecture.

Because this example must keep Notion's OAuth resource target, `sidecar dev
--tunnel` does not rewrite the advertised auth resource to the tunnel URL.
