/** Aggregated Claude plugin authoring entrypoint. */

export { agent, type ClaudeAgentDefinition } from "./agent.js";
export {
  command,
  slashCommand,
  type ClaudeCommandDefinition,
} from "./command.js";
export {
  commandHook,
  hook,
  hooks,
  httpHook,
  type ClaudeHookCommand,
  type ClaudeHookDefinition,
  type ClaudeHookEvent,
  type ClaudeHookHandler,
  type ClaudeHookHttp,
  type ClaudeHookMatcher,
  type ClaudeHooksDefinition,
} from "./hooks.js";
export {
  mcpServer,
  type ClaudeMcpServerDefinition,
} from "./mcp.js";
export { skill, type ClaudeSkillDefinition } from "./skill.js";

/** Claude plugin manifest fields Sidecar can generate. */
export type ClaudePluginDefinition = {
  name: string;
  version: string;
  description: string;
  displayName?: string;
  installationPreference?: "enabled" | "available" | "disabled" | (string & {});
};

/** Declares Claude plugin manifest metadata. */
export function claudePlugin(
  definition: ClaudePluginDefinition,
): ClaudePluginDefinition {
  return Object.freeze(definition);
}
