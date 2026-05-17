/**
 * Portable host capability facade.
 *
 * APIs in this package use the standard MCP Apps host bridge at runtime and
 * return typed unsupported/denied/failed results when a capability is absent.
 */
import { browserBridge, detectHostContext as detectSidecarHostContext } from "@sidecar-ai/client";

export {
  Alert,
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  ButtonLink,
  Callout,
  Checkbox,
  CircularProgress,
  Code,
  CopyButton,
  Divider,
  EmptyMessage,
  EmptyState,
  FieldDescription,
  FieldError,
  FieldLabel,
  FormField,
  Heading,
  Image,
  Inline,
  Input,
  KeyValue,
  LoadingDots,
  LoadingIndicator,
  Progress,
  RadioGroup,
  SegmentedControl,
  Select,
  SelectControl,
  ShimmerText,
  Skeleton,
  Slider,
  Spinner,
  Stack,
  Surface,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextField,
  TextLink,
  createPrimitiveComponents,
} from "./components/index.js";
export type {
  AlertProps,
  AvatarProps,
  AvatarGroupProps,
  BadgeProps,
  ButtonProps,
  ButtonLinkProps,
  CalloutProps,
  CheckboxProps,
  CheckboxState,
  CircularProgressProps,
  CodeProps,
  ComponentRecipe,
  ControlIntent,
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
  PrimitiveProps,
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
  TextFieldProps,
  TextLinkProps,
  TextareaProps,
  TextProps,
  Variant,
  Variants,
} from "./components/index.js";

/** Host detected from runtime globals. */
export type HostName = "chatgpt" | "claude" | "unknown";

/** Standard result shape for host capabilities. */
export type HostFeatureResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; reason: "unsupported" | "denied" | "cancelled" | "failed"; message?: string };

/** Static availability classification for host capabilities. */
export type CapabilityState = "supported" | "browser-fallback" | "unsupported";

/** Capabilities Sidecar can detect without making a host call. */
export type HostCapability =
  | "display.fullscreen"
  | "display.pip"
  | "files.select"
  | "files.download"
  | "links.openExternal";

/** Display modes hosts may support for widgets. */
export type DisplayMode = "inline" | "fullscreen" | "pip";

/** Runtime host detection helpers. */
export const host = {
  /** Detects the current host from browser globals. */
  current(): HostName {
    const context = detectSidecarHostContext();
    if (context.name === "chatgpt") {
      return "chatgpt";
    }
    if (context.name === "claude") {
      return "claude";
    }

    return "unknown";
  }
};

/** Host capability detection that does not perform the capability action. */
export const capabilities = {
  /** Returns one stable support state for a known capability. */
  get(capability: HostCapability): CapabilityState {
    const standard = browserBridge.getHostCapabilities();
    const context = detectSidecarHostContext().raw as { availableDisplayModes?: DisplayMode[] } | undefined;
    switch (capability) {
      case "display.fullscreen":
        return context?.availableDisplayModes?.includes("fullscreen")
          ? "supported"
          : "unsupported";
      case "display.pip":
        return context?.availableDisplayModes?.includes("pip")
          ? "supported"
          : "unsupported";
      case "files.select":
        return typeof document === "undefined"
            ? "unsupported"
            : "browser-fallback";
      case "files.download":
        return standard?.downloadFile
          ? "supported"
          : typeof document === "undefined" || typeof URL === "undefined"
          ? "unsupported"
          : "browser-fallback";
      case "links.openExternal":
        return standard?.openLinks
          ? "supported"
          : typeof window === "undefined"
            ? "unsupported"
            : "browser-fallback";
    }
  },

  /** Returns every known capability state as a plain object. */
  all(): Record<HostCapability, CapabilityState> {
    return {
      "display.fullscreen": this.get("display.fullscreen"),
      "display.pip": this.get("display.pip"),
      "files.select": this.get("files.select"),
      "files.download": this.get("files.download"),
      "links.openExternal": this.get("links.openExternal"),
    };
  },
};

/** Display-mode host capability helpers. */
export const display = {
  /** Requests a widget display mode when the host supports it. */
  async request(mode: DisplayMode): Promise<HostFeatureResult> {
    try {
      const result = await browserBridge.requestDisplayMode(mode);
      return result.ok ? { ok: true, value: undefined } : result;
    } catch (error) {
      return normalizeHostError(error);
    }
  }
};

/** File picker options normalized across hosts. */
export type FileSelectOptions = {
  accept?: string[];
  multiple?: boolean;
};

/** Download options for generated client-side files. */
export type FileDownloadOptions = {
  filename: string;
  mimeType?: string;
};

