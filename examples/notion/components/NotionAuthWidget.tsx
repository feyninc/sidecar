/** Authorization widget for linking a Notion account. */
import { Stack, Surface, Text } from "@sidecar-ai/native/components";
import {
  AuthorizeButton,
  useNotionResultState,
  WidgetHeader,
  WidgetShell
} from "./NotionPrimitives.js";

/** Dedicated OAuth panel for the explicit `authorize` tool. */
export function NotionAuthorizeWidget() {
  const state = useNotionResultState({ toolName: "authorize", retry: "emptyArgs" });

  if (state.status !== "ready") {
    return <PendingAuthorizationStatus failed={state.status === "missing"} />;
  }

  const { result } = state;
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
