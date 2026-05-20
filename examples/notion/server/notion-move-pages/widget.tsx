/** Native preview for moved Notion pages. */
import { widget } from "@sidecar-ai/react";
import { NotionOperationWidget } from "../../components/NotionWriteWidgets.js";

export default widget(
  {
    description: "Shows the Notion move result and affected item count.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionOperationWidget
);
