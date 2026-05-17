/**
 * Portable host capability facade.
 *
 * APIs in this package feature-detect host globals at runtime and return a
 * typed unsupported/denied/failed result instead of assuming ChatGPT support.
 */
export {
  Alert,
  Avatar,
  Badge,
  Button,
  Callout,
  Checkbox,
  Code,
  Divider,
  EmptyState,
  Heading,
  Image,
  Inline,
  KeyValue,
  Progress,
  RadioGroup,
  SegmentedControl,
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
  createPrimitiveComponents,
} from "./components/index.js";
export type {
  AlertProps,
  AvatarProps,
  BadgeProps,
  ButtonProps,
  CalloutProps,
  CheckboxProps,
  CodeProps,
  ComponentRecipe,
  ControlIntent,
  DividerProps,
  EmptyStateProps,
  HeadingProps,
  ImageProps,
  InlineProps,
  KeyValueItem,
  KeyValueProps,
  PrimitiveProps,
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
  TextFieldProps,
  TextareaProps,
  TextProps,
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
    if (typeof window === "undefined") {
      return "unknown";
    }

    const openai = (window as unknown as { openai?: unknown }).openai;
    if (openai) {
      return "chatgpt";
    }

    if (typeof document !== "undefined") {
      const styles = getComputedStyle(document.documentElement);
      if (
        styles.getPropertyValue("--claude-background-color") ||
        styles.getPropertyValue("--claude-text-color")
      ) {
        return "claude";
      }
    }

    return "unknown";
  }
};

/** Host capability detection that does not perform the capability action. */
export const capabilities = {
  /** Returns one stable support state for a known capability. */
  get(capability: HostCapability): CapabilityState {
    const openai = readOpenAI();
    switch (capability) {
      case "display.fullscreen":
      case "display.pip":
        return openai?.requestDisplayMode ? "supported" : "unsupported";
      case "files.select":
        return openai?.selectFiles
          ? "supported"
          : typeof document === "undefined"
            ? "unsupported"
            : "browser-fallback";
      case "files.download":
        return typeof document === "undefined" || typeof URL === "undefined"
          ? "unsupported"
          : "browser-fallback";
      case "links.openExternal":
        return openai?.openExternal
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
    const openai = readOpenAI();
    if (!openai?.requestDisplayMode) {
      return { ok: false, reason: "unsupported" };
    }

    try {
      await openai.requestDisplayMode({ mode });
      return { ok: true, value: undefined };
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
    const openai = readOpenAI();
    if (openai?.selectFiles) {
      try {
        const selected = await openai.selectFiles(options);
        return { ok: true, value: selected };
      } catch (error) {
        return normalizeHostError<File[]>(error);
      }
    }

    return selectFilesWithBrowserInput(options);
  },

  /** Downloads a Blob/string using the browser's native download behavior. */
  async download(
    data: BlobPart | Blob,
    options: FileDownloadOptions,
  ): Promise<HostFeatureResult> {
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
    const openai = readOpenAI();
    if (openai?.openExternal) {
      try {
        await openai.openExternal({ href: url });
        return { ok: true, value: undefined };
      } catch (error) {
        return normalizeHostError(error);
      }
    }

    if (typeof window === "undefined") {
      return { ok: false, reason: "unsupported" };
    }

    const opened = window.open(url, "_blank", "noopener,noreferrer");
    return opened
      ? { ok: true, value: undefined }
      : { ok: false, reason: "denied", message: "The host blocked the popup." };
  },
};

type OpenAIBridge = {
  requestDisplayMode?: (request: { mode: DisplayMode }) => Promise<void>;
  selectFiles?: (options: FileSelectOptions) => Promise<File[]>;
  openExternal?: (request: { href: string }) => Promise<void>;
};

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

/** Reads ChatGPT's host bridge when present. */
function readOpenAI(): OpenAIBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as unknown as { openai?: OpenAIBridge }).openai;
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
