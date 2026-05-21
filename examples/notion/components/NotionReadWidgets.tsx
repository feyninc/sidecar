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
  MissingResultFallback,
  previewItems,
  ResultList,
  ResultsSkeleton,
  useNotionResultState,
  WidgetHeader,
  WidgetShell
} from "./NotionPrimitives.js";

const COLLAPSED_DOCUMENT_LENGTH = 4200;

/** Document reader for `notion-fetch`. */
export function NotionDocumentWidget() {
  const state = useNotionResultState({ toolName: "notion-fetch", retry: "withArgs" });
  const [expanded, setExpanded] = useState(false);

  if (state.status === "loading") {
    return <DocumentSkeleton />;
  }
  if (state.status === "missing") {
    return <MissingResultFallback retry={state.retry} title="Document preview unavailable" />;
  }

  const { result } = state;
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
  const state = useNotionResultState({ toolName: "notion-search", retry: "withArgs" });
  if (state.status === "loading") {
    return <ResultsSkeleton />;
  }
  if (state.status === "missing") {
    return <MissingResultFallback retry={state.retry} title="Search preview unavailable" />;
  }

  const { result } = state;
  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title="Search results" summary={result.preview.summary} />
        <ResultList empty="No search results were returned." items={previewItems(result)} />
      </Stack>
    </WidgetShell>
  );
}

/** Compact result list for Notion data-source queries. */
export function NotionDataSourcesQueryWidget() {
  return <NotionQueryWidget toolName="notion-query-data-sources" />;
}

/** Compact result list for Notion database-view queries. */
export function NotionDatabaseViewQueryWidget() {
  return <NotionQueryWidget toolName="notion-query-database-view" />;
}

function NotionQueryWidget({ toolName }: { toolName: string }) {
  const state = useNotionResultState({ toolName, retry: "withArgs" });
  if (state.status === "loading") {
    return <ResultsSkeleton />;
  }
  if (state.status === "missing") {
    return <MissingResultFallback retry={state.retry} title="Query preview unavailable" />;
  }

  const { result } = state;
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
  const state = useNotionResultState({ toolName: "notion-get-comments", retry: "withArgs" });
  if (state.status === "loading") {
    return <CommentsSkeleton />;
  }
  if (state.status === "missing") {
    return <MissingResultFallback retry={state.retry} title="Comments preview unavailable" />;
  }

  const { result } = state;
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
