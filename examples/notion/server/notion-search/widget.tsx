/** Native preview for Notion search results. */
import { widget } from "@sidecar-ai/react";
import { NotionSearchWidget } from "../../components/NotionReadWidgets.js";

export default widget(
  {
    description: "Shows Notion search results with a readable native preview.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionSearchWidget
);
