/** Example Claude plugin hook using a tool matcher. */
import { commandHook, hook } from "@sidecar-ai/anthropic/hooks";

export default hook({
  event: "PreToolUse",
  matcher: "Write",
  run: [
    commandHook("echo checking write permissions")
  ]
});
