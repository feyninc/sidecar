/** Example typed skill emitted as SKILL.md. */
import { skill } from "@sidecar/core";

export default skill({
  name: "review-writer",
  description: "Use when drafting a short summary of an expense review.",
  body: `
Write a concise expense review summary.

Include the report id, approval readiness, and any policy issues returned by the tool.
`
});
