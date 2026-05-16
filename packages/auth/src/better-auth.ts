import {
  createResourceServerAuth,
  type AuthResult,
  type AuthScope,
  type AuthSession,
  type ResourceServerAuth,
  type ToolScopePolicy
} from "./index.js";

export type BetterAuthTokenVerifier = (
  token: string,
  options: {
    issuer: string;
    audience: string;
    scopes?: string[];
  }
) => Promise<BetterAuthTokenPayload>;

export type BetterAuthTokenPayload = {
  sub?: string;
  client_id?: string;
  scope?: string | string[];
  exp?: number;
  [claim: string]: unknown;
};

export type BetterAuthLike = {
  handler?: (request: Request) => Response | Promise<Response>;
  api?: {
    oAuth2introspectVerify?: (input: {
      body: { token: string };
      query?: { resource?: string };
    }) => Promise<{ active: boolean; sub?: string; client_id?: string; scope?: string; exp?: number }>;
  };
};

export type SidecarBetterAuthOptions = {
  issuer: string;
  resource: string;
  authorizationServers?: string[];
  scopes: Record<AuthScope, string>;
  tools?: ToolScopePolicy;
  verifyAccessToken?: BetterAuthTokenVerifier;
};

export type SidecarBetterAuthAdapter = {
  protectedResourceMetadata(): Response;
  authorizeRequest(request: Request): Promise<AuthResult>;
  authorizeTool(toolName: string, auth: AuthSession): AuthResult;
};

export function sidecarAuth(auth: BetterAuthLike, options: SidecarBetterAuthOptions): SidecarBetterAuthAdapter {
  const resourceServer: ResourceServerAuth = createResourceServerAuth({
    resource: options.resource,
    authorizationServers: options.authorizationServers ?? [options.issuer],
    scopes: options.scopes,
    tools: options.tools,
    async verifyToken(token) {
      const payload = await verifyToken(auth, token, options);
      return payload ? payloadToSession(token, payload) : undefined;
    }
  });

  return resourceServer;
}

async function verifyToken(
  auth: BetterAuthLike,
  token: string,
  options: SidecarBetterAuthOptions
): Promise<BetterAuthTokenPayload | undefined> {
  if (options.verifyAccessToken) {
    return options.verifyAccessToken(token, {
      issuer: options.issuer,
      audience: options.resource
    });
  }

  const introspect = auth.api?.oAuth2introspectVerify;
  if (!introspect) {
    throw new Error(
      "sidecarAuth requires options.verifyAccessToken or a Better Auth instance exposing api.oAuth2introspectVerify."
    );
  }

  const result = await introspect({
    body: { token },
    query: { resource: options.resource }
  });

  if (!result.active) {
    return undefined;
  }

  return result;
}

function payloadToSession(token: string, payload: BetterAuthTokenPayload): AuthSession {
  return {
    token,
    userId: typeof payload.sub === "string" ? payload.sub : undefined,
    clientId: typeof payload.client_id === "string" ? payload.client_id : undefined,
    scopes: normalizeScopes(payload.scope),
    expiresAt: typeof payload.exp === "number" ? new Date(payload.exp * 1000) : undefined,
    claims: payload
  };
}

function normalizeScopes(scope: string | string[] | undefined): string[] {
  if (Array.isArray(scope)) {
    return scope;
  }
  if (!scope) {
    return [];
  }
  return scope.split(/\s+/).filter(Boolean);
}
