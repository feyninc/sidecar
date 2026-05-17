# Sidecar

Sidecar is an opinionated TypeScript framework for building interactive MCP Apps and UI-capable plugin packages.

The current implementation is the first vertical slice:

- `@sidecar/core`: public `tool({ execute })` API, `toolResult(...)`, and MCP descriptor helpers.
- `@sidecar/client`: framework-agnostic widget bridge for tool calls, tool results, model messages, and model context.
- `@sidecar/react`: optional React hooks around `@sidecar/client`.
- `@sidecar/auth`: provider-agnostic MCP auth helpers, typed scopes, and `AuthSession`.
- `@sidecar/anthropic`: Claude plugin helpers plus reconstructed Claude-styled components.
- `@sidecar/compiler`: reserved `server/**/tool.ts` discovery and TypeScript/JSDoc schema extraction.
- `@sidecar/server`: minimal MCP JSON-RPC runtime for `initialize`, `tools/list`, `tools/call`, `resources/list`, and `resources/read`.
- `@sidecar/cli`: `sidecar inspect`, `sidecar build`, and `sidecar dev`.
- `@sidecar/native`: early runtime host feature facade and portable components.
- `@sidecar/openai`: typed ChatGPT compatibility helpers and official OpenAI Apps SDK UI component re-exports.
- `create-sidecar-app`: starter scaffold for `npm create sidecar-app` / `npx create-sidecar-app`.

## Tool Authoring

```ts
import { tool, toolResult, type ToolContext } from "@sidecar/core";

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
  widget: {
    description: "Shows policy issues and approval readiness.",
    csp: {
      connectDomains: [],
      resourceDomains: [],
      frameDomains: []
    }
  },
  async execute(params: Params, ctx: ToolContext) {
    const review: Result = await ctx.services.expenses.review(params.reportId);

    return toolResult({
      structuredContent: review,
      content:
        review.issues.length === 0
          ? "The expense report is ready and has no policy issues."
          : `The expense report needs changes: ${review.issues.join(", ")}.`
    });
  }
});
```

`execute` may be sync or async. Every tool must return `toolResult(...)`; Sidecar uses that single envelope to keep model-visible `content`, typed `structuredContent`, and optional widget-only `meta` explicit.

## Local Commands

```sh
npm install
npm run typecheck
npm test
npm run build
node dist/cli/index.js inspect --cwd examples/simple
node dist/cli/index.js build --cwd examples/simple
node dist/cli/index.js build --cwd examples/simple --target chatgpt
node dist/cli/index.js build --cwd examples/simple --target claude
node dist/cli/index.js build --cwd examples/simple --plugins
node dist/cli/index.js check --cwd examples/simple
node dist/cli/index.js dev --cwd examples/simple --port 3101
node dist/cli/index.js dev --cwd examples/simple --port 3101 --tunnel
node dist/create-sidecar-app/index.js /tmp/my-sidecar-app
```

`sidecar dev --tunnel` starts the local MCP server on Streamable HTTP and opens an HTTPS tunnel. Sidecar tries `cloudflared` first. If it is missing, the CLI asks whether to install `cloudflared` with Homebrew or continue with `npx wrangler tunnel quick-start`. The printed HTTPS `/mcp` URL is the one to add to ChatGPT, Claude, or the generated Claude plugin package.

`sidecar check` emits diagnostics in `file:line:column` form so terminals and future editor integrations can show squiggly-line-style warnings. Build and dev print the same warnings. Use `// sidecar-ignore DIAGNOSTIC_CODE` when an intentional exception is clearer than changing the code.

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
    "ui": {
      "resourceUri": "ui://add_numbers/widget.<hash>.html",
      "csp": {
        "connectDomains": [],
        "resourceDomains": [],
        "frameDomains": []
      }
    },
  }
}
```

Build with `--target chatgpt` to add ChatGPT compatibility metadata such as `openai/outputTemplate` and `openai/widgetCSP`. Shared MCP and Claude targets keep the standard `ui` metadata primary.

Widget code is React. Use `@sidecar/react` for hooks around tool results, tool calls, model messages, and model context updates.

Platform file variants let one tool keep a shared baseline while specializing only where needed:

```text
server/
  report/
    tool.ts              # shared MCP/ChatGPT/Claude tool
    widget.tsx           # shared widget
    widget.openai.tsx    # ChatGPT override
    widget.anthropic.tsx # Claude override
```

`tool.openai.ts` and `tool.anthropic.ts` override the shared tool only for the matching target. `widget.openai.tsx` and `widget.anthropic.tsx` override only the UI for that target; other targets still expose the shared tool and fall back to the tool's `content` when no widget is available.

Runtime host features should go through `@sidecar/native`, which feature-detects the current host and returns `{ ok: false, reason: "unsupported" }` when a capability is absent:

```ts
import { display, files, links } from "@sidecar/native";

await display.request("fullscreen");
await files.download(JSON.stringify(data), {
  filename: "report.json",
  mimeType: "application/json"
});
await links.openExternal("https://example.com");
```

Use `@sidecar/native/components` for portable controls that auto-style at runtime. Use `@sidecar/openai/components` when a widget is intentionally ChatGPT-only and needs the official OpenAI Apps SDK UI components. Use `@sidecar/anthropic/components` when a widget is intentionally Claude-only and should use Sidecar's reconstructed Claude component recipes.

Optional ChatGPT descriptor metadata is typed through `hosts.chatgpt`:

```ts
import { tool, toolResult } from "@sidecar/core";
import type { ChatGptToolOptions } from "@sidecar/openai";

export default tool({
  name: "Review Expense Report",
  description: "Use this when the user wants policy issues for one expense report.",
  hosts: {
    chatgpt: {
      invoking: "Reviewing expense report",
      invoked: "Expense report reviewed"
    } satisfies ChatGptToolOptions
  },
  execute(params: { reportId: string }) {
    return toolResult({
      structuredContent: { status: "ready" },
      content: `Expense report ${params.reportId} is ready.`
    });
  }
});
```

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
import { tool, toolResult } from "@sidecar/core";
import { scopes } from "../../auth.js";

export default tool({
  name: "Review Expense Report",
  description: "Use this to review one expense report for policy issues.",
  auth: {
    scopes: [scopes.expensesRead]
  },
  async execute(params: { reportId: string }, ctx) {
    const review = await ctx.services.expenses.review(params.reportId, {
      orgId: ctx.auth.orgId
    });

    return toolResult({
      structuredContent: review,
      content: `Reviewed expense report ${params.reportId}.`
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

`hooks.json` at the project root is copied into the generated Claude plugin as `hooks/hooks.json`. Sidecar keeps hook generation conservative for now because hook semantics are host-specific and can block or mutate tool flows.

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
