/**
 * Remote execution authoring helpers for reserved `remote.ts`.
 *
 * This subpath keeps provider-specific sandbox code separate from the default
 * Sidecar authoring import while reusing the core runtime contract.
 */
export {
  remote,
  type RemoteCodeRun,
  type RemoteExecutionContext,
  type RemoteExecutionDefinition,
  type RemoteExecutionResult,
  type RemoteRunFile,
} from "@sidecar-ai/core";

