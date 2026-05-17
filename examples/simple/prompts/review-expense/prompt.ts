/** Example MCP prompt template exposed by the sample app. */
import { prompt } from "sidecar-ai";

export default prompt({
  title: "Review Expense",
  description: "Creates a structured expense review request.",
  args: {
    reportId: "Expense report id to review.",
    severity: {
      description: "How urgent the review is.",
      required: false
    }
  },
  run({ reportId, severity }: { reportId: string; severity?: string }) {
    return `Review expense report ${reportId}. Urgency: ${severity ?? "normal"}.`;
  }
});
