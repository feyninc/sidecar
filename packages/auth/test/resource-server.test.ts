import { describe, expect, it } from "vitest";
import { createResourceServerAuth } from "../src/index.js";

describe("createResourceServerAuth", () => {
  it("authorizes requests with a provider-supplied verifier", async () => {
    const auth = createResourceServerAuth({
      resource: "https://api.example.com/mcp",
      authorizationServers: ["https://auth.example.com"],
      scopes: {
        "expenses.read": "Read expenses."
      },
      tools: {
        review_expense_report: ["expenses.read"]
      },
      async verifyToken(token, context) {
        expect(token).toBe("abc");
        expect(context.resource).toBe("https://api.example.com/mcp");
        return {
          userId: "user_123",
          scopes: ["expenses.read"],
          token
        };
      }
    });

    const result = await auth.authorizeRequest(
      new Request("https://api.example.com/mcp", {
        headers: { authorization: "Bearer abc" }
      })
    );

    expect(result).toMatchObject({
      ok: true,
      auth: {
        userId: "user_123",
        scopes: ["expenses.read"]
      }
    });

    if (result.ok) {
      expect(auth.authorizeTool("review_expense_report", result.auth)).toMatchObject({
        ok: true
      });
    }
  });
});
