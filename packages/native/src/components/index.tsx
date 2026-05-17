/**
 * Host-adaptive React components for Sidecar widgets.
 *
 * The public props intentionally track the shared OpenAI Apps SDK UI surface
 * where the same primitive can sensibly exist in Claude. Runtime styling is
 * selected with `data-sc-recipe`; `auto` follows the widget host, while scoped
 * packages pin a recipe explicitly.
 */
import * as React from "react";

/** Host recipe pinned by scoped packages or selected dynamically by native. */
export type ComponentRecipe = "auto" | "chatgpt" | "claude" | "generic";

/** Size tokens mirrored from the OpenAI Apps SDK UI scale. */
export type Size =
  | "5xs"
  | "4xs"
  | "3xs"
  | "2xs"
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "4xl"
  | "5xl"
  | "6xl";

/** Generic constrained size helper. */
export type Sizes<T extends Size = Size> = T;

/** Control height scale used by buttons, inputs, and related controls. */
export type ControlSize = Sizes<"3xs" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl">;

/** Semantic color tokens common to portable Sidecar controls. */
export type SemanticColor =
  | "primary"
  | "secondary"
  | "danger"
  | "success"
  | "warning"
  | "caution"
  | "discovery"
  | "info";

/** Generic constrained semantic color helper. */
export type SemanticColors<T extends SemanticColor = SemanticColor> = T;

/** Visual variants common to portable controls. */
export type Variant = "solid" | "soft" | "outline" | "ghost";

/** Generic constrained variant helper. */
export type Variants<T extends Variant = Variant> = T;

/** Legacy intent alias retained for early Sidecar examples. */
export type ControlIntent = SemanticColor | "ghost";

/** Common props accepted by all Sidecar native components. */
export type PrimitiveProps = {
  /** Internal recipe override used by scoped host packages. */
  recipe?: ComponentRecipe;
};

type Alignment = "start" | "center" | "end";
type Direction = "col" | "row";

type ButtonVisualProps = PrimitiveProps & {
  /**
   * Semantic color for the button.
   * @default "secondary"
   */
  color?: SemanticColors<
    "primary" | "secondary" | "danger" | "success" | "info" | "discovery" | "caution" | "warning"
  >;
  /**
   * Visual style for the button.
   * @default "solid"
   */
  variant?: Variants<"solid" | "soft" | "outline" | "ghost"> | ControlIntent;
  /** Backward-compatible alias for `color` from early Sidecar examples. */
  intent?: ControlIntent;
  /**
   * Determines if the button should be a fully rounded pill shape.
   * @default true
   */
  pill?: boolean;
  /** Controls disabled cursor treatment without changing disabled semantics. */
  disabledTone?: "relaxed";
  /**
   * Extends the control to 100% of available width.
   * @default false
   */
  block?: boolean;
  /** Applies a negative margin to optically align with surrounding content. */
  opticallyAlign?: "start" | "end";
  /**
   * Controls button height and default icon/text scale.
   * @default "md"
   */
  size?: ControlSize;
  /** Explicit icon size override. */
  iconSize?: Sizes<"sm" | "md" | "lg" | "xl" | "2xl">;
  /** Explicit horizontal gutter override. */
  gutterSize?: Sizes<"3xs" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl">;
  /**
   * Makes the button width match its height.
   * @default false
   */
  uniform?: boolean;
  /**
   * Displays selected styles on the button.
   * @default false
   */
  selected?: boolean;
  /**
   * Displays loading indicator and disables interaction.
   * @default false
   */
  loading?: boolean;
  /**
   * Makes the button inert without changing visual treatment.
   * @default false
   */
  inert?: boolean;
};

/** Props for Sidecar's portable button primitive. */
export type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> &
  ButtonVisualProps;

/** Portable button with host-adaptive visual recipes. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    block = false,
    children,
    color,
    disabled,
    disabledTone,
    gutterSize,
    iconSize,
    inert = false,
    intent,
    loading = false,
    opticallyAlign,
    pill = true,
    recipe = "auto",
    selected = false,
    size = "md",
    type = "button",
    uniform = false,
    variant,
    ...props
  },
  ref,
) {
  const visual = normalizeButtonVisual({ color, intent, variant });

  return React.createElement(
    "button",
    {
      ref,
      "aria-busy": loading || undefined,
      "data-sc-block": block ? "" : undefined,
      "data-sc-color": visual.color,
      "data-sc-component": "button",
      "data-sc-disabled-tone": disabledTone,
      "data-sc-gutter-size": gutterSize,
      "data-sc-icon-size": iconSize,
      "data-sc-inert": inert ? "" : undefined,
      "data-sc-intent": visual.color,
      "data-sc-loading": loading ? "" : undefined,
      "data-sc-optically-align": opticallyAlign,
      "data-sc-pill": pill ? "" : undefined,
      "data-sc-recipe": recipe,
      "data-sc-selected": selected ? "" : undefined,
      "data-sc-size": size,
      "data-sc-uniform": uniform ? "" : undefined,
      "data-sc-variant": visual.variant,
      disabled: disabled || loading || undefined,
      type,
      ...props,
    },
    loading ? React.createElement(LoadingIndicator, { "aria-hidden": true, size: "1em" }) : null,
    React.createElement("span", { "data-sc-component": "button-label" }, children),
  );
});

/** Props for a link styled as a host-adaptive button. */
export type ButtonLinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "color"> &
  ButtonVisualProps & {
    /** Forces external-link treatment when automatic detection is insufficient. */
    external?: boolean;
  };

/** Anchor element with the same visual language as `Button`. */
export const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  {
    block = false,
    children,
    color,
    disabledTone,
    external,
    gutterSize,
    href,
    iconSize,
    inert = false,
    intent,
    loading = false,
    opticallyAlign,
    pill = true,
    recipe = "auto",
    rel,
    selected = false,
    size = "md",
    target,
    uniform = false,
    variant,
    ...props
  },
  ref,
) {
  const visual = normalizeButtonVisual({ color, intent, variant });
  const isExternal = external ?? Boolean(href && /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href));

  return React.createElement(
    "a",
    {
      ref,
      "data-sc-block": block ? "" : undefined,
      "data-sc-color": visual.color,
      "data-sc-component": "button",
      "data-sc-disabled-tone": disabledTone,
      "data-sc-gutter-size": gutterSize,
      "data-sc-icon-size": iconSize,
      "data-sc-inert": inert ? "" : undefined,
      "data-sc-loading": loading ? "" : undefined,
      "data-sc-optically-align": opticallyAlign,
      "data-sc-pill": pill ? "" : undefined,
      "data-sc-recipe": recipe,
      "data-sc-selected": selected ? "" : undefined,
      "data-sc-size": size,
      "data-sc-uniform": uniform ? "" : undefined,
      "data-sc-variant": visual.variant,
      href,
      rel: isExternal && target === "_blank" ? "noreferrer" : rel,
      target,
      ...props,
    },
    loading ? React.createElement(LoadingIndicator, { "aria-hidden": true, size: "1em" }) : null,
    React.createElement("span", { "data-sc-component": "button-label" }, children),
  );
});

/** Clipboard content accepted by `CopyButton`. */
export type ClipboardContent = string | Record<string, string>;

/** Props for a host-adaptive copy button. */
export type CopyButtonProps = {
  /** Text or MIME map to place on the clipboard. */
  copyValue: ClipboardContent | (() => ClipboardContent);
  /** Custom button content, optionally as a render function. */
  children?: React.ReactNode | ((props: { copied: boolean }) => React.ReactNode);
} & Omit<ButtonProps, "children">;

