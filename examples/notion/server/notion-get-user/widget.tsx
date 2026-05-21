/** Native preview for one Notion user. */
import { widget } from "@sidecar-ai/react";
import { NotionUserWidget } from "../../components/NotionDirectoryWidgets.js";

export default widget(
  {
    description: "Shows one Notion user result.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionUserWidget
);
