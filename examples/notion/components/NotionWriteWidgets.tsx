/** Write-oriented widgets for Notion create/update/move tools. */
import { Heading, Stack, Surface, Text } from "@sidecar-ai/native/components";
import {
  cleanTitle,
  CopyableBlock,
  MarkdownContent,
  PlainTextBlock,
  useNotionResult,
  WidgetHeader,
  WidgetShell,
  WriteSkeleton
} from "./NotionPrimitives.js";

/** Focused page-content preview for create and update page tools. */
export function NotionPageWriteWidget() {
  const result = useNotionResult();
  if (!result) {
    return <WriteSkeleton />;
  }

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
  const result = useNotionResult();
  if (!result) {
    return <WriteSkeleton />;
  }

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

/** Schema-focused preview for database and data-source changes. */
export function NotionSchemaWidget() {
  const result = useNotionResult();
  if (!result) {
    return <WriteSkeleton />;
  }

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

/** View-configuration preview for Notion database view tools. */
export function NotionViewConfigWidget() {
  const result = useNotionResult();
  if (!result) {
    return <WriteSkeleton />;
  }

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

/** Concise acknowledgement for move and duplicate operations. */
export function NotionOperationWidget() {
  const result = useNotionResult();
  if (!result) {
    return <WriteSkeleton />;
  }

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
