/** Manifest and option types shared across the Sidecar compiler modules. */
import type { JsonSchema, McpToolDescriptor, ToolAnnotations } from "@sidecar/core";

/** Tool entry emitted into `manifest.sidecar.json`. */
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

/** Widget resource linked to a tool entry. */
export type SidecarWidgetManifestEntry = {
  sourceFile: string;
  resourceUri: string;
  outputFile?: string;
};

/** Build manifest produced for a Sidecar MCP output. */
export type SidecarManifest = {
  version: 1;
  rootDir: string;
  generatedAt: string;
  tools: SidecarToolManifestEntry[];
};

/** Options accepted by `buildProject()`. */
export type BuildProjectOptions = {
  rootDir: string;
  outDir?: string;
  plugins?: boolean;
};

/** Project identity used by generated plugin packages. */
export type ProjectIdentity = {
  name: string;
  slug: string;
  version: string;
  description: string;
};
