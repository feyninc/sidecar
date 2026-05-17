/**
 * Claude-pinned React components.
 *
 * Shared primitives use the same Claude recipe that `@sidecar-ai/native` selects
 * at runtime inside Claude MCP Apps. Claude-specific helpers live beside them.
 */
import { createPrimitiveComponents } from "@sidecar-ai/native/components";
import type { HTMLAttributes, ReactNode } from "react";

export type {
  AlertProps,
  AvatarGroupProps,
  AvatarProps,
  BadgeProps,
  ButtonLinkProps,
  ButtonProps,
  CalloutProps,
  CheckboxProps,
  CheckboxState,
  CircularProgressProps,
  CodeProps,
  ControlSize,
  CopyButtonProps,
  DropdownIconType,
  DividerProps,
  EmptyMessageIconProps,
  EmptyMessageProps,
  EmptyMessageTitleProps,
  EmptyStateProps,
  FieldDescriptionProps,
  FieldErrorProps,
  FieldLabelProps,
  FormFieldProps,
  HeadingProps,
  ImageProps,
  InlineProps,
  InputProps,
  KeyValueItem,
  KeyValueProps,
  LoadingDotsProps,
  LoadingIndicatorProps,
  Option,
  OptionGroup,
  Options,
  PopoverAlign,
  PopoverSide,
  ProgressProps,
  RadioGroupItemProps,
  RadioGroupProps,
  SegmentedControlOptionProps,
  SegmentedControlProps,
  SelectAction,
  SelectControlProps,
  SelectProps,
  SemanticColor,
  SemanticColors,
  ShimmerTextProps,
  Size,
  Sizes,
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
  TextLinkProps,
  TextProps,
  Variant,
  Variants,
} from "@sidecar-ai/native/components";

const primitives = createPrimitiveComponents("claude");

export const Alert = primitives.Alert;
export const Avatar = primitives.Avatar;
export const AvatarGroup = primitives.AvatarGroup;
export const Button = primitives.Button;
export const ButtonLink = primitives.ButtonLink;
export const Badge = primitives.Badge;
export const Callout = primitives.Callout;
export const Checkbox = primitives.Checkbox;
export const CircularProgress = primitives.CircularProgress;
export const Code = primitives.Code;
export const CopyButton = primitives.CopyButton;
export const Divider = primitives.Divider;
export const EmptyMessage = primitives.EmptyMessage;
export const EmptyState = primitives.EmptyState;
export const FieldDescription = primitives.FieldDescription;
export const FieldError = primitives.FieldError;
export const FieldLabel = primitives.FieldLabel;
export const FormField = primitives.FormField;
export const Heading = primitives.Heading;
export const Image = primitives.Image;
export const Inline = primitives.Inline;
export const Input = primitives.Input;
export const KeyValue = primitives.KeyValue;
export const LoadingDots = primitives.LoadingDots;
export const LoadingIndicator = primitives.LoadingIndicator;
export const Progress = primitives.Progress;
export const RadioGroup = primitives.RadioGroup;
export const SegmentedControl = primitives.SegmentedControl;
export const Select = primitives.Select;
export const SelectControl = primitives.SelectControl;
export const ShimmerText = primitives.ShimmerText;
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
export const TextLink = primitives.TextLink;

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
