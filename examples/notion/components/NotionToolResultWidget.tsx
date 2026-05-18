/** Reusable native UI for wrapped Notion MCP tool results. */
import { useMemo, useState } from "react";
import { useToolResult } from "@sidecar-ai/react";
import {
  Badge,
  Button,
  ButtonLink,
  Code,
  Divider,
  Heading,
  Inline,
  Stack,
  Surface,
  Text
} from "@sidecar-ai/native/components";
import type { NotionToolOutput } from "../lib/notion.js";

/** Renders the structured result emitted by the Notion tools. */
export default function NotionToolResultWidget() {
  const { structuredContent } = useToolResult<NotionToolOutput>();
  const [expanded, setExpanded] = useState(false);
  const preview = structuredContent?.preview;
  const content = preview?.content ?? "Waiting for a Notion result.";
  const visibleContent = expanded ? content : clampContent(content);
  const stats = useMemo(() => Object.entries(preview?.stats ?? {}), [preview?.stats]);

  return (
    <main className="grid gap-4 p-4">
      <Inline className="items-start justify-between gap-3">
        <Stack className="gap-1">
          <Inline className="items-center gap-2">
            <Badge>{preview?.kind ?? "notion"}</Badge>
            <Badge variant={structuredContent?.ok === false ? "danger" : "secondary"}>
              {structuredContent?.ok === false ? "error" : "ok"}
            </Badge>
          </Inline>
          <Heading level={1} className="text-xl">
            {preview?.title ?? "Notion result"}
          </Heading>
          <Text tone="secondary">{preview?.summary ?? "The upstream Notion MCP response will appear here."}</Text>
        </Stack>
        {preview?.url ? (
          <ButtonLink href={preview.url} variant="secondary">
            Open
          </ButtonLink>
        ) : null}
      </Inline>

      <Surface className="relative overflow-hidden p-0">
        {stats.length ? (
          <Inline className="absolute right-3 top-3 z-10 gap-2">
            {stats.map(([label, value]) => (
              <Badge key={label} variant="secondary">
                {value} {label}
              </Badge>
            ))}
          </Inline>
        ) : null}
        <pre className="notion-document-peek m-0 max-h-[52vh] overflow-auto p-4 pr-24 text-sm leading-6">
          {visibleContent}
        </pre>
      </Surface>

      <Inline className="items-center justify-between gap-3">
        <Button type="button" variant="secondary" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Peek" : "Preview"}
        </Button>
        <Text tone="secondary">
          {content.length.toLocaleString()} chars
        </Text>
      </Inline>

      {expanded ? (
        <>
          <Divider />
          <Stack className="gap-2">
            <Heading level={2} className="text-sm">
              Upstream structured content
            </Heading>
            <Code className="block max-h-72 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(structuredContent?.upstream.structuredContent ?? null, null, 2)}
            </Code>
          </Stack>
        </>
      ) : null}
    </main>
  );
}

/** Keeps the default write view focused on a useful page-sized peek. */
function clampContent(content: string): string {
  const limit = 2400;
  if (content.length <= limit) {
    return content;
  }
  return `${content.slice(0, limit).trimEnd()}\n\n...`;
}