/** Button that copies text to the clipboard with a short copied state. */
export function CopyButton({ children = "Copy", copyValue, onClick, ...restProps }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) {
      return;
    }
    const timeout = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  return React.createElement(
    Button,
    {
      ...restProps,
      onClick: async (event) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }
        const resolved = typeof copyValue === "function" ? copyValue() : copyValue;
        await copyToClipboard(resolved);
        setCopied(true);
      },
    },
    typeof children === "function" ? children({ copied }) : children,
  );
}

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
    "data-sc-recipe": recipe,
    "data-sc-tone": tone,
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
export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "disabled" | "size"> &
  PrimitiveProps & {
    /** Visual style of the input. */
    variant?: Variants<"outline" | "soft">;
    /** Control size. */
    size?: ControlSize;
    /** Explicit horizontal gutter override. */
    gutterSize?: Sizes<"2xs" | "xs" | "sm" | "md" | "lg" | "xl">;
    /** Disables the input visually and from interactions. */
    disabled?: boolean;
    /** Marks the input as invalid. */
    invalid?: boolean;
    /** Allow autofill extensions to appear in the input. */
    allowAutofillExtensions?: boolean;
    /** Selects all contents when the input mounts. */
    autoSelect?: boolean;
    /** Callback invoked when browser autofill is detected. */
    onAutofill?: () => void;
    /** Content rendered at the start of the control. */
    startAdornment?: React.ReactNode;
    /** Content rendered at the end of the control. */
    endAdornment?: React.ReactNode;
    /** Fully rounded pill shape. */
    pill?: boolean;
    /** Extends the control to 100% width. */
    block?: boolean;
    /** Applies a negative margin to optically align with surrounding content. */
    opticallyAlign?: "start" | "end";
  };

/** Portable single-line input styled through the active host recipe. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    allowAutofillExtensions: _allowAutofillExtensions,
    autoSelect = false,
    block = false,
    disabled = false,
    endAdornment,
    gutterSize,
    id,
    invalid,
    onAutofill: _onAutofill,
    opticallyAlign,
    pill = false,
    recipe = "auto",
    size = "md",
    startAdornment,
    variant = "outline",
    ...props
  },
  ref,
) {
  const field = React.useContext(FieldContext);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const mergedRef = useMergedRefs(ref, inputRef);
  const inputId = id ?? field?.controlId;
  const resolvedInvalid = invalid ?? field?.invalid ?? false;

  React.useEffect(() => {
    if (autoSelect) {
      inputRef.current?.select();
    }
  }, [autoSelect]);

  return React.createElement(
    "span",
    {
      "data-sc-block": block ? "" : undefined,
      "data-sc-component": "input-shell",
      "data-sc-disabled": disabled ? "" : undefined,
      "data-sc-gutter-size": gutterSize,
      "data-sc-has-end-adornment": endAdornment ? "" : undefined,
      "data-sc-has-start-adornment": startAdornment ? "" : undefined,
      "data-sc-invalid": resolvedInvalid ? "" : undefined,
      "data-sc-optically-align": opticallyAlign,
      "data-sc-pill": pill ? "" : undefined,
      "data-sc-recipe": recipe,
      "data-sc-size": size,
      "data-sc-variant": variant,
    },
    startAdornment ? React.createElement("span", { "data-sc-component": "input-adornment" }, startAdornment) : null,
    React.createElement("input", {
      ref: mergedRef,
      "aria-describedby": describedBy(props["aria-describedby"], field, resolvedInvalid),
      "aria-invalid": resolvedInvalid || undefined,
      disabled,
      id: inputId,
      "data-sc-component": "input",
      ...props,
    }),
    endAdornment ? React.createElement("span", { "data-sc-component": "input-adornment" }, endAdornment) : null,
  );
});

/** Backward-compatible alias for early Sidecar examples. */
export const TextField = Input;
export type TextFieldProps = InputProps;

/** Props for a multi-line text input. */
export type TextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "disabled" | "size"> &
  PrimitiveProps & {
    /** Visual style of the textarea. */
    variant?: Variants<"outline" | "soft">;
    /** Control size. */
    size?: ControlSize;
    /** Explicit horizontal gutter override. */
    gutterSize?: Sizes<"2xs" | "xs" | "sm" | "md" | "lg" | "xl">;
    disabled?: boolean;
    invalid?: boolean;
    allowAutofillExtensions?: boolean;
    autoSelect?: boolean;
    onAutofill?: () => void;
    autoResize?: boolean;
    maxRows?: number;
    pill?: boolean;
    block?: boolean;
    opticallyAlign?: "start" | "end";
  };

/** Portable textarea styled through the active host recipe. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    allowAutofillExtensions: _allowAutofillExtensions,
    autoResize = false,
    autoSelect = false,
    block = false,
    disabled = false,
    gutterSize,
    id,
    invalid,
    maxRows: _maxRows,
    onAutofill: _onAutofill,
    opticallyAlign,
    pill = false,
    recipe = "auto",
    rows = 3,
    size = "md",
    variant = "outline",
    ...props
  },
  ref,
) {
  const field = React.useContext(FieldContext);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const mergedRef = useMergedRefs(ref, textareaRef);
  const inputId = id ?? field?.controlId;
  const resolvedInvalid = invalid ?? field?.invalid ?? false;

  React.useEffect(() => {
    if (autoSelect) {
      textareaRef.current?.select();
    }
  }, [autoSelect]);

  React.useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node || !autoResize) {
      return;
    }
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [autoResize, props.value, props.defaultValue]);

  return React.createElement("textarea", {
    ref: mergedRef,
    "aria-describedby": describedBy(props["aria-describedby"], field, resolvedInvalid),
    "aria-invalid": resolvedInvalid || undefined,
    disabled,
    id: inputId,
    "data-sc-block": block ? "" : undefined,
    "data-sc-component": "textarea",
    "data-sc-disabled": disabled ? "" : undefined,
    "data-sc-gutter-size": gutterSize,
    "data-sc-invalid": resolvedInvalid ? "" : undefined,
    "data-sc-optically-align": opticallyAlign,
    "data-sc-pill": pill ? "" : undefined,
    "data-sc-recipe": recipe,
    "data-sc-size": size,
    "data-sc-variant": variant,
    rows,
    ...props,
  });
});

/** State accepted by host-adaptive checkboxes. */
export type CheckboxState = boolean | "indeterminate";

/** Props for a host-adaptive checkbox. */
export type CheckboxProps = PrimitiveProps & {
  id?: string;
  defaultChecked?: CheckboxState;
  checked?: CheckboxState;
  label?: React.ReactNode;
  onCheckedChange?: (nextState: boolean) => void;
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
  onFocus?: React.FocusEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  className?: string;
  orientation?: "left" | "right";
};

/** Portable checkbox with optional inline label. */
export function Checkbox({
  checked,
  className,
  defaultChecked = false,
  disabled = false,
  id,
  label,
  name,
  onBlur,
  onCheckedChange,
  onFocus,
  orientation = "left",
  recipe = "auto",
  required = false,
  value = "on",
}: CheckboxProps) {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const [state, setState] = useControllableValue<CheckboxState>({
    controlled: checked,
    defaultValue: defaultChecked,
    onChange: (next) => onCheckedChange?.(next === true),
  });
  const isChecked = state === true;
  const isMixed = state === "indeterminate";
  const button = React.createElement("button", {
    "aria-checked": isMixed ? "mixed" : isChecked,
    "aria-labelledby": label ? `${controlId}-label` : undefined,
    disabled,
    id: controlId,
    onBlur,
    onClick: () => {
      if (!disabled) {
        setState(!isChecked);
      }
    },
    onFocus,
    role: "checkbox",
    type: "button",
    "data-sc-checked": isChecked ? "" : undefined,
    "data-sc-component": "checkbox",
    "data-sc-disabled": disabled ? "" : undefined,
    "data-sc-indeterminate": isMixed ? "" : undefined,
    "data-sc-recipe": recipe,
  });
  const labelNode = label
    ? React.createElement("span", { id: `${controlId}-label`, "data-sc-component": "checkbox-label-text" }, label)
    : null;

  return React.createElement(
    "label",
    {
      className,
      "data-sc-component": "checkbox-label",
      "data-sc-orientation": orientation,
      "data-sc-recipe": recipe,
    },
    orientation === "right" ? labelNode : button,
    React.createElement("input", {
      checked: isChecked,
      disabled,
      name,
      readOnly: true,
      required,
      tabIndex: -1,
      type: "checkbox",
      value,
      "data-sc-component": "visually-hidden-input",
    }),
    orientation === "right" ? button : labelNode,
  );
}

