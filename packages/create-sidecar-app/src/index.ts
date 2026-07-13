#!/usr/bin/env node
/**
 * Project scaffolder for `npm create sidecar-app`.
 *
 * The generated project intentionally stays small: one public tool, one React
 * widget, and the config needed to run `sidecar dev`.
 */
import { existsSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cwd, exit } from "node:process";
import { pathToFileURL } from "node:url";

type CreateOptions = {
  directory: string;
  force: boolean;
};

/** Parses CLI arguments and writes the target starter project. */
async function main(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  const targetDir = path.resolve(cwd(), options.directory);
  const appName = toPackageName(path.basename(targetDir));

  if (existsSync(targetDir) && !options.force) {
    throw new Error(
      `${targetDir} already exists. Pass --force to write into it.`,
    );
  }

  await writeProject(targetDir, appName, options.force);

  console.log(`Created Sidecar app in ${targetDir}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${formatShellPath(targetDir)}`);
  console.log("  npm install");
  console.log("  npm run dev");
}

/** Parses the app directory and force flag from argv. */
function parseArgs(argv: string[]): CreateOptions {
  const directory = argv.find((arg) => !arg.startsWith("-")) ?? "sidecar-app";

  return {
    directory,
    force: argv.includes("--force"),
  };
}

/** Writes the starter project files. */
async function writeProject(rootDir: string, appName: string, force: boolean): Promise<void> {
  const sidecarVersion = "0.1.0-alpha.16";
  await mkdir(rootDir, { recursive: true });
  await Promise.all([
    writeFileIfNew(
      path.join(rootDir, "package.json"),
      `${JSON.stringify(
        {
          name: appName,
          private: true,
          type: "module",
          scripts: {
            dev: "sidecar dev",
            "dev:https": "sidecar dev --tunnel",
            build: "sidecar build",
            check: "sidecar check",
            inspect: "sidecar inspect",
          },
          dependencies: {
            "sidecar-ai": sidecarVersion,
            react: "^19.0.0",
            "react-dom": "^19.0.0",
          },
          devDependencies: {
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            typescript: "^5.9.0",
          },
        },
        null,
        2,
      )}\n`,
      force,
    ),
    writeFileIfNew(path.join(rootDir, "tsconfig.json"), tsconfigTemplate(), force),
    writeFileIfNew(
      path.join(rootDir, "sidecar.config.ts"),
      sidecarConfigTemplate(appName),
      force,
    ),
    writeFileIfNew(path.join(rootDir, "style.css"), styleTemplate(), force),
    writeFileIfNew(path.join(rootDir, ".gitignore"), gitignoreTemplate(), force),
    writeFileIfNew(path.join(rootDir, "README.md"), readmeTemplate(appName), force),
    writeFileIfNew(
      path.join(rootDir, "server", "add-numbers", "tool.ts"),
      toolTemplate(),
      force,
    ),
    writeFileIfNew(
      path.join(rootDir, "server", "add-numbers", "widget.tsx"),
      widgetTemplate(),
      force,
    ),
    writeFileIfNew(
      path.join(rootDir, "resources", "readme", "resource.ts"),
      resourceTemplate(),
      force,
    ),
    writeFileIfNew(
      path.join(rootDir, "prompts", "summarize", "prompt.ts"),
      promptTemplate(),
      force,
    ),
  ]);
}

