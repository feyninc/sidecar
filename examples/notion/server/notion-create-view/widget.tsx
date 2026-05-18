/** Native preview for created Notion views. */
import { widget } from "@sidecar-ai/react";
import NotionToolResultWidget from "../../components/NotionToolResultWidget.js";

export default widget(
  {
    description: "Shows the view configuration submitted to Notion.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionToolResultWidget
);