/** Props for a host-adaptive switch. */
export type SwitchProps = PrimitiveProps & {
  id?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  label?: React.ReactNode;
  onCheckedChange?: (nextState: boolean) => void;
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
  onFocus?: React.FocusEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  className?: string;
  labelPosition?: "start" | "end";
};

/** Binary switch control with optional inline label. */
export function Switch({
  checked,
  className,
  defaultChecked = false,
  disabled = false,
  id,
  label,
  labelPosition = "end",
  name,
  onBlur,
  onCheckedChange,
  onFocus,
  recipe = "auto",
  required = false,
  value = "on",
}: SwitchProps) {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const [state, setState] = useControllableValue<boolean>({
    controlled: checked,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  });
  const button = React.createElement(
    "button",
    {
      "aria-checked": state,
      "aria-labelledby": label ? `${controlId}-label` : undefined,
      disabled,
      id: controlId,
      onBlur,
      onClick: () => {
        if (!disabled) {
          setState(!state);
        }
      },
      onFocus,
      role: "switch",
      type: "button",
      "data-sc-checked": state ? "" : undefined,
      "data-sc-component": "switch",
      "data-sc-disabled": disabled ? "" : undefined,
      "data-sc-recipe": recipe,
    },
    React.createElement("span", { "data-sc-component": "switch-thumb" }),
  );
  const labelNode = label
    ? React.createElement("span", { id: `${controlId}-label`, "data-sc-component": "switch-label-text" }, label)
    : null;

  return React.createElement(
    "label",
    {
      className,
      "data-sc-component": "switch-label",
      "data-sc-label-position": labelPosition,
      "data-sc-recipe": recipe,
    },
    labelPosition === "start" ? labelNode : button,
    React.createElement("input", {
      checked: state,
      disabled,
      name,
      readOnly: true,
      required,
      tabIndex: -1,
      type: "checkbox",
      value,
      "data-sc-component": "visually-hidden-input",
    }),
    labelPosition === "start" ? button : labelNode,
  );
}

/** Props for grouped radio choices. */
export type RadioGroupProps<T extends string = string> = PrimitiveProps & {
  defaultValue?: T;
  value?: T;
  name?: string;
  onChange?: (value: T) => void;
  /** Accessible label for the radio options. */
  "aria-label": string;
  /**
   * Determines the layout direction of the radio items.
   * @default "row"
   */
  direction?: Direction;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  required?: boolean;
};

/** Props for one radio option. */
export type RadioGroupItemProps<T extends string = string> = {
  value: T;
  disabled?: boolean;
  required?: boolean;
  block?: boolean;
  className?: string;
  children: React.ReactNode;
};

type RadioGroupContextValue = {
  disabled: boolean;
  name?: string;
  onChange(value: string): void;
  recipe: ComponentRecipe;
  required: boolean;
  value?: string;
};

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(null);

function RadioGroupRoot<T extends string>({
  children,
  className,
  defaultValue,
  direction = "row",
  disabled = false,
  name,
  onChange,
  recipe = "auto",
  required = false,
  value,
  ...restProps
}: RadioGroupProps<T>) {
  const [selected, setSelected] = useControllableValue<string | undefined>({
    controlled: value,
    defaultValue,
    onChange: (next) => {
      if (next !== undefined) {
        onChange?.(next as T);
      }
    },
  });

  return React.createElement(
    RadioGroupContext.Provider,
    {
      value: {
        disabled,
        name,
        onChange: setSelected,
        recipe,
        required,
        value: selected,
      },
    },
    React.createElement(
      "div",
      {
        ...restProps,
        className,
        role: "radiogroup",
        "data-sc-component": "radio-group",
        "data-sc-direction": direction,
        "data-sc-disabled": disabled ? "" : undefined,
        "data-sc-recipe": recipe,
      },
      children,
    ),
  );
}

function RadioGroupItem<T extends string>({
  block = false,
  children,
  className,
  disabled = false,
  required,
  value,
}: RadioGroupItemProps<T>) {
  const context = useRequiredContext(RadioGroupContext, "RadioGroup.Item must be rendered inside RadioGroup");
  const itemDisabled = context.disabled || disabled;
  const checked = context.value === value;

  return React.createElement(
    "button",
    {
      "aria-checked": checked,
      className,
      disabled: itemDisabled,
      onClick: () => {
        if (!itemDisabled) {
          context.onChange(value);
        }
      },
      role: "radio",
      type: "button",
      "data-sc-block": block ? "" : undefined,
      "data-sc-checked": checked ? "" : undefined,
      "data-sc-component": "radio-item",
      "data-sc-disabled": itemDisabled ? "" : undefined,
      "data-sc-recipe": context.recipe,
    },
    React.createElement("span", { "data-sc-component": "radio-indicator" }),
    React.createElement("span", { "data-sc-component": "radio-label" }, children),
    context.name
      ? React.createElement("input", {
          checked,
          disabled: itemDisabled,
          name: context.name,
          readOnly: true,
          required: required ?? context.required,
          tabIndex: -1,
          type: "radio",
          value,
          "data-sc-component": "visually-hidden-input",
        })
      : null,
  );
}

/** Fieldset-compatible radio group with typed option values. */
export const RadioGroup = Object.assign(RadioGroupRoot, {
  Item: RadioGroupItem,
});

/** Props for grouped segmented buttons. */
export type SegmentedControlProps<T extends string = string> = PrimitiveProps & {
  value?: T;
  defaultValue?: T;
  onChange?: (nextValue: T) => void;
  onClick?: () => void;
  "aria-label": string;
  size?: ControlSize;
  gutterSize?: Sizes<"2xs" | "xs" | "sm" | "md" | "lg" | "xl">;
  disabled?: boolean;
  block?: boolean;
  pill?: boolean;
  className?: string;
  children: React.ReactNode;
};

/** Props for one segmented-control option. */
export type SegmentedControlOptionProps = {
  value: string;
  "aria-label"?: string;
  children: React.ReactNode;
  disabled?: boolean;
};

type SegmentedControlContextValue = {
  disabled: boolean;
  onClick?: () => void;
  onChange(value: string): void;
  recipe: ComponentRecipe;
  selected?: string;
};

const SegmentedControlContext = React.createContext<SegmentedControlContextValue | null>(null);

function SegmentedControlRoot<T extends string>({
  block = false,
  children,
  className,
  defaultValue,
  disabled = false,
  gutterSize,
  onChange,
  onClick,
  pill = false,
  recipe = "auto",
  size = "md",
  value,
  ...restProps
}: SegmentedControlProps<T>) {
  const [selected, setSelected] = useControllableValue<string | undefined>({
    controlled: value,
    defaultValue,
    onChange: (next) => {
      if (next !== undefined) {
        onChange?.(next as T);
      }
    },
  });

  return React.createElement(
    SegmentedControlContext.Provider,
    {
      value: {
        disabled,
        onChange: setSelected,
        onClick,
        recipe,
        selected,
      },
    },
    React.createElement(
      "div",
      {
        ...restProps,
        className,
        role: "group",
        "data-sc-block": block ? "" : undefined,
        "data-sc-component": "segmented-control",
        "data-sc-disabled": disabled ? "" : undefined,
        "data-sc-gutter-size": gutterSize,
        "data-sc-pill": pill ? "" : undefined,
        "data-sc-recipe": recipe,
        "data-sc-size": size,
      },
      children,
    ),
  );
}

