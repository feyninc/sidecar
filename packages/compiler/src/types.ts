import type { JsonSchema, McpToolDescriptor, ToolAnnotations } from "@sidecar/core";

export type SidecarToolManifestEntry = {
  sourceFile: string;
  directory: string;
  id: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  widget?: SidecarWidgetManifestEntry;
  descriptor: McpToolDescriptor;
};

export type SidecarWidgetManifestEntry = {
  sourceFile: string;
  resourceUri: string;
  outputFile?: string;
};

export type SidecarManifest = {
  version: 1;
  rootDir: string;
  generatedAt: string;
  tools: SidecarToolManifestEntry[];
};

export type BuildProjectOptions = {
  rootDir: string;
  outDir?: string;
  plugins?: boolean;
};

export type ProjectIdentity = {
  name: string;
  slug: string;
  version: string;
  description: string;
};
