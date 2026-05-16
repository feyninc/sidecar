import { command } from "@sidecar/anthropic/plugin";

export default command({
  name: "review-summary",
  description: "Draft a short expense review summary from the current context.",
  argumentHint: "[report-id]",
  allowedTools: ["review_expense_report"],
  prompt: `
Draft a concise review summary for the expense report in the current context.

If the user supplied a report id, call the review expense report tool first.
`
});
