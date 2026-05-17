/** Example protected tool with a typed auth scope requirement. */
import { tool, toolResult } from "sidecar-ai";
import type { ChatGptToolOptions } from "@sidecar-ai/openai";
import { scopes } from "../../auth.js";

type Params = {
  /** Expense report id, for example exp_123. */
  reportId: string;
};

type Result = {
  /** Approval readiness. */
  status: "ready" | "needs_changes";
  /** Policy issues found in the report. */
  issues: string[];
};

export default tool({
  name: "Review Expense Report",
  id: "expenses.review",
  description:
    "Use this when the user wants policy issues, approver notes, or a readiness check for one expense report. Do not use this to approve or reject a report.",
  auth: {
    scopes: [scopes.expensesRead]
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  },
  hosts: {
    chatgpt: {
      invoking: "Reviewing expense report",
      invoked: "Expense report reviewed"
    } satisfies ChatGptToolOptions
  },
  async execute(params: Params, ctx) {
    ctx.log.info("reviewing expense report", {
      reportId: params.reportId,
      orgId: ctx.auth.orgId
    });

    const review = {
      status: "ready",
      issues: []
    } satisfies Result;

    return toolResult({
      structuredContent: review,
      content: "The expense report is ready and has no policy issues."
    });
  }
});
