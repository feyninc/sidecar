/** Render tool for interactive, live-updating stock-price charts. */
import { tool, toolResult, withParams } from "sidecar-ai";
import { z } from "zod";
import { marketData } from "../../lib/provider.js";
import { PRICE_RANGES } from "../../lib/types.js";
import type {
  PriceRange,
  ShowLivePricesMeta,
  ShowLivePricesResult,
} from "../../lib/types.js";

const Params = z.object({
  tickers: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(8)
    .describe(
      "One to eight ticker symbols or company names. Prefer exchange-qualified ticker symbols for non-US securities.",
    ),
  range: z
    .enum(PRICE_RANGES)
    .optional()
    .describe("Initial chart window. Defaults to 1D; the user can change it in the widget."),
});

export default tool({
  id: "showLivePrices",
  name: "Stock Price Chart",
  description:
    "Use this when the user asks to see, chart, monitor, or track stock or ETF prices. Renders interactive, live-updating charts with time-window tabs, add/remove ticker controls, hover details, and 10-second current-quote refreshes.",
  annotations: {
    title: "Show live stock prices",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  visibility: {
    model: true,
    widgets: true,
  },
  hosts: {
    chatgpt: {
      invoking: "Loading price chart…",
      invoked: "Price chart ready",
      widgetAccessible: true,
    },
  },
  execute: withParams(Params, async ({ tickers, range }) => {
    const selectedRange: PriceRange = range ?? "1D";
    const loaded = await marketData.getPriceSeries(tickers, selectedRange);
    const structuredContent: ShowLivePricesResult = loaded.result;
    const meta: ShowLivePricesMeta = {
      chart: {
        range: selectedRange,
        series: loaded.series,
        fetchedAt: structuredContent.fetchedAt,
      },
    };

    return toolResult({
      structuredContent,
      meta,
      content: chartSummary(structuredContent),
    });
  }),
});

function chartSummary(result: ShowLivePricesResult): string {
  const shown = result.quotes.map((quote) => quote.symbol).join(", ");
  const failed = result.errors.map((error) => error.requested).join(", ");
  const parts = [
    shown
      ? `Displaying ${result.range} price charts for ${shown}.`
      : "No price charts could be loaded.",
  ];
  if (failed) parts.push(`Unavailable: ${failed}.`);
  parts.push(
    `The widget polls for fresh quotes every ${result.refreshAfterSeconds} seconds while it is visible. Source: ${result.provider.name}. ${result.provider.note}`,
  );
  return parts.join(" ");
}
