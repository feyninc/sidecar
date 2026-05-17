/** Tests for adaptive native component contracts. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as anthropicComponents from "../../anthropic/src/components.js";
import { links } from "../src/index.js";
import {
  Alert,
  Button,
  EmptyMessage,
  Input,
  RadioGroup,
  SegmentedControl,
  Select,
  SelectControl,
  TextField,
  TextLink,
  createPrimitiveComponents,
} from "../src/components/index.js";

describe("@sidecar/native components", () => {
  it("denies unsafe external URL schemes before host fallback", async () => {
    await expect(links.openExternal("javascript:alert(1)")).resolves.toMatchObject({
      ok: false,
      reason: "denied",
    });
  });

  it("renders shared primitives with the adaptive recipe by default", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { color: "primary", variant: "solid" }, "Approve"),
    );

    expect(html).toContain('data-sc-component="button"');
    expect(html).toContain('data-sc-color="primary"');
    expect(html).toContain('data-sc-variant="solid"');
    expect(html).toContain('data-sc-recipe="auto"');
  });

  it("keeps early Sidecar aliases working while moving to OpenAI-style props", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { intent: "primary" }, "Approve"),
    );

    expect(html).toContain('data-sc-intent="primary"');
    expect(html).toContain('data-sc-color="primary"');
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
    expect(
      renderToStaticMarkup(createElement(claude.SelectControl, { children: "Option", selected: true })),
    ).toContain('data-sc-recipe="claude"');
  });

  it("preserves accessibility attributes for invalid fields", () => {
    const html = renderToStaticMarkup(
      createElement(Input, { invalid: true, defaultValue: "bad" }),
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("data-sc-invalid");
  });

  it("preserves TextField as an Input alias", () => {
    const html = renderToStaticMarkup(
      createElement(TextField, { invalid: true, defaultValue: "bad" }),
    );

    expect(html).toContain('data-sc-component="input-shell"');
    expect(html).toContain('data-sc-component="input"');
    expect(html).toContain('aria-invalid="true"');
  });

  it("renders compound radio and segmented controls with typed option APIs", () => {
    const radioHtml = renderToStaticMarkup(
      createElement(
        RadioGroup,
        {
          "aria-label": "View",
          children: [
            createElement(RadioGroup.Item, { children: "List", key: "list", value: "list" }),
            createElement(RadioGroup.Item, { children: "Grid", key: "grid", value: "grid" }),
          ],
          value: "list",
        },
      ),
    );
    const segmentHtml = renderToStaticMarkup(
      createElement(
        SegmentedControl,
        {
          "aria-label": "View",
          children: [
            createElement(SegmentedControl.Option, { children: "List", key: "list", value: "list" }),
            createElement(SegmentedControl.Option, { children: "Grid", key: "grid", value: "grid" }),
          ],
          value: "grid",
        },
      ),
    );

    expect(radioHtml).toContain('role="radiogroup"');
    expect(radioHtml).toContain('data-sc-component="radio-item"');
    expect(segmentHtml).toContain('data-sc-component="segmented-control"');
    expect(segmentHtml).toContain('data-sc-selected=""');
  });

  it("renders select controls and default-open option lists without host globals", () => {
    const html = renderToStaticMarkup(
      createElement(Select, {
        defaultOpen: true,
        onChange: () => undefined,
        options: [
          { label: "CSV", value: "csv" },
          { description: "Portable document", label: "PDF", value: "pdf" },
        ],
        value: "csv",
      }),
    );

    expect(html).toContain('data-sc-component="select-control"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain("Portable document");
  });

  it("renders OpenAI-shaped shared components in native without importing the OpenAI package", () => {
    const html = renderToStaticMarkup(
      createElement(
        EmptyMessage,
        {
          children: [
            createElement(EmptyMessage.Title, { children: "No results", key: "title" }),
            createElement(EmptyMessage.Description, { children: "Try another filter.", key: "description" }),
            createElement(EmptyMessage.ActionRow, {
              children: createElement(TextLink, { children: "Reset", href: "#" }),
              key: "action",
            }),
          ],
        },
      ),
    );
    const alertHtml = renderToStaticMarkup(
      createElement(Alert, { color: "info", description: "Synced", title: "Status" }),
    );

    expect(html).toContain('data-sc-component="empty-message"');
    expect(html).toContain('data-sc-component="text-link"');
    expect(alertHtml).toContain('data-sc-component="alert"');
    expect(alertHtml).toContain('data-sc-color="info"');
  });

  it("exposes the shared native catalog from the Anthropic components package", () => {
    const shared = [
      "Alert",
      "Avatar",
      "AvatarGroup",
      "Badge",
      "Button",
      "ButtonLink",
      "Checkbox",
      "CopyButton",
      "EmptyMessage",
      "FormField",
      "Input",
      "RadioGroup",
      "SegmentedControl",
      "Select",
      "SelectControl",
      "Switch",
      "Textarea",
      "TextLink",
    ] as const;

    for (const name of shared) {
      expect(anthropicComponents[name]).toBeDefined();
    }
  });
});
