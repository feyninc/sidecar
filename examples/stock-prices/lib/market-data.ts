import {
  type ChartPoint,
  type CurrentPriceResult,
  type MarketDataError,
  type MarketSession,
  type PriceQuote,
  type PriceRange,
  type PriceSeries,
  type ProviderDisclosure,
  type QuoteFreshness,
  type ShowLivePricesResult,
  type SymbolCandidate,
} from "./types.js";

const CHART_ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart";
const SEARCH_ENDPOINT = "https://query2.finance.yahoo.com/v1/finance/search";
const USER_AGENT = "SidecarLivePrices/0.1 (+https://github.com/feyninc/sidecar)";
const MAX_TICKERS = 8;
const MAX_CHART_POINTS = 420;
const REQUEST_TIMEOUT_MS = 8_000;

export const PROVIDER_DISCLOSURE: ProviderDisclosure = {
  name: "Yahoo Finance",
  access: "unofficial-web-endpoint",
  homepage: "https://finance.yahoo.com",
  tradingGrade: false,
  consolidation: "not-disclosed",
  note:
    "Freshness varies by exchange. This prototype reports provider timestamps and must not be treated as an executable or consolidated market quote.",
};

type RangeConfig = {
  upstreamRange: string;
  interval: string;
  cacheMs: number;
};

const RANGE_CONFIG: Record<PriceRange, RangeConfig> = {
  "1D": { upstreamRange: "1d", interval: "1m", cacheMs: 7_500 },
  "5D": { upstreamRange: "5d", interval: "5m", cacheMs: 20_000 },
  "1M": { upstreamRange: "1mo", interval: "30m", cacheMs: 60_000 },
  "6M": { upstreamRange: "6mo", interval: "1d", cacheMs: 120_000 },
  YTD: { upstreamRange: "ytd", interval: "1d", cacheMs: 120_000 },
  "1Y": { upstreamRange: "1y", interval: "1d", cacheMs: 180_000 },
  "5Y": { upstreamRange: "5y", interval: "1wk", cacheMs: 300_000 },
};

type FetchLike = typeof globalThis.fetch;

type YahooTradingPeriod = {
  start?: number;
  end?: number;
};

type YahooChartMeta = {
  symbol?: string;
  currency?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  instrumentType?: string;
  regularMarketTime?: number;
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  longName?: string;
  shortName?: string;
  priceHint?: number;
  currentTradingPeriod?: {
    pre?: YahooTradingPeriod;
    regular?: YahooTradingPeriod;
    post?: YahooTradingPeriod;
  };
};

type YahooChartResult = {
  meta?: YahooChartMeta;
  timestamp?: Array<number | null>;
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
    }>;
  };
};

type YahooChartEnvelope = {
  chart?: {
    result?: YahooChartResult[] | null;
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
};

type YahooSearchQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchange?: string;
  exchDisp?: string;
  score?: number;
};

type YahooSearchEnvelope = {
  quotes?: YahooSearchQuote[];
};

type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

type ResolvedChart = {
  symbol: string;
  result: YahooChartResult;
};

