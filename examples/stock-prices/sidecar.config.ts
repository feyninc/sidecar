/** Sidecar project identity for the live stock-price MCP example. */
import { defineConfig } from "sidecar-ai";

export default defineConfig({
  name: "Live Stock Prices",
  version: "0.1.0",
  description:
    "Fresh, timestamped stock-price lookups and interactive price charts for ChatGPT and Claude.",
  build: {
    plugins: true,
  },
  resources: {
    listChanged: false,
    subscribe: false,
  },
  prompts: {
    listChanged: false,
  },
  tools: {
    listChanged: false,
  },
  pagination: {
    pageSize: 50,
  },
});
