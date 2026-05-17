/** Tests for provider-agnostic auth declarations and scope policies. */
import { describe, expect, it } from "vitest";
import {
  SidecarAuthError,
  auth,
  protectedResourceMetadataUrl,
  scope,
  type AuthSession,
} from "../src/index.js";

type DemoSession = AuthSession<
  { sub: string; scope: string; org_id: string },
  { orgId: string }
>;

describe("auth", () => {
  it("creates typed scopes and authorizes scoped tool policies", async () => {
    const appAuth = auth({
      resource: "https://api.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      scopes: {
        expensesRead: scope("expenses.read", "Read expenses.")
      },
      async session(request): Promise<DemoSession | null> {
        const token = request.bearerToken();
        expect(token).toBe("abc");
        return {
          userId: "user_123",
          subject: "user_123",
          scopes: ["expenses.read"],
          token,
          claims: {
            sub: "user_123",
            scope: "expenses.read",
            org_id: "org_123"
          },
          orgId: "org_123"
        };
      }
    });

    const result = await appAuth.authorizeRequest(
      new Request("https://api.example.com/mcp", {
        headers: { authorization: "Bearer abc" }
      })
    );

    expect(appAuth.metadata()).toMatchObject({
      resource: "https://api.example.com/mcp",
      authorization_servers: ["https://auth.example.com"],
      scopes_supported: ["expenses.read"]
    });
    expect(result).toMatchObject({
      ok: true,
      auth: {
        userId: "user_123",
        orgId: "org_123",
        scopes: ["expenses.read"]
      }
    });

    if (result.ok) {
      expect(
        appAuth.authorizeTool(
          { scopes: [appAuth.scopes.expensesRead] },
          result.auth
        )
      ).toMatchObject({ ok: true });
    }
  });

  it("emits protected resource metadata challenges", async () => {
    const appAuth = auth({
      resource: "https://api.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      scopes: {
        expensesRead: scope("expenses.read", "Read expenses.")
      },
      session() {
        return null;
      }
    });

    const result = await appAuth.authorizeRequest(new Request("https://api.example.com/mcp"));

    expect(protectedResourceMetadataUrl("https://api.example.com/mcp")).toBe("https://api.example.com/.well-known/oauth-protected-resource/mcp");
    expect(result).toMatchObject({
      ok: false,
      status: 401
    });
    if (!result.ok) {
      expect(result.headers.get("www-authenticate")).toContain(
        'resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp"',
      );
    }
  });

  it("rejects undeclared tool scopes during authorization", async () => {
    const appAuth = auth({
      resource: "https://api.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      scopes: {
        expensesRead: scope("expenses.read", "Read expenses.")
      },
      session(): AuthSession {
        return { scopes: ["expenses.read"] };
      }
    });

    expect(() =>
      appAuth.authorizeTool(
        { scopes: [scope("expenses.write", "Write expenses.")] },
        { scopes: ["expenses.read"] } as AuthSession,
      ),
    ).toThrow(SidecarAuthError);
  });

  it("validates the AuthSession shape returned by user auth code", async () => {
    const appAuth = auth({
      resource: "https://api.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      scopes: {},
      session() {
        return { userId: "user_123" } as unknown as AuthSession;
      }
    });

    await expect(
      appAuth.authorizeRequest(
        new Request("https://api.example.com/mcp", {
          headers: { authorization: "Bearer abc" }
        }),
      ),
    ).rejects.toThrow("scopes array");
  });

  it("rejects malformed bearer headers before provider session logic", async () => {
    let sessionCalls = 0;
    const appAuth = auth({
      resource: "https://api.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      scopes: {},
      session() {
        sessionCalls += 1;
        return { scopes: [] };
      }
    });

    const result = await appAuth.authorizeRequest(
      new Request("https://api.example.com/mcp", {
        headers: { authorization: "Bearer abc extra" }
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      status: 401
    });
    expect(sessionCalls).toBe(0);
  });

  it("validates OAuth resource and authorization server URLs", () => {
    expect(() =>
      auth({
        resource: "http://api.example.com/mcp",
        authorizationServers: ["https://auth.example.com"],
        scopes: {},
        session() {
          return { scopes: [] };
        }
      }),
    ).toThrow(SidecarAuthError);

    expect(() =>
      auth({
        resource: "https://api.example.com/mcp#fragment",
        authorizationServers: ["https://auth.example.com"],
        scopes: {},
        session() {
          return { scopes: [] };
        }
      }),
    ).toThrow(SidecarAuthError);

    expect(() =>
      auth({
        resource: "http://127.0.0.1:3000/mcp",
        authorizationServers: ["http://localhost:4000"],
        scopes: {},
        session() {
          return { scopes: [] };
        }
      }),
    ).not.toThrow();
  });
});
