/** Native preview for Notion authorization links. */
import { widget } from "@sidecar-ai/react";
import { NotionAuthorizeWidget } from "../../components/NotionAuthWidget.js";

export default widget(
  {
    description: "Shows the Notion authorization link for the current Sidecar user.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionAuthorizeWidget
);
