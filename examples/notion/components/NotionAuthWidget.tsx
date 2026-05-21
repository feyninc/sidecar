/** Authorization widget for linking a Notion account. */
import { useEffect, useState } from "react";
import { server, type WidgetToolResult } from "@sidecar-ai/react";
import { Stack, Surface, Text } from "@sidecar-ai/native/components";
import {
  AuthorizeButton,
  useNotionResult,
  WidgetHeader,
  WidgetShell
} from "./NotionPrimitives.js";
import type { NotionToolOutput } from "../lib/official-mcp-client.js";

/** Dedicated OAuth panel for the explicit `authorize` tool. */
export function NotionAuthorizeWidget() {
  const hostResult = useNotionResult();
  const [fallbackResult, setFallbackResult] = useState<NotionToolOutput | undefined>();
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const result = hostResult ?? fallbackResult;

  useEffect(() => {
    if (hostResult || fallbackResult || fallbackFailed) {
      return;
    }

    let active = true;
    server.tool<Record<string, never>, NotionToolOutput>({
      name: "authorize",
      arguments: {}
    })
      .then((toolResult: WidgetToolResult<NotionToolOutput>) => {
        if (active) {
          setFallbackResult(toolResult.structuredContent);
        }
      })
      .catch(() => {
        if (active) {
          setFallbackFailed(true);
        }
      });

    return () => {
      active = false;
    };
  }, [fallbackFailed, fallbackResult, hostResult]);

  if (!result) {
    return <PendingAuthorizationStatus failed={fallbackFailed} />;
  }

  return (
    <WidgetShell className="notion-auth-shell">
      <Surface variant="card" className="notion-auth-card">
        <Stack gap="md">
          <WidgetHeader title={result.preview.title} summary={result.preview.summary} />
          <Text tone="muted" className="notion-auth-note">
            Claude will return here after Notion grants access.
          </Text>
          <AuthorizeButton href={result.preview.url} />
        </Stack>
      </Surface>
    </WidgetShell>
  );
}

/** Stable non-skeleton fallback while the auth widget recovers a missed fast result. */
function PendingAuthorizationStatus({ failed }: { failed: boolean }) {
  return (
    <WidgetShell className="notion-auth-shell">
      <Surface variant="card" className="notion-auth-card">
        <Stack gap="md">
          <WidgetHeader
            title={failed ? "Authorization status unavailable" : "Checking Notion authorization"}
            summary={
              failed
                ? "Claude has the tool response, but the widget could not read the latest authorization status."
                : "Reading the current link status from the Sidecar server."
            }
          />
          <Text tone="muted" className="notion-auth-note">
            {failed
              ? "You can still use the text response below this widget."
              : "This usually completes in a moment."}
          </Text>
        </Stack>
      </Surface>
    </WidgetShell>
  );
}
