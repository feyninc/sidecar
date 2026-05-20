/** Shared visual primitives for the Notion example widgets. */
import { type AnchorHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { useToolResult } from "@sidecar-ai/react";
import {
  Button,
  ButtonLink,
  CopyButton,
  Heading,
  Inline,
  Skeleton,
  Stack,
  Surface,
  Text,
  TextLink
} from "@sidecar-ai/native/components";
import type { ButtonProps } from "@sidecar-ai/native/components";
import type { NotionPreviewItem, NotionToolOutput } from "../lib/official-mcp-client.js";

/** Reads the current Sidecar tool result with the Notion example's structure. */
export function useNotionResult(): NotionToolOutput | undefined {
  return useToolResult<NotionToolOutput>().structuredContent;
}

/** Transparent app shell shared by all Notion widgets. */
export function WidgetShell({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={classNames("notion-shell", className)}>{children}</main>;
}

/** Compact title and optional summary for focused widget layouts. */
export function WidgetHeader({ summary, title }: { summary?: string; title: string }) {
  return (
    <Stack gap="xs" className="notion-header">
      <Heading level={1} className="notion-title">
        {title}
      </Heading>
      {summary ? (
        <Text tone="muted" className="notion-summary">
          {summary}
        </Text>
      ) : null}
    </Stack>
  );
}

/** Framed content surface with a quiet text-block copy button. */
export function CopyableBlock({
  children,
  copyLabel = "Copy",
  copyValue,
  className
}: {
  children: ReactNode;
  copyLabel?: string;
  copyValue: string;
  className?: string;
}) {
  return (
    <Surface variant="card" className={classNames("notion-copyable-block", className)}>
      <CopyButton
        copyValue={copyValue}
        variant="ghost"
        color="secondary"
        size="xs"
        className="notion-copy-button"
      >
        {({ copied }) => copied ? "Copied" : copyLabel}
      </CopyButton>
      {children}
    </Surface>
  );
}

/** Markdown renderer used only for authored/readable Notion content. */
export function MarkdownContent({ children }: { children: string }) {
  return (
    <article className="notion-markdown">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm, remarkBreaks]} skipHtml>
        {children || "No content returned."}
      </ReactMarkdown>
    </article>
  );
}

/** Plain text renderer for raw config, schemas, and tool acknowledgements. */
export function PlainTextBlock({ children }: { children: string }) {
  return <pre className="notion-plain-text">{children || "No content returned."}</pre>;
}

/** Result list for search and query-oriented Notion tools. */
export function ResultList({ empty, items }: { empty: string; items: NotionPreviewItem[] }) {
  if (!items.length) {
    return (
      <Surface variant="plain" className="notion-empty">
        <Text tone="muted">{empty}</Text>
      </Surface>
    );
  }

  return (
    <Stack gap="sm" className="notion-result-list">
      {items.map((item, index) => (
        <Surface key={`${item.title}-${index}`} variant="plain" className="notion-result-row">
          <Stack gap="xs">
            <Heading level={3} className="notion-row-title">
              {item.title}
            </Heading>
            {item.body ? (
              <Text tone="muted" className="notion-row-body">
                {item.body}
              </Text>
            ) : null}
          </Stack>
        </Surface>
      ))}
    </Stack>
  );
}

/** Full-document loading skeleton for fetch-style widgets. */
export function DocumentSkeleton() {
  return (
    <WidgetShell>
      <Stack gap="lg">
        <Stack gap="sm" className="notion-header">
          <Skeleton height="30px" width="68%" />
          <Skeleton height="18px" width="88%" />
        </Stack>
        <Surface variant="card" className="notion-copyable-block">
          <Stack gap="sm" className="notion-skeleton-text">
            <Skeleton height="18px" width="96%" />
            <Skeleton height="18px" width="91%" />
            <Skeleton height="18px" width="84%" />
            <Skeleton height="18px" width="93%" />
            <Skeleton height="18px" width="72%" />
          </Stack>
        </Surface>
      </Stack>
    </WidgetShell>
  );
}

/** Repeated-row loading skeleton for search and query results. */
export function ResultsSkeleton() {
  return (
    <WidgetShell>
      <Stack gap="lg">
        <Stack gap="sm" className="notion-header">
          <Skeleton height="28px" width="54%" />
          <Skeleton height="18px" width="70%" />
        </Stack>
        <Stack gap="sm" className="notion-result-list">
          {[0, 1, 2].map((item) => (
            <Surface key={item} variant="plain" className="notion-result-row">
              <Stack gap="xs">
                <Skeleton height="18px" width={item === 1 ? "64%" : "78%"} />
                <Skeleton height="14px" width="92%" />
                <Skeleton height="14px" width="62%" />
              </Stack>
            </Surface>
          ))}
        </Stack>
      </Stack>
    </WidgetShell>
  );
}

