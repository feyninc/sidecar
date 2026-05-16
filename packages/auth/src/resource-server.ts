import {
  challenge,
  hasScopes,
  protectedResourceMetadata,
  readBearerToken,
  type AuthResult,
  type AuthScope,
  type AuthSession,
  type ToolScopePolicy,
} from "./core.js";

export type TokenVerifier = (
  token: string,
  context: {
    request: Request;
    resource: string;
  },
) => Promise<AuthSession | undefined>;

export type ResourceServerAuthOptions = {
  resource: string;
  authorizationServers: string[];
  scopes: Record<AuthScope, string>;
  tools?: ToolScopePolicy;
  verifyToken: TokenVerifier;
};

export type ResourceServerAuth = {
  metadata(): ReturnType<typeof protectedResourceMetadata>;
  protectedResourceMetadata(): Response;
  authorizeRequest(request: Request): Promise<AuthResult>;
  authorizeTool(toolName: string, auth: AuthSession): AuthResult;
};

export function createResourceServerAuth(
  options: ResourceServerAuthOptions,
): ResourceServerAuth {
  return {
    metadata() {
      return protectedResourceMetadata({
        resource: options.resource,
        authorizationServers: options.authorizationServers,
        scopes: options.scopes,
      });
    },

    protectedResourceMetadata() {
      return Response.json(this.metadata());
    },

    async authorizeRequest(request) {
      const token = readBearerToken(request);
      if (!token) {
        return challenge({
          resource: options.resource,
          description: "Missing bearer token.",
        });
      }

      const auth = await options.verifyToken(token, {
        request,
        resource: options.resource,
      });
      if (!auth) {
        return challenge({
          resource: options.resource,
          description: "Invalid bearer token.",
        });
      }

      return { ok: true, auth };
    },

    authorizeTool(toolName, auth) {
      const requiredScopes = options.tools?.[toolName] ?? [];
      if (!hasScopes(auth.scopes, requiredScopes)) {
        return challenge({
          resource: options.resource,
          scopes: requiredScopes,
          description: `Tool "${toolName}" requires additional scopes.`,
          status: 403,
        });
      }

      return { ok: true, auth };
    },
  };
}
