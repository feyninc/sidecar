/** Native preview for fetched Notion content. */
import { widget } from "@sidecar-ai/react";
import { NotionDocumentWidget } from "../../components/NotionReadWidgets.js";

export default widget(
  {
    description: "Shows fetched Notion content as a document preview.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionDocumentWidget
);
