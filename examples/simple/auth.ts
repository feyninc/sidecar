/**
 * Demo auth configuration used by the simple example.
 *
 * Real projects should validate the bearer token with their OAuth provider and
 * return an AuthSession with whatever custom fields their tools need.
 */
import { auth, scope, type AuthSession } from "@sidecar/auth";

type DemoSession = AuthSession<
  { sub: string; scope: string; org_id: string },
  { orgId: string }
>;

const appAuth = auth({
  resource: "http://127.0.0.1:3101/mcp",
  authorizationServers: ["https://auth.example.com"],
  scopes: {
    expensesRead: scope("expenses.read", "Read expense reports.")
  },
  async session(request): Promise<DemoSession | null> {
    const token = request.bearerToken();
    if (token !== "dev-token") {
      return null;
    }

    return {
      userId: "user_123",
      subject: "user_123",
      scopes: ["expenses.read"],
      token,
      claims: {
        sub: "user_123",
        scope: "expenses.read",
        org_id: "org_demo"
      },
      orgId: "org_demo"
    };
  }
});

export const { scopes } = appAuth;
export default appAuth;
