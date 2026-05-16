export { agent, type ClaudeAgentDefinition } from "./agent.js";
export {
  command,
  slashCommand,
  type ClaudeCommandDefinition,
} from "./command.js";
export {
  hook,
  hooks,
  type ClaudeHookCommand,
  type ClaudeHookEvent,
  type ClaudeHookMatcher,
  type ClaudeHooksDefinition,
} from "./hooks.js";
export {
  mcpServer,
  type ClaudeMcpServerDefinition,
} from "./mcp.js";
export { skill, type ClaudeSkillDefinition } from "./skill.js";

export type ClaudePluginDefinition = {
  name: string;
  version: string;
  description: string;
  displayName?: string;
  installationPreference?: "enabled" | "available" | "disabled" | (string & {});
};

export function claudePlugin(
  definition: ClaudePluginDefinition,
): ClaudePluginDefinition {
  return Object.freeze(definition);
}
