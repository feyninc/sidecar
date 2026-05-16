/** Tests for provider-agnostic auth declarations and scope policies. */
import { describe, expect, it } from "vitest";
import { auth, scope, type AuthSession } from "../src/index.js";

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
});
