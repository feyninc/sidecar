/** Read-oriented widgets for Notion fetch, search, query, and comments tools. */
import { useState } from "react";
import { Avatar, Heading, Inline, Stack, Surface, Text } from "@sidecar-ai/native/components";
import {
  cleanTitle,
  CommentsSkeleton,
  CopyableBlock,
  DocumentSkeleton,
  GhostButton,
  MarkdownContent,
  previewItems,
  ResultList,
  ResultsSkeleton,
  useNotionResult,
  WidgetHeader,
  WidgetShell
} from "./NotionPrimitives.js";

const COLLAPSED_DOCUMENT_LENGTH = 4200;

/** Document reader for `notion-fetch`. */
export function NotionDocumentWidget() {
  const result = useNotionResult();
  const [expanded, setExpanded] = useState(false);

  if (!result) {
    return <DocumentSkeleton />;
  }

  const title = cleanTitle(result.preview.title, "Fetched Notion content");
  const content = result.preview.content;
  const canToggle = content.length > COLLAPSED_DOCUMENT_LENGTH;
  const visibleContent = expanded || content.length <= COLLAPSED_DOCUMENT_LENGTH
    ? content
    : `${content.slice(0, COLLAPSED_DOCUMENT_LENGTH).trimEnd()}\n\n...`;

  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title={title} summary={result.preview.summary} />
        <CopyableBlock copyValue={content}>
          <MarkdownContent>{visibleContent}</MarkdownContent>
        </CopyableBlock>
        {canToggle ? (
          <Inline className="notion-inline-actions">
            <GhostButton onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Collapse" : "Show full document"}
            </GhostButton>
          </Inline>
        ) : null}
      </Stack>
    </WidgetShell>
  );
}

/** Search result list for `notion-search`. */
export function NotionSearchWidget() {
  const result = useNotionResult();
  if (!result) {
    return <ResultsSkeleton />;
  }

  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title="Search results" summary={result.preview.summary} />
        <ResultList empty="No search results were returned." items={previewItems(result)} />
      </Stack>
    </WidgetShell>
  );
}

/** Compact result list for Notion data-source and database-view query tools. */
export function NotionQueryWidget() {
  const result = useNotionResult();
  if (!result) {
    return <ResultsSkeleton />;
  }

  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title="Query results" summary={result.preview.summary} />
        <ResultList empty="No rows were returned." items={previewItems(result)} />
      </Stack>
    </WidgetShell>
  );
}

/** Comment-thread reader for `notion-get-comments`. */
export function NotionCommentsWidget() {
  const result = useNotionResult();
  if (!result) {
    return <CommentsSkeleton />;
  }

  const comments = previewItems(result);
  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title="Comments" summary={result.preview.summary} />
        {comments.length ? (
          <Stack gap="sm">
            {comments.map((comment, index) => (
              <Surface key={`${comment.title}-${index}`} variant="plain" className="notion-comment-row">
                <Avatar name={comment.title} size={30} />
                <Stack gap="xs" className="notion-comment-body">
                  <Heading level={3} className="notion-row-title">
                    {comment.title}
                  </Heading>
                  {comment.body ? (
                    <Text tone="muted" className="notion-row-body">
                      {comment.body}
                    </Text>
                  ) : null}
                </Stack>
              </Surface>
            ))}
          </Stack>
        ) : (
          <Text tone="muted">No comments were returned.</Text>
        )}
      </Stack>
    </WidgetShell>
  );
}
