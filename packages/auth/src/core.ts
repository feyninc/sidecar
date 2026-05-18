/**
 * Provider-agnostic auth helpers for Sidecar MCP servers.
 *
 * Sidecar acts as the OAuth resource server. User code validates bearer tokens
 * in `session()` and returns an `AuthSession` that tools can consume.
 */
import type {
  AuthScopeDefinition,
  MaybePromise,
  ToolAuthPolicy,
} from "@sidecar-ai/core";

/** Internal session shape Sidecar expects after provider-specific token validation. */
export type AuthSession<
  Claims extends Record<string, unknown> = Record<string, unknown>,
  Extra extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** Scope ids present in the accepted access token. */
  scopes: readonly string[];
  /** Human or account identity when the token represents a user. */
  userId?: string;
  /** OAuth subject. Useful when the subject is not a human user id. */
  subject?: string;
  /** OAuth client id when available. */
  clientId?: string;
  /** Token expiry after successful verification. */
  expiresAt?: Date;
  /** Raw bearer token, if the app wants it in tool context. */
  token?: string;
  /** Verified provider claims. */
  claims?: Claims;
} & Extra;

/** Typed scope object exported from `auth.ts` and imported by tool files. */
export type Scope<
  Id extends string = string,
  Session extends AuthSession = AuthSession,
> = AuthScopeDefinition<Id, Session>;

/** Named set of scopes advertised by an MCP resource server. */
export type ScopeCatalog<Session extends AuthSession = AuthSession> = Record<
  string,
  Scope<string, Session>
>;

/** Fetch request augmented with a safe bearer-token reader. */
export type AuthRequest = Request & {
  bearerToken(): string | undefined;
};

/** Auth failure translated to HTTP challenge data and JSON-RPC error metadata. */
export type AuthChallenge = {
  ok: false;
  status: 401 | 403;
  headers: Headers;
  body: {
    error: string;
    error_description?: string;
  };
};

/** Auth success with the typed application session. */
export type AuthSuccess<Session extends AuthSession = AuthSession> = {
  ok: true;
  auth: Session;
};

/** Result of request-level or tool-level authorization. */
export type AuthResult<Session extends AuthSession = AuthSession> =
  | AuthSuccess<Session>
  | AuthChallenge;

/** Definition accepted by `auth()` in an app's reserved `auth.ts` file. */
export type AuthDefinition<
  Scopes extends ScopeCatalog,
  Session extends AuthSession,
> = {
  /** Canonical MCP resource URL. Access tokens must be issued for this audience/resource. */
  resource: string;
  /** OAuth authorization servers that can issue tokens for this MCP resource. */
  authorizationServers: string[];
  /** Scope objects this MCP server advertises and enforces. */
  scopes: Scopes;
  /** Validates the bearer token and returns Sidecar's internal session shape. */
  session(request: AuthRequest): MaybePromise<Session | null | undefined>;
};

/** Branded auth configuration consumed by Sidecar runtimes. */
export type SidecarAuth<
  Scopes extends ScopeCatalog = ScopeCatalog,
  Session extends AuthSession = AuthSession,
> = Omit<AuthDefinition<Scopes, Session>, "scopes"> & {
  readonly kind: "sidecar.auth";
  readonly scopes: BindScopeCatalog<Scopes, Session>;
  metadata(): ProtectedResourceMetadata;
  protectedResourceMetadata(): Response;
  withResource(resource: string): SidecarAuth<Scopes, Session>;
  authorizeRequest(request: Request): Promise<AuthResult<Session>>;
  authorizeTool(
    policy: ToolAuthPolicy<Session> | undefined,
    auth: Session,
  ): AuthResult<Session>;
};

/** OAuth protected resource metadata advertised to MCP clients. */
export type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: ["header"];
};

/** Binds every declared scope object to the session inferred from `auth()`. */
type BindScopeCatalog<
  Scopes extends ScopeCatalog,
  Session extends AuthSession,
> = {
  readonly [Key in keyof Scopes]: Scopes[Key] extends Scope<
    infer Id,
    AuthSession
  >
    ? Scope<Id, Session>
    : never;
};

const authBrand = Symbol.for("sidecar.auth");

/** Creates a typed scope object for use in `auth.ts` and `tool.ts`. */
export function scope<const Id extends string>(
  id: Id,
  description: string,
): Scope<Id> {
  if (!id.trim()) {
    throw new SidecarAuthError("Scope id is required.");
  }
  if (!description.trim()) {
    throw new SidecarAuthError(`Scope "${id}" must include a description.`);
  }

  return Object.freeze({
    kind: "sidecar.scope" as const,
    id,
    description,
  });
}

/**
 * Declares Sidecar auth for an MCP resource server.
 *
 * The returned object handles MCP-facing metadata/challenges while delegating
 * provider-specific token verification to `definition.session`.
 */
export function auth<
  const Scopes extends ScopeCatalog,
  Session extends AuthSession,
