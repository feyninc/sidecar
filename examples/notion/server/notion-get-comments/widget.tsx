/** Native preview for Notion comments. */
import { widget } from "@sidecar-ai/react";
import { NotionCommentsWidget } from "../../components/NotionReadWidgets.js";

export default widget(
  {
    description: "Shows Notion comment and discussion results.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionCommentsWidget
);
