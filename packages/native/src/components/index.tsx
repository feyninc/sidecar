/**
 * Adaptive React primitives for Sidecar widgets.
 *
 * These components own portable behavior and accessibility. Visual appearance
 * comes from host recipes in `@sidecar/native/styles.css`, selected at runtime
 * by `SidecarWidgetRoot`.
 */
import * as React from "react";

/** Host recipe pinned by scoped packages or selected dynamically by native. */
export type ComponentRecipe = "auto" | "chatgpt" | "claude" | "generic";

/** Visual intent shared by portable controls. */
export type ControlIntent = "primary" | "secondary" | "ghost" | "danger";

/** Common props accepted by all Sidecar primitive components. */
export type PrimitiveProps = {
  /** Internal recipe override used by scoped host packages. */
  recipe?: ComponentRecipe;
};

/** Props for Sidecar's portable button primitive. */
export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  PrimitiveProps & {
    intent?: ControlIntent;
    /** Backward-compatible alias for `intent`. */
    variant?: ControlIntent;
    loading?: boolean;
  };

/** Portable button with host-adaptive visual recipes. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    disabled,
    intent = "secondary",
    loading = false,
    recipe = "auto",
    type = "button",
    variant,
    ...props
  },
  ref,
) {
  return React.createElement(
    "button",
    {
      ref,
      "data-sc-component": "button",
      "data-sc-intent": variant ?? intent,
      "data-sc-recipe": recipe,
      "data-sc-loading": loading ? "" : undefined,
      disabled: disabled || loading,
      type,
      ...props,
    },
    loading
      ? React.createElement("span", {
          "aria-hidden": "true",
          "data-sc-component": "spinner",
        })
      : null,
    React.createElement("span", { "data-sc-component": "button-label" }, children),
  );
});

/** Props for text blocks that align with the active host typography. */
export type TextProps = React.HTMLAttributes<HTMLParagraphElement> &
  PrimitiveProps & {
    tone?: "default" | "muted" | "success" | "warning" | "danger";
  };

