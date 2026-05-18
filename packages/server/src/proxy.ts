/**
 * Small HTTP middleware layer for Sidecar MCP servers.
 *
 * Proxy middleware handles transport-adjacent concerns such as origin checks,
 * request ids, and rate limiting. It deliberately does not define auth policy.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** HTTP response returned by proxy middleware to short-circuit a request. */
export type ProxyResult = {
  status: number;
  headers?: Record<string, string>;
  body?: string;
};

/** Middleware invoked before the MCP request handler. */
export type ProxyMiddleware = (request: IncomingMessage) => ProxyResult | undefined | Promise<ProxyResult | undefined>;

/** Ordered proxy middleware configuration. */
export type SidecarProxy = {
  readonly kind: "sidecar.proxy";
  before: ProxyMiddleware[];
};

const proxyBrand = Symbol.for("sidecar.proxy");

/** Creates a proxy middleware container. */
export function proxy(options: { before?: ProxyMiddleware[] } = {}): SidecarProxy {
  return {
    kind: "sidecar.proxy",
    [proxyBrand]: true,
    before: options.before ?? []
  } as SidecarProxy;
}

/** Returns true when a value was created by `proxy()`. */
export function isSidecarProxy(value: unknown): value is SidecarProxy {
  return Boolean(
    value &&
      typeof value === "object" &&
      ((value as Record<symbol, unknown>)[proxyBrand] === true ||
        (value as { kind?: unknown }).kind === "sidecar.proxy"),
  );
}

/** Runs configured proxy middleware until one returns a response. */
export async function runProxy(proxyConfig: SidecarProxy | undefined, request: IncomingMessage): Promise<ProxyResult | undefined> {
  for (const middleware of proxyConfig?.before ?? []) {
    const result = await middleware(request);
    if (result) {
      return result;
    }
  }

  return undefined;
}

/** Restricts browser origins for hosted MCP and widget resource requests. */
export function origin(options: { allow: string[]; dev?: string[] }): ProxyMiddleware {
  return (request) => {
    const originHeader = request.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;

    if (!origin) {
      return undefined;
    }

    const allowed = [...options.allow, ...(process.env.NODE_ENV === "production" ? [] : options.dev ?? [])];
    if (allowed.some((pattern) => matchesOrigin(pattern, origin))) {
      return undefined;
    }

    return {
      status: 403,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "forbidden_origin" })
    };
  };
}

/** Adds a request id header value for downstream logging. */
export function requestId(header = "x-sidecar-request-id"): ProxyMiddleware {
  return (request) => {
    request.headers[header] = randomUUID();
    return undefined;
  };
}

/** In-memory per-process rate limiter for dev and simple deployments. */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  key?: (request: IncomingMessage) => string;
  maxKeys?: number;
}): ProxyMiddleware {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastPrunedAt = 0;

  return (request) => {
    const now = Date.now();
    if (now - lastPrunedAt > options.windowMs) {
      pruneExpired(hits, now);
      lastPrunedAt = now;
    }

    const key = options.key?.(request) ?? request.socket.remoteAddress ?? "unknown";
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      if (hits.size >= (options.maxKeys ?? 10_000)) {
        pruneExpired(hits, now);
      }
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return undefined;
    }

    current.count += 1;
    if (current.count <= options.max) {
      return undefined;
    }

    return {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(Math.ceil((current.resetAt - now) / 1000))
      },
      body: JSON.stringify({ error: "rate_limited" })
    };
  };
}

/** Removes expired rate-limit buckets so long-running dev servers do not leak keys. */
function pruneExpired(
  hits: Map<string, { count: number; resetAt: number }>,
  now: number,
): void {
  for (const [key, value] of hits) {
    if (value.resetAt <= now) {
      hits.delete(key);
    }
  }
}

/** Matches exact origin strings or wildcard dev patterns. */
function matchesOrigin(pattern: string, origin: string): boolean {
  if (pattern === origin || pattern === "*") {
    return true;
  }

  if (pattern.includes("*")) {
    const escaped = pattern.split("*").map(escapeRegExp).join(".*");
    return new RegExp(`^${escaped}$`).test(origin);
  }

  return false;
}

/** Escapes a string before embedding it in a wildcard-origin regexp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
