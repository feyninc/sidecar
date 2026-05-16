/** Typed authoring helpers for Claude slash commands. */

/** Claude slash command definition emitted to `commands/*.md`. */
export type ClaudeCommandDefinition = {
  name: string;
  description?: string;
  argumentHint?: string;
  allowedTools?: string[];
  prompt: string;
};

/** Declares a Claude slash command. */
export function command(
  definition: ClaudeCommandDefinition,
): ClaudeCommandDefinition {
  return Object.freeze(definition);
}

/** Alias for `command()` when the caller wants the host term in code. */
export const slashCommand = command;
