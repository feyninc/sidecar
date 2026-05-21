/** Native preview for created Notion views. */
import { widget } from "@sidecar-ai/react";
import { NotionCreateViewWidget } from "../../components/NotionWriteWidgets.js";

export default widget(
  {
    description: "Shows the view configuration submitted to Notion.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionCreateViewWidget
);