>(definition: AuthDefinition<Scopes, Session>): SidecarAuth<Scopes, Session> {
  validateAuthDefinition(definition);
  const scopeIds = new Set(
    Object.values(definition.scopes).map((entry) => entry.id),
  );

  return Object.freeze({
    ...definition,
    kind: "sidecar.auth" as const,
    scopes: definition.scopes as unknown as BindScopeCatalog<Scopes, Session>,
    [authBrand]: true,

    metadata(): ProtectedResourceMetadata {
      return protectedResourceMetadata({
        resource: definition.resource,
        authorizationServers: definition.authorizationServers,
        scopes: definition.scopes,
      });
    },

    protectedResourceMetadata(): Response {
      return Response.json(this.metadata());
    },

    withResource(resource: string): SidecarAuth<Scopes, Session> {
      return auth({
        ...definition,
        resource,
      });
    },

    async authorizeRequest(request: Request): Promise<AuthResult<Session>> {
      const authRequest = createAuthRequest(request);
      if (!authRequest.bearerToken()) {
        return challenge({
          resource: definition.resource,
          description: "Missing bearer token.",
        });
      }

      const session = await definition.session(authRequest);
      if (!session) {
        return challenge({
          resource: definition.resource,
          description: "Invalid bearer token.",
        });
      }

      assertSession(session);
      return { ok: true, auth: session };
    },

    authorizeTool(
      policy: ToolAuthPolicy<Session> | undefined,
      authSession: Session,
    ): AuthResult<Session> {
      const requiredScopes =
        policy && policy.public !== true && "scopes" in policy
          ? (policy.scopes?.map((entry) => entry.id) ?? [])
          : [];
      const unknownScopes = requiredScopes.filter((id) => !scopeIds.has(id));
      if (unknownScopes.length) {
        throw new SidecarAuthError(
          `Tool requires scope${unknownScopes.length === 1 ? "" : "s"} not declared in auth.ts: ${unknownScopes.join(", ")}.`,
        );
      }

      if (!hasScopes(authSession.scopes, requiredScopes)) {
        return challenge({
          resource: definition.resource,
          scopes: requiredScopes,
          description: "The authenticated session lacks required tool scopes.",
          status: 403,
        });
      }

      return { ok: true, auth: authSession };
    },
  }) as SidecarAuth<Scopes, Session>;
}

/** Returns true when a value was produced by `auth()`. */
export function isSidecarAuth(value: unknown): value is SidecarAuth {
  return Boolean(
    value &&
      typeof value === "object" &&
      ((value as Record<symbol, unknown>)[authBrand] ||
        (value as { kind?: unknown }).kind === "sidecar.auth"),
  );
}

/** Adds `bearerToken()` to a fetch Request without changing the original headers. */
export function createAuthRequest(request: Request): AuthRequest {
  return Object.assign(request, {
    bearerToken() {
      return readBearerToken(request);
    },
  });
}

/** Reads an RFC 6750 bearer token from the Authorization header. */
export function readBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return undefined;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  const parts = authorization.trim().split(/\s+/);
  if (parts.length !== 2 || scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }

  return token;
}

/** Builds the protected resource metadata document exposed by HTTP runtimes. */
export function protectedResourceMetadata(options: {
  resource: string;
  authorizationServers: string[];
  scopes: ScopeCatalog | Record<string, string>;
}): ProtectedResourceMetadata {
  return {
    resource: options.resource,
    authorization_servers: options.authorizationServers,
    scopes_supported: Object.values(options.scopes).map((entry) =>
      typeof entry === "string" ? entry : entry.id,
    ),
    bearer_methods_supported: ["header"],
  };
}

/** Returns the well-known protected resource metadata URL for an MCP endpoint. */
export function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  url.pathname = `/.well-known/oauth-protected-resource${path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Builds a Bearer challenge used for missing, invalid, or insufficient scopes. */
export function challenge(options: {
  resource: string;
  resourceMetadata?: string;
  scopes?: readonly string[];
  description?: string;
  status?: 401 | 403;
}): AuthChallenge {
  const params = [
    options.status === 403 ? `error="insufficient_scope"` : undefined,
    `resource_metadata=${JSON.stringify(options.resourceMetadata ?? protectedResourceMetadataUrl(options.resource))}`,
    options.scopes?.length
      ? `scope=${JSON.stringify(options.scopes.join(" "))}`
      : undefined,
    options.description ? `error_description=${JSON.stringify(options.description)}` : undefined,
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

/** Returns true when all required scopes are present in the session. */
export function hasScopes(
  actual: readonly string[],
  required: readonly string[],
): boolean {
  const actualSet = new Set(actual);
  return required.every((requiredScope) => actualSet.has(requiredScope));
}

/** Error thrown for invalid auth declarations or invalid session objects. */
export class SidecarAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarAuthError";
  }
}

/** Validates the static shape of an auth declaration. */
function validateAuthDefinition(
  definition: AuthDefinition<ScopeCatalog, AuthSession>,
): void {
  if (!definition.resource.trim()) {
    throw new SidecarAuthError("auth({ resource }) is required.");
  }
  validateResourceUri(definition.resource);
  if (!definition.authorizationServers.length) {
    throw new SidecarAuthError(
      "auth({ authorizationServers }) must include at least one authorization server.",
    );
  }
  for (const authorizationServer of definition.authorizationServers) {
    validateAuthorizationServerUri(authorizationServer);
  }
}

/** Ensures user-supplied `session()` output has the fields Sidecar needs. */
function assertSession(session: AuthSession): void {
  if (!Array.isArray(session.scopes)) {
    throw new SidecarAuthError(
      "auth.session() must return an AuthSession with a scopes array.",
    );
  }
}

/** Validates the canonical MCP resource URI used for OAuth audience binding. */
function validateResourceUri(resource: string): void {
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    throw new SidecarAuthError("auth({ resource }) must be an absolute URI.");
  }

  if (url.hash) {
    throw new SidecarAuthError("auth({ resource }) must not include a URI fragment.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) {
    throw new SidecarAuthError("auth({ resource }) must use https, except for localhost development.");
  }
}

/** Validates OAuth authorization server metadata origins. */
function validateAuthorizationServerUri(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SidecarAuthError("auth({ authorizationServers }) entries must be absolute URLs.");
  }

  if (url.hash) {
    throw new SidecarAuthError("auth({ authorizationServers }) entries must not include fragments.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) {
    throw new SidecarAuthError("auth({ authorizationServers }) entries must use https, except for localhost development.");
  }
}

/** Returns true for localhost names accepted in development auth metadata. */
function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
