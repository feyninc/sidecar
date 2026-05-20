/** Native preview for updated Notion data sources. */
import { widget } from "@sidecar-ai/react";
import { NotionSchemaWidget } from "../../components/NotionWriteWidgets.js";

export default widget(
  {
    description: "Shows the data-source schema changes submitted to Notion.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionSchemaWidget
);
