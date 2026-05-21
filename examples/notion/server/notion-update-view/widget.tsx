/** Native preview for updated Notion views. */
import { widget } from "@sidecar-ai/react";
import { NotionUpdateViewWidget } from "../../components/NotionWriteWidgets.js";

export default widget(
  {
    description: "Shows the view changes submitted to Notion.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionUpdateViewWidget
);
