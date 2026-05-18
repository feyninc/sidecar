/** Native preview for Notion search results. */
import { widget } from "@sidecar-ai/react";
import NotionToolResultWidget from "../../components/NotionToolResultWidget.js";

export default widget(
  {
    description: "Shows Notion search results with a readable native preview.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionToolResultWidget
);
