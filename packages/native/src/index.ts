export type HostName = "chatgpt" | "claude" | "codex-plugin" | "claude-plugin" | "unknown";

export type HostFeatureResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; reason: "unsupported" | "denied" | "cancelled" | "failed"; message?: string };

export type DisplayMode = "inline" | "fullscreen" | "pip";

export const host = {
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

export const display = {
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

export type FileSelectOptions = {
  accept?: string[];
  multiple?: boolean;
};

export const files = {
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

function readOpenAI(): OpenAIBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as unknown as { openai?: OpenAIBridge }).openai;
}

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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
