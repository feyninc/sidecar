import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

export type ProxyResult = {
  status: number;
  headers?: Record<string, string>;
  body?: string;
};

export type ProxyMiddleware = (request: IncomingMessage) => ProxyResult | undefined | Promise<ProxyResult | undefined>;

export type SidecarProxy = {
  before: ProxyMiddleware[];
};

export function proxy(options: { before?: ProxyMiddleware[] } = {}): SidecarProxy {
  return {
    before: options.before ?? []
  };
}

export async function runProxy(proxyConfig: SidecarProxy | undefined, request: IncomingMessage): Promise<ProxyResult | undefined> {
  for (const middleware of proxyConfig?.before ?? []) {
    const result = await middleware(request);
    if (result) {
      return result;
    }
  }

  return undefined;
}

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

export function requestId(header = "x-sidecar-request-id"): ProxyMiddleware {
  return (request) => {
    request.headers[header] = randomUUID();
    return undefined;
  };
}

export function rateLimit(options: { windowMs: number; max: number }): ProxyMiddleware {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (request) => {
    const key = request.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
