/**
 * WorkOS AuthKit authentication for the hosted Notion MCP example.
 *
 * Sidecar is the MCP resource server, AuthKit is the OAuth authorization
 * server, and WorkOS Vault stores the per-user upstream Notion MCP token.
 */
import "dotenv/config";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { auth, type AuthSession } from "sidecar-ai";

const DEFAULT_AUTHKIT_ISSUER = "https://signin.workos.com";

/** Verified AuthKit claims accepted by this example. */
export type WorkOSMcpClaims = JWTPayload & {
  scope?: string;
  scp?: string[];
  client_id?: string;
  org_id?: string;
  organization_id?: string;
};

/** Session shape available to every Notion tool through `ctx.auth`. */
export type NotionSession = AuthSession<
  WorkOSMcpClaims,
  {
    workosUserId: string;
    workosOrganizationId?: string;
  }
>;

const appAuth = auth({
  resource: mcpResource(),
  authorizationServers: [authKitIssuer()],
  scopes: {},
  async session(request): Promise<NotionSession | null> {
    const token = request.bearerToken();
    if (!token) {
      return null;
    }

    const claims = await verifyAuthKitToken(token).catch((error) => {
      console.warn(JSON.stringify({
        event: "sidecar.notion.auth.invalid_token",
        message: error instanceof Error ? error.message : "Invalid AuthKit token.",
      }));
      return null;
    });
    if (!claims) {
      return null;
    }

    const workosUserId = subject(claims);
    const workosOrganizationId = organizationId(claims);

    return {
      userId: workosUserId,
      subject: workosUserId,
      clientId: optionalString(claims.client_id),
      scopes: scopesFromClaims(claims),
      expiresAt: expiresAt(claims),
      token,
      claims,
      workosUserId,
      workosOrganizationId,
    };
  },
});

export default appAuth;

/** Verifies an AuthKit-issued JWT against the issuer's JWKS endpoint. */
async function verifyAuthKitToken(token: string): Promise<WorkOSMcpClaims> {
  const issuer = authKitIssuer();
  const jwks = createRemoteJWKSet(new URL("/oauth2/jwks", issuer));
  const { payload } = await jwtVerify(token, jwks, { issuer });
  return payload as WorkOSMcpClaims;
}

/** Returns the MCP resource URL advertised to clients. */
function mcpResource(): string {
  return process.env.SIDECAR_MCP_URL ?? "http://127.0.0.1:3101/mcp";
}

/** Returns the AuthKit issuer URL configured in WorkOS. */
function authKitIssuer(): string {
  const explicit = process.env.WORKOS_AUTHKIT_ISSUER ?? process.env.AUTHKIT_ISSUER;
  if (explicit) {
    return normalizeIssuer(explicit);
  }

  const domain = process.env.WORKOS_AUTHKIT_DOMAIN ?? process.env.AUTHKIT_DOMAIN;
  if (domain) {
    return normalizeIssuer(domain.startsWith("http") ? domain : `https://${domain}`);
  }

  return DEFAULT_AUTHKIT_ISSUER;
}

/** Ensures issuer strings are URL-like and do not carry a trailing slash. */
function normalizeIssuer(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("WORKOS_AUTHKIT_ISSUER must be https:// except for localhost development.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

/** Extracts the authenticated user id from required JWT subject. */
function subject(claims: WorkOSMcpClaims): string {
  if (!claims.sub) {
    throw new Error("AuthKit token is missing required subject claim.");
  }
  return claims.sub;
}

/** Extracts a WorkOS organization id when the token contains one. */
function organizationId(claims: WorkOSMcpClaims): string | undefined {
  return optionalString(claims.org_id) ?? optionalString(claims.organization_id);
}

/** Converts JWT expiry seconds into a Date for Sidecar's auth context. */
function expiresAt(claims: WorkOSMcpClaims): Date | undefined {
  return typeof claims.exp === "number" ? new Date(claims.exp * 1000) : undefined;
}

/** Reads OAuth scopes from either `scope` or `scp` claim conventions. */
function scopesFromClaims(claims: WorkOSMcpClaims): string[] {
  if (Array.isArray(claims.scp)) {
    return claims.scp.filter((scope): scope is string => typeof scope === "string" && scope.length > 0);
  }
  if (typeof claims.scope === "string") {
    return claims.scope.split(/\s+/).filter(Boolean);
  }
  return [];
}

/** Returns a string only when the claim is present. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