/** Host-adaptive paragraph text. */
export const Text = React.forwardRef<HTMLParagraphElement, TextProps>(function Text(
  { tone = "default", recipe = "auto", ...props },
  ref,
) {
  return React.createElement("p", {
    ref,
    "data-sc-component": "text",
    "data-sc-tone": tone,
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for compact section headings. */
export type HeadingProps = React.HTMLAttributes<HTMLHeadingElement> &
  PrimitiveProps & {
    level?: 1 | 2 | 3 | 4;
  };

/** Host-adaptive heading component with compact widget defaults. */
export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(function Heading(
  { level = 2, recipe = "auto", ...props },
  ref,
) {
  return React.createElement(`h${level}`, {
    ref,
    "data-sc-component": "heading",
    "data-sc-level": level,
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for a host-adaptive single-line text input. */
export type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement> &
  PrimitiveProps & {
    invalid?: boolean;
  };

/** Portable text input styled through the active host recipe. */
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { invalid = false, recipe = "auto", ...props },
  ref,
) {
  return React.createElement("input", {
    ref,
    "aria-invalid": invalid || undefined,
    "data-sc-component": "textfield",
    "data-sc-invalid": invalid ? "" : undefined,
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for a host-adaptive checkbox. */
export type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement> &
  PrimitiveProps & {
    label?: React.ReactNode;
  };

/** Portable checkbox with optional inline label. */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, recipe = "auto", ...props },
  ref,
) {
  return React.createElement(
    "label",
    {
      "data-sc-component": "checkbox-label",
      "data-sc-recipe": recipe,
    },
    React.createElement("input", {
      ref,
      type: "checkbox",
      "data-sc-component": "checkbox",
      "data-sc-recipe": recipe,
      ...props,
    }),
    label ? React.createElement("span", null, label) : null,
  );
});

/** Props for neutral surfaces such as panels and repeated cards. */
export type SurfaceProps = React.HTMLAttributes<HTMLDivElement> &
  PrimitiveProps & {
    variant?: "plain" | "card" | "inset";
  };

/** Transparent-by-default surface that can opt into card framing. */
export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { recipe = "auto", variant = "plain", ...props },
  ref,
) {
  return React.createElement("div", {
    ref,
    "data-sc-component": "surface",
    "data-sc-variant": variant,
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for simple vertical layout stacks. */
export type StackProps = React.HTMLAttributes<HTMLDivElement> &
  PrimitiveProps & {
    gap?: "xs" | "sm" | "md" | "lg";
  };

/** Vertical stack with host-appropriate spacing tokens. */
export const Stack = React.forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap = "md", recipe = "auto", ...props },
  ref,
) {
  return React.createElement("div", {
    ref,
    "data-sc-component": "stack",
    "data-sc-gap": gap,
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for status badges. */
export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  PrimitiveProps & {
    tone?: "default" | "success" | "warning" | "danger";
  };

/** Compact status badge using the active host recipe. */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "default", recipe = "auto", ...props },
  ref,
) {
  return React.createElement("span", {
    ref,
    "data-sc-component": "badge",
    "data-sc-tone": tone,
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for skeleton loading blocks. */
export type SkeletonProps = React.HTMLAttributes<HTMLDivElement> &
  PrimitiveProps & {
    width?: string;
    height?: string;
  };

/** Host-adaptive skeleton block for widget loading states. */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { height, recipe = "auto", style, width, ...props },
  ref,
) {
  return React.createElement("div", {
    ref,
    "aria-hidden": "true",
    "data-sc-component": "skeleton",
    "data-sc-recipe": recipe,
    style: { width, height, ...style },
    ...props,
  });
});

/** Props for horizontal inline layout. */
export type InlineProps = React.HTMLAttributes<HTMLDivElement> &
  PrimitiveProps & {
    align?: "start" | "center" | "end";
    gap?: "xs" | "sm" | "md" | "lg";
    wrap?: boolean;
  };

/** Horizontal layout primitive for controls and compact metadata. */
export const Inline = React.forwardRef<HTMLDivElement, InlineProps>(function Inline(
  { align = "center", gap = "sm", recipe = "auto", wrap = true, ...props },
  ref,
) {
  return React.createElement("div", {
    ref,
    "data-sc-align": align,
    "data-sc-component": "inline",
    "data-sc-gap": gap,
    "data-sc-recipe": recipe,
    "data-sc-wrap": wrap ? "" : undefined,
    ...props,
  });
});

/** Props for a host-adaptive divider. */
export type DividerProps = React.HTMLAttributes<HTMLHRElement> & PrimitiveProps;

/** Thin separator using the active host border token. */
export const Divider = React.forwardRef<HTMLHRElement, DividerProps>(function Divider(
  { recipe = "auto", ...props },
  ref,
) {
  return React.createElement("hr", {
    ref,
    "data-sc-component": "divider",
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for inline code text. */
export type CodeProps = React.HTMLAttributes<HTMLElement> & PrimitiveProps;

/** Inline code primitive for ids, paths, and short literals. */
export const Code = React.forwardRef<HTMLElement, CodeProps>(function Code(
  { recipe = "auto", ...props },
  ref,
) {
  return React.createElement("code", {
    ref,
    "data-sc-component": "code",
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for a multi-line text input. */
export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> &
  PrimitiveProps & {
    invalid?: boolean;
  };

/** Portable textarea styled through the active host recipe. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, recipe = "auto", ...props },
  ref,
) {
  return React.createElement("textarea", {
    ref,
    "aria-invalid": invalid || undefined,
    "data-sc-component": "textarea",
    "data-sc-invalid": invalid ? "" : undefined,
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for a host-adaptive switch. */
export type SwitchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> &
  PrimitiveProps & {
    label?: React.ReactNode;
  };

/** Binary switch control with optional inline label. */
export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, recipe = "auto", ...props },
  ref,
) {
  return React.createElement(
    "label",
    {
      "data-sc-component": "switch-label",
      "data-sc-recipe": recipe,
    },
    React.createElement("input", {
      ref,
      role: "switch",
      type: "checkbox",
      "data-sc-component": "switch",
      "data-sc-recipe": recipe,
      ...props,
    }),
    label ? React.createElement("span", null, label) : null,
  );
});

/** Props for grouped radio choices. */
export type RadioGroupProps = React.HTMLAttributes<HTMLFieldSetElement> & PrimitiveProps;

/** Fieldset wrapper for accessible radio groups. */
export const RadioGroup = React.forwardRef<HTMLFieldSetElement, RadioGroupProps>(function RadioGroup(
  { recipe = "auto", ...props },
  ref,
) {
  return React.createElement("fieldset", {
    ref,
    "data-sc-component": "radio-group",
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for grouped segmented buttons. */
export type SegmentedControlProps = React.HTMLAttributes<HTMLDivElement> & PrimitiveProps;

/** Compact segmented-control container. */
export const SegmentedControl = React.forwardRef<HTMLDivElement, SegmentedControlProps>(function SegmentedControl(
  { recipe = "auto", ...props },
  ref,
) {
  return React.createElement("div", {
    ref,
    role: "group",
    "data-sc-component": "segmented-control",
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for tab-list composition. */
export type TabsProps = React.HTMLAttributes<HTMLDivElement> & PrimitiveProps;

/** Minimal tabs container for author-composed tab buttons and panels. */
export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { recipe = "auto", ...props },
  ref,
) {
  return React.createElement("div", {
    ref,
    "data-sc-component": "tabs",
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for numeric slider input. */
export type SliderProps = React.InputHTMLAttributes<HTMLInputElement> & PrimitiveProps;

/** Range slider using host accent colors. */
export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { recipe = "auto", type: _type, ...props },
  ref,
) {
  return React.createElement("input", {
    ref,
    type: "range",
    "data-sc-component": "slider",
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for alert and callout blocks. */
export type CalloutProps = React.HTMLAttributes<HTMLDivElement> &
  PrimitiveProps & {
    tone?: "default" | "success" | "warning" | "danger";
  };

/** Portable callout block for compact status and guidance. */
export const Callout = React.forwardRef<HTMLDivElement, CalloutProps>(function Callout(
  { recipe = "auto", role = "note", tone = "default", ...props },
  ref,
) {
  return React.createElement("div", {
    ref,
    role,
    "data-sc-component": "callout",
    "data-sc-recipe": recipe,
    "data-sc-tone": tone,
    ...props,
  });
});

/** Alias for callouts that represent stronger status. */
export const Alert = Callout;
export type AlertProps = CalloutProps;

/** Props for empty states. */
export type EmptyStateProps = React.HTMLAttributes<HTMLDivElement> &
  PrimitiveProps & {
    title: React.ReactNode;
    action?: React.ReactNode;
  };

/** Compact empty-state block with title, body, and optional action. */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { action, children, recipe = "auto", title, ...props },
  ref,
) {
  return React.createElement(
    "div",
    {
      ref,
      "data-sc-component": "empty-state",
      "data-sc-recipe": recipe,
      ...props,
    },
    React.createElement("strong", { "data-sc-component": "empty-state-title" }, title),
    children ? React.createElement("div", { "data-sc-component": "empty-state-body" }, children) : null,
    action ? React.createElement("div", { "data-sc-component": "empty-state-action" }, action) : null,
  );
});

/** Props for an indeterminate spinner. */
export type SpinnerProps = React.HTMLAttributes<HTMLSpanElement> & PrimitiveProps;

/** Inline loading spinner. */
export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { recipe = "auto", ...props },
  ref,
) {
  return React.createElement("span", {
    ref,
    "aria-hidden": "true",
    "data-sc-component": "spinner",
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for progress bars. */
export type ProgressProps = React.ProgressHTMLAttributes<HTMLProgressElement> & PrimitiveProps;

/** Native progress element with host-adaptive colors. */
export const Progress = React.forwardRef<HTMLProgressElement, ProgressProps>(function Progress(
  { recipe = "auto", ...props },
  ref,
) {
  return React.createElement("progress", {
    ref,
    "data-sc-component": "progress",
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for tabular data. */
export type TableProps = React.TableHTMLAttributes<HTMLTableElement> & PrimitiveProps;

/** Simple table wrapper with host border and text defaults. */
export const Table = React.forwardRef<HTMLTableElement, TableProps>(function Table(
  { recipe = "auto", ...props },
  ref,
) {
  return React.createElement("table", {
    ref,
    "data-sc-component": "table",
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Key-value item rendered by `KeyValue`. */
export type KeyValueItem = {
  key: React.ReactNode;
  value: React.ReactNode;
};

/** Props for compact definition-list metadata. */
export type KeyValueProps = React.HTMLAttributes<HTMLDListElement> &
  PrimitiveProps & {
    items: readonly KeyValueItem[];
  };

/** Compact key-value list for facts and metadata. */
export const KeyValue = React.forwardRef<HTMLDListElement, KeyValueProps>(function KeyValue(
  { items, recipe = "auto", ...props },
  ref,
) {
  return React.createElement(
    "dl",
    {
      ref,
      "data-sc-component": "key-value",
      "data-sc-recipe": recipe,
      ...props,
    },
    items.map((item, index) =>
      React.createElement(
        "div",
        { "data-sc-component": "key-value-row", key: index },
        React.createElement("dt", null, item.key),
        React.createElement("dd", null, item.value),
      ),
    ),
  );
});

/** Props for a compact avatar. */
export type AvatarProps = React.HTMLAttributes<HTMLSpanElement> &
  PrimitiveProps & {
    alt?: string;
    fallback?: React.ReactNode;
    src?: string;
  };

/** Circular avatar with image and fallback text support. */
export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { alt = "", fallback, recipe = "auto", src, ...props },
  ref,
) {
  return React.createElement(
    "span",
    {
      ref,
      "data-sc-component": "avatar",
      "data-sc-recipe": recipe,
      ...props,
    },
    src ? React.createElement("img", { alt, src }) : fallback,
  );
});

/** Props for images inside widgets. */
export type ImageProps = React.ImgHTMLAttributes<HTMLImageElement> & PrimitiveProps;

/** Responsive image primitive with stable block sizing defaults. */
export const Image = React.forwardRef<HTMLImageElement, ImageProps>(function Image(
  { recipe = "auto", ...props },
  ref,
) {
  return React.createElement("img", {
    ref,
    "data-sc-component": "image",
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Creates a scoped set of primitives pinned to one host recipe. */
export function createPrimitiveComponents(recipe: Exclude<ComponentRecipe, "auto">) {
  return {
    Alert: pinRecipe(Alert, recipe),
    Avatar: pinRecipe(Avatar, recipe),
    Button: pinRecipe(Button, recipe),
    Badge: pinRecipe(Badge, recipe),
    Callout: pinRecipe(Callout, recipe),
    Checkbox: pinRecipe(Checkbox, recipe),
    Code: pinRecipe(Code, recipe),
    Divider: pinRecipe(Divider, recipe),
    EmptyState: pinRecipe(EmptyState, recipe),
    Heading: pinRecipe(Heading, recipe),
    Image: pinRecipe(Image, recipe),
    Inline: pinRecipe(Inline, recipe),
    KeyValue: pinRecipe(KeyValue, recipe),
    Progress: pinRecipe(Progress, recipe),
    RadioGroup: pinRecipe(RadioGroup, recipe),
    SegmentedControl: pinRecipe(SegmentedControl, recipe),
    Skeleton: pinRecipe(Skeleton, recipe),
    Slider: pinRecipe(Slider, recipe),
    Spinner: pinRecipe(Spinner, recipe),
    Stack: pinRecipe(Stack, recipe),
    Surface: pinRecipe(Surface, recipe),
    Switch: pinRecipe(Switch, recipe),
    Table: pinRecipe(Table, recipe),
    Tabs: pinRecipe(Tabs, recipe),
    Text: pinRecipe(Text, recipe),
    Textarea: pinRecipe(Textarea, recipe),
    TextField: pinRecipe(TextField, recipe),
  };
}

/** Pins an adaptive primitive to a host recipe for scoped packages. */
function pinRecipe<Props extends PrimitiveProps>(
  Component: React.ComponentType<Props>,
  recipe: Exclude<ComponentRecipe, "auto">,
) {
  return function RecipePinnedComponent(props: Omit<Props, "recipe">) {
    return React.createElement(Component, {
      ...(props as Props),
      recipe,
    });
  };
}
