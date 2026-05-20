/** Native preview for Notion data-source query results. */
import { widget } from "@sidecar-ai/react";
import { NotionQueryWidget } from "../../components/NotionReadWidgets.js";

export default widget(
  {
    description: "Shows query results returned by Notion data sources.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionQueryWidget
);
