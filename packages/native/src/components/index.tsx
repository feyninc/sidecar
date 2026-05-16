/**
 * Portable React components for Sidecar widgets.
 *
 * These components use browser-native styling tokens so they remain usable
 * before host-specific component adapters exist.
 */
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";

/** Props for the portable button component. */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

/** Basic host-neutral button with Canvas colors and small-radius defaults. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", style, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      data-sidecar-button=""
      data-variant={variant}
      style={{ ...buttonStyle(variant), ...style }}
      {...props}
    />
  );
});

/** Returns inline styles for the current button variant. */
function buttonStyle(variant: ButtonProps["variant"]): CSSProperties {
  const base: CSSProperties = {
    alignItems: "center",
    borderRadius: 8,
    border: "1px solid color-mix(in srgb, CanvasText 16%, transparent)",
    cursor: "pointer",
    display: "inline-flex",
    font: "inherit",
    gap: 6,
    minHeight: 32,
    padding: "0 12px"
  };

  if (variant === "primary") {
    return {
      ...base,
      background: "CanvasText",
      color: "Canvas"
    };
  }

  if (variant === "ghost") {
    return {
      ...base,
      background: "transparent",
      borderColor: "transparent",
      color: "CanvasText"
    };
  }

  return {
    ...base,
    background: "color-mix(in srgb, CanvasText 6%, transparent)",
    color: "CanvasText"
  };
}
