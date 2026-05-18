/** Tests for framework-agnostic widget client helpers. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createToolClient, detectHostContext, type WidgetBridge } from "../src/index.js";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalGetComputedStyle = globalThis.getComputedStyle;

afterEach(() => {
  vi.restoreAllMocks();
  setGlobal("window", originalWindow);
  setGlobal("document", originalDocument);
  setGlobal("getComputedStyle", originalGetComputedStyle);
});

describe("createToolClient", () => {
  it("turns typed methods into bridge tool calls", async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const bridge: Pick<WidgetBridge, "callTool"> = {
      async callTool<TParams extends Record<string, unknown>, TResult>(
        name: string,
        params: TParams,
      ): Promise<TResult> {
        calls.push({ name, params });
        return { sum: 7 } as TResult;
      }
    };

    type Tools = {
      addNumbers(params: { a: number; b: number }): Promise<{ sum: number }>;
    };

    const tools = createToolClient<Tools>(
      { addNumbers: "add_numbers" },
      bridge
    );

    await expect(tools.addNumbers({ a: 3, b: 4 })).resolves.toEqual({
      sum: 7
    });
    expect(calls).toEqual([
      { name: "add_numbers", params: { a: 3, b: 4 } }
    ]);
  });

  it("does not synthesize calls for promise probes or unknown properties", () => {
    type Tools = {
      addNumbers(params: { a: number; b: number }): Promise<{ sum: number }>;
    };

    const tools = createToolClient<Tools>({ addNumbers: "add_numbers" });

    expect((tools as unknown as { then?: unknown }).then).toBeUndefined();
    expect((tools as unknown as { missing?: unknown }).missing).toBeUndefined();
  });
});

describe("detectHostContext", () => {
  it("falls back to a generic host outside the browser", () => {
    expect(detectHostContext()).toMatchObject({
      name: "generic",
      source: "fallback"
    });
  });

  it("detects Claude from documented host style variables", () => {
    setGlobal("window", {
      matchMedia() {
        return {
          matches: false,
          addEventListener() {},
          removeEventListener() {},
        };
      },
    });
    setGlobal("document", { documentElement: {} });
    setGlobal("getComputedStyle", () => ({
      getPropertyValue(name: string) {
        return name === "--font-sans" ? "Anthropic Sans, sans-serif" : "";
      },
    }));

    expect(detectHostContext()).toMatchObject({
      name: "claude",
      source: "claude-css",
    });
  });
});

function setGlobal(key: "window" | "document" | "getComputedStyle", value: unknown): void {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
