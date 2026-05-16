import { describe, expect, it } from "vitest";
import { sidecarAuth } from "../src/better-auth.js";

describe("sidecarAuth", () => {
  it("verifies bearer tokens and checks tool scopes", async () => {
    const adapter = sidecarAuth(
      {},
      {
        issuer: "https://auth.example.com",
        resource: "https://api.example.com/mcp",
        scopes: {
          "expenses.read": "Read expenses."
        },
        tools: {
          review_expense_report: ["expenses.read"]
        },
        async verifyAccessToken(token) {
          expect(token).toBe("abc");
          return {
            sub: "user_123",
            client_id: "client_123",
            scope: "expenses.read",
            exp: 2_000_000_000
          };
        }
      }
    );

    const auth = await adapter.authorizeRequest(
      new Request("https://api.example.com/mcp", {
        headers: { authorization: "Bearer abc" }
      })
    );

    expect(auth).toMatchObject({
      ok: true,
      auth: {
        userId: "user_123",
        clientId: "client_123",
        scopes: ["expenses.read"]
      }
    });

    if (auth.ok) {
      expect(adapter.authorizeTool("review_expense_report", auth.auth)).toMatchObject({ ok: true });
    }
  });
});
