/** Native preview for Notion workspace identity. */
import { widget } from "@sidecar-ai/react";
import { NotionSelfWidget } from "../../components/NotionDirectoryWidgets.js";

export default widget(
  {
    description: "Shows the current Notion MCP identity and workspace details.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionSelfWidget
);
