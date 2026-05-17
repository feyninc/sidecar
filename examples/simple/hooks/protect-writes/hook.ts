/** Example Claude plugin hook using a tool matcher. */
import { commandHook, hook } from "@sidecar/anthropic/hooks";

export default hook({
  event: "PreToolUse",
  matcher: "Write",
  run: [
    commandHook("echo checking write permissions")
  ]
});
