/**
 * Demo auth configuration used by the simple example.
 *
 * This demo accepts SIDECAR_DEMO_TOKEN only so examples can run locally without
 * embedding reusable credentials. Real projects should validate the bearer
 * token with their OAuth provider and return an AuthSession with whatever
 * custom fields their tools need.
 */
import { auth, scope, type AuthSession } from "@sidecar/auth";

type DemoSession = AuthSession<
  { sub: string; scope: string; org_id: string },
  { orgId: string }
>;

const appAuth = auth({
  resource: process.env.SIDECAR_MCP_URL ?? "http://127.0.0.1:3101/mcp",
  authorizationServers: ["https://auth.example.com"],
  scopes: {
    expensesRead: scope("expenses.read", "Read expense reports.")
  },
  async session(request): Promise<DemoSession | null> {
    const token = request.bearerToken();
    if (!process.env.SIDECAR_DEMO_TOKEN || token !== process.env.SIDECAR_DEMO_TOKEN) {
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