function SegmentedControlOption({
  children,
  disabled = false,
  value,
  ...restProps
}: SegmentedControlOptionProps) {
  const context = useRequiredContext(
    SegmentedControlContext,
    "SegmentedControl.Option must be rendered inside SegmentedControl",
  );
  const selected = context.selected === value;
  const optionDisabled = context.disabled || disabled;

  return React.createElement(
    "button",
    {
      ...restProps,
      "aria-pressed": selected,
      disabled: optionDisabled,
      onClick: () => {
        context.onClick?.();
        if (!optionDisabled) {
          context.onChange(value);
        }
      },
      type: "button",
      "data-sc-component": "segmented-option",
      "data-sc-disabled": optionDisabled ? "" : undefined,
      "data-sc-recipe": context.recipe,
      "data-sc-selected": selected ? "" : undefined,
    },
    children,
  );
}

/** Compact segmented-control container with compound options. */
export const SegmentedControl = Object.assign(SegmentedControlRoot, {
  Option: SegmentedControlOption,
});

/** Select option displayed in `Select`. */
export type Option<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
  description?: React.ReactNode;
  tooltip?: {
    content: React.ReactNode;
    maxWidth?: number;
  };
};

/** Labeled select option group. */
export type OptionGroup<T extends Option = Option> = {
  label: string;
  options: T[];
  optionsLimit?: {
    label: string;
    limit: number;
  };
};

/** Flat or grouped select options. */
export type Options<T extends Option = Option> = T[] | OptionGroup<T>[];

type CallbackWithOption<T extends Option> = (option: T) => void;
type CallbackWithOptions<T extends Option> = (options: T[]) => void;
type CallbackWithActionId = (actionId: string) => void;
type SearchPredicate<T extends Option> = (option: T, searchTerm: string) => boolean;

/** Action rendered below a select option list. */
export type SelectAction = {
  id: string;
  label: string;
  Icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  className?: string;
  onSelect: CallbackWithActionId;
};

/** Preferred side for the select popup. */
export type PopoverSide = "top" | "bottom";

/** Preferred alignment for the select popup. */
export type PopoverAlign = Alignment;

type CommonSelectProps<T extends Option> = PrimitiveProps & {
  options: Options<T>;
  disabled?: boolean;
  id?: string;
  required?: boolean;
  name?: string;
  placeholder?: string;
  loadingPlaceholder?: string;
  loading?: boolean;
  variant?: SelectControlProps["variant"];
  pill?: boolean;
  size?: SelectControlProps["size"];
  dropdownIconType?: SelectControlProps["dropdownIconType"];
  actions?: SelectAction[];
  optionClassName?: string;
  OptionView?: React.FC<T>;
  TriggerStartIcon?: SelectControlProps["StartIcon"];
  triggerClassName?: string;
  opticallyAlign?: "start" | "end";
  clearable?: boolean;
  block?: boolean;
  side?: PopoverSide;
  align?: PopoverAlign;
  alignOffset?: number;
  avoidCollisions?: boolean;
  listWidth?: number | "auto";
  listMinWidth?: number | "auto";
  listMaxWidth?: number | "auto";
  searchPredicate?: SearchPredicate<T>;
  searchPlaceholder?: string;
  searchEmptyMessage?: React.ReactNode;
  /** Sidecar-only testing and controlled-preview helper. */
  defaultOpen?: boolean;
};

type SingleSelectProps<T extends Option> = {
  multiple?: false;
  value: string;
  onChange: CallbackWithOption<T>;
  TriggerView?: React.FC<T>;
};

type MultiSelectTriggerViewProps<T extends Option> = {
  values: T[];
  selectedAll: boolean;
};

type MultiSelectProps<T extends Option> = {
  multiple: true;
  value: string[];
  onChange: CallbackWithOptions<T>;
  TriggerView?: React.FC<MultiSelectTriggerViewProps<T>>;
};

/** Props for a host-adaptive select. */
export type SelectProps<T extends Option = Option> = (SingleSelectProps<T> | MultiSelectProps<T>) &
  CommonSelectProps<T>;

/** Host-adaptive select with search, actions, and single or multi selection. */
export function Select<T extends Option = Option>({
  actions,
  block = true,
  clearable = false,
  defaultOpen = false,
  disabled = false,
  dropdownIconType = "dropdown",
  id,
  loading = false,
  loadingPlaceholder = "Loading...",
  multiple,
  name,
  onChange,
  OptionView,
  options,
  opticallyAlign,
  pill = false,
  placeholder = "Select...",
  recipe = "auto",
  required = false,
  searchEmptyMessage = "No results",
  searchPlaceholder = "Search...",
  searchPredicate = defaultSearchPredicate,
  size = "md",
  TriggerStartIcon,
  TriggerView,
  triggerClassName,
  value,
  variant = "outline",
}: SelectProps<T>) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [search, setSearch] = React.useState("");
  const allOptions = React.useMemo(() => flattenOptions(options), [options]);
  const filteredOptions = React.useMemo(
    () => allOptions.filter((option) => searchPredicate(option, search)),
    [allOptions, search, searchPredicate],
  );
  const selectedOptions = React.useMemo(() => {
    const values = Array.isArray(value) ? value : [value];
    return allOptions.filter((option) => values.includes(option.value));
  }, [allOptions, value]);
  const selected = selectedOptions[0];
  const triggerContent = renderSelectTriggerContent({
    loading,
    loadingPlaceholder,
    multiple: Boolean(multiple),
    placeholder,
    selected,
    selectedOptions,
    TriggerView: TriggerView as React.FC<unknown> | undefined,
  });

  const commitOption = (option: T) => {
    if (option.disabled) {
      return;
    }
    if (multiple) {
      const current = selectedOptions.some((selectedOption) => selectedOption.value === option.value)
        ? selectedOptions.filter((selectedOption) => selectedOption.value !== option.value)
        : [...selectedOptions, option];
      (onChange as CallbackWithOptions<T>)(current);
      return;
    }
    (onChange as CallbackWithOption<T>)(option);
    setOpen(false);
  };

  return React.createElement(
    "div",
    {
      "data-sc-block": block ? "" : undefined,
      "data-sc-component": "select",
      "data-sc-open": open ? "" : undefined,
      "data-sc-recipe": recipe,
    },
    React.createElement(SelectControl, {
      block,
      children: triggerContent,
      className: triggerClassName,
      disabled,
      dropdownIconType,
      id,
      loading,
      onClearClick:
        clearable && selectedOptions.length > 0
          ? () => {
              if (multiple) {
                (onChange as CallbackWithOptions<T>)([]);
              } else {
                (onChange as CallbackWithOption<T>)({ label: "", value: "" } as T);
              }
            }
          : undefined,
      onInteract: () => setOpen((next) => !next),
      opticallyAlign,
      pill,
      recipe,
      selected: selectedOptions.length > 0,
      size,
      StartIcon: TriggerStartIcon,
      variant,
    }),
    name
      ? renderHiddenSelectInputs({
          disabled,
          multiple: Boolean(multiple),
          name,
          required,
          selectedOptions,
          value,
        })
      : null,
    open
      ? React.createElement(
          "div",
          {
            role: "listbox",
            "aria-multiselectable": multiple || undefined,
            "data-sc-component": "select-list",
            "data-sc-recipe": recipe,
          },
          React.createElement(Input, {
            "aria-label": searchPlaceholder,
            onChange: (event) => setSearch(event.currentTarget.value),
            placeholder: searchPlaceholder,
            recipe,
            size: "sm",
            value: search,
          }),
          filteredOptions.length === 0
            ? React.createElement("div", { "data-sc-component": "select-empty" }, searchEmptyMessage)
            : filteredOptions.map((option) => {
                const selectedOption = selectedOptions.some((selectedCandidate) => selectedCandidate.value === option.value);
                return React.createElement(
                  "button",
                  {
                    className: undefined,
                    disabled: option.disabled,
                    key: option.value,
                    onClick: () => commitOption(option),
                    role: "option",
                    type: "button",
                    "aria-selected": selectedOption,
                    "data-sc-component": "select-option",
                    "data-sc-disabled": option.disabled ? "" : undefined,
                    "data-sc-selected": selectedOption ? "" : undefined,
                  },
                  OptionView
                    ? React.createElement(OptionView, option)
                    : React.createElement(
                        React.Fragment,
                        null,
                        React.createElement("span", { "data-sc-component": "select-option-label" }, option.label),
                        option.description
                          ? React.createElement("span", { "data-sc-component": "select-option-description" }, option.description)
                          : null,
                      ),
                );
              }),
          actions?.length
            ? React.createElement(
                "div",
                { "data-sc-component": "select-actions" },
                actions.map((action) =>
                  React.createElement(
                    "button",
                    {
                      className: action.className,
                      key: action.id,
                      onClick: () => action.onSelect(action.id),
                      type: "button",
                      "data-sc-component": "select-action",
                    },
                    action.Icon ? React.createElement(action.Icon, { "aria-hidden": true }) : null,
                    action.label,
                  ),
                ),
              )
            : null,
        )
      : null,
  );
}

