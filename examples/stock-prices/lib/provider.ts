import { YahooMarketDataClient } from "./market-data.js";
import { SchwabMarketDataClient, schwabConfigFromEnv } from "./schwab-market-data.js";
import type { MarketDataClient } from "./types.js";

/** Selects Schwab when configured; the Yahoo adapter is an explicit prototype fallback. */
export function createMarketDataClient(
  env: NodeJS.ProcessEnv = process.env,
): MarketDataClient {
  const requested = env.MARKET_DATA_PROVIDER?.trim().toLocaleLowerCase();
  const schwabConfig = schwabConfigFromEnv(env);

  if (requested === "schwab") {
    if (!schwabConfig) {
      throw new Error(
        "MARKET_DATA_PROVIDER=schwab requires SCHWAB_ACCESS_TOKEN or SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, and SCHWAB_REFRESH_TOKEN.",
      );
    }
    return new SchwabMarketDataClient(schwabConfig);
  }

  if (requested === "yahoo") {
    return new YahooMarketDataClient();
  }

  return schwabConfig
    ? new SchwabMarketDataClient(schwabConfig)
    : new YahooMarketDataClient();
}

/** Shared process-local provider instance used by both MCP tools. */
export const marketData = createMarketDataClient();
