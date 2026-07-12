/** Interactive chart UI attached only to the showLivePrices render tool. */
import { widget } from "@sidecar-ai/react";
import { LivePricesWidget } from "../../components/LivePricesWidget.js";

export default widget(
  {
    description:
      "An interactive live stock-price dashboard with time windows, hover details, and ticker controls.",
    prefersBorder: true,
    csp: {
      connectDomains: [],
      resourceDomains: [],
    },
  },
  LivePricesWidget,
);