type ClientOptions = {
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

class MarketDataProviderError extends Error {
  constructor(
    readonly code: MarketDataError["code"],
    message: string,
    readonly candidates?: SymbolCandidate[],
  ) {
    super(message);
    this.name = "MarketDataProviderError";
  }
}

/** Small Yahoo-backed provider client with bounded caching and partial failures. */
export class YahooMarketDataClient {
  private readonly fetcher: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly chartCache = new Map<string, CachedValue<YahooChartResult>>();
  private readonly chartRequests = new Map<string, Promise<YahooChartResult>>();
  private readonly resolutionCache = new Map<string, CachedValue<string>>();

  constructor(options: ClientOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async getCurrentPrices(inputs: readonly string[]): Promise<CurrentPriceResult> {
    const requested = normalizeInputs(inputs);
    const settled = await this.mapInputs(requested, async (input) => {
      const chart = await this.resolveChart(input, "1D");
      return quoteFromChart(input, chart.result, this.now());
    });

    return {
      requested,
      quotes: uniqueBySymbol(settled.values, (quote) => quote.symbol),
      errors: settled.errors,
      fetchedAt: new Date(this.now()).toISOString(),
      refreshAfterSeconds: 10,
      provider: PROVIDER_DISCLOSURE,
    };
  }

  async getPriceSeries(
    inputs: readonly string[],
    range: PriceRange,
  ): Promise<{ result: ShowLivePricesResult; series: PriceSeries[] }> {
    const requested = normalizeInputs(inputs);
    const settled = await this.mapInputs(requested, async (input) => {
      const current = await this.resolveChart(input, "1D");
      const history = range === "1D"
        ? current.result
        : await this.fetchChart(current.symbol, range);
      const quote = quoteFromChart(input, current.result, this.now());
      return {
        quote,
        range,
        points: chartPoints(history),
      } satisfies PriceSeries;
    });
    const fetchedAt = new Date(this.now()).toISOString();
    const series = uniqueBySymbol(settled.values, (item) => item.quote.symbol);

    return {
      result: {
        requested,
        quotes: series.map((item) => item.quote),
        errors: settled.errors,
        fetchedAt,
        refreshAfterSeconds: 10,
        provider: PROVIDER_DISCLOSURE,
        range,
      },
      series,
    };
  }

  private async mapInputs<T>(
    inputs: string[],
    load: (input: string) => Promise<T>,
  ): Promise<{ values: T[]; errors: MarketDataError[] }> {
    const values: T[] = [];
    const errors: MarketDataError[] = [];

    for (let index = 0; index < inputs.length; index += 4) {
      const batch = inputs.slice(index, index + 4);
      const batchResults = await Promise.allSettled(batch.map(load));
      batchResults.forEach((result, batchIndex) => {
        const requested = batch[batchIndex] ?? "";
        if (result.status === "fulfilled") {
          values.push(result.value);
        } else {
          errors.push(publicError(requested, result.reason));
        }
      });
    }

    return { values, errors };
  }

  private async resolveChart(input: string, range: PriceRange): Promise<ResolvedChart> {
    const resolutionKey = input.toLocaleLowerCase();
    const cachedResolution = this.readCache(this.resolutionCache, resolutionKey);
    if (cachedResolution) {
      return {
        symbol: cachedResolution,
        result: await this.fetchChart(cachedResolution, range),
      };
    }

    if (looksLikeCompanyName(input)) {
      const symbol = await this.searchSymbol(input);
      const result = await this.fetchChart(symbol, range);
      this.writeCache(this.resolutionCache, resolutionKey, symbol, 60 * 60_000);
      return { symbol, result };
    }

    const directSymbol = normalizeSymbol(input);
    try {
      const result = await this.fetchChart(directSymbol, range);
      this.writeCache(this.resolutionCache, resolutionKey, directSymbol, 60 * 60_000);
      return { symbol: directSymbol, result };
    } catch (error) {
      if (!(error instanceof MarketDataProviderError) || error.code !== "not-found") {
        throw error;
      }
    }

    const symbol = await this.searchSymbol(input);
    const result = await this.fetchChart(symbol, range);
    this.writeCache(this.resolutionCache, resolutionKey, symbol, 60 * 60_000);
    return { symbol, result };
  }

  private async fetchChart(symbol: string, range: PriceRange): Promise<YahooChartResult> {
    const config = RANGE_CONFIG[range];
    const cacheKey = `${symbol}:${range}`;
    const cached = this.readCache(this.chartCache, cacheKey);
    if (cached) {
      return cached;
    }

    const activeRequest = this.chartRequests.get(cacheKey);
    if (activeRequest) {
      return activeRequest;
    }

    const request = this.loadChart(symbol, config).finally(() => {
      this.chartRequests.delete(cacheKey);
    });
    this.chartRequests.set(cacheKey, request);

    const value = await request;
    this.writeCache(this.chartCache, cacheKey, value, config.cacheMs);
    return value;
  }

  private async loadChart(symbol: string, config: RangeConfig): Promise<YahooChartResult> {
    const url = new URL(`${CHART_ENDPOINT}/${encodeURIComponent(symbol)}`);
    url.searchParams.set("interval", config.interval);
    url.searchParams.set("range", config.upstreamRange);
    url.searchParams.set("includePrePost", "true");
    url.searchParams.set("events", "div,splits");

    const payload = await this.fetchJson<YahooChartEnvelope>(url, true);
    const upstreamError = payload.chart?.error;
    if (upstreamError) {
      const code = upstreamError.code?.toLocaleLowerCase() ?? "";
      throw new MarketDataProviderError(
        code.includes("not found") ? "not-found" : "upstream",
        upstreamError.description ?? `No chart data was returned for ${symbol}.`,
      );
    }

    const result = payload.chart?.result?.[0];
    if (!result?.meta?.symbol || !isFiniteNumber(result.meta.regularMarketPrice)) {
      throw new MarketDataProviderError(
        "not-found",
        `No usable market quote was returned for ${symbol}.`,
      );
    }
    return result;
  }

  private async searchSymbol(query: string): Promise<string> {
    const url = new URL(SEARCH_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("quotesCount", "6");
    url.searchParams.set("newsCount", "0");
    url.searchParams.set("listsCount", "0");

    const payload = await this.fetchJson<YahooSearchEnvelope>(url, false);
    const matches = (payload.quotes ?? [])
      .filter((quote) =>
        Boolean(quote.symbol) && ["EQUITY", "ETF"].includes(quote.quoteType ?? ""),
      )
      .slice(0, 5);

    if (!matches.length) {
      throw new MarketDataProviderError(
        "not-found",
        `No stock or ETF matched “${query}”. Try an exchange-qualified ticker.`,
      );
    }

    const candidates = matches.map(toCandidate);
    const [first, second] = matches;
    const confident =
      Boolean(first) &&
      (matches.length === 1 ||
        normalizedName(query) === normalizedName(first?.longname ?? first?.shortname ?? "") ||
        (first?.score ?? 0) - (second?.score ?? 0) >= 1_000 ||
        (first?.score ?? 0) >= 25_000);

    if (!first?.symbol || !confident) {
      throw new MarketDataProviderError(
        "ambiguous",
        `“${query}” matches multiple securities. Use a ticker or include the exchange/country.`,
        candidates,
      );
    }

    return normalizeSymbol(first.symbol);
  }

  private async fetchJson<T>(url: URL, notFoundOn404: boolean): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(url, {
        headers: {
          accept: "application/json",
          "user-agent": USER_AGENT,
        },
        signal: controller.signal,
      });
      if (response.status === 404 && notFoundOn404) {
        throw new MarketDataProviderError("not-found", "The requested symbol was not found.");
      }
      if (response.status === 429) {
        throw new MarketDataProviderError(
          "rate-limited",
          "The market-data source is rate-limiting requests. Try again shortly.",
        );
      }
      if (!response.ok) {
        throw new MarketDataProviderError(
          "upstream",
          `The market-data source returned HTTP ${response.status}.`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof MarketDataProviderError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new MarketDataProviderError("upstream", "The market-data request timed out.");
      }
      throw new MarketDataProviderError(
        "upstream",
        error instanceof Error ? error.message : "The market-data request failed.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private readCache<T>(cache: Map<string, CachedValue<T>>, key: string): T | undefined {
    const cached = cache.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= this.now()) {
      cache.delete(key);
      return undefined;
    }
    return cached.value;
  }

  private writeCache<T>(
    cache: Map<string, CachedValue<T>>,
    key: string,
    value: T,
    ttlMs: number,
  ): void {
    cache.set(key, { value, expiresAt: this.now() + ttlMs });
  }
}

/** Explicit development fallback instance. Prefer the provider selector in provider.ts. */
export const yahooMarketData = new YahooMarketDataClient();

function normalizeInputs(inputs: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of inputs) {
    const value = raw.trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }

  if (!normalized.length) {
    throw new Error("At least one ticker or company name is required.");
  }
  if (normalized.length > MAX_TICKERS) {
    throw new Error(`A maximum of ${MAX_TICKERS} tickers can be requested at once.`);
  }
  return normalized;
}

function uniqueBySymbol<T>(values: T[], symbol: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = symbol(value).toLocaleUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSymbol(input: string): string {
  return input.trim().toLocaleUpperCase().replace(/\s+/g, "");
}

function looksLikeCompanyName(input: string): boolean {
  return /[\s,&]/.test(input.trim());
}

function normalizedName(input: string): string {
  return input
    .toLocaleLowerCase()
    .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function toCandidate(quote: YahooSearchQuote): SymbolCandidate {
  return {
    symbol: quote.symbol ?? "",
    name: quote.longname ?? quote.shortname ?? quote.symbol ?? "Unknown security",
    exchange: quote.exchDisp ?? quote.exchange,
  };
}

function quoteFromChart(requested: string, result: YahooChartResult, nowMs: number): PriceQuote {
  const meta = result.meta;
  if (!meta?.symbol || !isFiniteNumber(meta.regularMarketPrice)) {
    throw new MarketDataProviderError("invalid-response", "The quote response was incomplete.");
  }

  const points = rawChartPoints(result);
  const latestPoint = points.at(-1);
  const marketState = sessionAt(Math.floor(nowMs / 1_000), meta.currentTradingPeriod);
  const regularTime = numberOrUndefined(meta.regularMarketTime);
  const useRegularSnapshot = marketState === "regular" && regularTime !== undefined;
  const price = useRegularSnapshot
    ? meta.regularMarketPrice
    : latestPoint?.price ?? meta.regularMarketPrice;
  const timestampSeconds = useRegularSnapshot
    ? regularTime
    : latestPoint?.timestamp ?? regularTime ?? Math.floor(nowMs / 1_000);
  const priceSession = sessionAt(timestampSeconds, meta.currentTradingPeriod);
  const ageSeconds = Math.max(0, Math.floor(nowMs / 1_000) - timestampSeconds);
  const previousClose = numberOrUndefined(meta.previousClose ?? meta.chartPreviousClose);
  const change = previousClose === undefined ? undefined : price - previousClose;
  const changePercent =
    previousClose === undefined || previousClose === 0
      ? undefined
      : (change! / previousClose) * 100;

  return compactObject({
    requested,
    symbol: meta.symbol,
    name: meta.longName ?? meta.shortName ?? meta.symbol,
    assetType: meta.instrumentType ?? "UNKNOWN",
    exchange: meta.exchangeName ?? "UNKNOWN",
    exchangeName: meta.fullExchangeName ?? meta.exchangeName ?? "Unknown exchange",
    currency: meta.currency ?? "USD",
    price,
    priceAsOf: new Date(timestampSeconds * 1_000).toISOString(),
    priceSession: priceSession === "unknown" && marketState === "closed" ? "closed" : priceSession,
    marketState,
    freshness: quoteFreshness(marketState, ageSeconds),
    ageSeconds,
    regularMarketPrice: meta.regularMarketPrice,
    regularMarketTime: new Date((regularTime ?? timestampSeconds) * 1_000).toISOString(),
    previousClose,
    change,
    changePercent,
    dayHigh: numberOrUndefined(meta.regularMarketDayHigh),
    dayLow: numberOrUndefined(meta.regularMarketDayLow),
    volume: numberOrUndefined(meta.regularMarketVolume),
    pricePrecision: Math.min(8, Math.max(0, Math.trunc(meta.priceHint ?? 2))),
    priceType: useRegularSnapshot ? "regular-market-price" : "intraday-close",
    isRealtime: null,
    isConsolidated: null,
    source: "Yahoo Finance" as const,
  }) as PriceQuote;
}

function chartPoints(result: YahooChartResult): ChartPoint[] {
  return downsample(
    rawChartPoints(result).map((point) => ({
      time: new Date(point.timestamp * 1_000).toISOString(),
      price: point.price,
    })),
    MAX_CHART_POINTS,
  );
}

function rawChartPoints(result: YahooChartResult): Array<{ timestamp: number; price: number }> {
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const points: Array<{ timestamp: number; price: number }> = [];

  for (let index = 0; index < Math.min(timestamps.length, closes.length); index += 1) {
    const timestamp = timestamps[index];
    const price = closes[index];
    if (isFiniteNumber(timestamp) && isFiniteNumber(price)) {
      points.push({ timestamp, price });
    }
  }
  return points;
}

function downsample<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  const sampled: T[] = [];
  const lastIndex = values.length - 1;
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index / (limit - 1)) * lastIndex);
    const value = values[sourceIndex];
    if (value !== undefined) sampled.push(value);
  }
  return sampled;
}