/** Page/editor loading skeleton for write previews. */
export function WriteSkeleton() {
  return (
    <WidgetShell>
      <Stack gap="lg">
        <Stack gap="sm" className="notion-header">
          <Skeleton height="28px" width="58%" />
          <Skeleton height="18px" width="76%" />
        </Stack>
        <Surface variant="card" className="notion-write-sheet">
          <Stack gap="sm">
            <Skeleton height="20px" width="50%" />
            <Skeleton height="16px" width="88%" />
            <Skeleton height="16px" width="96%" />
            <Skeleton height="16px" width="74%" />
          </Stack>
        </Surface>
      </Stack>
    </WidgetShell>
  );
}

/** Comment thread loading skeleton. */
export function CommentsSkeleton() {
  return (
    <WidgetShell>
      <Stack gap="lg">
        <Skeleton height="28px" width="46%" />
        <Stack gap="sm">
          {[0, 1].map((item) => (
            <Surface key={item} variant="plain" className="notion-comment-row">
              <Skeleton height="28px" width="28px" className="notion-avatar-skeleton" />
              <Stack gap="xs" className="notion-comment-body">
                <Skeleton height="16px" width="42%" />
                <Skeleton height="15px" width="94%" />
                <Skeleton height="15px" width="68%" />
              </Stack>
            </Surface>
          ))}
        </Stack>
      </Stack>
    </WidgetShell>
  );
}

/** Directory/profile loading skeleton. */
export function PeopleSkeleton() {
  return (
    <WidgetShell>
      <Stack gap="lg">
        <Skeleton height="28px" width="50%" />
        <Stack gap="sm">
          {[0, 1, 2].map((item) => (
            <Surface key={item} variant="plain" className="notion-person-row">
              <Skeleton height="34px" width="34px" className="notion-avatar-skeleton" />
              <Stack gap="xs">
                <Skeleton height="16px" width={item === 0 ? "160px" : "128px"} />
                <Skeleton height="14px" width="220px" />
              </Stack>
            </Surface>
          ))}
        </Stack>
      </Stack>
    </WidgetShell>
  );
}

/** Minimal authorization loading skeleton. */
export function AuthSkeleton() {
  return (
    <WidgetShell className="notion-auth-shell">
      <Surface variant="card" className="notion-auth-card">
        <Stack gap="md">
          <Skeleton height="28px" width="58%" />
          <Skeleton height="18px" width="88%" />
          <Skeleton height="18px" width="74%" />
          <Skeleton height="38px" width="180px" />
        </Stack>
      </Surface>
    </WidgetShell>
  );
}

/** Action button for authorization-only links. */
export function AuthorizeButton({ href }: { href?: string }) {
  if (!href) {
    return null;
  }
  return (
    <ButtonLink href={href} color="primary">
      Authorize Notion
    </ButtonLink>
  );
}

/** Quiet secondary action used for inline show-more controls. */
export function GhostButton(props: ButtonProps) {
  return <Button {...props} variant="ghost" color="secondary" size="sm" />;
}

/** Removes generic fallback titles when a better heading is available nearby. */
export function cleanTitle(value: string | undefined, fallback: string): string {
  const title = value?.trim();
  if (!title || /^notion result$/i.test(title)) {
    return fallback;
  }
  return title;
}

/** Returns a short collection of preview items from the result model. */
export function previewItems(result: NotionToolOutput | undefined): NotionPreviewItem[] {
  return result?.preview.items ?? [];
}

const markdownComponents: Components = {
  h1({ node: _node, ...props }) {
    return <Heading level={2} className="notion-markdown-heading notion-markdown-heading-primary" {...props} />;
  },
  h2({ node: _node, ...props }) {
    return <Heading level={2} className="notion-markdown-heading" {...props} />;
  },
  h3({ node: _node, ...props }) {
    return <Heading level={3} className="notion-markdown-heading" {...props} />;
  },
  h4({ node: _node, ...props }) {
    return <Heading level={4} className="notion-markdown-heading" {...props} />;
  },
  a(props) {
    const { children, href, node: _node, ...anchorProps } = props as AnchorHTMLAttributes<HTMLAnchorElement> & {
      node?: Record<string, unknown>;
    };
    return (
      <TextLink href={href} forceExternal {...anchorProps}>
        {children}
      </TextLink>
    );
  },
  code({ node: _node, className, ...props }) {
    return <code className={classNames(className, "notion-inline-code")} {...props} />;
  },
  pre({ node: _node, className, ...props }) {
    return <pre className={classNames(className, "notion-code-block")} {...props} />;
  },
  blockquote({ node: _node, className, ...props }) {
    return <blockquote className={classNames(className, "notion-blockquote")} {...props} />;
  },
  table({ node: _node, className, ...props }) {
    return <table className={classNames(className, "notion-markdown-table")} {...props} />;
  }
};

/** Joins optional CSS classes without adding empty tokens. */
export function classNames(...values: Array<string | undefined | false>): string | undefined {
  const merged = values.filter(Boolean).join(" ");
  return merged || undefined;
}
