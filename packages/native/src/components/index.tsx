import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

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
