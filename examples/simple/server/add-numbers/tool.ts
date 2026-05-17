/** Example public tool that relies on the default public auth policy. */
import { tool, toolResult } from "@sidecar/core";

type Params = {
  /** First number to add. */
  a: number;
  /** Second number to add. */
  b: number;
};

type Result = {
  /** Sum of the two input numbers. */
  sum: number;
};

export default tool({
  name: "Add Numbers",
  description: "Use this when the user wants to add two numbers.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  },
  widget: {
    description: "Shows the computed sum from the Add Numbers tool.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  execute(params: Params) {
    const sum = params.a + params.b;
    const structuredContent: Result = { sum };

    return toolResult({
      structuredContent,
      content: `The sum is ${sum}.`
    });
  }
});
