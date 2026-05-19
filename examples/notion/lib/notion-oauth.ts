/**
 * OAuth client helpers for linking the official hosted Notion MCP.
 *
 * This module follows Notion's custom MCP-client guide: discover OAuth
 * metadata, use dynamic client registration, use PKCE, store short-lived state
 * server-side, and persist tokens in WorkOS Vault.
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import {
  deleteStoredNotionOAuthState,
  deleteStoredNotionToken,
  readStoredNotionOAuthState,
  readStoredNotionToken,
  writeStoredNotionOAuthState,
  writeStoredNotionToken,
  type NotionTokenOwner,
  type StoredNotionMcpToken,
} from "./workos-vault.js";

const NOTION_AUTH_SERVER = "https://mcp.notion.com";
const NOTION_OAUTH_CALLBACK_PATH = "/notion/oauth/callback";
const LINK_EXPIRY_MS = 10 * 60 * 1000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** OAuth authorization-server metadata needed for this example. */
export type NotionOAuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
};

/** Dynamic OAuth client registration response. */
type ClientCredentials = {
  client_id: string;
  client_secret?: string;
};

/** Token response returned by Notion's OAuth token endpoint. */
type TokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

let metadataCache: Promise<NotionOAuthMetadata> | undefined;

/** Creates a Notion OAuth authorization URL and stores its PKCE state in Vault. */
export async function createNotionAuthorizationUrl(owner: NotionTokenOwner): Promise<string> {
  const metadata = await discoverNotionOAuthMetadata();
  const redirectUri = notionOAuthRedirectUri();
  const client = await registerNotionOAuthClient(metadata, redirectUri);
  const state = randomUrlToken();
  const codeVerifier = randomUrlToken();
  const codeChallenge = sha256Base64Url(codeVerifier);

  await writeStoredNotionOAuthState({
    ...owner,
    state,
    codeVerifier,
    redirectUri,
    clientId: client.client_id,
    clientSecret: client.client_secret,
    tokenEndpoint: metadata.token_endpoint,
    authorizationServer: metadata.issuer,
    expiresAt: new Date(Date.now() + LINK_EXPIRY_MS).toISOString(),
  });

  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

/** Completes a Notion OAuth callback and stores the resulting token in Vault. */
export async function completeNotionAuthorization(callbackUrl: URL): Promise<NotionTokenOwner> {
  const error = callbackUrl.searchParams.get("error");
  if (error) {
    throw new Error(callbackUrl.searchParams.get("error_description") ?? error);
  }

  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  if (!code || !state) {
    throw new Error("Notion OAuth callback is missing code or state.");
  }

  const stored = await readStoredNotionOAuthState(state);
  if (!stored) {
    throw new Error("Notion OAuth state was not found or already used.");
  }
  if (Date.parse(stored.expiresAt) <= Date.now()) {
    await deleteStoredNotionOAuthState(state);
    throw new Error("Notion OAuth state expired. Start linking again.");
  }

  try {
    const tokens = await exchangeAuthorizationCode({
      code,
      codeVerifier: stored.codeVerifier,
      redirectUri: stored.redirectUri,
      clientId: stored.clientId,
      clientSecret: stored.clientSecret,
      tokenEndpoint: stored.tokenEndpoint,
    });

    await writeStoredNotionToken(stored, tokenFromResponse(tokens, {
      clientId: stored.clientId,
      clientSecret: stored.clientSecret,
      tokenEndpoint: stored.tokenEndpoint,
      authorizationServer: stored.authorizationServer,
    }));
    return {
      workosUserId: stored.workosUserId,
      workosOrganizationId: stored.workosOrganizationId,
    };
  } finally {
    await deleteStoredNotionOAuthState(state);
  }
}

/** Reads and refreshes a stored Notion MCP token when possible. */
export async function readUsableNotionToken(
  owner: NotionTokenOwner,
): Promise<StoredNotionMcpToken | null> {
  const token = await readStoredNotionToken(owner);
  if (!token || !shouldRefresh(token)) {
    return token;
  }
  if (!token.refreshToken || !token.clientId || !token.tokenEndpoint) {
    return token;
  }

  try {
    const refreshed = await refreshAccessToken(token);
    const next = tokenFromResponse(refreshed, {
      clientId: token.clientId,
      clientSecret: token.clientSecret,
      tokenEndpoint: token.tokenEndpoint,
      authorizationServer: token.authorizationServer,
      previousRefreshToken: token.refreshToken,
    });
    await writeStoredNotionToken(owner, next);
    return next;
  } catch (error) {
    if (isReauthRequired(error)) {
      await deleteStoredNotionToken(owner);
      return null;
    }
    if (!isExpired(token)) {
      return token;
    }
    throw error;
  }
}

/** Discovers Notion MCP OAuth metadata through MCP protected-resource metadata. */
async function discoverNotionOAuthMetadata(): Promise<NotionOAuthMetadata> {
  metadataCache ??= (async () => {
    const protectedResourceUrl = new URL("/.well-known/oauth-protected-resource/mcp", NOTION_AUTH_SERVER);
    const protectedResourceResponse = await fetchJson<{ authorization_servers?: unknown }>(
      protectedResourceUrl,
    );
    const authorizationServers = protectedResourceResponse.authorization_servers;
    const authorizationServer = Array.isArray(authorizationServers) && typeof authorizationServers[0] === "string"
      ? authorizationServers[0]
      : NOTION_AUTH_SERVER;

    const metadataUrl = new URL("/.well-known/oauth-authorization-server", authorizationServer);
    const metadata = await fetchJson<NotionOAuthMetadata>(metadataUrl);
    if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
      throw new Error("Notion OAuth metadata is missing required endpoints.");
    }
    return metadata;
  })();

  return metadataCache;
}

