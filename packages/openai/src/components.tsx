/**
 * ChatGPT-pinned React components.
 *
 * Shared primitives intentionally use the same ChatGPT recipe that
 * `@sidecar/native` selects at runtime inside ChatGPT. OpenAI-only components
 * live here instead of `@sidecar/native`.
 */
import { createPrimitiveComponents } from "@sidecar/native/components";
import {
  type HTMLAttributes,
  type ReactNode,
  useId,
  useState,
} from "react";

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

const primitives = createPrimitiveComponents("chatgpt");

export const Button = primitives.Button;
export const Text = primitives.Text;
export const Heading = primitives.Heading;
export const TextField = primitives.TextField;
export const Checkbox = primitives.Checkbox;
export const Surface = primitives.Surface;
export const Stack = primitives.Stack;
export const Badge = primitives.Badge;
export const Skeleton = primitives.Skeleton;

/** Props for the ChatGPT-only popover helper. */
export type PopoverProps = HTMLAttributes<HTMLDivElement> & {
  trigger: ReactNode;
  children: ReactNode;
};

/**
 * Lightweight ChatGPT-only popover.
 *
 * Claude inline apps discourage this pattern, so it is intentionally not
 * exported from `@sidecar/native`.
 */
export function Popover({ children, trigger, ...props }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div data-sc-component="popover" data-sc-recipe="chatgpt" {...props}>
      <button
        aria-controls={id}
        aria-expanded={open}
        data-sc-component="button"
        data-sc-intent="secondary"
        data-sc-recipe="chatgpt"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <span data-sc-component="button-label">{trigger}</span>
      </button>
      {open ? (
        <div id={id} role="dialog" data-sc-component="popover-content">
          {children}
        </div>
      ) : null}
    </div>
  );
}
