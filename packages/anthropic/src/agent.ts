/** Typed authoring helpers for Claude plugin subagents. */

/** Claude plugin subagent definition emitted as markdown frontmatter and body. */
export type ClaudeAgentDefinition = {
  name: string;
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  color?: string;
};

/** Declares a Claude plugin subagent. */
export function agent(
  definition: ClaudeAgentDefinition,
): ClaudeAgentDefinition {
  return Object.freeze(definition);
}
