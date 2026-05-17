/** Typed authoring helpers for Claude plugin hook configuration. */

/** Claude hook event name. String extension keeps the type forward-compatible. */
export type ClaudeHookEvent =
  | "UserPromptExpansion"
  | "PreToolUse"
  | "PermissionRequest"
  | "PostToolUse"
  | "PostToolUseFailure"
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
  args?: string[];
  timeout?: number;
  if?: string;
  shell?: "bash" | "powershell" | (string & {});
};

/** HTTP hook executed by the Claude host. */
export type ClaudeHookHttp = {
  type: "http";
  url: string;
  timeout?: number;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
};

/** Hook handler supported by Claude plugin hooks. */
export type ClaudeHookHandler = ClaudeHookCommand | ClaudeHookHttp;

/** Hook matcher entry for one Claude hook event. */
export type ClaudeHookMatcher = {
  matcher?: string;
  run: ClaudeHookHandler[];
};

/** Single reserved `hooks/<name>/hook.ts` declaration. */
export type ClaudeHookDefinition = {
  event: ClaudeHookEvent;
  matcher?: string;
  run: ClaudeHookHandler[];
};

/** Complete Claude hook configuration object. */
export type ClaudeHooksDefinition = Partial<
  Record<ClaudeHookEvent, ClaudeHookMatcher[]>
>;

/** Declares one Claude hook matcher entry. */
export function hook(
  definition: ClaudeHookDefinition,
): ClaudeHookDefinition {
  return Object.freeze(definition);
}

/** Freezes a complete hook configuration. */
export function hooks(
  definition: ClaudeHooksDefinition,
): ClaudeHooksDefinition {
  return Object.freeze(definition);
}

/** Creates a command hook using Claude's official hook handler vocabulary. */
export function commandHook(
  command: string,
  options: Omit<ClaudeHookCommand, "type" | "command"> = {},
): ClaudeHookCommand {
  return Object.freeze({
    type: "command" as const,
    command,
    ...options,
  });
}

/** Creates an HTTP hook using Claude's official hook handler vocabulary. */
export function httpHook(
  url: string,
  options: Omit<ClaudeHookHttp, "type" | "url"> = {},
): ClaudeHookHttp {
  return Object.freeze({
    type: "http" as const,
    url,
    ...options,
  });
}
