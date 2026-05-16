/** HTTPS tunnel helpers for local MCP development. */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/** Tunnel backend requested by `sidecar dev --tunnel`. */
export type TunnelProvider = "auto" | "cloudflared" | "ngrok";

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
  const provider = resolveProvider(options.provider);
  const localUrl = `http://127.0.0.1:${options.port}`;
  const path = options.path ?? "/mcp";

  if (provider === "cloudflared") {
    return startCloudflared(localUrl, path, options.timeoutMs);
  }

  return startNgrok(localUrl, path, options.timeoutMs);
}

/** Human-readable install guidance for missing tunnel providers. */
export function tunnelInstallMessage(provider: TunnelProvider = "auto"): string {
  if (provider === "cloudflared" || provider === "auto") {
    return [
      "No supported HTTPS tunnel binary was found.",
      "Install cloudflared for account-free temporary URLs:",
      "  brew install cloudflared",
      "Then run:",
      "  sidecar dev --tunnel",
      "ngrok is also supported with:",
      "  sidecar dev --tunnel ngrok",
    ].join("\n");
  }

  return [
    "ngrok was not found on PATH.",
    "Install ngrok and authenticate it, then run:",
    "  sidecar dev --tunnel ngrok",
  ].join("\n");
}

/** Picks the first available tunnel provider for `auto`. */
function resolveProvider(provider: TunnelProvider): Exclude<TunnelProvider, "auto"> {
  if (provider !== "auto") {
    if (!hasCommand(provider)) {
      throw new Error(tunnelInstallMessage(provider));
    }
    return provider;
  }

  if (hasCommand("cloudflared")) {
    return "cloudflared";
  }
  if (hasCommand("ngrok")) {
    return "ngrok";
  }

  throw new Error(tunnelInstallMessage("auto"));
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

/** Starts an ngrok tunnel and waits for its local API to report a public URL. */
async function startNgrok(
  localUrl: string,
  path: string,
  timeoutMs = 20_000,
): Promise<TunnelSession> {
  const child = spawn("ngrok", ["http", localUrl, "--log=stdout"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const publicUrl = await waitForNgrokUrl(child, timeoutMs);

  return {
    provider: "ngrok",
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

/** Polls ngrok's local API because ngrok output is not stable across versions. */
async function waitForNgrokUrl(
  child: ChildProcess,
  timeoutMs: number,
): Promise<string> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`ngrok exited before producing a URL with code ${child.exitCode}.`);
    }

    try {
      const response = await fetch("http://127.0.0.1:4040/api/tunnels");
      if (response.ok) {
        const data = (await response.json()) as {
          tunnels?: Array<{ public_url?: string }>;
        };
        const url = data.tunnels
          ?.map((tunnel) => tunnel.public_url)
          .find((candidate): candidate is string => Boolean(candidate?.startsWith("https://")));
        if (url) {
          return url;
        }
      }
    } catch (error) {
      lastError = error;
    }

    await delay(300);
  }

  child.kill("SIGTERM");
  throw new Error(
    lastError instanceof Error
      ? `Timed out waiting for ngrok URL: ${lastError.message}`
      : "Timed out waiting for ngrok URL.",
  );
}

/** Returns true when a command can be resolved from PATH. */
function hasCommand(command: string): boolean {
  return spawnSync("which", [command], { stdio: "ignore" }).status === 0;
}

/** Appends the MCP endpoint path to a tunnel origin. */
function appendPath(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
