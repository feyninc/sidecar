/** Native preview for Notion users. */
import { widget } from "@sidecar-ai/react";
import { NotionPeopleWidget } from "../../components/NotionDirectoryWidgets.js";

export default widget(
  {
    description: "Shows Notion workspace user metadata.",
    csp: {
      connectDomains: [],
      resourceDomains: []
    }
  },
  NotionPeopleWidget
);
