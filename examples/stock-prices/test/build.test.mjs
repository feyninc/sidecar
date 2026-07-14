import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(rootDir, ".test-output");

test("builds a two-tool MCP with one interactive widget", { timeout: 60_000 }, async () => {
  await rm(outDir, { recursive: true, force: true });
  try {
    await npm(["run", "build:chatgpt", "--", "--out", outDir, "--no-plugins"]);
    const manifest = JSON.parse(
      await readFile(path.join(outDir, "manifest.sidecar.json"), "utf8"),
    );
    assert.deepEqual(
      manifest.tools.map((tool) => tool.id).sort(),
      ["getCurrentPrice", "showLivePrices"],
    );
    const dataTool = manifest.tools.find((tool) => tool.id === "getCurrentPrice");
    const renderTool = manifest.tools.find((tool) => tool.id === "showLivePrices");
    assert.equal(Boolean(dataTool?.widget), false);
    assert.ok(renderTool?.widget?.outputFile);
    assert.equal(
      renderTool.descriptor._meta["openai/outputTemplate"],
      renderTool.widget.resourceUri,
    );
    assert.deepEqual(renderTool.descriptor._meta.ui.visibility, ["model", "app"]);

    const widget = await readFile(path.join(outDir, renderTool.widget.outputFile), "utf8");
    assert.match(widget, /Companies in chart/);
    assert.match(widget, /getCurrentPrice/);
    assert.doesNotMatch(widget, /Reference data only|Price timestamps shown per ticker/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

async function npm(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      cwd: rootDir,
      env: { ...process.env, MARKET_DATA_PROVIDER: "yahoo" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) return resolve();
      reject(
        new Error(
          `npm ${args.join(" ")} failed with exit code ${code}\n${Buffer.concat(stdout).toString("utf8")}${Buffer.concat(stderr).toString("utf8")}`,
        ),
      );
    });
  });
}
