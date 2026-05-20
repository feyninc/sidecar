/** Native preview for created Notion views. */
import { widget } from "@sidecar-ai/react";
import { NotionViewConfigWidget } from "../../components/NotionWriteWidgets.js";

export default widget(
  {
    description: "Shows the view configuration submitted to Notion.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionViewConfigWidget
);
