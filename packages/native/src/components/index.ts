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

/** Creates a scoped set of primitives pinned to one host recipe. */
export function createPrimitiveComponents(recipe: Exclude<ComponentRecipe, "auto">) {
  return {
    Button: pinRecipe(Button, recipe),
    Text: pinRecipe(Text, recipe),
    Heading: pinRecipe(Heading, recipe),
    TextField: pinRecipe(TextField, recipe),
    Checkbox: pinRecipe(Checkbox, recipe),
    Surface: pinRecipe(Surface, recipe),
    Stack: pinRecipe(Stack, recipe),
    Badge: pinRecipe(Badge, recipe),
    Skeleton: pinRecipe(Skeleton, recipe),
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
