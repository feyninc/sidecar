/** Reusable native UI for wrapped Notion MCP tool results. */
import { useMemo, useState } from "react";
import { useToolResult } from "@sidecar-ai/react";
import {
  Badge,
  Button,
  ButtonLink,
  CopyButton,
  Divider,
  Heading,
  Inline,
  KeyValue,
  Stack,
  Surface,
  Text
} from "@sidecar-ai/native/components";
import type { NotionToolOutput } from "../lib/official-mcp-client.js";

/** Renders the structured result emitted by the Notion tools. */
export default function NotionToolResultWidget() {
  const { structuredContent } = useToolResult<NotionToolOutput>();
  const [expanded, setExpanded] = useState(false);
  const preview = structuredContent?.preview;
  const content = preview?.content ?? "Waiting for a Notion result.";
  const visibleContent = expanded
    ? clampContent(content, 7200)
    : clampContent(content, preview?.kind === "write" ? 3600 : 2400);
  const truncated = visibleContent.length < content.length;
  const stats = useMemo(() => Object.entries(preview?.stats ?? {}), [preview?.stats]);
  const details = useMemo(() => preview?.details ?? [], [preview?.details]);
  const actionLabel = preview?.kind === "metadata" && /authorize/i.test(preview.title)
    ? "Authorize Notion"
    : "Open in Notion";

  return (
    <main className="notion-shell">
      <Stack gap="lg">
        <Stack gap="sm" className="notion-intro">
          <Inline align="start" className="notion-meta-row" gap="xs">
            <Badge color="discovery" pill>
              {previewKindLabel(preview?.kind)}
            </Badge>
            <Badge color={structuredContent?.ok === false ? "danger" : "success"} pill>
              {structuredContent?.ok === false ? "Error" : "Ready"}
            </Badge>
            {stats.map(([label, value]) => (
              <Badge key={label} color="secondary" pill>
                {value} {label}
              </Badge>
            ))}
          </Inline>

          <Heading level={1} className="notion-title">
            {preview?.title ?? "Notion result"}
          </Heading>

          <Text tone="secondary" className="notion-summary">
            {preview?.summary ?? "The upstream Notion MCP response will appear here."}
          </Text>
        </Stack>

        <Surface variant="card" className="notion-document-window">
          <Stack gap="md">
            <Inline className="notion-window-bar" gap="sm">
              <span className="notion-window-dot" aria-hidden="true" />
              <span className="notion-window-dot" aria-hidden="true" />
              <span className="notion-window-dot" aria-hidden="true" />
              <Text tone="secondary" className="notion-window-label">
                {preview?.kind === "write" ? "Submitted content" : "Document preview"}
              </Text>
            </Inline>

            <Divider />

            <article className="notion-document-body">
              {paragraphs(visibleContent).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </article>

            {truncated ? (
              <Inline className="notion-more-row">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? "Show less" : "Show more"}
                </Button>
                <Text tone="secondary" className="notion-count">
                  {content.length.toLocaleString()} chars
                </Text>
              </Inline>
            ) : null}
          </Stack>
        </Surface>

        {details.length ? (
          <Surface variant="plain" className="notion-details">
            <KeyValue
              items={details.map((detail) => ({
                key: detail.label,
                value: detail.value
              }))}
            />
          </Surface>
        ) : null}

        <Divider />

        <Inline className="notion-actions" gap="sm">
          {preview?.url ? (
            <ButtonLink href={preview.url} color="primary">
              {actionLabel}
            </ButtonLink>
          ) : null}
          <CopyButton copyValue={content} variant="secondary">
            {({ copied }) => copied ? "Copied" : "Copy preview"}
          </CopyButton>
        </Inline>
      </Stack>
    </main>
  );
}

/** Keeps the default write view focused on a useful page-sized peek. */
function clampContent(content: string, limit: number): string {
  if (content.length <= limit) {
    return content;
  }
  return `${content.slice(0, limit).trimEnd()}\n\n...`;
}

/** Preserves Notion line breaks while avoiding a single raw pre block. */
function paragraphs(content: string): string[] {
  const values = content
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? values : ["No preview content returned."];
}

/** Names the preview intent in user-facing language. */
function previewKindLabel(kind: NotionToolOutput["preview"]["kind"] | undefined): string {
  if (kind === "read") return "Page";
  if (kind === "search") return "Search";
  if (kind === "write") return "Write";
  if (kind === "metadata") return "Setup";
  return "Notion";
}
