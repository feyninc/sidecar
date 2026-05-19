/**
 * WorkOS Vault-backed token storage for the Notion example.
 *
 * Vault gives this example encrypted storage without owning encryption keys.
 * The object name is the deterministic lookup key; the key context associates
 * encryption with the WorkOS user and, when available, the WorkOS organization.
 */
import "dotenv/config";
import { NotFoundException, WorkOS } from "@workos-inc/node";

/** OAuth token material needed to call the official hosted Notion MCP. */
export type StoredNotionMcpToken = {
  /** Bearer token issued for `https://mcp.notion.com/mcp`. */
  accessToken: string;
  /** Optional refresh token, if the Notion linking flow receives one. */
  refreshToken?: string;
  /** ISO timestamp for proactive refresh decisions. */
  expiresAt?: string;
  /** Token type returned by the upstream OAuth server. */
  tokenType?: string;
  /** Space-delimited upstream OAuth scopes. */
  scope?: string;
  /** Dynamic OAuth client id used when this token was issued. */
  clientId?: string;
  /** Dynamic OAuth client secret, when Notion returns one. */
  clientSecret?: string;
  /** Token endpoint used for refresh operations. */
  tokenEndpoint?: string;
  /** Authorization server that issued this token. */
  authorizationServer?: string;
  /** Notion workspace id, when known. */
  workspaceId?: string;
  /** Human-readable Notion workspace name, when known. */
  workspaceName?: string;
};

/** Short-lived PKCE state needed to complete Notion OAuth callbacks. */
export type StoredNotionOAuthState = NotionTokenOwner & {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  authorizationServer: string;
  expiresAt: string;
};

/** Identity used to scope one stored Notion token. */
export type NotionTokenOwner = {
  /** WorkOS user id from the validated AuthKit access token. */
  workosUserId: string;
  /** WorkOS organization id, if this app is running in an org context. */
  workosOrganizationId?: string;
};

const DEFAULT_OBJECT_PREFIX = "sidecar-notion/notion-mcp-token";
const DEFAULT_STATE_PREFIX = "sidecar-notion/notion-oauth-state";

let workosClient: WorkOS | undefined;

