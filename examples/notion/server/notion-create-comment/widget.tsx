/** Native preview for created Notion comments. */
import { widget } from "@sidecar-ai/react";
import { NotionCommentWriteWidget } from "../../components/NotionWriteWidgets.js";

export default widget(
  {
    description: "Shows the comment content submitted to Notion.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionCommentWriteWidget
);
