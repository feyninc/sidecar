/** Typed authoring helpers for Claude plugin hook configuration. */

/** Claude hook event name. String extension keeps the type forward-compatible. */
export type ClaudeHookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "Notification"
  | "UserPromptSubmit"
  | "Stop"
  | "SubagentStop"
  | "SessionStart"
  | "PreCompact"
  | (string & {});

/** Command hook executed by the host shell. */
export type ClaudeHookCommand = {
  type: "command";
  command: string;
  timeout?: number;
};

/** Hook matcher entry for one Claude hook event. */
export type ClaudeHookMatcher = {
  matcher?: string;
  hooks: ClaudeHookCommand[];
};

/** Complete Claude hook configuration object. */
export type ClaudeHooksDefinition = Partial<
  Record<ClaudeHookEvent, ClaudeHookMatcher[]>
>;

/** Creates a one-event hook configuration. */
export function hook(
  event: ClaudeHookEvent,
  definition: ClaudeHookMatcher,
): ClaudeHooksDefinition {
  return Object.freeze({ [event]: [definition] });
}

/** Freezes a complete hook configuration. */
export function hooks(
  definition: ClaudeHooksDefinition,
): ClaudeHooksDefinition {
  return Object.freeze(definition);
}
