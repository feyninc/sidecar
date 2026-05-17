/**
 * Claude-pinned React components.
 *
 * Shared primitives use the same Claude recipe that `@sidecar/native` selects
 * at runtime inside Claude MCP Apps. Claude-specific helpers live beside them.
 */
import { createPrimitiveComponents } from "@sidecar/native/components";
import type { HTMLAttributes, ReactNode } from "react";

export type {
  AlertProps,
  AvatarProps,
  BadgeProps,
  ButtonProps,
  CalloutProps,
  CheckboxProps,
  CodeProps,
  DividerProps,
  EmptyStateProps,
  HeadingProps,
  ImageProps,
  InlineProps,
  KeyValueItem,
  KeyValueProps,
  ProgressProps,
  RadioGroupProps,
  SegmentedControlProps,
  SkeletonProps,
  SliderProps,
  SpinnerProps,
  StackProps,
  SurfaceProps,
  SwitchProps,
  TableProps,
  TabsProps,
  TextareaProps,
  TextFieldProps,
  TextProps,
} from "@sidecar/native/components";

const primitives = createPrimitiveComponents("claude");

export const Alert = primitives.Alert;
export const Avatar = primitives.Avatar;
export const Button = primitives.Button;
export const Badge = primitives.Badge;
export const Callout = primitives.Callout;
export const Checkbox = primitives.Checkbox;
export const Code = primitives.Code;
export const Divider = primitives.Divider;
export const EmptyState = primitives.EmptyState;
export const Heading = primitives.Heading;
export const Image = primitives.Image;
export const Inline = primitives.Inline;
export const KeyValue = primitives.KeyValue;
export const Progress = primitives.Progress;
export const RadioGroup = primitives.RadioGroup;
export const SegmentedControl = primitives.SegmentedControl;
export const Skeleton = primitives.Skeleton;
export const Slider = primitives.Slider;
export const Spinner = primitives.Spinner;
export const Stack = primitives.Stack;
export const Surface = primitives.Surface;
export const Switch = primitives.Switch;
export const Table = primitives.Table;
export const Tabs = primitives.Tabs;
export const Text = primitives.Text;
export const Textarea = primitives.Textarea;
export const TextField = primitives.TextField;

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
