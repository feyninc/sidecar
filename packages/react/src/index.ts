import {
  browserBridge,
  type WidgetBridge,
  type WidgetToolResult,
} from "@sidecar/client";
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export {
  browserBridge,
  createBrowserBridge,
  createToolClient,
  getToolResult,
  model,
  type HostFeatureResult,
  type ModelMessage,
  type WidgetBridge,
  type WidgetToolResult,
} from "@sidecar/client";

const WidgetBridgeContext = createContext<WidgetBridge | null>(null);

export function SidecarWidgetProvider(props: { bridge: WidgetBridge; children: ReactNode }) {
  return createElement(WidgetBridgeContext.Provider, { value: props.bridge }, props.children);
}

export function useWidgetBridge(): WidgetBridge {
  const bridge = useContext(WidgetBridgeContext);
  if (!bridge) {
    return browserBridge;
  }
  return bridge;
}

export function useToolResult<Structured, Meta = Record<string, unknown>>(): WidgetToolResult<Structured, Meta> {
  return useWidgetBridge().getToolResult<Structured, Meta>();
}

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
