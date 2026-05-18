/** Streamable HTTP Server-Sent Events helpers. */
import type { ServerResponse } from "node:http";
import { JSONRPC_VERSION } from "@modelcontextprotocol/sdk/types.js";

/** JSON-RPC notification emitted over Streamable HTTP SSE. */
export type McpNotificationMessage = {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: Record<string, unknown>;
};

/** Low-level notification sink used by HTTP streams and tests. */
export type McpNotificationSink = {
  /** True when this stream is tied to the active request and may carry progress updates. */
  supportsRequestProgress?: boolean;
  /** Sends one server-to-client JSON-RPC notification. */
  send(method: string, params?: Record<string, unknown>): void;
};

/** Writable SSE stream for JSON-RPC messages. */
export type SseStream = McpNotificationSink & {
  sendJson(value: unknown): void;
  end(): void;
};

let sseEventCounter = 0;

/** Creates a GET SSE notification hub that sends each message on one stream. */
export function createSseHub(): McpNotificationSink & { open(response: ServerResponse): SseStream } {
  const streams = new Set<SseStream>();

  return {
    open(response) {
      const stream = createSseStream(response);
      streams.add(stream);
      response.on("close", () => {
        streams.delete(stream);
      });
      return stream;
    },
    send(method, params) {
      const stream = streams.values().next().value;
      stream?.send(method, params);
    },
  };
}

/** Starts one Streamable HTTP SSE response. */
export function createSseStream(
  response: ServerResponse,
  options: { supportsRequestProgress?: boolean } = {},
): SseStream {
  let closed = false;
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders?.();

  const keepAlive = setInterval(() => {
    writeRaw(": keepalive\n\n");
  }, 30_000);
  keepAlive.unref?.();

  response.on("close", () => {
    closed = true;
    clearInterval(keepAlive);
  });

  writeRaw(`id: ${nextSseEventId()}\ndata:\n\n`);

  function writeRaw(frame: string): void {
    if (!closed && !response.destroyed) {
      response.write(frame);
    }
  }

  function sendJson(value: unknown): void {
    writeRaw([
      `id: ${nextSseEventId()}`,
      "event: message",
      `data: ${JSON.stringify(value)}`,
      "",
      "",
    ].join("\n"));
  }

  return {
    supportsRequestProgress: options.supportsRequestProgress,
    send(method, params) {
      sendJson(omitUndefined({
        jsonrpc: JSONRPC_VERSION,
        method,
        params,
      }));
    },
    sendJson,
    end() {
      closed = true;
      clearInterval(keepAlive);
      response.end();
    },
  };
}

/** Returns a globally unique SSE event id for this process. */
function nextSseEventId(): string {
  sseEventCounter += 1;
  return `sidecar-${Date.now()}-${sseEventCounter}`;
}

/** Drops undefined top-level entries before serializing JSON-RPC messages. */
function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
