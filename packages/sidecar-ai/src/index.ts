/**
 * Public Sidecar framework entrypoint.
 *
 * This facade keeps the default authoring path small: app code imports tool,
 * resource, prompt, config, and auth primitives from `sidecar-ai`, while the
 * implementation remains split across focused packages.
 */
export * from "@sidecar-ai/core";
export * from "@sidecar-ai/auth";
