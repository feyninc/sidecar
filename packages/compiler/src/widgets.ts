/** Widget discovery and HTML bundling. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { build as esbuild } from "esbuild";
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

  for (const entry of widgets) {
    const sourceFile = path.join(rootDir, entry.widget.sourceFile);
    const safeId = safePathSegment(entry.id);
    const entryFile = path.join(cacheDir, `${safeId}.entry.tsx`);
    const importPath = toImportSpecifier(path.dirname(entryFile), sourceFile);

    await writeFile(
      entryFile,
      `import React from "react";
import { createRoot } from "react-dom/client";
import Component from ${JSON.stringify(importPath)};

createRoot(document.getElementById("root")!).render(React.createElement(Component));
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

    const javascript =
      bundled.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
    const html = renderWidgetHtml(entry.name, javascript);
    const hash = createHash("sha256").update(html).digest("hex").slice(0, 12);
    const outputDir = path.join(outDir, "public", "widgets", safeId);
    const outputFile = path.join(outputDir, `widget.${hash}.html`);
    const resourceUri = `ui://${safeId}/widget.${hash}.html`;

    await mkdir(outputDir, { recursive: true });
    await writeFile(outputFile, html);

    entry.widget.resourceUri = resourceUri;
    entry.widget.outputFile = path.relative(outDir, outputFile);
    entry.descriptor._meta = widgetMeta(resourceUri);
  }
}

/** Finds a sibling `widget.tsx` for a tool file. */
export function findWidget(
  rootDir: string,
  toolFile: string,
  id: string,
): SidecarWidgetManifestEntry | undefined {
  const widgetFile = path.join(path.dirname(toolFile), "widget.tsx");
  if (!existsSync(widgetFile)) {
    return undefined;
  }

  const safeId = safePathSegment(id);
  return {
    sourceFile: path.relative(rootDir, widgetFile),
    resourceUri: `ui://${safeId}/widget.html`,
  };
}

/** Builds standard and ChatGPT-compatible widget metadata for a descriptor. */
export function widgetMeta(resourceUri: string): Record<string, unknown> {
  return {
    ui: { resourceUri },
    "openai/outputTemplate": resourceUri,
  };
}

/** Wraps bundled JavaScript in the minimal transparent widget document. */
function renderWidgetHtml(title: string, javascript: string): string {
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
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>${javascript}</script>
  </body>
</html>
`;
}
