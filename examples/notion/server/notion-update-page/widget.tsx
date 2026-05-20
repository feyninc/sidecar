/** Native preview for updated Notion page content. */
import { widget } from "@sidecar-ai/react";
import { NotionPageWriteWidget } from "../../components/NotionWriteWidgets.js";

export default widget(
  {
    description: "Shows the new page content or update summary accepted by Notion.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionPageWriteWidget
);
