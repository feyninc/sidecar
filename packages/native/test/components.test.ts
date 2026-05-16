/** Tests for adaptive native component contracts. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Button,
  TextField,
  createPrimitiveComponents,
} from "../src/components/index.js";

describe("@sidecar/native components", () => {
  it("renders shared primitives with the adaptive recipe by default", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { intent: "primary" }, "Approve"),
    );

    expect(html).toContain('data-sc-component="button"');
    expect(html).toContain('data-sc-intent="primary"');
    expect(html).toContain('data-sc-recipe="auto"');
  });

  it("pins scoped primitives to host recipes", () => {
    const openai = createPrimitiveComponents("chatgpt");
    const claude = createPrimitiveComponents("claude");

    expect(
      renderToStaticMarkup(createElement(openai.Button, null, "Approve")),
    ).toContain('data-sc-recipe="chatgpt"');
    expect(
      renderToStaticMarkup(createElement(claude.Button, null, "Approve")),
    ).toContain('data-sc-recipe="claude"');
  });

  it("preserves accessibility attributes for invalid fields", () => {
    const html = renderToStaticMarkup(
      createElement(TextField, { invalid: true, defaultValue: "bad" }),
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("data-sc-invalid");
  });
});
