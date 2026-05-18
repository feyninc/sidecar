/** Native preview for updated Notion page content. */
import { widget } from "@sidecar-ai/react";
import NotionToolResultWidget from "../../components/NotionToolResultWidget.js";

export default widget(
  {
    description: "Shows the new page content or update summary accepted by Notion.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionToolResultWidget
);
