/** Wraps Notion MCP `notion-update-page`. */
import { tool, toolResult, type ToolContext } from "sidecar-ai";
import type { NotionSession } from "../../auth.js";
import { callNotionTool } from "../../lib/notion.js";

type ContentUpdate = {
  /** Existing exact content to find. Fetch the page first and copy the exact snippet. */
  old_str: string;
  /** Replacement content in Notion-flavored Markdown. */
  new_str: string;
  /** Replace every exact match instead of the first match. */
  replace_all_matches?: boolean;
};

type UpdatePageParams = {
  /** Page id with or without dashes. */
  page_id: string;
  /** Update command to run. */
  command: "update_properties" | "update_content" | "replace_content" | "apply_template" | "update_verification";
  /** Property updates for update_properties. Fetch schema first for database pages. */
  properties?: Record<string, unknown>;
  /** Search-and-replace operations for update_content. */
  content_updates?: ContentUpdate[];
  /** Full replacement body for replace_content. */
  new_str?: string;
  /** Template id for apply_template. */
  template_id?: string;
  /** Whether deleting child pages/databases is explicitly allowed. Ask the user first. */
  allow_deleting_content?: boolean;
  /** verified or unverified for update_verification. */
  verification_status?: "verified" | "unverified";
  /** Optional expiry in days when verifying a page. */
  verification_expiry_days?: number;
  /** Emoji, custom emoji name, external image URL, or none. */
  icon?: string;
  /** External image URL or none. */
  cover?: string;
};

export default tool({
  name: "Update Notion Page",
  description:
    "Use this when the user wants to update a Notion page's properties, content, icon, cover, template, or verification. Ask clarifying questions before drafting or applying substantial edits. Always fetch the page first for content edits, and never set allow_deleting_content unless the user explicitly confirms the listed deletions.",
  auth: {
    authenticated: true
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true
  },
  async execute(params: UpdatePageParams, ctx: ToolContext<NotionSession>) {
    return toolResult(await callNotionTool({
      toolName: "notion-update-page",
      title: "Updated Notion page",
      previewKind: "write",
      args: params,
      ctx
    }));
  }
});
