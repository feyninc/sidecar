/** Example Sidecar project identity used by build and plugin outputs. */
import { defineConfig } from "sidecar-ai";

export default defineConfig({
  name: "Simple Sidecar Example",
  version: "0.1.0-alpha.1",
  description: "A small Sidecar project used to exercise tool discovery.",
  resources: {
    listChanged: false,
    subscribe: false
  },
  prompts: {
    listChanged: false
  },
  pagination: {
    pageSize: 10
  }
});
