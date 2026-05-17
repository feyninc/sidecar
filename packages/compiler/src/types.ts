/** Manifest and option types shared across the Sidecar compiler modules. */
import type {
  JsonSchema,
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpResourceTemplateDescriptor,
  McpToolDescriptor,
  PromptArgsDefinition,
  ResourceAnnotations,
  ToolAnnotations,
  ToolVisibility,
  ToolWidgetOptions,
} from "@sidecar/core";
import type { SidecarDiagnostic } from "./diagnostics.js";

/** Build target profile selected by reserved platform file suffixes. */
export type SidecarTarget = "mcp" | "chatgpt" | "claude";

/** Platform suffix chosen for a reserved tool or widget file. */
export type SidecarSourceVariant = "shared" | "openai" | "anthropic";

/** Tool entry emitted into `manifest.sidecar.json`. */
export type SidecarToolManifestEntry = {
  sourceFile: string;
  variant: SidecarSourceVariant;
  target: SidecarTarget;
  directory: string;
  id: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  visibility?: ToolVisibility;
  widget?: SidecarWidgetManifestEntry;
  descriptor: McpToolDescriptor;
};

/** Widget resource linked to a tool entry. */
export type SidecarWidgetManifestEntry = {
  sourceFile: string;
  variant: SidecarSourceVariant;
  resourceUri: string;
  resourceMeta?: Record<string, unknown>;
  outputFile?: string;
  options?: ToolWidgetOptions;
};

/** Static resource entry emitted into `manifest.sidecar.json`. */
export type SidecarResourceManifestEntry = {
  sourceFile: string;
  directory: string;
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: ResourceAnnotations;
  subscribe?: boolean;
  descriptor: McpResourceDescriptor;
};

/** Static resource template entry emitted into `manifest.sidecar.json`. */
export type SidecarResourceTemplateManifestEntry = {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  annotations?: ResourceAnnotations;
  descriptor: McpResourceTemplateDescriptor;
};

/** Static prompt entry emitted into `manifest.sidecar.json`. */
export type SidecarPromptManifestEntry = {
  sourceFile: string;
  directory: string;
  name: string;
  title: string;
  description?: string;
  args?: PromptArgsDefinition;
  descriptor: McpPromptDescriptor;
};

/** Serializable project config subset recorded in build manifests. */
export type SidecarCompilerConfig = {
  resources: {
    subscribe: boolean;
    listChanged: boolean;
  };
  prompts: {
    listChanged: boolean;
  };
  tools: {
    listChanged: boolean;
  };
  pagination: {
    pageSize: number;
    hasOverride: boolean;
  };
};

/** Build manifest produced for a Sidecar MCP output. */
export type SidecarManifest = {
  version: 1;
  target: SidecarTarget;
  rootDir: string;
  generatedAt: string;
  config: SidecarCompilerConfig;
  tools: SidecarToolManifestEntry[];
  resources: SidecarResourceManifestEntry[];
  resourceTemplates: SidecarResourceTemplateManifestEntry[];
  prompts: SidecarPromptManifestEntry[];
  diagnostics?: SidecarDiagnostic[];
};

/** Options accepted by `buildProject()`. */
export type BuildProjectOptions = {
  rootDir: string;
  outDir?: string;
  plugins?: boolean;
  strict?: boolean;
  target?: SidecarTarget;
};

/** Project identity used by generated plugin packages. */
export type ProjectIdentity = {
  name: string;
  slug: string;
  version: string;
  description: string;
};
