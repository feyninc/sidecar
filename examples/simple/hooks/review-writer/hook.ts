/** Example Claude plugin hook emitted by Sidecar. */
import { commandHook, hook } from "@sidecar-ai/anthropic/hooks";

export default hook({
  event: "SubagentStop",
  matcher: "review-writer",
  run: [
    commandHook("echo review-writer finished")
  ]
});
