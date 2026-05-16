export type ClaudeAgentDefinition = {
  name: string;
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  color?: string;
};

export function agent(
  definition: ClaudeAgentDefinition,
): ClaudeAgentDefinition {
  return Object.freeze(definition);
}
