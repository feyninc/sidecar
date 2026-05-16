/** Tests for framework-agnostic widget client helpers. */
import { describe, expect, it } from "vitest";
import { createToolClient, detectHostContext, type WidgetBridge } from "../src/index.js";

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
});

describe("detectHostContext", () => {
  it("falls back to a generic host outside the browser", () => {
    expect(detectHostContext()).toMatchObject({
      name: "generic",
      source: "fallback"
    });
  });
});