/** Registers a public PKCE OAuth client with Notion's MCP auth server. */
async function registerNotionOAuthClient(
  metadata: NotionOAuthMetadata,
  redirectUri: string,
): Promise<ClientCredentials> {
  if (!metadata.registration_endpoint) {
    throw new Error("Notion MCP OAuth metadata does not include a registration endpoint.");
  }

  const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      client_name: process.env.NOTION_MCP_CLIENT_NAME ?? "Sidecar Notion",
      client_uri: publicBaseUrl(),
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!response.ok) {
    throw new Error(`Notion dynamic client registration failed: ${response.status} ${await response.text()}`);
  }

  const client = await response.json() as ClientCredentials;
  if (!client.client_id) {
    throw new Error("Notion dynamic client registration did not return client_id.");
  }
  return client;
}

/** Exchanges an authorization code for access and refresh tokens. */
async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
}): Promise<TokenResponse> {
  return tokenRequest(input.tokenEndpoint, {
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    client_secret: input.clientSecret,
  });
}

/** Refreshes an existing Notion MCP access token. */
async function refreshAccessToken(token: StoredNotionMcpToken): Promise<TokenResponse> {
  return tokenRequest(required(token.tokenEndpoint, "tokenEndpoint"), {
    grant_type: "refresh_token",
    refresh_token: required(token.refreshToken, "refreshToken"),
    client_id: required(token.clientId, "clientId"),
    client_secret: token.clientSecret,
  });
}

/** Performs a form-encoded OAuth token endpoint request. */
async function tokenRequest(
  tokenEndpoint: string,
  fields: Record<string, string | undefined>,
): Promise<TokenResponse> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value) {
      body.set(key, value);
    }
  }

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent": "Sidecar-Notion/0.1",
    },
    body,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    const oauthError = isRecord(data) && typeof data.error === "string" ? data.error : undefined;
    throw new NotionOAuthError(`Notion token request failed: ${response.status}`, oauthError);
  }
  if (!isRecord(data) || typeof data.access_token !== "string") {
    throw new Error("Notion token endpoint did not return access_token.");
  }

  return {
    access_token: data.access_token,
    refresh_token: optionalString(data.refresh_token),
    token_type: optionalString(data.token_type),
    expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
    scope: optionalString(data.scope),
  };
}

/** Normalizes an OAuth token response into the Vault storage shape. */
function tokenFromResponse(
  response: TokenResponse,
  options: {
    clientId: string;
    clientSecret?: string;
    tokenEndpoint: string;
    authorizationServer?: string;
    previousRefreshToken?: string;
  },
): StoredNotionMcpToken {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? options.previousRefreshToken,
    expiresAt: typeof response.expires_in === "number"
      ? new Date(Date.now() + response.expires_in * 1000).toISOString()
      : undefined,
    tokenType: response.token_type,
    scope: response.scope,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    tokenEndpoint: options.tokenEndpoint,
    authorizationServer: options.authorizationServer,
  };
}

/** Fetches JSON and validates the response status. */
async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Sidecar-Notion/0.1",
    },
  });
  if (!response.ok) {
    throw new Error(`Notion OAuth discovery failed: ${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
}

/** Returns the HTTPS callback URL that Notion should redirect to. */
function notionOAuthRedirectUri(): string {
  return `${publicBaseUrl()}${NOTION_OAUTH_CALLBACK_PATH}`;
}

/** Returns the public base URL for this hosted Sidecar example. */
function publicBaseUrl(): string {
  const raw = process.env.SIDECAR_PUBLIC_URL ?? process.env.SIDECAR_MCP_URL ?? "http://127.0.0.1:3001/mcp";
  const url = new URL(raw);
  if (url.pathname.endsWith("/mcp")) {
    url.pathname = url.pathname.slice(0, -"/mcp".length) || "/";
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

/** Returns true when a stored token should be refreshed before use. */
function shouldRefresh(token: StoredNotionMcpToken): boolean {
  return Boolean(token.expiresAt && Date.parse(token.expiresAt) <= Date.now() + REFRESH_SKEW_MS);
}

/** Returns true when a stored token is already expired. */
function isExpired(token: StoredNotionMcpToken): boolean {
  return Boolean(token.expiresAt && Date.parse(token.expiresAt) <= Date.now());
}

/** Returns true when Notion requires the user to authorize again. */
function isReauthRequired(error: unknown): boolean {
  return error instanceof NotionOAuthError && error.oauthError === "invalid_grant";
}

/** Generates a base64url random value for PKCE and state. */
function randomUrlToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Computes a PKCE S256 challenge. */
function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** Returns a required string or throws an actionable error. */
function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Stored Notion token is missing ${name}; relink Notion.`);
  }
  return value;
}

/** Returns a string value only when it is present. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Returns true for non-array objects. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** OAuth token endpoint error with the machine-readable OAuth error code. */
class NotionOAuthError extends Error {
  constructor(message: string, readonly oauthError: string | undefined) {
    super(message);
    this.name = "NotionOAuthError";
  }
}
