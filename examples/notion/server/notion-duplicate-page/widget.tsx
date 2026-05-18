/** Native preview for duplicated Notion pages. */
import { widget } from "@sidecar-ai/react";
import NotionToolResultWidget from "../../components/NotionToolResultWidget.js";

export default widget(
  {
    description: "Shows the asynchronous Notion duplication result.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionToolResultWidget
);
