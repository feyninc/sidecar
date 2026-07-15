/**
 * WorkOS API-key authentication for the private Notion MCP example.
 *
 * The Sidecar dev harness and MCP clients send a standard bearer token. This
 * file validates that bearer value with WorkOS API Keys, then uses the API key
 * owner as the stable Vault owner for the upstream Notion token.
 */
import "dotenv/config";
import { WorkOS } from "@workos-inc/node";
import { auth, type AuthSession } from "sidecar-ai";

/** Claims attached to validated WorkOS API-key sessions in this example. */
export type NotionApiKeyClaims = {
  sub: string;
  scope: string;
  kind: "workos-api-key";
  apiKeyId: string;
  ownerType: "organization" | "user";
  ownerId: string;
  organizationId?: string;
  permissions: string[];
};

/** Session shape available to every Notion tool through `ctx.auth`. */
export type NotionSession = AuthSession<
  NotionApiKeyClaims,
  {
    workosUserId: string;
    workosOrganizationId?: string;
    workosApiKeyId: string;
    workosApiKeyName: string;
    workosApiKeyPermissions: string[];
  }
>;

let workosClient: WorkOS | undefined;
let warnedMissingWorkosKey = false;

/** Minimal API key shape returned by WorkOS validation. */
type ValidatedWorkosApiKey = {
  id: string;
  owner: {
    type: "organization" | "user";
    id: string;
    organizationId?: string;
    organization_id?: string;
  };
  name: string;
  permissions: string[];
};

const appAuth = auth({
  resource: mcpResource(),
  authorizationServers: [metadataOnlyAuthorizationServer()],
  scopes: {},
  async session(request): Promise<NotionSession | null> {
    const token = request.bearerToken();
    if (!token) {
      return null;
    }

    const apiKey = await validateWorkosApiKey(token);
    if (!apiKey) {
      return null;
    }

    return sessionFromApiKey(token, apiKey);
  },
});

export default appAuth;

/** Returns the MCP resource URL advertised to clients. */
function mcpResource(): string {
  return process.env.SIDECAR_MCP_URL ?? "http://127.0.0.1:3101/mcp";
}

/**
 * Returns the metadata-only authorization server URL required by Sidecar auth.
 *
 * This example authenticates with WorkOS-managed API keys instead of an OAuth
 * login flow into Sidecar. Clients should send `Authorization: Bearer <api key>`
 * directly and should not attempt OAuth discovery against this URL.
 */
function metadataOnlyAuthorizationServer(): string {
  return process.env.SIDECAR_NOTION_AUTH_SERVER ?? "https://sidecar.ai/notion-workos-api-key";
}

/** Validates a bearer token with WorkOS API Keys. */
async function validateWorkosApiKey(value: string): Promise<ValidatedWorkosApiKey | null> {
  try {
    const result = await createApiKeyValidation(value);
    return normalizeValidatedApiKey(result.apiKey);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "sidecar.notion.auth.api_key_validation_failed",
      message: error instanceof Error ? error.message : "WorkOS API key validation failed.",
    }));
    return null;
  }
}

/** Supports both current and older WorkOS SDK validation method names. */
async function createApiKeyValidation(value: string): Promise<{ apiKey: unknown }> {
  const apiKeys = workos().apiKeys as {
    validateApiKey?: (payload: { value: string }) => Promise<{ apiKey: unknown }>;
    createValidation?: (payload: { value: string }) => Promise<{ apiKey: unknown }>;
  };
  const validate = apiKeys.validateApiKey ?? apiKeys.createValidation;
  if (!validate) {
    throw new Error("Installed @workos-inc/node does not expose API key validation.");
  }

  return await validate.call(apiKeys, { value });
}

/** Normalizes WorkOS API key validation output across SDK response shapes. */
function normalizeValidatedApiKey(value: unknown): ValidatedWorkosApiKey | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "string" || typeof value.name !== "string" || !isRecord(value.owner)) {
    return null;
  }
  const ownerType = value.owner.type;
  const ownerId = value.owner.id;
  if ((ownerType !== "organization" && ownerType !== "user") || typeof ownerId !== "string") {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    owner: {
      type: ownerType,
      id: ownerId,
      organizationId: optionalString(value.owner.organizationId) ?? optionalString(value.owner.organization_id),
    },
    permissions: Array.isArray(value.permissions)
      ? value.permissions.filter((permission): permission is string => typeof permission === "string")
      : [],
  };
}

/** Builds a Sidecar session from a validated WorkOS API key. */
function sessionFromApiKey(token: string, apiKey: ValidatedWorkosApiKey): NotionSession {
  const owner = apiKeyOwner(apiKey);
  const claims: NotionApiKeyClaims = {
    sub: owner.userId,
    scope: permissionsScope(apiKey.permissions),
    kind: "workos-api-key",
    apiKeyId: apiKey.id,
    ownerType: apiKey.owner.type,
    ownerId: apiKey.owner.id,
    organizationId: owner.organizationId,
    permissions: apiKey.permissions,
  };

  return {
    userId: owner.userId,
    subject: owner.userId,
    clientId: apiKey.id,
    scopes: apiKey.permissions,
    token,
    claims,
    workosUserId: owner.userId,
    workosOrganizationId: owner.organizationId,
    workosApiKeyId: apiKey.id,
    workosApiKeyName: apiKey.name,
    workosApiKeyPermissions: apiKey.permissions,
  };
}

/** Returns the Vault owner identity represented by a WorkOS API key. */
function apiKeyOwner(apiKey: ValidatedWorkosApiKey): { userId: string; organizationId?: string } {
  if (apiKey.owner.type === "organization") {
    return {
      userId: apiKey.owner.id,
      organizationId: apiKey.owner.id,
    };
  }

  return {
    userId: apiKey.owner.id,
    organizationId: apiKey.owner.organizationId,
  };
}

/** Creates the WorkOS SDK client lazily so imports stay cheap. */
function workos(): WorkOS {
  workosClient ??= new WorkOS(requiredEnv("WORKOS_API_KEY_NOTION", "WORKOS_API_KEY"), {
    clientId: process.env.WORKOS_CLIENT_ID,
  });
  return workosClient;
}

/** Reads the first present environment variable from a prioritized list. */
function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }

  warnMissingWorkosKeyOnce(names);
  throw new Error(`Set one of ${names.join(", ")} before validating WorkOS API keys.`);
}

/** Warns once when the server-side WorkOS key is missing. */
function warnMissingWorkosKeyOnce(names: string[]): void {
  if (warnedMissingWorkosKey) {
    return;
  }
  warnedMissingWorkosKey = true;
  console.warn(JSON.stringify({
    event: "sidecar.notion.auth.missing_workos_api_key",
    message: `Set one of ${names.join(", ")} before calling the Notion MCP example.`,
  }));
}

/** Formats API key permissions as an OAuth-style scope string for diagnostics. */
function permissionsScope(permissions: string[]): string {
  return permissions.length ? permissions.join(" ") : "notion";
}

/** Returns true for non-array objects. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Returns a non-empty string value. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