/** Select trigger variant icon type. */
export type DropdownIconType = "chevronDown" | "dropdown" | "none";

/** Props for a standalone select-like trigger. */
export type SelectControlProps = Omit<React.HTMLAttributes<HTMLSpanElement>, "onClick"> &
  PrimitiveProps & {
    variant?: Variants<"soft" | "outline" | "ghost">;
    pill?: boolean;
    block?: boolean;
    opticallyAlign?: "start" | "end";
    disabled?: boolean;
    invalid?: boolean;
    selected?: boolean;
    onClearClick?: () => void;
    onInteract?: () => void;
    size?: ControlSize;
    loading?: boolean;
    dropdownIconType?: DropdownIconType;
    StartIcon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    children: React.ReactNode;
  };

/** Host-adaptive select trigger used by `Select` and custom controls. */
export const SelectControl = React.forwardRef<HTMLSpanElement, SelectControlProps>(function SelectControl(
  {
    block = true,
    children,
    disabled = false,
    dropdownIconType = "dropdown",
    invalid = false,
    loading = false,
    onClearClick,
    onInteract,
    opticallyAlign,
    pill = false,
    recipe = "auto",
    selected = false,
    size = "md",
    StartIcon,
    tabIndex,
    variant = "outline",
    ...props
  },
  ref,
) {
  return React.createElement(
    "span",
    {
      ref,
      role: "button",
      tabIndex: disabled ? -1 : (tabIndex ?? 0),
      onClick: () => {
        if (!disabled) {
          onInteract?.();
        }
      },
      onKeyDown: (event) => {
        props.onKeyDown?.(event);
        if (!disabled && !event.defaultPrevented && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onInteract?.();
        }
      },
      "data-sc-block": block ? "" : undefined,
      "data-sc-component": "select-control",
      "data-sc-disabled": disabled ? "" : undefined,
      "data-sc-invalid": invalid ? "" : undefined,
      "data-sc-optically-align": opticallyAlign,
      "data-sc-pill": pill ? "" : undefined,
      "data-sc-recipe": recipe,
      "data-sc-selected": selected ? "" : undefined,
      "data-sc-size": size,
      "data-sc-variant": variant,
      ...props,
    },
    StartIcon ? React.createElement(StartIcon, { "aria-hidden": true }) : null,
    React.createElement("span", { "data-sc-component": "select-control-value" }, children),
    loading ? React.createElement(LoadingIndicator, { "aria-hidden": true, size: "1em" }) : null,
    onClearClick
      ? React.createElement(
          "button",
          {
            "aria-label": "Clear selection",
            onClick: (event) => {
              event.stopPropagation();
              onClearClick();
            },
            type: "button",
            "data-sc-component": "select-clear",
          },
          "×",
        )
      : null,
    dropdownIconType === "none"
      ? null
      : React.createElement("span", { "aria-hidden": true, "data-sc-component": "select-dropdown-icon" }, dropdownIconType === "chevronDown" ? "⌄" : "▾"),
  );
});

/** Props for status badges. */
export type BadgeProps = Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> &
  PrimitiveProps & {
    children?: React.ReactNode;
    variant?: Variants<"solid" | "soft" | "outline">;
    size?: Sizes<"sm" | "md" | "lg">;
    pill?: boolean;
    color?: SemanticColors<"secondary" | "success" | "danger" | "warning" | "info" | "discovery">;
    /** Backward-compatible alias for `color`. */
    tone?: "default" | "success" | "warning" | "danger";
  };

/** Compact status badge using the active host recipe. */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  {
    children,
    color,
    pill = false,
    recipe = "auto",
    size = "sm",
    tone,
    variant = "soft",
    ...props
  },
  ref,
) {
  const resolvedColor = color ?? toneToColor(tone) ?? "secondary";

  return React.createElement(
    "span",
    {
      ref,
      "data-sc-color": resolvedColor,
      "data-sc-component": "badge",
      "data-sc-pill": pill ? "" : undefined,
      "data-sc-recipe": recipe,
      "data-sc-size": size,
      "data-sc-tone": tone,
      "data-sc-variant": variant,
      ...props,
    },
    children,
  );
});

/** Props for alert blocks. */
export type AlertProps = Omit<React.HTMLAttributes<HTMLDivElement>, "color" | "title"> &
  PrimitiveProps & {
    color?: SemanticColors<"primary" | "danger" | "success" | "info" | "discovery" | "caution" | "warning">;
    variant?: Variants<"solid" | "soft" | "outline">;
    title?: React.ReactNode;
    description?: React.ReactNode;
    actions?: React.ReactNode;
    actionsPlacement?: "end" | "bottom";
    indicator?: React.ReactNode | false;
    actionsClassName?: string;
    /** Backward-compatible alias for `color`. */
    tone?: "default" | "success" | "warning" | "danger";
  };

/** Portable alert block for compact status and guidance. */
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(function Alert(
  {
    actions,
    actionsClassName,
    actionsPlacement,
    children,
    color,
    description,
    indicator,
    recipe = "auto",
    role = "note",
    title,
    tone,
    variant = "soft",
    ...props
  },
  ref,
) {
  const resolvedColor = color ?? toneToColor(tone) ?? "primary";
  return React.createElement(
    "div",
    {
      ref,
      role,
      "data-sc-actions-placement": actionsPlacement,
      "data-sc-color": resolvedColor,
      "data-sc-component": "alert",
      "data-sc-recipe": recipe,
      "data-sc-tone": tone,
      "data-sc-variant": variant,
      ...props,
    },
    indicator === false
      ? null
      : React.createElement(
          "span",
          { "aria-hidden": true, "data-sc-component": "alert-indicator" },
          indicator ?? "•",
        ),
    React.createElement(
      "div",
      { "data-sc-component": "alert-content" },
      title ? React.createElement("div", { "data-sc-component": "alert-title" }, title) : null,
      description ? React.createElement("div", { "data-sc-component": "alert-description" }, description) : null,
      children,
    ),
    actions
      ? React.createElement(
          "div",
          { className: actionsClassName, "data-sc-component": "alert-actions" },
          actions,
        )
      : null,
  );
});

