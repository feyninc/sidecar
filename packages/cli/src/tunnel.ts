/** HTTPS tunnel helpers for local MCP development. */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/** Tunnel backend requested by `sidecar dev --tunnel`. */
export type TunnelProvider = "auto" | "cloudflared" | "wrangler";

/** Running tunnel process and the public MCP endpoint it exposes. */
export type TunnelSession = {
  provider: Exclude<TunnelProvider, "auto">;
  publicUrl: string;
  mcpUrl: string;
  close(): void;
};

/** Options for starting a dev HTTPS tunnel. */
export type StartTunnelOptions = {
  provider: TunnelProvider;
  port: number;
  path?: string;
  timeoutMs?: number;
};

/** Starts an HTTPS tunnel to the local Sidecar dev server. */
export async function startTunnel(options: StartTunnelOptions): Promise<TunnelSession> {
  const provider = await resolveProvider(options.provider);
  const localUrl = `http://127.0.0.1:${options.port}`;
  const path = options.path ?? "/mcp";

  if (provider === "cloudflared") {
    return startCloudflared(localUrl, path, options.timeoutMs);
  }

  return startWrangler(localUrl, path, options.timeoutMs);
}

/** Human-readable install guidance for missing tunnel providers. */
export function tunnelInstallMessage(provider: TunnelProvider = "auto"): string {
  if (provider === "wrangler") {
    return [
      "npx was not found on PATH, so Sidecar cannot run Wrangler quick-start.",
      "Install Node.js/npm, or install cloudflared directly:",
      "  brew install cloudflared",
    ].join("\n");
  }

  return [
    "cloudflared was not found on PATH.",
    "Install cloudflared for the fastest Sidecar tunnel path:",
    "  brew install cloudflared",
    "Or run with Wrangler explicitly:",
    "  sidecar dev --tunnel wrangler",
  ].join("\n");
}

/** Picks the first available tunnel provider for `auto`. */
async function resolveProvider(provider: TunnelProvider): Promise<Exclude<TunnelProvider, "auto">> {
  if (provider === "cloudflared") {
    if (hasCommand("cloudflared")) {
      return "cloudflared";
    }
    if (await promptForCloudflaredInstall()) {
      await installCloudflared();
      return "cloudflared";
    }
    assertNpxAvailable();
    return "wrangler";
  }

  if (provider === "wrangler") {
    assertNpxAvailable();
    return "wrangler";
  }

  if (hasCommand("cloudflared")) {
    return "cloudflared";
  }

  const choice = await promptForMissingCloudflared();
  if (choice === "install") {
    await installCloudflared();
    return "cloudflared";
  }
  if (choice === "wrangler") {
    assertNpxAvailable();
    return "wrangler";
  }

  throw new Error("Cancelled HTTPS tunnel startup.");
}

/** Prompts for whether to install cloudflared for explicit cloudflared requests. */
async function promptForCloudflaredInstall(): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(tunnelInstallMessage("cloudflared"));
  }

  const answer = await question([
    "cloudflared is not installed.",
    "Install cloudflared with Homebrew now? Answer no to continue with npx wrangler. [y/N] ",
  ].join("\n"));
  return answer.trim().toLowerCase().startsWith("y");
}

/** Prompts for the dev fallback every time cloudflared is unavailable. */
async function promptForMissingCloudflared(): Promise<"install" | "wrangler" | "cancel"> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(tunnelInstallMessage("auto"));
  }

  const answer = await question([
    "cloudflared is not installed.",
    "Choose how Sidecar should create an HTTPS MCP URL:",
    "  [i] install cloudflared with Homebrew",
    "  [w] continue with npx wrangler tunnel quick-start",
    "  [c] cancel",
    "Selection [i/w/c]: ",
  ].join("\n"));
  const normalized = answer.trim().toLowerCase();

  if (normalized === "i" || normalized === "install") {
    return "install";
  }
  if (normalized === "w" || normalized === "wrangler") {
    return "wrangler";
  }
  return "cancel";
}

/** Runs a one-shot prompt and always closes the readline interface. */
async function question(prompt: string): Promise<string> {
  const input = createInterface({ input: stdin, output: stdout });
  try {
    return await input.question(prompt);
  } finally {
    input.close();
  }
}

/** Installs cloudflared through Homebrew when available. */
async function installCloudflared(): Promise<void> {
  if (!hasCommand("brew")) {
    throw new Error([
      "Sidecar can only install cloudflared automatically when Homebrew is available.",
      "Install cloudflared manually, then rerun:",
      "  sidecar dev --tunnel",
      "Or continue without installing it:",
      "  sidecar dev --tunnel wrangler",
    ].join("\n"));
  }

  await runInherited("brew", ["install", "cloudflared"]);
}

/** Ensures npx exists before selecting the Wrangler fallback. */
function assertNpxAvailable(): void {
  if (!hasCommand("npx")) {
    throw new Error(tunnelInstallMessage("wrangler"));
  }
}

/** Starts a Cloudflare quick tunnel and waits for its public URL. */
async function startCloudflared(
  localUrl: string,
  path: string,
  timeoutMs = 20_000,
): Promise<TunnelSession> {
  const child = spawn("cloudflared", ["tunnel", "--url", localUrl, "--no-autoupdate"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const publicUrl = await waitForTunnelUrl(child, /https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/, timeoutMs);

  return {
    provider: "cloudflared",
    publicUrl,
    mcpUrl: appendPath(publicUrl, path),
    close() {
      child.kill("SIGTERM");
    },
  };
}

/** Starts a Wrangler quick tunnel and waits for its public URL. */
async function startWrangler(
  localUrl: string,
  path: string,
  timeoutMs = 20_000,
): Promise<TunnelSession> {
  const child = spawn("npx", ["--yes", "wrangler", "tunnel", "quick-start", localUrl], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const publicUrl = await waitForTunnelUrl(child, /https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/, timeoutMs);

  return {
    provider: "wrangler",
    publicUrl,
    mcpUrl: appendPath(publicUrl, path),
    close() {
      child.kill("SIGTERM");
    },
  };
}

/** Waits until a spawned tunnel process prints a matching HTTPS URL. */
function waitForTunnelUrl(
  child: ChildProcess,
  pattern: RegExp,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error("Timed out waiting for HTTPS tunnel URL."));
      }
    }, timeoutMs);

    const inspect = (chunk: Buffer) => {
      const match = chunk.toString("utf8").match(pattern);
      if (match?.[0] && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };

    child.stdout?.on("data", inspect);
    child.stderr?.on("data", inspect);
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.once("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Tunnel process exited before producing a URL${code === null ? "" : ` with code ${code}`}.`));
      }
    });
  });
}

/** Returns true when a command can be resolved from PATH. */
function hasCommand(command: string): boolean {
  return spawnSync("which", [command], { stdio: "ignore" }).status === 0;
}

/** Runs an installation command with inherited stdio. */
function runInherited(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}.`));
      }
    });
  });
}

/** Appends the MCP endpoint path to a tunnel origin. */
function appendPath(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
