# Sidecar

Sidecar is an opinionated TypeScript framework for building interactive MCP apps once and targeting ChatGPT and Claude.

It gives you a Next.js-style project structure for MCP:

- write tools as normal TypeScript functions
- write widgets as React components
- use typed helpers instead of raw JSON-RPC and metadata strings
- generate MCP apps and Claude plugin packages from the same source tree
- keep platform-specific features in `@sidecar-ai/openai` and `@sidecar-ai/anthropic`

Sidecar is currently alpha. The core API is usable, but public docs, deployment polish, and larger examples are still evolving.

## Create An App

```sh
npm create sidecar-app@latest my-app
cd my-app
npm install
npm run dev
```

For an existing project:

```sh
npm install sidecar-ai
```

For an HTTPS MCP URL that can be added to ChatGPT or Claude:

```sh
npm run dev:https
```

`sidecar dev --tunnel` starts Sidecar on Streamable HTTP, opens a temporary HTTPS tunnel, and validates the public MCP endpoint before printing the URL. Sidecar tries `cloudflared` first. If it is missing, the CLI asks whether to install `cloudflared` or continue with `npx wrangler`.

The generated tunnel URL is public and unprotected unless your app has `auth.ts`, `proxy.ts`, or upstream network controls in place. Treat tunneled dev servers as temporary test endpoints, avoid sensitive data, and stop the process when you are done. Quick tunnels are still best-effort infrastructure; for repeatable team testing, use a configured tunnel/domain or a deployed preview.

## Project Structure

```txt
my-app/
  sidecar.config.ts
  style.css
  auth.ts                # optional
  proxy.ts               # optional
  server/
    add-numbers/
      tool.ts
      widget.tsx         # optional React UI for the tool
  resources/
    company-handbook/
      resource.ts
  prompts/
    review-expense/
      prompt.ts
```

Folder names become stable machine ids by default:

- `server/add-numbers/tool.ts` becomes tool id `add-numbers`
- `resources/company-handbook/resource.ts` becomes URI `sidecar://resources/company-handbook`
- `prompts/review-expense/prompt.ts` becomes prompt name `review-expense`

You can override ids and URIs when you need to.

## App Config

```ts
import { defineConfig } from "sidecar-ai";

export default defineConfig({
  name: "Expense Review",
  version: "0.1.0",
  description: "Review expense reports with MCP tools and widgets.",
  pagination: {
    pageSize: 10
  }
});
```

Sidecar uses `sidecar.config.ts` for app identity, generated manifests, plugin metadata, and MCP capability settings.

## Tools

Tools live in `server/<tool-id>/tool.ts`.

```ts
import { tool, toolResult } from "sidecar-ai";

type Params = {
  /** First number to add. */
  a: number;
  /** Second number to add. */
  b: number;
};

type Result = {
  /** Sum of the two input numbers. */
  sum: number;
};

export default tool({
  name: "Add Numbers",
  description: "Use this when the user wants to add two numbers.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  },
  execute(params: Params) {
    const structuredContent: Result = {
      sum: params.a + params.b
    };

    return toolResult({
      structuredContent,
      content: `The sum is ${structuredContent.sum}.`
    });
  }
});
```

Every tool returns `toolResult(...)`. Sidecar keeps the MCP result channels explicit:

- `structuredContent`: typed data for widgets and clients
- `content`: model-visible content
- `meta`: optional host/widget-only metadata

`execute` can be sync or async.

## Widgets

Place `widget.tsx` next to a tool to give it UI.

```tsx
import { widget, useToolResult } from "@sidecar-ai/react";

type Result = {
  sum: number;
};

function AddNumbersWidget() {
  const { structuredContent } = useToolResult<Result>();

  return (
    <main style={{ padding: 16 }}>
      <h1>Sum</h1>
      <output>{structuredContent?.sum ?? "--"}</output>
    </main>
  );
}

export default widget(
  {
    description: "Shows the computed sum from the Add Numbers tool.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  AddNumbersWidget
);
```

Sidecar bundles widgets into content-hashed `ui://...` resources and emits the MCP Apps metadata needed for hosts to render them. Cache-busting widget URIs are generated automatically when UI output changes.

Widget code is React. The iframe still supports normal CSS, Tailwind, and any React component library you choose.

## Resources

Resources expose readable MCP context.

```ts
import { resource, resourceResult } from "sidecar-ai";

export default resource({
  name: "Company Handbook",
  description: "Reference handbook for expense policy.",
  mimeType: "text/markdown",
  annotations: {
    audience: ["assistant"],
    priority: 0.7
  },
  read() {
    return resourceResult({
      content: "# Handbook\n\nExpense reports need receipts.",
      mimeType: "text/markdown"
    });
  }
});
```

`resourceResult(...)` mirrors `toolResult(...)`: it is the required Sidecar envelope that lowers to MCP `resources/read`.

## Prompts

Prompts expose reusable MCP prompt templates.

```ts
import { prompt } from "sidecar-ai";

export default prompt({
  title: "Review Expense",
  description: "Creates an expense review request.",
  args: {
    reportId: "Expense report id to review.",
    severity: {
      description: "How urgent the review is.",
      required: false
    }
  },
  run({ reportId, severity }: { reportId: string; severity?: string }) {
    return `Review expense report ${reportId}. Urgency: ${severity ?? "normal"}.`;
  }
});
```

Returning a string creates one MCP user text message. Advanced prompts can return many MCP prompt messages directly.

## Pagination

Sidecar paginates the MCP list operations that support cursors:

