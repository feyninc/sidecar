export type ClaudeCommandDefinition = {
  name: string;
  description?: string;
  argumentHint?: string;
  allowedTools?: string[];
  prompt: string;
};

export function command(
  definition: ClaudeCommandDefinition,
): ClaudeCommandDefinition {
  return Object.freeze(definition);
}

export const slashCommand = command;
