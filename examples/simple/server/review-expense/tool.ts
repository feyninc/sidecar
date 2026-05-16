/** Example protected tool with a typed auth scope requirement. */
import { tool } from "@sidecar/core";
import type { ChatGptToolOptions } from "@sidecar/openai";
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
  execute(params: Params, ctx): Promise<Result> {
    ctx.log.info("reviewing expense report", {
      reportId: params.reportId,
      orgId: ctx.auth.orgId
    });
    return Promise.resolve({
      status: "ready",
      issues: []
    });
  }
});
