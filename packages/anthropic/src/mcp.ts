export type ClaudeHttpMcpServerDefinition = {
  name: string;
  type: "http";
  url: string;
  headers?: Record<string, string>;
};

export type ClaudeStdioMcpServerDefinition = {
  name: string;
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type ClaudeMcpServerDefinition =
  | ClaudeHttpMcpServerDefinition
  | ClaudeStdioMcpServerDefinition;

export function mcpServer(
  definition: ClaudeMcpServerDefinition,
): ClaudeMcpServerDefinition {
  return Object.freeze(definition);
}
