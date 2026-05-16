/**
 * Claude-pinned React components.
 *
 * Shared primitives use the same Claude recipe that `@sidecar/native` selects
 * at runtime inside Claude MCP Apps. Claude-specific helpers live beside them.
 */
import { createPrimitiveComponents } from "@sidecar/native/components";
import type { HTMLAttributes, ReactNode } from "react";

export type {
  BadgeProps,
  ButtonProps,
  CheckboxProps,
  HeadingProps,
  SkeletonProps,
  StackProps,
  SurfaceProps,
  TextFieldProps,
  TextProps,
} from "@sidecar/native/components";

const primitives = createPrimitiveComponents("claude");

export const Button = primitives.Button;
export const Text = primitives.Text;
export const Heading = primitives.Heading;
export const TextField = primitives.TextField;
export const Checkbox = primitives.Checkbox;
export const Surface = primitives.Surface;
export const Stack = primitives.Stack;
export const Badge = primitives.Badge;
export const Skeleton = primitives.Skeleton;

/** Props for hiding old widget instances after supersession. */
export type SupersededProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
};

/** Small Claude-styled notice for an older widget instance. */
export function SupersededNotice({
  children = "A newer result is available in this conversation.",
  ...props
}: SupersededProps) {
  return (
    <div data-sc-component="surface" data-sc-variant="inset" data-sc-recipe="claude" {...props}>
      <p data-sc-component="text" data-sc-tone="muted" data-sc-recipe="claude">
        {children}
      </p>
    </div>
  );
}
