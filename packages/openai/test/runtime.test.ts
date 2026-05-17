/** Tests for explicit ChatGPT runtime helpers. */
import { afterEach, describe, expect, it, vi } from "vitest";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.restoreAllMocks();
  setWindow(originalWindow);
});

describe("@sidecar-ai/openai runtime", () => {
  it("uses window.openai only through explicit ChatGPT helpers", async () => {
    const callTool = vi.fn(async () => ({ sum: 7 }));
    const sendFollowUpMessage = vi.fn(async () => undefined);
    const setWidgetState = vi.fn(async () => undefined);
    const requestDisplayMode = vi.fn(async () => undefined);
    const openExternal = vi.fn(async () => undefined);
    const selectFiles = vi.fn(async () => []);
    setWindow({
      openai: {
        callTool,
        openExternal,
        requestDisplayMode,
        selectFiles,
        sendFollowUpMessage,
        setWidgetState,
        toolOutput: { sum: 9 },
        toolResponseMetadata: { trace: "abc" },
      },
    });

    const { chatgpt, readChatGptBridge } = await import("../src/index.js");

    expect(chatgpt.runtime.available()).toBe(true);
    expect(readChatGptBridge()).toBeDefined();
    await expect(chatgpt.runtime.callTool("add_numbers", { a: 3, b: 4 })).resolves.toEqual({
      ok: true,
      value: { sum: 7 },
    });
    await expect(chatgpt.runtime.sendFollowUpMessage("show details")).resolves.toMatchObject({ ok: true });
    await expect(chatgpt.runtime.setWidgetState({ selected: "r1" })).resolves.toMatchObject({ ok: true });
    await expect(chatgpt.runtime.requestDisplayMode("fullscreen")).resolves.toMatchObject({ ok: true });
    await expect(chatgpt.runtime.openExternal("https://example.com")).resolves.toMatchObject({ ok: true });
    await expect(chatgpt.runtime.selectFiles({ accept: ["text/csv"] })).resolves.toMatchObject({ ok: true });
    expect(chatgpt.runtime.toolResult()).toMatchObject({
      structuredContent: { sum: 9 },
      meta: { trace: "abc" },
    });
  });

  it("reports unsupported when ChatGPT's bridge is absent", async () => {
    setWindow({});
    const { chatgpt } = await import("../src/index.js");

    expect(chatgpt.runtime.available()).toBe(false);
    await expect(chatgpt.runtime.callTool("add_numbers", {})).resolves.toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("denies unsafe external URL schemes", async () => {
    const openExternal = vi.fn(async () => undefined);
    setWindow({ openai: { openExternal } });
    const { chatgpt } = await import("../src/index.js");

    await expect(chatgpt.runtime.openExternal("javascript:alert(1)")).resolves.toMatchObject({
      ok: false,
      reason: "denied",
    });
    expect(openExternal).not.toHaveBeenCalled();
  });
});

function setWindow(value: unknown): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value,
    writable: true,
  });
}
