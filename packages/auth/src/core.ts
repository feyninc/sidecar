export type AuthScope = string;

export type AuthSession = {
  userId?: string;
  clientId?: string;
  scopes: AuthScope[];
  expiresAt?: Date;
  token?: string;
  claims?: Record<string, unknown>;
};

export type AuthChallenge = {
  ok: false;
  status: 401 | 403;
  headers: Headers;
  body: {
    error: string;
    error_description?: string;
  };
};

export type AuthSuccess = {
  ok: true;
  auth: AuthSession;
};

export type AuthResult = AuthSuccess | AuthChallenge;

export type ToolScopePolicy = Record<string, AuthScope[]>;

export function readBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return undefined;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }

  return token;
}

export function hasScopes(
  actual: readonly string[],
  required: readonly string[],
): boolean {
  const actualSet = new Set(actual);
  return required.every((scope) => actualSet.has(scope));
}

export function challenge(options: {
  resource: string;
  scopes?: readonly string[];
  description?: string;
  status?: 401 | 403;
}): AuthChallenge {
  const params = [
    `resource=${JSON.stringify(options.resource)}`,
    options.scopes?.length
      ? `scope=${JSON.stringify(options.scopes.join(" "))}`
      : undefined,
  ].filter(Boolean);

  return {
    ok: false,
    status: options.status ?? 401,
    headers: new Headers({
      "www-authenticate": `Bearer ${params.join(", ")}`,
    }),
    body: {
      error: options.status === 403 ? "insufficient_scope" : "invalid_token",
      error_description: options.description,
    },
  };
}

export function protectedResourceMetadata(options: {
  resource: string;
  authorizationServers: string[];
  scopes: Record<string, string>;
}) {
  return {
    resource: options.resource,
    authorization_servers: options.authorizationServers,
    scopes_supported: Object.keys(options.scopes),
    bearer_methods_supported: ["header"],
  };
}
