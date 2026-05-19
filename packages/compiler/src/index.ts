/** Public compiler entrypoint. */
export { analyzeProjectTools, analyzeToolFile } from "./analyze.js";
export { buildProject } from "./build.js";
export { analyzeProjectConfig } from "./config.js";
export { collectProjectDiagnostics, formatDiagnostic } from "./diagnostics.js";
export { CompilerError } from "./errors.js";
export { analyzeProjectPrompts, analyzePromptFile } from "./prompts.js";
export { analyzeProjectResources, analyzeResourceFile } from "./resources.js";
export { SERVER_ENTRYPOINT, VERCEL_ENTRYPOINT } from "./server-output.js";
export type { SidecarDiagnostic } from "./diagnostics.js";
export type {
  BuildProjectOptions,
  ProjectIdentity,
  SidecarCompilerConfig,
  SidecarHost,
  SidecarManifest,
  SidecarPromptManifestEntry,
  SidecarResourceManifestEntry,
  SidecarResourceTemplateManifestEntry,
  SidecarSourceVariant,
  SidecarTarget,
  SidecarToolManifestEntry,
  SidecarWidgetManifestEntry,
} from "./types.js";
