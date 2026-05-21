/** Native preview for created Notion databases. */
import { widget } from "@sidecar-ai/react";
import { NotionCreateDatabaseWidget } from "../../components/NotionWriteWidgets.js";

export default widget(
  {
    description: "Shows the database schema submitted to Notion.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionCreateDatabaseWidget
);
