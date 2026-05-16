import { agent } from "@sidecar/anthropic/plugin";

export default agent({
  name: "review-writer",
  description: "Use to draft concise expense review summaries.",
  model: "sonnet",
  color: "blue",
  tools: ["Read", "Grep"],
  disallowedTools: ["Write"],
  prompt: `
Draft concise expense review summaries from Sidecar tool results.

Lead with readiness, then list policy issues if any exist.
`
});