/** Backward-compatible alias for alerts. */
export const Callout = Alert;
export type CalloutProps = AlertProps;

/** Props for a compact avatar. */
export type AvatarProps = Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> &
  PrimitiveProps & {
    size?: number;
    overflowCount?: number;
    name?: string;
    color?: SemanticColors<"primary" | "secondary" | "success" | "info" | "discovery" | "danger">;
    variant?: Variants<"soft" | "solid">;
    imageUrl?: string;
    Icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    onClick?: () => void;
    onPointerDown?: () => void;
    /** Backward-compatible alias for `imageUrl`. */
    src?: string;
    /** Backward-compatible alt text for image avatars. */
    alt?: string;
    /** Backward-compatible fallback content. */
    fallback?: React.ReactNode;
  };

/** Circular avatar with image, initials, overflow, icon, and fallback support. */
export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  {
    alt = "",
    color = "secondary",
    fallback,
    Icon,
    imageUrl,
    name,
    overflowCount,
    recipe = "auto",
    size = 28,
    src,
    variant = "soft",
    ...props
  },
  ref,
) {
  const url = imageUrl ?? src;
  const label = overflowCount !== undefined ? formatOverflow(overflowCount) : initialsFromName(name);
  const interactive = Boolean(props.onClick || props.onPointerDown);

  return React.createElement(
    "span",
    {
      ref,
      role: interactive ? "button" : undefined,
      tabIndex: interactive ? 0 : undefined,
      "data-sc-color": color,
      "data-sc-component": "avatar",
      "data-sc-interactive": interactive ? "" : undefined,
      "data-sc-recipe": recipe,
      "data-sc-variant": variant,
      style: { "--sc-avatar-size": `${size}px`, ...props.style } as React.CSSProperties,
      ...props,
    },
    url ? React.createElement("img", { alt, src: url }) : null,
    !url && Icon ? React.createElement(Icon, { "aria-hidden": true }) : null,
    !url && !Icon ? fallback ?? label : null,
  );
});

/** Props for stacked avatar groups. */
export type AvatarGroupProps = PrimitiveProps & {
  className?: string;
  stack?: "start" | "end";
  size?: number;
  children: React.ReactNode;
};

/** Stacked avatar group using the active host recipe. */
export function AvatarGroup({ children, className, recipe = "auto", size, stack = "start" }: AvatarGroupProps) {
  return React.createElement(
    "div",
    {
      className,
      "data-sc-component": "avatar-group",
      "data-sc-recipe": recipe,
      "data-sc-stack": stack,
      style: size ? ({ "--sc-avatar-size": `${size}px` } as React.CSSProperties) : undefined,
    },
    children,
  );
}

/** Props for empty-message containers. */
export type EmptyMessageProps = PrimitiveProps & {
  children: React.ReactNode;
  className?: string;
  fill?: "static" | "absolute" | "none";
};

/** Props for empty-message icon slots. */
export type EmptyMessageIconProps = PrimitiveProps & {
  size?: Sizes<"sm" | "md">;
  color?: SemanticColors<"secondary" | "danger" | "warning">;
  children: React.ReactNode;
  className?: string;
};

/** Props for empty-message title slots. */
export type EmptyMessageTitleProps = PrimitiveProps & {
  children: React.ReactNode;
  className?: string;
  color?: SemanticColors<"secondary" | "danger" | "warning">;
};

const EmptyMessageContext = React.createContext<ComponentRecipe>("auto");

function EmptyMessageRoot({ children, className, fill = "static", recipe = "auto" }: EmptyMessageProps) {
  return React.createElement(
    EmptyMessageContext.Provider,
    { value: recipe },
    React.createElement(
      "div",
      {
        className,
        "data-sc-component": "empty-message",
        "data-sc-fill": fill,
        "data-sc-recipe": recipe,
      },
      children,
    ),
  );
}

function EmptyMessageIcon({ children, className, color = "secondary", recipe, size = "sm" }: EmptyMessageIconProps) {
  const inheritedRecipe = React.useContext(EmptyMessageContext);
  return React.createElement(
    "div",
    {
      className,
      "data-sc-color": color,
      "data-sc-component": "empty-message-icon",
      "data-sc-recipe": recipe ?? inheritedRecipe,
      "data-sc-size": size,
    },
    children,
  );
}

function EmptyMessageTitle({ children, className, color = "secondary", recipe }: EmptyMessageTitleProps) {
  const inheritedRecipe = React.useContext(EmptyMessageContext);
  return React.createElement(
    "div",
    {
      className,
      "data-sc-color": color,
      "data-sc-component": "empty-message-title",
      "data-sc-recipe": recipe ?? inheritedRecipe,
    },
    children,
  );
}

function EmptyMessageDescription({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return React.createElement("div", { className, "data-sc-component": "empty-message-description" }, children);
}

function EmptyMessageActionRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return React.createElement("div", { className, "data-sc-component": "empty-message-actions" }, children);
}

/** Empty-state primitive with compound slots matching the OpenAI UI shape. */
export const EmptyMessage = Object.assign(EmptyMessageRoot, {
  ActionRow: EmptyMessageActionRow,
  Description: EmptyMessageDescription,
  Icon: EmptyMessageIcon,
  Title: EmptyMessageTitle,
});

/** Backward-compatible props for early Sidecar empty states. */
export type EmptyStateProps = Omit<React.HTMLAttributes<HTMLDivElement>, "title"> &
  PrimitiveProps & {
    title: React.ReactNode;
    action?: React.ReactNode;
  };

/** Backward-compatible wrapper around `EmptyMessage`. */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { action, children, recipe = "auto", title, ...props },
  ref,
) {
  return React.createElement(
    "div",
    { ref, ...props },
    React.createElement(
      EmptyMessage,
      {
        recipe,
        children: [
          React.createElement(EmptyMessage.Title, { children: title, key: "title" }),
          children
            ? React.createElement(EmptyMessage.Description, { children, key: "description" })
            : null,
          action
            ? React.createElement(EmptyMessage.ActionRow, { children: action, key: "action" })
            : null,
        ],
      },
    ),
  );
});

/** Props for loading dot indicators. */
export type LoadingDotsProps = Omit<React.ComponentProps<"div">, "children"> & PrimitiveProps;

/** Three-dot loading indicator. */
export function LoadingDots({ recipe = "auto", ...props }: LoadingDotsProps) {
  return React.createElement(
    "div",
    {
      "aria-hidden": true,
      "data-sc-component": "loading-dots",
      "data-sc-recipe": recipe,
      ...props,
    },
    React.createElement("span", null),
    React.createElement("span", null),
    React.createElement("span", null),
  );
}

/** Props for circular indeterminate indicators. */
export type LoadingIndicatorProps = {
  className?: string;
  size?: number | string;
  strokeWidth?: number;
} & Omit<React.ComponentProps<"div">, "children"> &
  PrimitiveProps;

/** Circular indeterminate loading indicator. */
export function LoadingIndicator({
  className,
  recipe = "auto",
  size = "1em",
  strokeWidth = 2,
  style,
  ...props
}: LoadingIndicatorProps) {
  return React.createElement(
    "div",
    {
      className,
      "data-sc-component": "loading-indicator",
      "data-sc-recipe": recipe,
      style: { "--sc-indicator-size": typeof size === "number" ? `${size}px` : size, ...style } as React.CSSProperties,
      ...props,
    },
    React.createElement(
      "svg",
      {
        viewBox: "0 0 24 24",
        "aria-hidden": true,
      },
      React.createElement("circle", {
        cx: 12,
        cy: 12,
        r: 9,
        fill: "none",
        stroke: "currentColor",
        strokeLinecap: "round",
        strokeWidth,
      }),
    ),
  );
}

