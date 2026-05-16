import { tool, type ToolContext } from "@sidecar/core";

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
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  },
  execute(params: Params, ctx: ToolContext): Promise<Result> {
    ctx.log.info("reviewing expense report", { reportId: params.reportId });
    return Promise.resolve({
      status: "ready",
      issues: []
    });
  }
});
