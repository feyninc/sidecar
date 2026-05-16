#!/usr/bin/env node
/**
 * Project scaffolder for `npm create sidecar-app`.
 *
 * The generated project intentionally stays small: one public tool, one React
 * widget, and the config needed to run `sidecar dev`.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cwd, exit } from "node:process";

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

  await writeProject(targetDir, appName);

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
async function writeProject(rootDir: string, appName: string): Promise<void> {
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
            build: "sidecar build --plugins",
            inspect: "sidecar inspect",
          },
          dependencies: {
            "@sidecar/cli": "latest",
            "@sidecar/core": "latest",
            "@sidecar/native": "latest",
            "@sidecar/react": "latest",
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
    ),
    writeFileIfNew(path.join(rootDir, "tsconfig.json"), tsconfigTemplate()),
    writeFileIfNew(
      path.join(rootDir, "sidecar.config.ts"),
      sidecarConfigTemplate(appName),
    ),
    writeFileIfNew(path.join(rootDir, ".gitignore"), gitignoreTemplate()),
    writeFileIfNew(path.join(rootDir, "README.md"), readmeTemplate(appName)),
    writeFileIfNew(
      path.join(rootDir, "server", "add-numbers", "tool.ts"),
      toolTemplate(),
    ),
    writeFileIfNew(
      path.join(rootDir, "server", "add-numbers", "widget.tsx"),
      widgetTemplate(),
    ),
  ]);
}

/** Writes a file only when the scaffold target does not already exist. */
async function writeFileIfNew(filePath: string, content: string): Promise<void> {
  if (existsSync(filePath)) {
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

  return `export default {
  name: ${JSON.stringify(displayName)},
  version: "0.1.0",
  description: "A Sidecar MCP app."
};
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
      include: ["server/**/*.ts", "server/**/*.tsx", "sidecar.config.ts"],
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

## Commands

\`\`\`sh
npm run dev
npm run build
npm run inspect
\`\`\`
`;
}

/** Template for the starter tool declaration. */
function toolTemplate(): string {
  return `/** Public starter tool generated by create-sidecar-app. */
import { tool } from "@sidecar/core";

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
  execute(params: Params): Result {
    return { sum: params.a + params.b };
  }
});
`;
}

/** Template for the starter React widget. */
function widgetTemplate(): string {
  return `/** Starter React widget generated by create-sidecar-app. */
import { useToolResult } from "@sidecar/react";

type Result = {
  sum: number;
};

/** Renders the structured result from the sibling Add Numbers tool. */
export default function AddNumbersWidget() {
  const { structured } = useToolResult<Result>();

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Sum</h1>
      <output style={{ display: "block", fontSize: 32, fontWeight: 650 }}>
        {structured?.sum ?? "--"}
      </output>
    </main>
  );
}
`;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
});
