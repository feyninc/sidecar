/** Example React widget rendered for the sibling Add Numbers tool. */
import { useToolResult, widget } from "@sidecar/react";
import { Button } from "@sidecar/native/components";

type Result = {
  sum: number;
};

/** Renders the structured result from the Add Numbers tool. */
function AddNumbersWidget() {
  const { structured } = useToolResult<Result>();

  return (
    <main className="grid gap-3 p-4">
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Sum</h1>
      <output className="sidecar-example-output block text-3xl font-semibold">
        {structured?.sum ?? "--"}
      </output>
      <Button variant="secondary" type="button">
        Ready
      </Button>
    </main>
  );
}

export default widget(
  {
    description: "Shows the computed sum from the Add Numbers tool.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  AddNumbersWidget
);