/** Reads a user's stored Notion MCP token from WorkOS Vault. */
export async function readStoredNotionToken(
  owner: NotionTokenOwner,
): Promise<StoredNotionMcpToken | null> {
  try {
    const object = await workos().vault.readObjectByName(vaultObjectName(owner));
    if (!object.value) {
      return null;
    }

    return parseStoredToken(object.value);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/** Reads a short-lived Notion OAuth state entry by its public state value. */
export async function readStoredNotionOAuthState(
  state: string,
): Promise<StoredNotionOAuthState | null> {
  try {
    const object = await workos().vault.readObjectByName(vaultStateObjectName(state));
    if (!object.value) {
      return null;
    }

    return parseStoredOAuthState(object.value);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/** Stores a short-lived Notion OAuth state entry in WorkOS Vault. */
export async function writeStoredNotionOAuthState(
  value: StoredNotionOAuthState,
): Promise<void> {
  const name = vaultStateObjectName(value.state);
  const payload = JSON.stringify(validateStoredOAuthState(value));

  try {
    const existing = await workos().vault.readObjectByName(name);
    await workos().vault.updateObject({
      id: existing.id,
      value: payload,
      versionCheck: existing.metadata.versionId,
    });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }

    await workos().vault.createObject({
      name,
      value: payload,
      context: {
        ...vaultContext(value),
        data_type: "notion_oauth_state",
      },
    });
  }
}

/** Deletes a short-lived Notion OAuth state entry. */
export async function deleteStoredNotionOAuthState(state: string): Promise<void> {
  try {
    const existing = await workos().vault.readObjectByName(vaultStateObjectName(state));
    await workos().vault.deleteObject({ id: existing.id });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

/** Creates or replaces a user's stored Notion MCP token in WorkOS Vault. */
export async function writeStoredNotionToken(
  owner: NotionTokenOwner,
  token: StoredNotionMcpToken,
): Promise<void> {
  const name = vaultObjectName(owner);
  const value = JSON.stringify(validateStoredToken(token));

  try {
    const existing = await workos().vault.readObjectByName(name);
    await workos().vault.updateObject({
      id: existing.id,
      value,
      versionCheck: existing.metadata.versionId,
    });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }

    await workos().vault.createObject({
      name,
      value,
      context: vaultContext(owner),
    });
  }
}

/** Deletes a user's stored Notion MCP token, if one exists. */
export async function deleteStoredNotionToken(
  owner: NotionTokenOwner,
): Promise<void> {
  try {
    const existing = await workos().vault.readObjectByName(vaultObjectName(owner));
    await workos().vault.deleteObject({ id: existing.id });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

/** Returns the deterministic Vault object name for a WorkOS user. */
export function vaultObjectName(owner: NotionTokenOwner): string {
  assertOwner(owner);
  return `${objectPrefix()}/${base64Url(owner.workosUserId)}`;
}

/** Returns the deterministic Vault object name for an OAuth state value. */
export function vaultStateObjectName(state: string): string {
  if (!state.trim()) {
    throw new Error("OAuth state is required to access a Notion Vault state object.");
  }
  return `${statePrefix()}/${base64Url(state)}`;
}

/** Returns the WorkOS Vault key context for this user's Notion token. */
export function vaultContext(owner: NotionTokenOwner): Record<string, string> {
  assertOwner(owner);
  return stripUndefined({
    user_id: owner.workosUserId,
    organization_id: owner.workosOrganizationId,
    data_type: "notion_mcp_token",
  });
}

/** Creates the WorkOS SDK client lazily so test/typecheck imports stay cheap. */
function workos(): WorkOS {
  workosClient ??= new WorkOS(requiredEnv("WORKOS_API_KEY_NOTION", "WORKOS_API_KEY"), {
    clientId: process.env.WORKOS_CLIENT_ID,
  });
  return workosClient;
}

/** Parses and validates the JSON blob retrieved from Vault. */
function parseStoredToken(value: string): StoredNotionMcpToken {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Stored Notion token must be a JSON object.");
  }

  return validateStoredToken(parsed);
}

/** Parses and validates a short-lived OAuth state blob retrieved from Vault. */
function parseStoredOAuthState(value: string): StoredNotionOAuthState {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Stored Notion OAuth state must be a JSON object.");
  }

  return validateStoredOAuthState(parsed);
}

/** Validates the minimum token shape before storing or using it. */
function validateStoredToken(value: unknown): StoredNotionMcpToken {
  if (!isRecord(value) || typeof value.accessToken !== "string" || !value.accessToken) {
    throw new Error("Stored Notion token requires a non-empty accessToken.");
  }

  return {
    accessToken: value.accessToken,
    refreshToken: optionalString(value.refreshToken),
    expiresAt: optionalString(value.expiresAt),
    tokenType: optionalString(value.tokenType),
    scope: optionalString(value.scope),
    clientId: optionalString(value.clientId),
    clientSecret: optionalString(value.clientSecret),
    tokenEndpoint: optionalString(value.tokenEndpoint),
    authorizationServer: optionalString(value.authorizationServer),
    workspaceId: optionalString(value.workspaceId),
    workspaceName: optionalString(value.workspaceName),
  };
}

/** Validates the minimum OAuth state shape before storing or using it. */
function validateStoredOAuthState(value: unknown): StoredNotionOAuthState {
  if (!isRecord(value)) {
    throw new Error("Stored Notion OAuth state must be a JSON object.");
  }

  const workosUserId = requiredString(value.workosUserId, "workosUserId");
  return {
    workosUserId,
    workosOrganizationId: optionalString(value.workosOrganizationId),
    state: requiredString(value.state, "state"),
    codeVerifier: requiredString(value.codeVerifier, "codeVerifier"),
    redirectUri: requiredString(value.redirectUri, "redirectUri"),
    clientId: requiredString(value.clientId, "clientId"),
    clientSecret: optionalString(value.clientSecret),
    tokenEndpoint: requiredString(value.tokenEndpoint, "tokenEndpoint"),
    authorizationServer: requiredString(value.authorizationServer, "authorizationServer"),
    expiresAt: requiredString(value.expiresAt, "expiresAt"),
  };
}

/** Reads the first present environment variable from a prioritized list. */
function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }

  throw new Error(`Set one of ${names.join(", ")} before using WorkOS Vault.`);
}

/** Allows deployments to partition objects without changing code. */
function objectPrefix(): string {
  return process.env.WORKOS_VAULT_NOTION_PREFIX ?? DEFAULT_OBJECT_PREFIX;
}

/** Allows deployments to partition transient OAuth state without changing code. */
function statePrefix(): string {
  return process.env.WORKOS_VAULT_NOTION_STATE_PREFIX ?? DEFAULT_STATE_PREFIX;
}

/** Converts arbitrary user ids to a Vault-name-safe segment. */
function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** Throws early for unusable owner ids. */
function assertOwner(owner: NotionTokenOwner): void {
  if (!owner.workosUserId.trim()) {
    throw new Error("WorkOS user id is required to access a Notion Vault token.");
  }
}

/** Returns true for WorkOS 404 responses. */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof NotFoundException ||
    (isRecord(error) && (error.status === 404 || error.name === "NotFoundException"))
  );
}

/** Removes undefined values while preserving string-only context objects. */
function stripUndefined(value: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** Returns a string value only when it is present. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Returns a required string field from an unknown record. */
function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Stored Notion OAuth state requires ${name}.`);
  }
  return value;
}

/** Returns true for non-array objects. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
