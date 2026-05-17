/** Tests for the standard MCP Apps postMessage bridge adapter. */
import { afterEach, describe, expect, it, vi } from "vitest";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalGetComputedStyle = globalThis.getComputedStyle;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  setGlobal("window", originalWindow);
  setGlobal("document", originalDocument);
  setGlobal("getComputedStyle", originalGetComputedStyle);
});

describe("MCP Apps bridge", () => {
  it("initializes over postMessage and routes typed tool calls through tools/call", async () => {
    silenceBridgeLogs();
    const host = installFakeHost();
    const { createBrowserBridge } = await import("../src/index.js");

    const bridge = createBrowserBridge();

    await expect(bridge.callTool("add_numbers", { a: 3, b: 4 })).resolves.toEqual({ sum: 7 });
    expect(host.sentMethods()).toContain("ui/initialize");
    expect(host.sentMethods()).toContain("ui/notifications/initialized");
    expect(host.sentMessages.find((message) => message.method === "tools/call")).toMatchObject({
      params: {
        name: "add_numbers",
        arguments: { a: 3, b: 4 },
      },
    });
    expect(bridge.getHostContext()).toMatchObject({
      name: "claude",
      theme: "dark",
      source: "mcp-apps",
    });
  });

  it("updates subscribers from ui/notifications/tool-result", async () => {
    silenceBridgeLogs();
    const host = installFakeHost();
    const { createBrowserBridge } = await import("../src/index.js");

    const bridge = createBrowserBridge();
    const listener = vi.fn();
    bridge.subscribeToolResult(listener);

    await host.waitForMethod("ui/notifications/initialized");
    host.dispatch({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        content: [{ type: "text", text: "sum: 9" }],
        structuredContent: { sum: 9 },
        _meta: { trace: "abc" },
      },
    });
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      structuredContent: { sum: 9 },
      structured: { sum: 9 },
      meta: { trace: "abc" },
    }));
    expect(bridge.getToolResult()).toMatchObject({
      structuredContent: { sum: 9 },
      content: [{ type: "text", text: "sum: 9" }],
      _meta: { trace: "abc" },
    });
  });

  it("covers resource, sampling, logging, and lifecycle methods from the Apps spec", async () => {
    silenceBridgeLogs();
    const host = installFakeHost();
    const { createBrowserBridge } = await import("../src/index.js");

    const bridge = createBrowserBridge();

    await expect(bridge.readServerResource({ uri: "data://report" })).resolves.toMatchObject({
      ok: true,
      value: {
        contents: [{ uri: "data://report", mimeType: "text/plain", text: "report" }],
      },
    });
    await expect(bridge.listServerResources()).resolves.toMatchObject({
      ok: true,
      value: {
        resources: [{ uri: "data://report", name: "Report" }],
      },
    });
    await expect(bridge.createSamplingMessage({
      messages: [{ role: "user", content: { type: "text", text: "Summarize" } }],
      maxTokens: 64,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        role: "assistant",
        content: { type: "text", text: "Done" },
      },
    });

    await expect(bridge.sendLog({ level: "info", data: "ready", logger: "test" })).resolves.toMatchObject({ ok: true });
    await expect(bridge.requestTeardown()).resolves.toMatchObject({ ok: true });
    await expect(bridge.sendSizeChanged({ width: 320, height: 180 })).resolves.toMatchObject({ ok: true });

    expect(host.sentMethods()).toContain("resources/read");
    expect(host.sentMethods()).toContain("resources/list");
    expect(host.sentMethods()).toContain("sampling/createMessage");
    expect(host.sentMethods()).toContain("notifications/message");
    expect(host.sentMethods()).toContain("ui/notifications/request-teardown");
    expect(host.sentMethods()).toContain("ui/notifications/size-changed");
  });

  it("subscribes to tool input and cancellation lifecycle notifications", async () => {
    silenceBridgeLogs();
    const host = installFakeHost();
    const { createBrowserBridge } = await import("../src/index.js");

    const bridge = createBrowserBridge();
    const input = vi.fn();
    const partial = vi.fn();
    const cancelled = vi.fn();
    bridge.subscribeToolInput(input);
    bridge.subscribeToolInputPartial(partial);
    bridge.subscribeToolCancelled(cancelled);

    await host.waitForMethod("ui/notifications/initialized");
    host.dispatch({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-input",
      params: { arguments: { reportId: "r1" } },
    });
    host.dispatch({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-input-partial",
      params: { arguments: { reportId: "r" } },
    });
    host.dispatch({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-cancelled",
      params: { reason: "user action" },
    });
    await Promise.resolve();

    expect(input).toHaveBeenCalledWith({ arguments: { reportId: "r1" } });
    expect(partial).toHaveBeenCalledWith({ arguments: { reportId: "r" } });
    expect(cancelled).toHaveBeenCalledWith({ reason: "user action" });
    expect(bridge.getToolResult()).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "user action" }],
    });
  });

  it("does not use window.openai as a generic fallback", async () => {
    silenceBridgeLogs();
    const fakeWindow = {
      parent: undefined as unknown,
      addEventListener() {},
      removeEventListener() {},
      matchMedia() {
        return {
          matches: false,
          addEventListener() {},
          removeEventListener() {},
        };
      },
      openai: {
        callTool: vi.fn(async () => ({ sum: 7 })),
        sendFollowUpMessage: vi.fn(async () => undefined),
      },
    };
    fakeWindow.parent = fakeWindow;
    setGlobal("window", fakeWindow);
    setGlobal("document", { documentElement: {}, body: {} });
    setGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));

    const { createBrowserBridge } = await import("../src/index.js");
    const bridge = createBrowserBridge();

    await expect(bridge.callTool("add_numbers", { a: 3, b: 4 })).rejects.toThrow(
      "This host does not expose widget tool calls.",
    );
    await expect(bridge.sendMessage({ text: "hello" })).resolves.toMatchObject({
      ok: false,
      reason: "unsupported",
    });
    expect(fakeWindow.openai.callTool).not.toHaveBeenCalled();
    expect(fakeWindow.openai.sendFollowUpMessage).not.toHaveBeenCalled();
    expect(bridge.getHostContext()).toMatchObject({
      name: "generic",
    });
  });
});