/** Props for determinate or simulated circular progress. */
export type CircularProgressProps = Omit<React.ComponentProps<"div">, "children"> &
  PrimitiveProps & {
    maxDuration?: number;
    done?: boolean;
    progress?: number;
    size?: number | string;
    strokeWidth?: number;
    trackActiveColor?: string;
    trackColor?: string;
  };

/** Circular progress indicator with optional determinate value. */
export function CircularProgress({
  className,
  done = false,
  progress,
  recipe = "auto",
  size = 28,
  strokeWidth = 2,
  style,
  trackActiveColor = "currentColor",
  trackColor = "color-mix(in srgb, currentColor 18%, transparent)",
  ...props
}: CircularProgressProps) {
  const value = done ? 100 : Math.max(0, Math.min(100, progress ?? 66));
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (value / 100) * circumference;

  return React.createElement(
    "div",
    {
      className,
      role: "progressbar",
      "aria-valuemax": 100,
      "aria-valuemin": 0,
      "aria-valuenow": value,
      "data-sc-component": "circular-progress",
      "data-sc-recipe": recipe,
      style: { "--sc-progress-size": typeof size === "number" ? `${size}px` : size, ...style } as React.CSSProperties,
      ...props,
    },
    React.createElement(
      "svg",
      { viewBox: "0 0 24 24", "aria-hidden": true },
      React.createElement("circle", {
        cx: 12,
        cy: 12,
        fill: "none",
        r: radius,
        stroke: trackColor,
        strokeWidth,
      }),
      React.createElement("circle", {
        cx: 12,
        cy: 12,
        fill: "none",
        r: radius,
        stroke: trackActiveColor,
        strokeDasharray: circumference,
        strokeDashoffset: dashOffset,
        strokeLinecap: "round",
        strokeWidth,
        transform: "rotate(-90 12 12)",
      }),
    ),
  );
}

/** Backward-compatible alias for indeterminate loading. */
export const Spinner = LoadingIndicator;
export type SpinnerProps = LoadingIndicatorProps;

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

/** Props for shimmer text. */
export type ShimmerTextProps = PrimitiveProps & {
  as?: "p" | "span" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "div";
  children: React.ReactNode;
  className?: string;
};

/** Text skeleton shimmer that preserves the surrounding typography. */
export function ShimmerText({ as: Tag = "span", children, className, recipe = "auto" }: ShimmerTextProps) {
  return React.createElement(
    Tag,
    {
      className,
      "data-sc-component": "shimmer-text",
      "data-sc-recipe": recipe,
    },
    children,
  );
}

/** Props for text links. */
export type TextLinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "children"> &
  PrimitiveProps & {
    children: React.ReactNode;
    primary?: boolean;
    underline?: boolean;
    forceExternal?: boolean;
  };

/** Anchor with host-adaptive text-link affordances. */
export const TextLink = React.forwardRef<HTMLAnchorElement, TextLinkProps>(function TextLink(
  {
    children,
    forceExternal,
    href,
    primary = false,
    recipe = "auto",
    rel,
    target,
    underline = true,
    ...props
  },
  ref,
) {
  const external = forceExternal ?? Boolean(href && /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href));
  return React.createElement(
    "a",
    {
      ref,
      "data-sc-component": "text-link",
      "data-sc-primary": primary ? "" : undefined,
      "data-sc-recipe": recipe,
      "data-sc-underline": underline ? "" : undefined,
      href,
      rel: external && target === "_blank" ? "noreferrer" : rel,
      target,
      ...props,
    },
    children,
  );
});

/** Props for images inside widgets. */
export type ImageProps = React.ImgHTMLAttributes<HTMLImageElement> &
  PrimitiveProps & {
    forceRenderAfterLoadFail?: boolean;
  };

/** Responsive image primitive with stable block sizing defaults. */
export const Image = React.forwardRef<HTMLImageElement, ImageProps>(function Image(
  { forceRenderAfterLoadFail: _forceRenderAfterLoadFail, recipe = "auto", ...props },
  ref,
) {
  return React.createElement("img", {
    ref,
    "data-sc-component": "image",
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
    "aria-hidden": true,
    "data-sc-component": "skeleton",
    "data-sc-recipe": recipe,
    style: { width, height, ...style },
    ...props,
  });
});

/** Props for form-field wrappers. */
export type FormFieldProps = React.HTMLAttributes<HTMLDivElement> &
  PrimitiveProps & {
    invalid?: boolean;
    disabled?: boolean;
    required?: boolean;
  };

type FieldContextValue = {
  controlId: string;
  descriptionId: string;
  errorId: string;
  disabled: boolean;
  invalid: boolean;
  required: boolean;
};

const FieldContext = React.createContext<FieldContextValue | null>(null);

/** Form field wrapper that wires labels, descriptions, errors, and controls. */
export function FormField({
  children,
  disabled = false,
  id,
  invalid = false,
  recipe = "auto",
  required = false,
  ...props
}: FormFieldProps) {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const context = React.useMemo(
    () => ({
      controlId,
      descriptionId: `${controlId}-description`,
      disabled,
      errorId: `${controlId}-error`,
      invalid,
      required,
    }),
    [controlId, disabled, invalid, required],
  );

  return React.createElement(
    FieldContext.Provider,
    { value: context },
    React.createElement(
      "div",
      {
        "data-sc-component": "form-field",
        "data-sc-disabled": disabled ? "" : undefined,
        "data-sc-invalid": invalid ? "" : undefined,
        "data-sc-recipe": recipe,
        ...props,
      },
      children,
    ),
  );
}

/** Props for field labels. */
export type FieldLabelProps = React.LabelHTMLAttributes<HTMLLabelElement> & PrimitiveProps;

/** Label that automatically binds to the nearest `FormField` control. */
export const FieldLabel = React.forwardRef<HTMLLabelElement, FieldLabelProps>(function FieldLabel(
  { children, htmlFor, recipe = "auto", ...props },
  ref,
) {
  const field = React.useContext(FieldContext);
  return React.createElement(
    "label",
    {
      ref,
      htmlFor: htmlFor ?? field?.controlId,
      "data-sc-component": "field-label",
      "data-sc-recipe": recipe,
      ...props,
    },
    children,
    field?.required ? React.createElement("span", { "aria-hidden": true, "data-sc-component": "field-required" }, "*") : null,
  );
});

/** Props for field descriptions. */
export type FieldDescriptionProps = React.HTMLAttributes<HTMLParagraphElement> & PrimitiveProps;

/** Description text that automatically binds to the nearest `FormField`. */
export const FieldDescription = React.forwardRef<HTMLParagraphElement, FieldDescriptionProps>(function FieldDescription(
  { id, recipe = "auto", ...props },
  ref,
) {
  const field = React.useContext(FieldContext);
  return React.createElement("p", {
    ref,
    id: id ?? field?.descriptionId,
    "data-sc-component": "field-description",
    "data-sc-recipe": recipe,
    ...props,
  });
});

/** Props for field errors. */
export type FieldErrorProps = React.HTMLAttributes<HTMLParagraphElement> & PrimitiveProps;

