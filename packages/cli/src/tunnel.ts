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

/** Options for validating a public tunnel endpoint before it is shown to users. */
export type TunnelValidationOptions = {
  /** Public MCP endpoint, for example `https://example.com/mcp`. */
  mcpUrl: string;
  /** Whether the local MCP server has auth enabled. */
  auth: boolean;
  /** Expected OAuth protected-resource value. Defaults to the MCP URL. */
  expectedResource?: string;
  /** Request timeout for each validation probe. */
  timeoutMs?: number;
  /** Require an HTTPS public endpoint. Disable only in tests. */
  requireHttps?: boolean;
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

/**
 * Probes a tunnel through the public URL before Sidecar reports it as ready.
 *
 * This catches provider interstitial pages, dead forwards, incorrect auth
 * metadata, and server responses that do not satisfy MCP Streamable HTTP.
 */
export async function validateTunnelEndpoint(
  options: TunnelValidationOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const mcpUrl = new URL(options.mcpUrl);
  if ((options.requireHttps ?? true) && mcpUrl.protocol !== "https:") {
    throw new Error(`Tunnel URL must use https://, received ${options.mcpUrl}.`);
  }

  await retryTunnelValidation(async () => {
    if (options.auth) {
      await validateProtectedResourceMetadata({
        mcpUrl,
        expectedResource: options.expectedResource ?? options.mcpUrl,
        timeoutMs,
      });
      await validateAuthChallenge({ mcpUrl, timeoutMs });
      return;
    }

    await validateInitialize({ mcpUrl, timeoutMs });
    await validateToolsList({ mcpUrl, timeoutMs });
  }, timeoutMs);
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
    let output = "";
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error([
          "Timed out waiting for HTTPS tunnel URL.",
          tunnelOutputHint(output),
        ].filter(Boolean).join("\n")));
      }
    }, timeoutMs);

    const inspect = (chunk: Buffer) => {
      output = tail(`${output}${chunk.toString("utf8")}`, 4_000);
      const match = output.match(pattern);
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
        reject(new Error([
          `Tunnel process exited before producing a URL${code === null ? "" : ` with code ${code}`}.`,
          tunnelOutputHint(output),
        ].filter(Boolean).join("\n")));
      }
    });
  });
}

/** Validates OAuth protected-resource metadata served through the tunnel. */
async function validateProtectedResourceMetadata(options: {
  mcpUrl: URL;
  expectedResource: string;
  timeoutMs: number;
}): Promise<void> {
  const metadataUrl = protectedResourceMetadataUrl(options.mcpUrl);
  const response = await fetchWithTimeout(metadataUrl, {
    headers: { accept: "application/json" },
    timeoutMs: options.timeoutMs,
  });
  const body = await readValidationBody(response);
  assertNotHtml(response, body, metadataUrl);

  if (response.status !== 200) {
    if (isTransientHttpStatus(response.status)) {
      throw new TransientTunnelValidationError(`Tunnel validation failed: ${metadataUrl} returned HTTP ${response.status}.`);
    }
    throw new Error(`Tunnel validation failed: ${metadataUrl} returned HTTP ${response.status}.`);
  }

  const metadata = parseJsonObject(body, metadataUrl);
  if (metadata.resource !== options.expectedResource) {
    throw new Error([
      "Tunnel validation failed: OAuth protected-resource metadata does not match the public MCP URL.",
      `  expected resource: ${options.expectedResource}`,
      `  actual resource: ${String(metadata.resource)}`,
    ].join("\n"));
  }
}

/** Validates that authenticated MCP endpoints return a proper bearer challenge. */
async function validateAuthChallenge(options: {
  mcpUrl: URL;
  timeoutMs: number;
}): Promise<void> {
  const response = await postJsonRpc(options.mcpUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "sidecar-tunnel-check", version: "0.0.0" },
    },
  }, options.timeoutMs);
  const body = await readValidationBody(response);
  assertNotHtml(response, body, options.mcpUrl.toString());

  if (response.status !== 401) {
    if (isTransientHttpStatus(response.status)) {
      throw new TransientTunnelValidationError(`Tunnel validation failed: authenticated MCP endpoint returned HTTP ${response.status}.`);
    }
    throw new Error(`Tunnel validation failed: authenticated MCP endpoint should return HTTP 401 without a bearer token, received HTTP ${response.status}.`);
  }
  if (!response.headers.get("www-authenticate")?.toLowerCase().includes("bearer")) {
    throw new Error("Tunnel validation failed: authenticated MCP endpoint did not include a Bearer WWW-Authenticate challenge.");
  }
  parseJsonObject(body, options.mcpUrl.toString());
}