function sessionAt(
  timestamp: number,
  periods: YahooChartMeta["currentTradingPeriod"],
): MarketSession {
  if (within(timestamp, periods?.pre)) return "pre-market";
  if (within(timestamp, periods?.regular)) return "regular";
  if (within(timestamp, periods?.post)) return "after-hours";
  if (periods?.regular?.end && timestamp > periods.regular.end) return "closed";
  return "unknown";
}

function within(timestamp: number, period: YahooTradingPeriod | undefined): boolean {
  return Boolean(
    isFiniteNumber(period?.start) &&
      isFiniteNumber(period?.end) &&
      timestamp >= period.start &&
      timestamp <= period.end,
  );
}

function quoteFreshness(marketState: MarketSession, ageSeconds: number): QuoteFreshness {
  if (marketState === "closed") return "market-closed";
  if (ageSeconds <= 120) return "fresh";
  if (ageSeconds <= 20 * 60) return "delayed-or-inactive";
  return "stale";
}

function publicError(requested: string, error: unknown): MarketDataError {
  if (error instanceof MarketDataProviderError) {
    return compactObject({
      requested,
      code: error.code,
      message: error.message,
      candidates: error.candidates,
    }) as MarketDataError;
  }
  return {
    requested,
    code: "upstream",
    message: error instanceof Error ? error.message : "The quote lookup failed.",
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}
