/** Data-only tool for fresh stock prices used as model context. */
import { tool, toolResult, withParams } from "sidecar-ai";
import { z } from "zod";
import { marketData } from "../../lib/provider.js";
import { PRICE_RANGES } from "../../lib/types.js";
import type {
  CurrentPriceMeta,
  CurrentPriceResult,
  PriceQuote,
} from "../../lib/types.js";

const Params = z.object({
  tickers: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(8)
    .describe(
      "One to eight ticker symbols or company names. Prefer exchange-qualified ticker symbols for non-US securities.",
    ),
  chartRange: z
    .enum(PRICE_RANGES)
    .optional()
    .describe(
      "Widget-only history request. Models should normally omit this and use showLivePrices when the user wants a chart.",
    ),
});

export default tool({
  id: "getCurrentPrice",
  name: "Get Current Stock Prices",
  description:
    "Use this when fresh stock or ETF prices are context for a larger answer and no chart is needed. Returns timestamped data without rendering UI. Every quote includes its source, market session, provider timestamp, and freshness; never describe an old or unverified quote as live.",
  annotations: {
    title: "Get current stock prices",
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
      invoking: "Checking current prices…",
      invoked: "Prices checked",
      widgetAccessible: true,
    },
  },
  execute: withParams(Params, async ({ tickers, chartRange }) => {
    if (chartRange) {
      const loaded = await marketData.getPriceSeries(tickers, chartRange);
      const { range: _range, ...structuredContent } = loaded.result;
      const meta: CurrentPriceMeta = {
        chart: {
          range: chartRange,
          series: loaded.series,
          fetchedAt: structuredContent.fetchedAt,
        },
      };

      return toolResult({
        structuredContent,
        meta,
        content: modelSummary(structuredContent),
        isError: structuredContent.quotes.length === 0,
      });
    }

    const structuredContent: CurrentPriceResult = await marketData.getCurrentPrices(tickers);

    return toolResult({
      structuredContent,
      content: modelSummary(structuredContent),
      isError: structuredContent.quotes.length === 0,
    });
  }),
});

function modelSummary(result: CurrentPriceResult): string {
  const lines = result.quotes.map((quote) => quoteLine(quote));
  const errors = result.errors.map(
    (error) => `${error.requested}: unavailable (${error.message})`,
  );
  const summary = [...lines, ...errors].join("\n");
  return [
    summary || "No prices were available.",
    `Fetched ${result.fetchedAt} from ${result.provider.name}. ${result.provider.note}`,
  ].join("\n");
}

function quoteLine(quote: PriceQuote): string {
  const amount = formatMoney(quote.price, quote.currency, quote.pricePrecision);
  const realtime =
    quote.isRealtime === true
      ? "provider reports real-time"
      : quote.isRealtime === false
        ? "provider reports delayed"
        : `freshness ${quote.freshness}`;
  return `${quote.symbol} (${quote.name}): ${amount}; ${quote.priceType}; ${quote.marketState}; as of ${quote.priceAsOf}; ${realtime}; source ${quote.source}.`;
}

function formatMoney(value: number, currency: string, precision: number): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: Math.min(precision, 4),
      maximumFractionDigits: Math.min(precision, 4),
    }).format(value);
  } catch {
    return `${value.toFixed(Math.min(precision, 4))} ${currency}`;
  }
}
