/** Public compiler entrypoint. */
export { analyzeProjectTools, analyzeToolFile } from "./analyze.js";
export { buildProject } from "./build.js";
export { collectProjectDiagnostics, formatDiagnostic } from "./diagnostics.js";
export { CompilerError } from "./errors.js";
export type { SidecarDiagnostic } from "./diagnostics.js";
export type {
  BuildProjectOptions,
  ProjectIdentity,
  SidecarManifest,
  SidecarToolManifestEntry,
  SidecarWidgetManifestEntry,
} from "./types.js";
