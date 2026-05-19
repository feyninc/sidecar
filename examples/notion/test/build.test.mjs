import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testOutRoot = path.join(rootDir, "out", "test");
const outDir = path.join(testOutRoot, "vercel");

test("builds the Notion MCP as a standalone published-Sidecar consumer", { timeout: 60_000 }, async () => {
  await rm(testOutRoot, { recursive: true, force: true });

  try {
    await sidecar(["build", "--host", "vercel", "--out", "out/test/vercel", "--plugins"]);

    const manifest = JSON.parse(
      await readFile(path.join(outDir, "manifest.sidecar.json"), "utf8"),
    );
    assert.equal(manifest.host, "vercel");
    assert.equal(manifest.target, "mcp");
    assert.equal(manifest.tools.length, 18);
    assert.deepEqual(
      manifest.tools.map((tool) => tool.id).sort(),
      [
        "notion-create-comment",
        "notion-create-database",
        "notion-create-pages",
        "notion-create-view",
        "notion-duplicate-page",
        "notion-fetch",
        "notion-get-comments",
        "notion-get-self",
        "notion-get-teams",
        "notion-get-user",
        "notion-get-users",
        "notion-move-pages",
        "notion-query-data-sources",
        "notion-query-database-view",
        "notion-search",
        "notion-update-data-source",
        "notion-update-page",
        "notion-update-view",
      ],
    );
    assert.ok(manifest.tools.every((tool) => tool.widget));
    assert.ok(
      manifest.tools.every((tool) =>
        tool.descriptor.securitySchemes?.some((scheme) => scheme.type === "oauth2"),
      ),
    );

    const update = manifest.tools.find((tool) => tool.id === "notion-update-page");
    assert.ok(update?.widget?.outputFile);
    assert.equal(update?.descriptor.annotations?.destructiveHint, true);
    assert.match(
      await readFile(path.join(outDir, update.widget.outputFile), "utf8"),
      /notion-document-peek/,
    );
    assert.match(await readFile(path.join(outDir, "api", "sidecar.js"), "utf8"), /server\/index\.js/);
    assert.match(await readFile(path.join(outDir, "vercel.json"), "utf8"), /api\/sidecar/);
    assert.match(
      await readFile(path.join(testOutRoot, "claude-plugin", ".mcp.json"), "utf8"),
      /\$\{SIDECAR_MCP_URL\}/,
    );
  } finally {
    await rm(testOutRoot, { recursive: true, force: true });
  }
});

async function sidecar(args) {
  const bin = path.join(
    rootDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "sidecar.cmd" : "sidecar",
  );

  await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `sidecar ${args.join(" ")} failed with exit code ${code}\n${Buffer.concat(stdout).toString("utf8")}${Buffer.concat(stderr).toString("utf8")}`,
        ),
      );
    });
  });
}