/** Validates unauthenticated MCP initialize over Streamable HTTP. */
async function validateInitialize(options: {
  mcpUrl: URL;
  timeoutMs: number;
}): Promise<void> {
  const response = await postJsonRpc(options.mcpUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "sidecar-tunnel-check", version: "0.0.0" },
    },
  }, options.timeoutMs);
  const body = await readValidationBody(response);
  assertNotHtml(response, body, options.mcpUrl.toString());

  if (response.status !== 200) {
    if (isTransientHttpStatus(response.status)) {
      throw new TransientTunnelValidationError(`Tunnel validation failed: initialize returned HTTP ${response.status}.`);
    }
    throw new Error(`Tunnel validation failed: initialize returned HTTP ${response.status}.`);
  }
  const payload = parseJsonObject(body, options.mcpUrl.toString());
  if (!isRecord(payload.result) || typeof payload.result.protocolVersion !== "string") {
    throw new Error("Tunnel validation failed: initialize did not return an MCP server result.");
  }
}

/** Validates unauthenticated MCP tools/list over Streamable HTTP. */
async function validateToolsList(options: {
  mcpUrl: URL;
  timeoutMs: number;
}): Promise<void> {
  const response = await postJsonRpc(options.mcpUrl, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  }, options.timeoutMs);
  const body = await readValidationBody(response);
  assertNotHtml(response, body, options.mcpUrl.toString());

  if (response.status !== 200) {
    if (isTransientHttpStatus(response.status)) {
      throw new TransientTunnelValidationError(`Tunnel validation failed: tools/list returned HTTP ${response.status}.`);
    }
    throw new Error(`Tunnel validation failed: tools/list returned HTTP ${response.status}.`);
  }
  const payload = parseJsonObject(body, options.mcpUrl.toString());
  if (!isRecord(payload.result) || !Array.isArray(payload.result.tools)) {
    throw new Error("Tunnel validation failed: tools/list did not return a tools array.");
  }
}

/** Sends one JSON-RPC request with Streamable HTTP headers. */
function postJsonRpc(url: URL, payload: unknown, timeoutMs: number): Promise<Response> {
  return fetchWithTimeout(url.toString(), {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    timeoutMs,
  });
}

/** Fetch wrapper with a per-request timeout. */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs: number },
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new TransientTunnelValidationError(`Tunnel validation failed: timed out fetching ${url}.`);
    }
    throw new TransientTunnelValidationError(
      `Tunnel validation failed: could not fetch ${url}: ${errorMessage(error)}.`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Retries transient public tunnel failures while the provider route warms up. */
async function retryTunnelValidation(
  validate: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      await validate();
      return;
    } catch (error) {
      lastError = error;
      if (!(error instanceof TransientTunnelValidationError)) {
        throw error;
      }
      await delay(500);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Tunnel validation failed before the public endpoint became reachable.");
}

/** Error class for validation failures that may clear once the tunnel is ready. */
class TransientTunnelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientTunnelValidationError";
  }
}

/** Returns true for HTTP statuses that can occur while tunnel routing warms up. */
function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Resolves after a short retry delay. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads a bounded response body for validation diagnostics. */
async function readValidationBody(response: Response): Promise<string> {
  const text = await response.text();
  return text.slice(0, 20_000);
}

/** Rejects common tunnel provider HTML warning/interstitial pages. */
function assertNotHtml(response: Response, body: string, url: string): void {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const trimmed = body.trimStart().toLowerCase();
  if (contentType.includes("text/html") || trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html")) {
    throw new Error([
      `Tunnel validation failed: ${url} returned HTML instead of MCP JSON.`,
      "This usually means the tunnel provider returned an interstitial, warning page, or bad route.",
    ].join("\n"));
  }
}

/** Parses a JSON object or throws a user-actionable validation error. */
function parseJsonObject(body: string, url: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to the normalized error below.
  }

  throw new Error(`Tunnel validation failed: ${url} did not return a JSON object.`);
}

/** Returns the protected resource metadata URL for a public MCP endpoint. */
function protectedResourceMetadataUrl(mcpUrl: URL): string {
  const url = new URL(mcpUrl.origin);
  const pathname = mcpUrl.pathname.replace(/\/+$/, "") || "/";
  url.pathname = pathname === "/"
    ? "/.well-known/oauth-protected-resource"
    : `/.well-known/oauth-protected-resource${pathname}`;
  return url.toString();
}

/** Returns a short process-output hint for tunnel startup failures. */
function tunnelOutputHint(output: string): string {
  const trimmed = output.trim();
  return trimmed ? `Tunnel output:\n${trimmed}` : "";
}

/** Keeps only the tail of a diagnostic output buffer. */
function tail(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(value.length - maxLength) : value;
}

/** Formats unknown errors without leaking bulky stack traces into CLI output. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeMessage = cause instanceof Error ? ` (${cause.message})` : "";
    return `${error.message}${causeMessage}`;
  }
  return String(error);
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

/** Returns true when a value is a non-null object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
