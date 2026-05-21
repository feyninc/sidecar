/** Write-oriented widgets for Notion create/update/move tools. */
import { Heading, Stack, Surface, Text } from "@sidecar-ai/native/components";
import {
  cleanTitle,
  CopyableBlock,
  MarkdownContent,
  MissingResultFallback,
  PlainTextBlock,
  useNotionResultState,
  WidgetHeader,
  WidgetShell,
  WriteSkeleton
} from "./NotionPrimitives.js";

/** Focused page-content preview for created Notion pages. */
export function NotionCreatePagesWidget() {
  return <NotionPageWriteWidget toolName="notion-create-pages" />;
}

/** Focused page-content preview for updated Notion pages. */
export function NotionUpdatePageWidget() {
  return <NotionPageWriteWidget toolName="notion-update-page" />;
}

function NotionPageWriteWidget({ toolName }: { toolName: string }) {
  const state = useNotionResultState({ toolName, retry: "never" });
  if (state.status === "loading") {
    return <WriteSkeleton />;
  }
  if (state.status === "missing") {
    return <MissingResultFallback retry={state.retry} title="Page preview unavailable" />;
  }

  const { result } = state;
  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title={cleanTitle(result.preview.title, "Page content")} summary={result.preview.summary} />
        <CopyableBlock copyValue={result.preview.content} className="notion-write-sheet">
          <MarkdownContent>{result.preview.content}</MarkdownContent>
        </CopyableBlock>
      </Stack>
    </WidgetShell>
  );
}

/** Comment composer preview for `notion-create-comment`. */
export function NotionCommentWriteWidget() {
  const state = useNotionResultState({ toolName: "notion-create-comment", retry: "never" });
  if (state.status === "loading") {
    return <WriteSkeleton />;
  }
  if (state.status === "missing") {
    return <MissingResultFallback retry={state.retry} title="Comment preview unavailable" />;
  }

  const { result } = state;
  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title="Comment submitted" summary={result.preview.summary} />
        <Surface variant="plain" className="notion-comment-row notion-comment-submitted">
          <div className="notion-comment-marker" aria-hidden="true" />
          <Stack gap="xs" className="notion-comment-body">
            <Heading level={3} className="notion-row-title">
              New comment
            </Heading>
            <Text className="notion-row-body">{result.preview.content}</Text>
          </Stack>
        </Surface>
      </Stack>
    </WidgetShell>
  );
}

/** Schema-focused preview for created Notion databases. */
export function NotionCreateDatabaseWidget() {
  return <NotionSchemaWidget toolName="notion-create-database" />;
}

/** Schema-focused preview for updated Notion data sources. */
export function NotionUpdateDataSourceWidget() {
  return <NotionSchemaWidget toolName="notion-update-data-source" />;
}

function NotionSchemaWidget({ toolName }: { toolName: string }) {
  const state = useNotionResultState({ toolName, retry: "never" });
  if (state.status === "loading") {
    return <WriteSkeleton />;
  }
  if (state.status === "missing") {
    return <MissingResultFallback retry={state.retry} title="Schema preview unavailable" />;
  }

  const { result } = state;
  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title={cleanTitle(result.preview.title, "Schema changes")} summary={result.preview.summary} />
        <CopyableBlock copyValue={result.preview.content} className="notion-schema-block">
          <PlainTextBlock>{result.preview.content}</PlainTextBlock>
        </CopyableBlock>
      </Stack>
    </WidgetShell>
  );
}

/** View-configuration preview for created Notion database views. */
export function NotionCreateViewWidget() {
  return <NotionViewConfigWidget toolName="notion-create-view" />;
}

/** View-configuration preview for updated Notion database views. */
export function NotionUpdateViewWidget() {
  return <NotionViewConfigWidget toolName="notion-update-view" />;
}

function NotionViewConfigWidget({ toolName }: { toolName: string }) {
  const state = useNotionResultState({ toolName, retry: "never" });
  if (state.status === "loading") {
    return <WriteSkeleton />;
  }
  if (state.status === "missing") {
    return <MissingResultFallback retry={state.retry} title="View preview unavailable" />;
  }

  const { result } = state;
  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title={cleanTitle(result.preview.title, "View configuration")} summary={result.preview.summary} />
        <CopyableBlock copyValue={result.preview.content} className="notion-schema-block">
          <PlainTextBlock>{result.preview.content}</PlainTextBlock>
        </CopyableBlock>
      </Stack>
    </WidgetShell>
  );
}

/** Concise acknowledgement for moved Notion pages. */
export function NotionMovePagesWidget() {
  return <NotionOperationWidget toolName="notion-move-pages" />;
}

/** Concise acknowledgement for duplicated Notion pages. */
export function NotionDuplicatePageWidget() {
  return <NotionOperationWidget toolName="notion-duplicate-page" />;
}

function NotionOperationWidget({ toolName }: { toolName: string }) {
  const state = useNotionResultState({ toolName, retry: "never" });
  if (state.status === "loading") {
    return <WriteSkeleton />;
  }
  if (state.status === "missing") {
    return <MissingResultFallback retry={state.retry} title="Operation preview unavailable" />;
  }

  const { result } = state;
  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title={cleanTitle(result.preview.title, "Notion updated")} summary={result.preview.summary} />
        <Surface variant="plain" className="notion-operation-summary">
          <Text>{result.preview.content}</Text>
        </Surface>
      </Stack>
    </WidgetShell>
  );
}
