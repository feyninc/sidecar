/** Example authored MCP resource exposed by the sample app. */
import { resource, resourceResult } from "sidecar-ai";

export default resource({
  name: "Company Handbook",
  description: "Reference handbook used by sample prompts and tools.",
  mimeType: "text/markdown",
  annotations: {
    audience: ["assistant"],
    priority: 0.7
  },
  read() {
    return resourceResult({
      content: "# Company Handbook\n\nExpense reports should include a receipt and a business purpose.",
      mimeType: "text/markdown"
    });
  }
});
