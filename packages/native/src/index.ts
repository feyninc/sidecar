/**
 * Portable host capability facade.
 *
 * APIs in this package feature-detect host globals at runtime and return a
 * typed unsupported/denied/failed result instead of assuming ChatGPT support.
 */

/** Host detected from runtime globals. */
export type HostName = "chatgpt" | "claude" | "codex-plugin" | "claude-plugin" | "unknown";

/** Standard result shape for host capabilities. */
export type HostFeatureResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; reason: "unsupported" | "denied" | "cancelled" | "failed"; message?: string };

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

    return "unknown";
  }
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

/** File host capability helpers. */
export const files = {
  /** Requests files from the host when supported. */
  async select(options: FileSelectOptions = {}): Promise<HostFeatureResult<File[]>> {
    const openai = readOpenAI();
    if (!openai?.selectFiles) {
      return { ok: false, reason: "unsupported" };
    }

    try {
      const selected = await openai.selectFiles(options);
      return { ok: true, value: selected };
    } catch (error) {
      return normalizeHostError<File[]>(error);
    }
  }
};

type OpenAIBridge = {
  requestDisplayMode?: (request: { mode: DisplayMode }) => Promise<void>;
  selectFiles?: (options: FileSelectOptions) => Promise<File[]>;
};

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
