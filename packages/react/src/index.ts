/**
 * React conveniences over the framework-agnostic `@sidecar/client` bridge.
 *
 * Widgets can use this package for hooks, but the underlying iframe bridge is
 * intentionally not React-specific.
 */
import {
  browserBridge,
  type WidgetBridge,
  type WidgetToolResult,
  type SidecarHostContext,
} from "@sidecar/client";
import {
  createContext,
  createElement,
  useEffect,
  useContext,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { ToolWidgetOptions } from "@sidecar/core";

export {
  browserBridge,
  createBrowserBridge,
  createToolClient,
  getToolResult,
  model,
  type HostFeatureResult,
  type SidecarHostContext,
  type ModelMessage,
  type WidgetBridge,
  type WidgetToolResult,
} from "@sidecar/client";
export type {
  ChatGptWidgetOptions,
  ToolWidgetOptions as WidgetOptions,
  WidgetCspOptions,
} from "@sidecar/core";

/** Props supplied to generated widget roots. Widgets read data through hooks. */
export type WidgetProps = Record<string, never>;

/** React component returned by `widget(...)` with static Sidecar metadata. */
export type SidecarWidget = ComponentType<WidgetProps> & {
  readonly kind: "sidecar.widget";
  readonly options: ToolWidgetOptions;
};

const WidgetBridgeContext = createContext<WidgetBridge | null>(null);
const HostContextContext = createContext<SidecarHostContext | null>(null);

/**
 * Declares a React widget and its MCP Apps resource metadata.
 *
 * The compiler reads the options statically from `widget.tsx`; at runtime this
 * returns the component itself so React rendering stays ordinary.
 */
export function widget(
  options: ToolWidgetOptions,
  Component: ComponentType<WidgetProps>,
): SidecarWidget {
  Object.defineProperties(Component, {
    kind: {
      enumerable: false,
      value: "sidecar.widget",
    },
    options: {
      enumerable: false,
      value: Object.freeze({ ...options }),
    },
  });

  return Component as SidecarWidget;
}

/** Provides a custom widget bridge for tests or non-browser embedding. */
export function SidecarWidgetProvider(props: { bridge: WidgetBridge; children?: ReactNode }) {
  const [hostContext, setHostContext] = useState<SidecarHostContext>(() =>
    props.bridge.getHostContext(),
  );

  useEffect(() => props.bridge.subscribeHostContext(setHostContext), [props.bridge]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.dataset.sidecarHost = hostContext.name;
    document.documentElement.dataset.sidecarTheme = hostContext.theme;
  }, [hostContext]);

  return createElement(
    WidgetBridgeContext.Provider,
    { value: props.bridge },
    createElement(
      HostContextContext.Provider,
      { value: hostContext },
      props.children,
    ),
  );
}

/** Generated widgets mount through this root so host context is always active. */
export function SidecarWidgetRoot(props: { children: ReactNode; bridge?: WidgetBridge }) {
  return createElement(
    SidecarWidgetProvider,
    { bridge: props.bridge ?? browserBridge },
    props.children,
  );
}

/** Returns the nearest bridge provider or the default browser bridge. */
export function useWidgetBridge(): WidgetBridge {
  const bridge = useContext(WidgetBridgeContext);
  if (!bridge) {
    return browserBridge;
  }
  return bridge;
}

/** React hook for reading the current tool result. */
export function useToolResult<Structured, Meta = Record<string, unknown>>(): WidgetToolResult<Structured, Meta> {
  return useWidgetBridge().getToolResult<Structured, Meta>();
}

/** React hook for the active host/theme context. */
export function useHost(): SidecarHostContext {
  const context = useContext(HostContextContext);
  if (context) {
    return context;
  }

  return useWidgetBridge().getHostContext();
}

/** React hook for just the active light/dark theme. */
export function useTheme(): SidecarHostContext["theme"] {
  return useHost().theme;
}

/** Session-storage backed state helper for lightweight widget state. */
export function useWidgetState<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const storageKey = `sidecar.widget.${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return initialValue;
    }

    const stored = window.sessionStorage.getItem(storageKey);
    return stored === null ? initialValue : (JSON.parse(stored) as T);
  });

  const update = useMemo(
    () => (next: T) => {
      setValue(next);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(storageKey, JSON.stringify(next));
      }
    },
    [storageKey]
  );

  return [value, update];
}
