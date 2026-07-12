/** Time windows supported by the interactive chart. */
export const PRICE_RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y"] as const;

export type PriceRange = (typeof PRICE_RANGES)[number];

export type MarketSession =
  | "pre-market"
  | "regular"
  | "after-hours"
  | "closed"
  | "unknown";

export type QuoteFreshness =
  | "fresh"
  | "market-closed"
  | "delayed-or-inactive"
  | "stale";

export type SymbolCandidate = {
  symbol: string;
  name: string;
  exchange?: string;
};

export type MarketDataError = {
  requested: string;
  code:
    | "ambiguous"
    | "configuration"
    | "reauth-required"
    | "not-found"
    | "delayed"
    | "rate-limited"
    | "upstream"
    | "invalid-response";
  message: string;
  candidates?: SymbolCandidate[];
};

export type MarketDataProviderName = "Charles Schwab" | "Yahoo Finance";

export type ProviderDisclosure = {
  name: MarketDataProviderName;
  access: "official-user-authorized-api" | "unofficial-web-endpoint";
  homepage: string;
  tradingGrade: false;
  consolidation: "provider-reported" | "not-disclosed";
  note: string;
};

export type PriceQuote = {
  requested: string;
  symbol: string;
  name: string;
  assetType: string;
  exchange: string;
  exchangeName: string;
  currency: string;
  price: number;
  priceAsOf: string;
  priceSession: MarketSession;
  marketState: MarketSession;
  freshness: QuoteFreshness;
  ageSeconds: number;
  regularMarketPrice: number;
  regularMarketTime: string;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  dayHigh?: number;
  dayLow?: number;
  volume?: number;
  pricePrecision: number;
  priceType: "last-trade" | "intraday-close" | "regular-market-price";
  isRealtime: boolean | null;
  isConsolidated: boolean | null;
  bid?: number;
  ask?: number;
  venue?: string;
  source: MarketDataProviderName;
};

export type ChartPoint = {
  time: string;
  price: number;
};

export type PriceSeries = {
  quote: PriceQuote;
  range: PriceRange;
  points: ChartPoint[];
};

export type CurrentPriceResult = {
  requested: string[];
  quotes: PriceQuote[];
  errors: MarketDataError[];
  fetchedAt: string;
  refreshAfterSeconds: 10;
  provider: ProviderDisclosure;
};

export type ShowLivePricesResult = CurrentPriceResult & {
  range: PriceRange;
};

export type ShowLivePricesMeta = {
  chart: {
    range: PriceRange;
    series: PriceSeries[];
    fetchedAt: string;
  };
};

export type CurrentPriceMeta = {
  chart?: ShowLivePricesMeta["chart"];
};

/** Provider contract shared by the Schwab and development fallback adapters. */
export type MarketDataClient = {
  getCurrentPrices(inputs: readonly string[]): Promise<CurrentPriceResult>;
  getPriceSeries(
    inputs: readonly string[],
    range: PriceRange,
  ): Promise<{ result: ShowLivePricesResult; series: PriceSeries[] }>;
};
