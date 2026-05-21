/** Native preview for Notion database-view query results. */
import { widget } from "@sidecar-ai/react";
import { NotionDatabaseViewQueryWidget } from "../../components/NotionReadWidgets.js";

export default widget(
  {
    description: "Shows query results returned by a Notion database view.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionDatabaseViewQueryWidget
);
