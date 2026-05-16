import { useToolResult } from "@sidecar/react";
import { Button } from "@sidecar/native/components";

type Result = {
  sum: number;
};

export default function AddNumbersWidget() {
  const { structured } = useToolResult<Result>();

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Sum</h1>
      <output style={{ display: "block", fontSize: 32, fontWeight: 650, marginBottom: 12 }}>
        {structured?.sum ?? "--"}
      </output>
      <Button variant="secondary" type="button">
        Ready
      </Button>
    </main>
  );
}