/** File host capability helpers. */
export const files = {
  /** Requests files from the host when supported. */
  async select(options: FileSelectOptions = {}): Promise<HostFeatureResult<File[]>> {
    return selectFilesWithBrowserInput(options);
  },

  /** Downloads a Blob/string using the browser's native download behavior. */
  async download(
    data: BlobPart | Blob,
    options: FileDownloadOptions,
  ): Promise<HostFeatureResult> {
    const hostResult = await downloadWithHost(data, options);
    if (hostResult.ok || hostResult.reason !== "unsupported") {
      return hostResult;
    }

    if (typeof document === "undefined" || typeof URL === "undefined") {
      return { ok: false, reason: "unsupported" };
    }

    const blob = data instanceof Blob
      ? data
      : new Blob([data], { type: options.mimeType ?? "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = options.filename;
    anchor.rel = "noopener noreferrer";

    try {
      document.body.append(anchor);
      anchor.click();
      return { ok: true, value: undefined };
    } catch (error) {
      return normalizeHostError(error);
    } finally {
      anchor.remove();
      URL.revokeObjectURL(url);
    }
  },
};

/** External navigation helpers. */
export const links = {
  /** Opens an external URL through the host bridge when possible. */
  async openExternal(url: string): Promise<HostFeatureResult> {
    const hostResult = await browserBridge.openLink(url);
    if (hostResult.ok || hostResult.reason !== "unsupported") {
      return hostResult;
    }

    return openWithBrowserFallback(url);
  },
};

/** Allows only URL schemes that are safe for external navigation helpers. */
function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

/** Attempts the standard MCP Apps file download bridge before browser fallback. */
async function downloadWithHost(
  data: BlobPart | Blob,
  options: FileDownloadOptions,
): Promise<HostFeatureResult> {
  try {
    const contents = typeof data === "string"
      ? [{
          type: "resource",
          resource: {
            uri: fileUri(options.filename),
            mimeType: options.mimeType ?? "text/plain",
            text: data,
          },
        }]
      : [{
          type: "resource",
          resource: {
            uri: fileUri(options.filename),
            mimeType: options.mimeType ?? (data instanceof Blob ? data.type : undefined) ?? "application/octet-stream",
            blob: await blobPartToBase64(data, options.mimeType),
          },
        }];

    return browserBridge.downloadFile(contents);
  } catch (error) {
    return normalizeHostError(error);
  }
}

/** Builds a conservative file URI for MCP embedded download resources. */
function fileUri(filename: string): string {
  return `file:///${encodeURIComponent(filename.replace(/^[/\\]+/, ""))}`;
}

/** Converts browser Blob data into the base64 payload MCP embedded resources expect. */
async function blobPartToBase64(data: BlobPart | Blob, mimeType: string | undefined): Promise<string> {
  const blob = data instanceof Blob
    ? data
    : new Blob([data], { type: mimeType ?? "application/octet-stream" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Uses a hidden browser file input when the host has no native picker. */
function selectFilesWithBrowserInput(options: FileSelectOptions): Promise<HostFeatureResult<File[]>> {
  if (typeof document === "undefined") {
    return Promise.resolve({ ok: false, reason: "unsupported" });
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept?.join(",") ?? "";
    input.multiple = Boolean(options.multiple);
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.addEventListener("change", () => {
      const selected = input.files ? Array.from(input.files) : [];
      input.remove();
      resolve({ ok: true, value: selected });
    }, { once: true });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve({ ok: false, reason: "cancelled" });
    }, { once: true });
    document.body.append(input);
    input.click();
  });
}

/** Opens an external URL with normal browser behavior when no host bridge exists. */
function openWithBrowserFallback(url: string): HostFeatureResult {
  if (!isAllowedExternalUrl(url)) {
    return {
      ok: false,
      reason: "denied",
      message: "Only http, https, and mailto URLs can be opened externally.",
    };
  }

  if (typeof window === "undefined") {
    return { ok: false, reason: "unsupported" };
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  return opened
    ? { ok: true, value: undefined }
    : { ok: false, reason: "denied", message: "The host blocked the popup." };
}

/** Converts host exceptions into stable capability results. */
function normalizeHostError<T = void>(error: unknown): HostFeatureResult<T> {
  if (isAbortError(error)) {
    return { ok: false, reason: "cancelled" };
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("denied") || message.includes("permission")) {
      return { ok: false, reason: "denied", message: error.message };
    }
    return { ok: false, reason: "failed", message: error.message };
  }

  return { ok: false, reason: "failed" };
}

/** Detects cancellation errors from browser file/display APIs. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
