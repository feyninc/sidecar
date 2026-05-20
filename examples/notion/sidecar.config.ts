/** Sidecar project identity for the hosted Notion MCP example. */
import { defineConfig } from "sidecar-ai";

export default defineConfig({
  name: "Notion MCP",
  version: "0.1.0-alpha.1",
  description:
    "A Sidecar example that exposes the hosted Notion MCP tools with native UI previews.",
  build: {
    plugins: true
  },
  resources: {
    listChanged: false,
    subscribe: false
  },
  prompts: {
    listChanged: false
  },
  tools: {
    listChanged: false
  },
  pagination: {
    pageSize: 50
  }
});
