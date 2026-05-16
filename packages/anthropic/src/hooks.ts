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

export type ClaudeHookCommand = {
  type: "command";
  command: string;
  timeout?: number;
};

export type ClaudeHookMatcher = {
  matcher?: string;
  hooks: ClaudeHookCommand[];
};

export type ClaudeHooksDefinition = Partial<
  Record<ClaudeHookEvent, ClaudeHookMatcher[]>
>;

export function hook(
  event: ClaudeHookEvent,
  definition: ClaudeHookMatcher,
): ClaudeHooksDefinition {
  return Object.freeze({ [event]: [definition] });
}

export function hooks(
  definition: ClaudeHooksDefinition,
): ClaudeHooksDefinition {
  return Object.freeze(definition);
}
