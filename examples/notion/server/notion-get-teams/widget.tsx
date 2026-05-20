/** Native preview for Notion teamspaces. */
import { widget } from "@sidecar-ai/react";
import { NotionTeamsWidget } from "../../components/NotionDirectoryWidgets.js";

export default widget(
  {
    description: "Shows Notion teamspace metadata.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionTeamsWidget
);