type JsonRpcMessage = {
  jsonrpc?: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
};

type MessageListener = (event: { data: JsonRpcMessage; source: unknown }) => void;

function installFakeHost() {
  const listeners = new Set<MessageListener>();
  const waiters = new Map<string, Array<() => void>>();
  const sentMessages: JsonRpcMessage[] = [];
  const parent = {
    postMessage(message: JsonRpcMessage) {
      sentMessages.push(message);
      for (const resolve of waiters.get(message.method ?? "") ?? []) {
        resolve();
      }
      waiters.delete(message.method ?? "");
      queueMicrotask(() => respond(message));
    },
  };

  const fakeWindow = {
    parent,
    addEventListener(event: string, listener: MessageListener) {
      if (event === "message") listeners.add(listener);
    },
    removeEventListener(event: string, listener: MessageListener) {
      if (event === "message") listeners.delete(listener);
    },
    matchMedia() {
      return {
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      };
    },
    open: vi.fn(),
  };

  setGlobal("window", fakeWindow);
  setGlobal("document", { documentElement: {}, body: {} });
  setGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));

  function respond(message: JsonRpcMessage) {
    if (message.id === undefined || !message.method) {
      return;
    }

    if (message.method === "ui/initialize") {
      dispatch({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2026-01-26",
          hostInfo: { name: "claude-desktop", version: "1.0.0" },
          hostCapabilities: {
            serverTools: {},
            serverResources: {},
            message: { text: {} },
            updateModelContext: { structuredContent: {} },
            openLinks: {},
            downloadFile: {},
            logging: {},
            sampling: {},
          },
          hostContext: {
            theme: "dark",
            userAgent: "claude-desktop",
            availableDisplayModes: ["inline", "fullscreen"],
          },
        },
      });
      return;
    }

    if (message.method === "tools/call") {
      dispatch({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: "sum: 7" }],
          structuredContent: { sum: 7 },
        },
      });
      return;
    }

    if (message.method === "resources/read") {
      dispatch({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          contents: [{ uri: "data://report", mimeType: "text/plain", text: "report" }],
        },
      });
      return;
    }

    if (message.method === "resources/list") {
      dispatch({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          resources: [{ uri: "data://report", name: "Report" }],
        },
      });
      return;
    }

    if (message.method === "sampling/createMessage") {
      dispatch({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          role: "assistant",
          content: { type: "text", text: "Done" },
          model: "test",
          stopReason: "endTurn",
        },
      });
    }
  }

  function dispatch(data: JsonRpcMessage) {
    for (const listener of listeners) {
      listener({ data, source: parent });
    }
  }

  return {
    sentMessages,
    sentMethods: () => sentMessages.map((message) => message.method),
    dispatch,
    waitForMethod(method: string) {
      if (sentMessages.some((message) => message.method === method)) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const list = waiters.get(method) ?? [];
        list.push(resolve);
        waiters.set(method, list);
      });
    },
  };
}

function setGlobal(name: "window" | "document" | "getComputedStyle", value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });
}

function silenceBridgeLogs(): void {
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
}