/** Error text that automatically binds to the nearest invalid `FormField`. */
export const FieldError = React.forwardRef<HTMLParagraphElement, FieldErrorProps>(function FieldError(
  { id, recipe = "auto", ...props },
  ref,
) {
  const field = React.useContext(FieldContext);
  return React.createElement("p", {
    ref,
    id: id ?? field?.errorId,
    role: "alert",
    "data-sc-component": "field-error",
    "data-sc-recipe": recipe,
    ...props,
  });
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
    "data-sc-recipe": recipe,
    "data-sc-variant": variant,
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
export type SliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & PrimitiveProps;

/** Range slider using host accent colors. */
export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { recipe = "auto", ...props },
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

/** Creates a scoped set of primitives pinned to one host recipe. */
export function createPrimitiveComponents(recipe: Exclude<ComponentRecipe, "auto">) {
  return {
    Alert: pinRecipe(Alert, recipe),
    Avatar: pinRecipe(Avatar, recipe),
    AvatarGroup: pinRecipe(AvatarGroup, recipe),
    Badge: pinRecipe(Badge, recipe),
    Button: pinRecipe(Button, recipe),
    ButtonLink: pinRecipe(ButtonLink, recipe),
    Callout: pinRecipe(Callout, recipe),
    Checkbox: pinRecipe(Checkbox, recipe),
    CircularProgress: pinRecipe(CircularProgress, recipe),
    Code: pinRecipe(Code, recipe),
    CopyButton: pinRecipe(CopyButton, recipe),
    Divider: pinRecipe(Divider, recipe),
    EmptyMessage: pinRecipe(EmptyMessage, recipe),
    EmptyState: pinRecipe(EmptyState, recipe),
    FieldDescription: pinRecipe(FieldDescription, recipe),
    FieldError: pinRecipe(FieldError, recipe),
    FieldLabel: pinRecipe(FieldLabel, recipe),
    FormField: pinRecipe(FormField, recipe),
    Heading: pinRecipe(Heading, recipe),
    Image: pinRecipe(Image, recipe),
    Inline: pinRecipe(Inline, recipe),
    Input: pinRecipe(Input, recipe),
    KeyValue: pinRecipe(KeyValue, recipe),
    LoadingDots: pinRecipe(LoadingDots, recipe),
    LoadingIndicator: pinRecipe(LoadingIndicator, recipe),
    Progress: pinRecipe(Progress, recipe),
    RadioGroup: pinRecipe(RadioGroup, recipe),
    SegmentedControl: pinRecipe(SegmentedControl, recipe),
    Select: pinRecipe(Select, recipe),
    SelectControl: pinRecipe(SelectControl, recipe),
    ShimmerText: pinRecipe(ShimmerText, recipe),
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
    TextLink: pinRecipe(TextLink, recipe),
  };
}

function normalizeButtonVisual({
  color,
  intent,
  variant,
}: Pick<ButtonVisualProps, "color" | "intent" | "variant">): {
  color: SemanticColor;
  variant: Variant;
} {
  if (variant && isSemanticColor(variant)) {
    return { color: variant, variant: defaultVariantForColor(variant) };
  }

  if (variant === "ghost") {
    return { color: color ?? "secondary", variant: "ghost" };
  }

  if (intent === "ghost") {
    return { color: color ?? "secondary", variant: "ghost" };
  }

  const resolvedColor = color ?? (intent && isSemanticColor(intent) ? intent : "secondary");
  return { color: resolvedColor, variant: (variant as Variant | undefined) ?? defaultVariantForColor(resolvedColor) };
}

function defaultVariantForColor(color: SemanticColor): Variant {
  return color === "secondary" ? "soft" : "solid";
}

function isSemanticColor(value: string): value is SemanticColor {
  return ["primary", "secondary", "danger", "success", "warning", "caution", "discovery", "info"].includes(value);
}

function toneToColor(tone?: "default" | "success" | "warning" | "danger") {
  switch (tone) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "danger":
      return "danger";
    case "default":
    case undefined:
      return undefined;
  }
}

function useControllableValue<T>({
  controlled,
  defaultValue,
  onChange,
}: {
  controlled?: T;
  defaultValue: T;
  onChange?: (nextValue: T) => void;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const value = controlled ?? uncontrolled;
  const setValue = React.useCallback(
    (nextValue: T) => {
      if (controlled === undefined) {
        setUncontrolled(nextValue);
      }
      onChange?.(nextValue);
    },
    [controlled, onChange],
  );

  return [value, setValue] as const;
}

function useRequiredContext<T>(context: React.Context<T | null>, message: string): T {
  const value = React.useContext(context);
  if (value === null) {
    throw new Error(message);
  }
  return value;
}

function useMergedRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return React.useCallback(
    (node: T) => {
      for (const ref of refs) {
        if (!ref) {
          continue;
        }
        if (typeof ref === "function") {
          ref(node);
        } else {
          ref.current = node;
        }
      }
    },
    [refs],
  );
}

function describedBy(
  existing: string | undefined,
  field: FieldContextValue | null,
  invalid: boolean,
) {
  const ids = [existing, field?.descriptionId, invalid ? field?.errorId : undefined].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

function flattenOptions<T extends Option>(options: Options<T>): T[] {
  return options.flatMap((entry) => (isOptionGroup(entry) ? entry.options : [entry]));
}

function isOptionGroup<T extends Option>(entry: T | OptionGroup<T>): entry is OptionGroup<T> {
  return Array.isArray((entry as OptionGroup<T>).options);
}

function defaultSearchPredicate<T extends Option>(option: T, searchTerm: string) {
  if (!searchTerm) {
    return true;
  }
  return `${option.label} ${option.description ?? ""}`.toLowerCase().includes(searchTerm.toLowerCase());
}

function renderSelectTriggerContent<T extends Option>({
  loading,
  loadingPlaceholder,
  multiple,
  placeholder,
  selected,
  selectedOptions,
  TriggerView,
}: {
  loading: boolean;
  loadingPlaceholder: string;
  multiple: boolean;
  placeholder: string;
  selected?: T;
  selectedOptions: T[];
  TriggerView?: React.FC<unknown>;
}) {
  if (loading && selectedOptions.length === 0) {
    return loadingPlaceholder;
  }
  if (TriggerView) {
    const View = TriggerView as React.ComponentType<Record<string, unknown>>;
    return multiple
      ? React.createElement(View, {
          selectedAll: false,
          values: selectedOptions,
        })
      : selected
        ? React.createElement(View, selected)
        : placeholder;
  }
  if (multiple) {
    return selectedOptions.length ? `${selectedOptions.length} selected` : placeholder;
  }
  return selected?.label || placeholder;
}

function renderHiddenSelectInputs<T extends Option>({
  disabled,
  multiple,
  name,
  required,
  selectedOptions,
  value,
}: {
  disabled: boolean;
  multiple: boolean;
  name: string;
  required: boolean;
  selectedOptions: T[];
  value: string | string[];
}) {
  if (multiple) {
    return selectedOptions.map((option) =>
      React.createElement("input", {
        disabled,
        key: option.value,
        name,
        readOnly: true,
        required,
        type: "hidden",
        value: option.value,
      }),
    );
  }
  return React.createElement("input", {
    disabled,
    name,
    readOnly: true,
    required,
    type: "hidden",
    value: Array.isArray(value) ? "" : value,
  });
}

function initialsFromName(name?: string) {
  if (!name) {
    return null;
  }
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || null;
}

function formatOverflow(count: number) {
  return count > 99 ? "99+" : `+${count}`;
}

async function copyToClipboard(value: ClipboardContent) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(typeof value === "string" ? value : Object.values(value).join("\n"));
  }
}

/** Pins an adaptive primitive to a host recipe for scoped packages. */
function pinRecipe<C>(
  Component: C,
  recipe: Exclude<ComponentRecipe, "auto">,
): C {
  const ComponentWithRecipe = Component as React.ComponentType<Record<string, unknown>>;
  const Wrapped = ((props: Record<string, unknown>) =>
    React.createElement(ComponentWithRecipe, { ...props, recipe })) as C;
  Object.assign(Wrapped as object, Component as object);
  return Wrapped;
}
