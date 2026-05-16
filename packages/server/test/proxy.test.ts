/** Tests for Sidecar proxy middleware. */
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { origin, rateLimit, runProxy } from "../src/proxy.js";

describe("proxy middleware", () => {
  it("rejects disallowed origins", async () => {
    const request = new IncomingMessage(new Socket());
    request.headers.origin = "https://evil.example";

    await expect(
      runProxy(
        {
          before: [origin({ allow: ["https://chatgpt.com"] })]
        },
        request
      )
    ).resolves.toMatchObject({
      status: 403
    });
  });

  it("rate-limits by remote address", async () => {
    const request = new IncomingMessage(new Socket());

    const limiter = rateLimit({ windowMs: 1_000, max: 1 });
    await expect(runProxy({ before: [limiter] }, request)).resolves.toBeUndefined();
    await expect(runProxy({ before: [limiter] }, request)).resolves.toMatchObject({
      status: 429
    });
  });
});
