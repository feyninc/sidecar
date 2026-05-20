/** Authorization widget for linking a Notion account. */
import { Stack, Surface, Text } from "@sidecar-ai/native/components";
import {
  AuthSkeleton,
  AuthorizeButton,
  useNotionResult,
  WidgetHeader,
  WidgetShell
} from "./NotionPrimitives.js";

/** Dedicated OAuth panel for the explicit `authorize` tool. */
export function NotionAuthorizeWidget() {
  const result = useNotionResult();
  if (!result) {
    return <AuthSkeleton />;
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