- `tools/list`
- `resources/list`
- `resources/templates/list`
- `prompts/list`

The default page size is `10`. Override globally or per operation:

```ts
import { defineConfig, offsetPagination } from "sidecar-ai";

export default defineConfig({
  name: "Acme",
  version: "0.1.0",
  description: "Acme MCP app.",
  pagination: {
    pageSize: 10,
    override: {
      default({ items, cursor, pageSize }) {
        return offsetPagination({ items, cursor, pageSize });
      },
      toolsList({ items, cursor, pageSize, auth }) {
        return offsetPagination({
          items: items.filter((tool) => canUseTool(auth, tool)),
          cursor,
          pageSize
        });
      }
    }
  }
});
```

Clients treat cursors as opaque. The server decides page size.

## Styling And Native Components

Sidecar imports `@sidecar-ai/native/styles.css` before your root `style.css`.

Use `style.css` for:

- Tailwind entrypoints
- app-wide layout classes
- product tokens
- intentional native token overrides

Use portable native components when you want controls that adapt to the current host:

```tsx
import { Button, Text, Surface } from "@sidecar-ai/native/components";

export function ReviewPanel() {
  return (
    <Surface>
      <Text>Ready for review.</Text>
      <Button color="primary">Approve</Button>
    </Surface>
  );
}
```

Use platform packages when you intentionally want host-specific APIs or components:

- `@sidecar-ai/openai`
- `@sidecar-ai/openai/components`
- `@sidecar-ai/anthropic`
- `@sidecar-ai/anthropic/components`

Sidecar warns when shared widgets import platform-specific features without an obvious platform boundary.

## Platform Files

Use platform-specific files when a tool or widget should differ by host:

```txt
server/
  report/
    tool.ts
    widget.tsx
    tool.openai.ts
    widget.openai.tsx
    tool.anthropic.ts
    widget.anthropic.tsx
```

Build targets select the matching files:

```sh
sidecar build --target mcp
sidecar build --target chatgpt
sidecar build --target claude --plugins
```

`mcp` uses only standard MCP behavior. `chatgpt` and `claude` add platform-specific output where supported.

## Auth And Proxy

`auth.ts` owns MCP/OAuth resource-server behavior. Your auth provider still validates tokens.

```ts
import { auth, scope, type AuthSession } from "sidecar-ai";

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

Tool policy lives with the tool:

```ts
import { tool, toolResult } from "sidecar-ai";
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

`proxy.ts` is for HTTP middleware such as origins, request ids, and rate limits:

```ts
import { origin, proxy, rateLimit, requestId } from "@sidecar-ai/server/proxy";

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

## Claude Plugin Pieces

Claude plugin-specific pieces can be authored as TypeScript and generated into plugin files.

Agents:

```txt
agents/
  review-writer/
    agent.ts
```

```ts
import { agent } from "@sidecar-ai/anthropic/plugin";

export default agent({
  name: "review-writer",
  description: "Use to draft concise expense review summaries.",
  tools: ["Read", "Grep"],
  disallowedTools: ["Write"],
  prompt: "Draft concise expense review summaries from Sidecar tool results."
});
```

Hooks:

```txt
hooks/
  protect-writes/
    hook.ts
```

```ts
import { commandHook, hook } from "@sidecar-ai/anthropic/hooks";

export default hook({
  event: "PreToolUse",
  matcher: "Write",
  run: [commandHook("echo checking write permissions")]
});
```

Slash commands:

```ts
import { command } from "@sidecar-ai/anthropic/plugin";

export default command({
  name: "review-summary",
  description: "Draft a short expense review summary.",
  argumentHint: "[report-id]",
  allowedTools: ["expenses.review"],
  prompt: "Draft a concise review summary for the current expense report."
});
```

## Commands

Inside a Sidecar app:

```sh
npm run dev          # local Streamable HTTP MCP server
npm run dev:https    # local server plus HTTPS tunnel
npm run check        # diagnostics
npm run inspect      # list detected tools
npm run build        # build MCP and plugin artifacts
```

Direct CLI usage:

```sh
sidecar dev --port 3101
sidecar dev --tunnel
sidecar check --strict
sidecar build --target mcp
sidecar build --target chatgpt
sidecar build --target claude --plugins
```

`sidecar check` prints diagnostics as `file:line:column` messages. Build and dev print the same diagnostics. Use `// sidecar-ignore DIAGNOSTIC_CODE` when an exception is intentional.

## Build Output

```txt
out/
  mcp/
    manifest.sidecar.json
    public/widgets/...
  chatgpt/
    manifest.sidecar.json
    public/widgets/...
  claude/
    manifest.sidecar.json
  claude-plugin/
    .claude-plugin/plugin.json
    .mcp.json
    skills/
    commands/
    hooks/
    agents/
```

The MCP server itself still needs to be hosted somewhere. Claude plugin packages reference the hosted MCP URL instead of bundling the server. After hosting the MCP server, update the generated `claude-plugin/.mcp.json` URL from the placeholder to your real HTTPS MCP endpoint before sharing or installing the plugin.

## Developing Sidecar Itself

This repository is a monorepo:

```txt
packages/
  sidecar-ai/
  core/
  cli/
  compiler/
  server/
  native/
  openai/
  anthropic/
examples/
  simple/
```

Package releases are cut from GitHub Actions using npm trusted publishing. See
[RELEASE.md](./RELEASE.md) for the maintainer workflow.

Contributor commands:

```sh
npm install
npm run typecheck
npm test
npm run build
node dist/cli/index.js build --cwd examples/simple --target chatgpt
```
