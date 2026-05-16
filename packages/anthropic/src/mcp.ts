/** Typed authoring helpers for Claude plugin MCP server declarations. */

/** Remote HTTP MCP server entry. */
export type ClaudeHttpMcpServerDefinition = {
  name: string;
  type: "http";
  url: string;
  headers?: Record<string, string>;
};

/** Local stdio MCP server entry. */
export type ClaudeStdioMcpServerDefinition = {
  name: string;
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/** Supported MCP server shapes in a Claude plugin manifest/config. */
export type ClaudeMcpServerDefinition =
  | ClaudeHttpMcpServerDefinition
  | ClaudeStdioMcpServerDefinition;

/** Declares an MCP server entry for Claude plugin output. */
export function mcpServer(
  definition: ClaudeMcpServerDefinition,
): ClaudeMcpServerDefinition {
  return Object.freeze(definition);
}