/** Writes a file only when the scaffold target does not already exist. */
async function writeFileIfNew(filePath: string, content: string, force = false): Promise<void> {
  if (existsSync(filePath) && !force) {
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

/** Converts a directory name into an npm-safe package name. */
function toPackageName(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "sidecar-app"
  );
}

/** Returns a readable path for the printed `cd` command. */
function formatShellPath(targetDir: string): string {
  const relative = path.relative(cwd(), targetDir);
  if (relative && !relative.startsWith("..")) {
    return relative;
  }

  return targetDir;
}

/** Template for `sidecar.config.ts`. */
function sidecarConfigTemplate(appName: string): string {
  const displayName = appName
    .split(/[-_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return `import { defineConfig } from "sidecar-ai";

export default defineConfig({
  name: ${JSON.stringify(displayName)},
  version: "0.1.0",
  description: "A Sidecar MCP app.",
  build: {
    plugins: true
  },
  pagination: {
    pageSize: 50
  }
});
`;
}

/** Template for app-wide widget CSS and Tailwind entrypoint. */
export function styleTemplate(): string {
  return `/*
 * App-wide widget CSS.
 *
 * Sidecar automatically loads @sidecar-ai/native/styles.css before this file.
 * Keep this file for normal app CSS: Tailwind, product tokens, layout classes,
 * charts, tables, and intentional overrides.
 *
 * Stable native override tokens:
 *   --sc-font-sans
 *   --sc-font-mono
 *   --sc-primary
 *   --sc-primary-text
 *   --sc-radius-sm
 *   --sc-radius-md
 *   --sc-radius-lg
 *   --sc-focus
 *   --sc-control-height
 *
 * Leave --sc-* tokens unset unless you intentionally want to brand native
 * controls away from the host defaults. Use --app-* tokens for app UI first.
 */
@import "tailwindcss";
@source "./server/**/*.{ts,tsx}";

:root {
  color-scheme: light dark;
  background: transparent;

  --app-font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --app-surface: transparent;
  --app-text: CanvasText;
  --app-muted: color-mix(in srgb, CanvasText 64%, transparent);
  --app-border: color-mix(in srgb, CanvasText 14%, transparent);

  /*
   * Example native overrides:
   * --sc-primary: #2563eb;
   * --sc-primary-text: #ffffff;
   * --sc-radius-md: 10px;
   */
}

html,
body,
#root {
  min-height: 100%;
  margin: 0;
  background: transparent;
}

body {
  color: var(--app-text);
  font-family: var(--app-font-sans);
}
`;
}

/** Template for the starter TypeScript config. */
function tsconfigTemplate(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM"],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        jsx: "react-jsx",
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      },
      include: [
        "server/**/*.ts",
        "server/**/*.tsx",
        "resources/**/*.ts",
        "prompts/**/*.ts",
        "sidecar.config.ts"
      ],
    },
    null,
    2,
  )}\n`;
}

/** Template for starter ignored files. */
function gitignoreTemplate(): string {
  return `node_modules
out
.sidecar
dist
.env
`;
}

/** Template for starter README. */
function readmeTemplate(appName: string): string {
  return `# ${appName}

This is a Sidecar MCP app.

## Styling

Sidecar loads \`@sidecar-ai/native/styles.css\` before your app \`style.css\`.
Use \`style.css\` for Tailwind, app tokens, layout classes, and intentional
native token overrides. The generated stylesheet documents the stable
\`--sc-*\` tokens you can override.

## Commands

\`\`\`sh
npm run dev
npm run dev:https
npm run check
npm run build
npm run inspect
\`\`\`
`;
}

/** Template for the starter MCP resource. */
function resourceTemplate(): string {
  return `/** Starter MCP resource generated by create-sidecar-app. */
import { resource, resourceResult } from "sidecar-ai";

export default resource({
  name: "Readme",
  description: "Small context resource for the starter app.",
  mimeType: "text/markdown",
  read() {
    return resourceResult({
      content: "# Starter Resource\\n\\nThis resource is served through MCP resources/read.",
      mimeType: "text/markdown"
    });
  }
});
`;
}

/** Template for the starter MCP prompt. */
function promptTemplate(): string {
  return `/** Starter MCP prompt generated by create-sidecar-app. */
import { prompt } from "sidecar-ai";

export default prompt({
  title: "Summarize",
  description: "Creates a short summarization request.",
  args: {
    topic: "Topic to summarize."
  },
  run({ topic }: { topic: string }) {
    return \`Summarize \${topic} in three concise bullets.\`;
  }
});
`;
}

/** Template for the starter tool declaration. */
function toolTemplate(): string {
  return `/** Public starter tool generated by create-sidecar-app. */
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
    const sum = params.a + params.b;
    const structuredContent: Result = { sum };

    return toolResult({
      structuredContent,
      content: \`The sum is \${sum}.\`
    });
  }
});
`;
}

/** Template for the starter React widget. */
function widgetTemplate(): string {
  return `/** Starter React widget generated by create-sidecar-app. */
import { useToolResult, widget } from "@sidecar-ai/react";

type Result = {
  sum: number;
};

/** Renders the structured result from the sibling Add Numbers tool. */
function AddNumbersWidget() {
  const { structuredContent } = useToolResult<Result>();

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Sum</h1>
      <output style={{ display: "block", fontSize: 32, fontWeight: 650 }}>
        {structuredContent?.sum ?? "--"}
      </output>
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
`;
}

/** Returns true when this file is being run as the CLI entrypoint. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  const entryPath = realpathSync.native(entry);
  return import.meta.url === pathToFileURL(entryPath).href;
}

if (isDirectRun()) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    exit(1);
  });
}
