/** Widget discovery and HTML bundling. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build as esbuild } from "esbuild";
import postcss from "postcss";
import type { ToolWidgetOptions } from "@sidecar/core";
import type { SidecarToolManifestEntry, SidecarWidgetManifestEntry } from "./types.js";
import { escapeHtml, safePathSegment, toImportSpecifier } from "./utils.js";

/** Bundles every discovered `widget.tsx` into a content-hashed HTML resource. */
export async function buildWidgets(
  rootDir: string,
  outDir: string,
  tools: SidecarToolManifestEntry[],
): Promise<void> {
  const widgets = tools.filter(
    (
      entry,
    ): entry is SidecarToolManifestEntry & {
      widget: SidecarWidgetManifestEntry;
    } => Boolean(entry.widget),
  );
  if (!widgets.length) {
    return;
  }

  const cacheDir = path.join(rootDir, ".sidecar", "cache", "widgets");
  await mkdir(cacheDir, { recursive: true });
  const appStyle = await prepareAppStyle(rootDir, cacheDir);

  for (const entry of widgets) {
    const sourceFile = path.join(rootDir, entry.widget.sourceFile);
    const safeId = safePathSegment(entry.id);
    const entryFile = path.join(cacheDir, `${safeId}.entry.tsx`);
    const importPath = toImportSpecifier(path.dirname(entryFile), sourceFile);

    await writeFile(
      entryFile,
      `import React from "react";
import { createRoot } from "react-dom/client";
import { SidecarWidgetRoot } from "@sidecar/react";
import "@sidecar/native/styles.css";
${appStyle ? `import ${JSON.stringify(toImportSpecifier(path.dirname(entryFile), appStyle))};` : ""}
import Component from ${JSON.stringify(importPath)};

createRoot(document.getElementById("root")!).render(
  React.createElement(SidecarWidgetRoot, null, React.createElement(Component))
);
`,
    );

    const bundled = await esbuild({
      absWorkingDir: rootDir,
      bundle: true,
      entryPoints: [entryFile],
      format: "iife",
      jsx: "automatic",
      minify: false,
      nodePaths: [
        path.join(rootDir, "node_modules"),
        path.join(process.cwd(), "node_modules"),
      ],
      outfile: "widget.js",
      platform: "browser",
      sourcemap: false,
      write: false,
    });

    const javascript = bundled.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
    const css = bundled.outputFiles
      .filter((file) => file.path.endsWith(".css"))
      .map((file) => file.text)
      .join("\n");
    const html = renderWidgetHtml(entry.name, javascript, css);
    const hash = createHash("sha256").update(html).digest("hex").slice(0, 12);
    const outputDir = path.join(outDir, "public", "widgets", safeId);
    const outputFile = path.join(outputDir, `widget.${hash}.html`);
    const resourceUri = `ui://${safeId}/widget.${hash}.html`;

    await mkdir(outputDir, { recursive: true });
    await writeFile(outputFile, html);

    entry.widget.resourceUri = resourceUri;
    entry.widget.outputFile = path.relative(outDir, outputFile);
    entry.descriptor._meta = mergeWidgetMeta(entry.descriptor._meta, widgetMeta(resourceUri, entry.widget.options));
  }
}

/** Copies and optionally processes root `style.css` for widget builds. */
async function prepareAppStyle(rootDir: string, cacheDir: string): Promise<string | undefined> {
  const sourceFile = path.join(rootDir, "style.css");
  if (!existsSync(sourceFile)) {
    return undefined;
  }

  const source = await readFile(sourceFile, "utf8");
  const css = await processAppStyle(source, sourceFile);
  const outputFile = path.join(cacheDir, "style.css");
  await writeFile(outputFile, css);
  return outputFile;
}

/** Runs Tailwind/PostCSS only when the app stylesheet needs it. */
async function processAppStyle(source: string, from: string): Promise<string> {
  if (!needsPostcss(source)) {
    return source;
  }

  const cssSource = source
    .replace(/@import\s+["']tailwindcss["'];?/g, "@tailwind utilities;")
    .replace(/@import\s+["']@openai\/apps-sdk-ui\/css["'];?/g, "");
  const plugins = [];
  if (cssSource.includes("@tailwind")) {
    const tailwind = await import("@tailwindcss/postcss");
    plugins.push(tailwind.default({ base: path.dirname(from) }));
  }

  const autoprefixer = await import("autoprefixer");
  plugins.push(autoprefixer.default());

  const result = await postcss(plugins).process(cssSource, {
    from,
    map: false,
  });
  return result.css;
}

/** Returns true when CSS contains framework directives that esbuild does not own. */
function needsPostcss(source: string): boolean {
  return /@import\s+["']tailwindcss["']|@tailwind|@source|@theme|@plugin/.test(source);
}

/** Finds a sibling `widget.tsx` for a tool file. */
export function findWidget(
  rootDir: string,
  toolFile: string,
  id: string,
  options?: ToolWidgetOptions,
): SidecarWidgetManifestEntry | undefined {
  const widgetFile = path.join(path.dirname(toolFile), "widget.tsx");
  if (!existsSync(widgetFile)) {
    return undefined;
  }

  const safeId = safePathSegment(id);
  return {
    sourceFile: path.relative(rootDir, widgetFile),
    resourceUri: `ui://${safeId}/widget.html`,
    options,
  };
}

/** Builds standard and ChatGPT-compatible widget metadata for a descriptor. */
export function widgetMeta(resourceUri: string, options: ToolWidgetOptions = {}): Record<string, unknown> {
  const csp = {
    connectDomains: options.csp?.connectDomains ? [...options.csp.connectDomains] : [],
    resourceDomains: options.csp?.resourceDomains ? [...options.csp.resourceDomains] : [],
    frameDomains: options.csp?.frameDomains ? [...options.csp.frameDomains] : undefined,
  };
  const chatgptCsp = {
    connect_domains: csp.connectDomains,
    resource_domains: csp.resourceDomains,
    frame_domains: csp.frameDomains,
    redirect_domains: options.hosts?.chatgpt?.redirectDomains
      ? [...options.hosts.chatgpt.redirectDomains]
      : undefined,
  };

  return {
    ui: {
      resourceUri,
      prefersBorder: options.prefersBorder,
      csp: stripUndefined(csp),
    },
    "openai/outputTemplate": resourceUri,
    "openai/widgetDescription": options.description,
    "openai/widgetDomain": options.hosts?.chatgpt?.domain,
    "openai/widgetCSP": stripUndefined(chatgptCsp),
  };
}

/** Merges widget metadata into existing descriptor metadata without losing `ui`. */
export function mergeWidgetMeta(
  existing: Record<string, unknown> | undefined,
  widget: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(widget)) {
    if (key === "ui" && isRecord(value) && isRecord(merged.ui)) {
      merged.ui = { ...merged.ui, ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/** Wraps bundled JavaScript in the minimal transparent widget document. */
function renderWidgetHtml(title: string, javascript: string, css = ""): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      html, body, #root { min-height: 100%; margin: 0; background: transparent; }
      body { color: CanvasText; }
      * { box-sizing: border-box; }
      ${css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>${javascript}</script>
  </body>
</html>
`;
}

/** Returns true for metadata objects that can be shallow-merged. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Drops undefined keys from emitted metadata objects. */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
