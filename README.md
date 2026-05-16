# Sidecar

Sidecar is an opinionated TypeScript framework for building interactive MCP Apps and UI-capable plugin packages.

The current implementation is the first vertical slice:

- `@sidecar/core`: public `tool({ execute })` API, MCP descriptor helpers, result normalization.
- `@sidecar/client`: framework-agnostic widget bridge for tool calls, tool results, model messages, and model context.
- `@sidecar/react`: optional React hooks around `@sidecar/client`.
- `@sidecar/auth`: provider-agnostic MCP auth helpers, typed scopes, and `AuthSession`.
- `@sidecar/anthropic`: Claude plugin authoring helpers for skills, slash commands, hooks, MCP servers, agents, and plugin metadata.
- `@sidecar/compiler`: reserved `server/**/tool.ts` discovery and TypeScript/JSDoc schema extraction.
- `@sidecar/server`: minimal MCP JSON-RPC runtime for `initialize`, `tools/list`, `tools/call`, `resources/list`, and `resources/read`.
- `@sidecar/cli`: `sidecar inspect`, `sidecar build`, and `sidecar dev`.
- `@sidecar/native`: early runtime host feature facade and portable components.
- `create-sidecar-app`: starter scaffold for `npm create sidecar-app` / `npx create-sidecar-app`.

## Tool Authoring

```ts
import { tool, type ToolContext } from "@sidecar/core";

type Params = {
  /** Expense report id, for example exp_123. */
  reportId: string;
};

type Result = {
  /** Approval readiness. */
  status: "ready" | "needs_changes";
  /** Policy issues found in the report. */
  issues: string[];
};

export default tool({
  name: "Review Expense Report",
  id: "expenses.review",
  description:
    "Use this when the user wants policy issues for one expense report. Do not use this to approve or reject a report.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  },
  execute(params: Params, ctx: ToolContext): Promise<Result> {
    return ctx.services.expenses.review(params.reportId);
  }
});
```

`execute` may be sync or async. MCP clients only see the eventual JSON-RPC response; Sidecar normalizes both `Result` and `Promise<Result>`.

## Local Commands

```sh
npm install
npm run typecheck
npm test
npm run build
node dist/cli/index.js inspect --cwd examples/simple
node dist/cli/index.js build --cwd examples/simple
node dist/cli/index.js build --cwd examples/simple --plugins
node dist/cli/index.js dev --cwd examples/simple --port 3101
node dist/create-sidecar-app/index.js /tmp/my-sidecar-app
```

## Widgets

Place `widget.tsx` next to `tool.ts`.

```text
server/
  add-numbers/
    tool.ts
    widget.tsx
```

Sidecar bundles the widget into a content-hashed `ui://...` resource and adds standard MCP Apps metadata:

```json
{
  "_meta": {
    "ui": { "resourceUri": "ui://add_numbers/widget.<hash>.html" },
    "openai/outputTemplate": "ui://add_numbers/widget.<hash>.html"
  }
}
```

Widget code can be any iframe-friendly frontend. Use `@sidecar/client` for framework-agnostic bridge calls. Use `@sidecar/react` only when a React widget wants hooks for tool results, tool calls, model messages, or model context updates.

## Proxy And Auth

`auth.ts` should own MCP/OAuth semantics. `proxy.ts` should own HTTP middleware such as origins, request ids, and rate limits.

```ts
import { origin, proxy, rateLimit, requestId } from "@sidecar/server/proxy";

export default proxy({
  before: [
    requestId(),
    origin({
      allow: ["https://chatgpt.com", "https://claude.ai"],
      dev: ["http://localhost:*"]
    }),
    rateLimit({ windowMs: 60_000, max: 120 })
  ]
});
```

Auth is provider-agnostic at the Sidecar layer. Sidecar owns the MCP resource-server contract; your auth system owns token verification.

```ts
// auth.ts
import { auth, scope, type AuthSession } from "@sidecar/auth";

type Session = AuthSession<
  { sub: string; scope: string; org_id: string },
  { orgId: string }
>;

const appAuth = auth({
  resource: "https://api.example.com/mcp",
  authorizationServers: ["https://auth.example.com"],
  scopes: {
    expensesRead: scope("expenses.read", "Read expense reports.")
  },
  async session(request): Promise<Session | null> {
    const claims = await verifyWithYourProvider(request.bearerToken(), {
      audience: "https://api.example.com/mcp"
    });
    if (!claims) return null;

    return {
      userId: claims.sub,
      scopes: claims.scope.split(" "),
      claims,
      orgId: claims.org_id
    };
  }
});

export const { scopes } = appAuth;
export default appAuth;
```

Tool-level policy belongs in `tool.ts`:

```ts
import { tool } from "@sidecar/core";
import { scopes } from "../../auth.js";

export default tool({
  name: "Review Expense Report",
  description: "Use this to review one expense report for policy issues.",
  auth: {
    scopes: [scopes.expensesRead]
  },
  execute(params: { reportId: string }, ctx) {
    return ctx.services.expenses.review(params.reportId, {
      orgId: ctx.auth.orgId
    });
  }
});
```

Tools are public by default, even when `auth.ts` exists. Use a policy only when the tool needs auth:

```ts
auth: {
  authenticated: true
}
```

Explicit public policy is available when you want the source to make that choice obvious:

```ts
auth: {
  public: true
}
```

## Claude Plugin Agents

Claude plugin pieces can be authored as TypeScript and generated into plugin files. Agents are generated into markdown:

```ts
import { agent } from "@sidecar/anthropic/plugin";

export default agent({
  name: "review-writer",
  description: "Use to draft concise expense review summaries.",
  tools: ["Read", "Grep"],
  disallowedTools: ["Write"],
  prompt: "Draft concise expense review summaries from Sidecar tool results."
});
```

`hooks.json` at the project root is copied into both plugin outputs as `hooks/hooks.json`. Sidecar keeps hook generation conservative for now because hook semantics are host-specific and can block or mutate tool flows.

Slash commands can be static markdown under `commands/` or dynamic `command.ts` files:

```ts
import { command } from "@sidecar/anthropic/plugin";

export default command({
  name: "review-summary",
  description: "Draft a short expense review summary.",
  argumentHint: "[report-id]",
  allowedTools: ["review_expense_report"],
  prompt: "Draft a concise review summary for the current expense report."
});
```
