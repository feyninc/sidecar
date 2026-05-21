/** Native preview for created Notion pages. */
import { widget } from "@sidecar-ai/react";
import { NotionCreatePagesWidget } from "../../components/NotionWriteWidgets.js";

export default widget(
  {
    description: "Shows the new page content accepted by Notion.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionCreatePagesWidget
);
