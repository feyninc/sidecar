import { Buffer } from "node:buffer";
import type {
  ChartPoint,
  CurrentPriceResult,
  MarketDataClient,
  MarketDataError,
  MarketSession,
  PriceQuote,
  PriceRange,
  PriceSeries,
  ProviderDisclosure,
  QuoteFreshness,
  ShowLivePricesResult,
  SymbolCandidate,
} from "./types.js";

const DEFAULT_API_BASE = "https://api.schwabapi.com/marketdata/v1";
const DEFAULT_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TICKERS = 8;
const MAX_CHART_POINTS = 420;

export const SCHWAB_PROVIDER_DISCLOSURE: ProviderDisclosure = {
  name: "Charles Schwab",
  access: "official-user-authorized-api",
  homepage: "https://developer.schwab.com/products/trader-api--individual",
  tradingGrade: false,
  consolidation: "provider-reported",
  note:
    "Provider-authorized personal market data. Prices are timestamped last trades, not execution guarantees; Individual API data must not be redistributed to other users.",
};

type FetchLike = typeof globalThis.fetch;

export type SchwabMarketDataConfig = {
  accessToken?: string;
  accessTokenExpiresAt?: number;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  apiBaseUrl?: string;
  tokenUrl?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
  now?: () => number;
};

type RawSchwabQuote = {
  assetMainType?: string;
  assetSubType?: string;
  quoteType?: string;
  realtime?: boolean;
  isDelayed?: boolean;
  symbol?: string;
  quote?: {
    askMICId?: string;
    askPrice?: number;
    bidMICId?: string;
    bidPrice?: number;
    closePrice?: number;
    highPrice?: number;
    lastMICId?: string;
    lastPrice?: number;
    lowPrice?: number;
    mark?: number;
    netChange?: number;
    netPercentChange?: number;
    openPrice?: number;
    quoteTime?: number;
    totalVolume?: number;
    tradeTime?: number;
  };
  reference?: {
    description?: string;
    exchange?: string;
    exchangeName?: string;
  };
  regular?: {
    regularMarketLastPrice?: number;
    regularMarketNetChange?: number;
    regularMarketPercentChange?: number;
    regularMarketTradeTime?: number;
    lastPrice?: number;
    tradeTime?: number;
  };
  extended?: {
    askPrice?: number;
    bidPrice?: number;
    lastPrice?: number;
    mark?: number;
    quoteTime?: number;
    tradeTime?: number;
  };
};

type RawQuoteEnvelope = Record<string, RawSchwabQuote | RawQuoteErrors> & {
  errors?: RawQuoteErrors;
};

type RawQuoteErrors = {
  invalidSymbols?: string[];
  invalidCusips?: string[];
  invalidSSIDs?: number[];
};

type RawHistory = {
  candles?: Array<{
    close?: number;
    datetime?: number;
  }>;
  symbol?: string;
  empty?: boolean;
  previousClose?: number;
  previousCloseDate?: number;
};

type RawInstrumentSearch = {
  instruments?: Array<{
    symbol?: string;
    description?: string;
    exchange?: string;
    assetType?: string;
  }>;
};

type OAuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type MarketPeriods = {
  pre?: TimePeriod;
  regular?: TimePeriod;
  post?: TimePeriod;
};

type TimePeriod = {
  start: number;
  end: number;
};

type ResolvedInput = {
  requested: string;
  symbol: string;
};

type SelectedTrade = {
  price: number;
  time: number;
  venue?: string;
  source: "aggregate" | "regular" | "extended";
};

class SchwabProviderError extends Error {
  constructor(
    readonly code: MarketDataError["code"],
    message: string,
    readonly candidates?: SymbolCandidate[],
  ) {
    super(message);
    this.name = "SchwabProviderError";
  }
}

/** Reads a personal Schwab provider configuration without exposing secrets to widgets. */
export function schwabConfigFromEnv(
  env: NodeJS.ProcessEnv,
): SchwabMarketDataConfig | undefined {
  const accessToken = clean(env.SCHWAB_ACCESS_TOKEN);
  const clientId = clean(env.SCHWAB_CLIENT_ID ?? env.SCHWAB_APP_KEY);
  const clientSecret = clean(env.SCHWAB_CLIENT_SECRET ?? env.SCHWAB_APP_SECRET);
  const refreshToken = clean(env.SCHWAB_REFRESH_TOKEN);
  if (!accessToken && !(clientId && clientSecret && refreshToken)) {
    return undefined;
  }

  const expiresAt = Number(env.SCHWAB_ACCESS_TOKEN_EXPIRES_AT);
  return {
    accessToken,
    accessTokenExpiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
    clientId,
    clientSecret,
    refreshToken,
    apiBaseUrl: clean(env.SCHWAB_MARKET_DATA_BASE_URL),
    tokenUrl: clean(env.SCHWAB_OAUTH_TOKEN_URL),
    timeoutMs: finitePositive(env.SCHWAB_HTTP_TIMEOUT_MS),
  };
}

/** Official Schwab Trader API adapter for personal, user-authorized US market data. */
export class SchwabMarketDataClient implements MarketDataClient {
  private readonly fetcher: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly apiBaseUrl: string;
  private readonly tokenUrl: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private refreshToken?: string;
  private accessToken?: string;
  private accessTokenExpiresAt: number;
  private refreshRequest?: Promise<string>;
  private readonly resolutionCache = new Map<string, { symbol: string; expiresAt: number }>();
  private marketHoursCache?: { date: string; periods?: MarketPeriods };

  constructor(config: SchwabMarketDataConfig) {
    this.fetcher = config.fetch ?? globalThis.fetch;
    this.now = config.now ?? Date.now;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.apiBaseUrl = (config.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/$/, "");
    this.tokenUrl = config.tokenUrl ?? DEFAULT_TOKEN_URL;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.refreshToken = config.refreshToken;
    this.accessToken = config.accessToken;
    this.accessTokenExpiresAt =
      config.accessTokenExpiresAt ?? (config.accessToken ? Number.POSITIVE_INFINITY : 0);
  }

  async getCurrentPrices(inputs: readonly string[]): Promise<CurrentPriceResult> {
    const requested = normalizeInputs(inputs);
    const resolved = await this.resolveKnownNames(requested);
    const initial = await this.fetchQuoteEnvelope(resolved.map((item) => item.symbol));
    const retried = await this.resolveMissingSymbols(resolved, initial);
    const envelope = { ...initial, ...retried.envelope };
    const resolutions = retried.resolved;
    const periods = await this.getMarketPeriods().catch(() => undefined);
    const quotes: PriceQuote[] = [];
    const errors: MarketDataError[] = [...retried.errors];

    for (const item of resolutions) {
      const raw = envelope[item.symbol];
      if (!isRawQuote(raw)) {
        if (!errors.some((error) => error.requested === item.requested)) {
          errors.push({
            requested: item.requested,
            code: "not-found",
            message: `No Schwab market quote was returned for ${item.symbol}.`,
          });
        }
        continue;
      }

      try {
        quotes.push(quoteFromSchwab(item.requested, raw, this.now(), periods));
      } catch (error) {
        errors.push(publicError(item.requested, error));
      }
    }

    for (const invalid of quoteErrors(envelope)) {
      const resolution = resolutions.find((item) => item.symbol === invalid);
      if (resolution && !errors.some((error) => error.requested === resolution.requested)) {
        errors.push({
          requested: resolution.requested,
          code: "not-found",
          message: `${invalid} is not a supported Schwab market-data symbol.`,
        });
      }
    }

    return {
      requested,
      quotes: dedupeQuotes(quotes),
      errors: dedupeErrors(errors),
      fetchedAt: new Date(this.now()).toISOString(),
      refreshAfterSeconds: 10,
      provider: SCHWAB_PROVIDER_DISCLOSURE,
    };
  }

  async getPriceSeries(
    inputs: readonly string[],
    range: PriceRange,
  ): Promise<{ result: ShowLivePricesResult; series: PriceSeries[] }> {
    const current = await this.getCurrentPrices(inputs);
    const series: PriceSeries[] = [];
    const historyErrors: MarketDataError[] = [];

    for (let index = 0; index < current.quotes.length; index += 4) {
      const batch = current.quotes.slice(index, index + 4);
      const settled = await Promise.allSettled(
        batch.map(async (quote): Promise<PriceSeries> => ({
          quote,
          range,
          points: await this.fetchHistory(quote.symbol, range),
        })),
      );

      settled.forEach((result, batchIndex) => {
        const quote = batch[batchIndex];
        if (result.status === "fulfilled") {
          series.push(result.value);
        } else if (quote) {
          historyErrors.push(publicError(quote.requested, result.reason));
        }
      });
    }

    return {
      result: {
        ...current,
        errors: dedupeErrors([...current.errors, ...historyErrors]),
        range,
      },
      series,
    };
  }

  private async resolveKnownNames(inputs: string[]): Promise<ResolvedInput[]> {
    const resolved: ResolvedInput[] = [];
    for (const requested of inputs) {
      if (looksLikeCompanyName(requested)) {
        try {
          resolved.push({ requested, symbol: await this.searchSymbol(requested) });
        } catch {
          resolved.push({ requested, symbol: normalizeSymbol(requested) });
        }
      } else {
        resolved.push({ requested, symbol: normalizeSymbol(requested) });
      }
    }
    return resolved;
  }

  private async resolveMissingSymbols(
    resolutions: ResolvedInput[],
    firstEnvelope: RawQuoteEnvelope,
  ): Promise<{
    resolved: ResolvedInput[];
    envelope: RawQuoteEnvelope;
    errors: MarketDataError[];
  }> {
    const resolved = [...resolutions];
    const retrySymbols: string[] = [];
    const errors: MarketDataError[] = [];

    for (let index = 0; index < resolved.length; index += 1) {
      const item = resolved[index];
      if (!item || isRawQuote(firstEnvelope[item.symbol])) continue;
      try {
        const symbol = await this.searchSymbol(item.requested);
        resolved[index] = { ...item, symbol };
        if (!isRawQuote(firstEnvelope[symbol])) retrySymbols.push(symbol);
      } catch (error) {
        errors.push(publicError(item.requested, error));
      }
    }

    return {
      resolved,
      envelope: retrySymbols.length ? await this.fetchQuoteEnvelope(unique(retrySymbols)) : {},
      errors,
    };
  }

  private async fetchQuoteEnvelope(symbols: string[]): Promise<RawQuoteEnvelope> {
    if (!symbols.length) return {};
    const url = new URL(`${this.apiBaseUrl}/quotes`);
    url.searchParams.set("symbols", unique(symbols).join(","));
    url.searchParams.set("fields", "quote,reference,regular,extended");
    url.searchParams.set("indicative", "false");
    return this.apiJson<RawQuoteEnvelope>(url);
  }

  private async fetchHistory(symbol: string, range: PriceRange): Promise<ChartPoint[]> {
    const end = this.now();
    const config = historyConfig(range, end);
    const url = new URL(`${this.apiBaseUrl}/pricehistory`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("periodType", config.periodType);
    url.searchParams.set("frequencyType", config.frequencyType);
    url.searchParams.set("frequency", String(config.frequency));
    url.searchParams.set("startDate", String(config.start));
    url.searchParams.set("endDate", String(end));
    url.searchParams.set("needExtendedHoursData", "true");
    url.searchParams.set("needPreviousClose", "true");
    const payload = await this.apiJson<RawHistory>(url);
    const rawPoints = (payload.candles ?? [])
      .filter((candle) => finite(candle.datetime) && finite(candle.close))
      .map((candle) => ({
        time: new Date(normalizeEpoch(candle.datetime!)).toISOString(),
        price: candle.close!,
      }))
      .sort((left, right) => left.time.localeCompare(right.time));
    const points = exactWindow(rawPoints, range);
    if (payload.empty || !points.length) {
      throw new SchwabProviderError(
        "not-found",
        `Schwab returned no ${range} price history for ${symbol}.`,
      );
    }
    return downsample(points, MAX_CHART_POINTS);
  }

  private async searchSymbol(query: string): Promise<string> {
    const cacheKey = query.trim().toLocaleLowerCase();
    const cached = this.resolutionCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return cached.symbol;

    const url = new URL(`${this.apiBaseUrl}/instruments`);
    url.searchParams.set("symbol", query);
    url.searchParams.set("projection", "desc-search");
    const payload = await this.apiJson<RawInstrumentSearch>(url);
    const matches = (payload.instruments ?? [])
      .filter((item) =>
        Boolean(item.symbol) && ["EQUITY", "ETF"].includes((item.assetType ?? "").toUpperCase()),
      )
      .map((item) => ({
        ...item,
        exact: normalizedName(item.description ?? "") === normalizedName(query),
      }));
    if (!matches.length) {
      throw new SchwabProviderError(
        "not-found",
        `No Schwab stock or ETF matched “${query}”. Try an exact US ticker.`,
      );
    }

    const exactMatches = matches.filter((item) => item.exact);
    const candidates = (exactMatches.length ? exactMatches : matches).slice(0, 5);
    if (candidates.length !== 1) {
      throw new SchwabProviderError(
        "ambiguous",
        `“${query}” matches multiple securities. Use an exact ticker or share class.`,
        candidates.map((item) => ({
          symbol: item.symbol ?? "",
          name: item.description ?? item.symbol ?? "Unknown security",
          exchange: item.exchange,
        })),
      );
    }

    const symbol = normalizeSymbol(candidates[0]?.symbol ?? "");
    this.resolutionCache.set(cacheKey, {
      symbol,
      expiresAt: this.now() + 24 * 60 * 60_000,
    });
    return symbol;
  }

  private async getMarketPeriods(): Promise<MarketPeriods | undefined> {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(this.now()));
    if (this.marketHoursCache?.date === date) return this.marketHoursCache.periods;

    const url = new URL(`${this.apiBaseUrl}/markets/equity`);
    url.searchParams.set("date", date);
    const payload = await this.apiJson<unknown>(url);
    const periods = findMarketPeriods(payload);
    this.marketHoursCache = { date, periods };
    return periods;
  }

  private async apiJson<T>(url: URL): Promise<T> {
    let token = await this.getAccessToken(false);
    let response = await this.request(url, token);
    if (response.status === 401 && this.canRefresh()) {
      token = await this.getAccessToken(true);
      response = await this.request(url, token);
    }

    if (response.status === 401) {
      throw new SchwabProviderError(
        "reauth-required",
        "Schwab authorization expired. Reconnect the Schwab account and update the token.",
      );
    }
    if (response.status === 403) {
      throw new SchwabProviderError(
        "configuration",
        "The Schwab app is not entitled to this market-data endpoint.",
      );
    }
    if (response.status === 404) {
      throw new SchwabProviderError("not-found", "The requested Schwab market data was not found.");
    }
    if (response.status === 429) {
      throw new SchwabProviderError(
        "rate-limited",
        "Schwab is rate-limiting market-data requests. Try again shortly.",
      );
    }
    if (!response.ok) {
      throw new SchwabProviderError(
        "upstream",
        `Schwab market data returned HTTP ${response.status}.`,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new SchwabProviderError("invalid-response", "Schwab returned invalid JSON.");
    }
  }

  private async request(url: URL, token: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(url, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new SchwabProviderError("upstream", "The Schwab market-data request timed out.");
      }
      throw new SchwabProviderError(
        "upstream",
        error instanceof Error ? error.message : "The Schwab market-data request failed.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getAccessToken(forceRefresh: boolean): Promise<string> {
    if (
      !forceRefresh &&
      this.accessToken &&
      this.accessTokenExpiresAt > this.now() + 60_000
    ) {
      return this.accessToken;
    }
    if (!this.canRefresh()) {
      if (this.accessToken) return this.accessToken;
      throw new SchwabProviderError(
        "configuration",
        "Schwab credentials are incomplete. Supply an access token or refresh credentials.",
      );
    }
    if (!this.refreshRequest) {
      this.refreshRequest = this.refreshAccessToken().finally(() => {
        this.refreshRequest = undefined;
      });
    }
    return this.refreshRequest;
  }

  private canRefresh(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.refreshToken);
  }

  private async refreshAccessToken(): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.tokenUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.refreshToken ?? "",
        }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as OAuthResponse;
      if (!response.ok || !payload.access_token) {
        throw new SchwabProviderError(
          "reauth-required",
          payload.error_description ??
            "Schwab could not refresh authorization. Its refresh token expires after roughly seven days; reconnect the account.",
        );
      }
      this.accessToken = payload.access_token;
      this.refreshToken = payload.refresh_token ?? this.refreshToken;
      this.accessTokenExpiresAt = this.now() + Math.max(60, payload.expires_in ?? 1_800) * 1_000;
      return payload.access_token;
    } catch (error) {
      if (error instanceof SchwabProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new SchwabProviderError("upstream", "The Schwab token refresh timed out.");
      }
      throw new SchwabProviderError(
        "reauth-required",
        error instanceof Error ? error.message : "Schwab authorization refresh failed.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function quoteFromSchwab(
  requested: string,
  raw: RawSchwabQuote,
  nowMs: number,
  periods: MarketPeriods | undefined,
): PriceQuote {
  const trade = selectLatestTrade(raw);
  if (!trade) {
    throw new SchwabProviderError(
      "invalid-response",
      `Schwab returned no timestamped last trade for ${raw.symbol ?? requested}.`,
    );
  }
  const regularPrice =
    numberValue(raw.regular?.regularMarketLastPrice ?? raw.regular?.lastPrice) ??
    (sessionAt(trade.time, periods) === "regular" ? trade.price : undefined) ??
    numberValue(raw.quote?.closePrice) ??
    trade.price;
  const regularTime = normalizeEpoch(
    numberValue(raw.regular?.regularMarketTradeTime ?? raw.regular?.tradeTime) ?? trade.time,
  );
  const previousClose = numberValue(raw.quote?.closePrice);
  const change = previousClose === undefined ? numberValue(raw.quote?.netChange) : trade.price - previousClose;
  const changePercent =
    previousClose === undefined || previousClose === 0
      ? numberValue(raw.quote?.netPercentChange)
      : ((trade.price - previousClose) / previousClose) * 100;
  const realtime = raw.realtime === true && raw.isDelayed !== true && raw.quoteType?.toUpperCase() !== "DELAYED"
    ? true
    : raw.realtime === false || raw.isDelayed === true || raw.quoteType?.toUpperCase() === "DELAYED"
      ? false
      : null;
  const marketState = periods ? sessionAt(nowMs, periods) : fallbackUsSession(nowMs);
  const priceSession = periods
    ? sessionAt(trade.time, periods)
    : trade.source === "regular"
      ? "regular"
      : trade.source === "extended"
        ? "after-hours"
        : fallbackUsSession(trade.time);
  const ageSeconds = Math.max(0, Math.floor((nowMs - trade.time) / 1_000));

  return compact({
    requested,
    symbol: raw.symbol ?? normalizeSymbol(requested),
    name: raw.reference?.description ?? raw.symbol ?? requested,
    assetType: raw.assetMainType ?? raw.assetSubType ?? "EQUITY",
    exchange: raw.reference?.exchange ?? "UNKNOWN",
    exchangeName: raw.reference?.exchangeName ?? raw.reference?.exchange ?? "Unknown exchange",
    currency: "USD",
    price: trade.price,
    priceAsOf: new Date(trade.time).toISOString(),
    priceSession,
    marketState,
    freshness: freshness(marketState, ageSeconds, realtime),
    ageSeconds,
    regularMarketPrice: regularPrice,
    regularMarketTime: new Date(regularTime).toISOString(),
    previousClose,
    change,
    changePercent,
    dayHigh: numberValue(raw.quote?.highPrice),
    dayLow: numberValue(raw.quote?.lowPrice),
    volume: numberValue(raw.quote?.totalVolume),
    pricePrecision: trade.price < 1 ? 4 : 2,
    priceType: "last-trade" as const,
    isRealtime: realtime,
    isConsolidated: null,
    bid: numberValue(raw.extended?.bidPrice ?? raw.quote?.bidPrice),
    ask: numberValue(raw.extended?.askPrice ?? raw.quote?.askPrice),
    venue: trade.venue,
    source: "Charles Schwab" as const,
  }) as PriceQuote;
}

function selectLatestTrade(raw: RawSchwabQuote): SelectedTrade | undefined {
  const candidates: Array<SelectedTrade | undefined> = [
    tradeCandidate("aggregate", raw.quote?.lastPrice, raw.quote?.tradeTime, raw.quote?.lastMICId),
    tradeCandidate("extended", raw.extended?.lastPrice, raw.extended?.tradeTime),
    tradeCandidate(
      "regular",
      raw.regular?.regularMarketLastPrice ?? raw.regular?.lastPrice,
      raw.regular?.regularMarketTradeTime ?? raw.regular?.tradeTime,
    ),
  ];
  return candidates
    .filter((candidate): candidate is SelectedTrade => Boolean(candidate))
    .sort((left, right) => right.time - left.time)[0];
}

function tradeCandidate(
  source: SelectedTrade["source"],
  price: unknown,
  time: unknown,
  venue?: string,
): SelectedTrade | undefined {
  if (!finite(price) || !finite(time)) return undefined;
  return compact({ price, time: normalizeEpoch(time), venue, source }) as SelectedTrade;
}

function historyConfig(range: PriceRange, now: number) {
  const days = (count: number) => now - count * 24 * 60 * 60_000;
  const startOfYear = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  switch (range) {
    case "1D": return { periodType: "day", frequencyType: "minute", frequency: 1, start: days(7) };
    case "5D": return { periodType: "day", frequencyType: "minute", frequency: 5, start: days(14) };
    case "1M": return { periodType: "month", frequencyType: "daily", frequency: 1, start: days(35) };
    case "6M": return { periodType: "month", frequencyType: "daily", frequency: 1, start: days(190) };
    case "YTD": return { periodType: "ytd", frequencyType: "daily", frequency: 1, start: startOfYear };
    case "1Y": return { periodType: "year", frequencyType: "daily", frequency: 1, start: days(370) };
    case "5Y": return { periodType: "year", frequencyType: "weekly", frequency: 1, start: days(5 * 366) };
  }
}

function exactWindow(points: ChartPoint[], range: PriceRange): ChartPoint[] {
  if (range !== "1D" && range !== "5D") return points;
  const tradingDates = unique(
    points.map((point) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(point.time)),
    ),
  );
  const retained = new Set(tradingDates.slice(range === "1D" ? -1 : -5));
  return points.filter((point) =>
    retained.has(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(point.time)),
    ),
  );
}

function findMarketPeriods(value: unknown): MarketPeriods | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const sessionHours = record.sessionHours;
  if (sessionHours && typeof sessionHours === "object") {
    const sessions = sessionHours as Record<string, unknown>;
    return compact({
      pre: parseFirstPeriod(sessions.preMarket),
      regular: parseFirstPeriod(sessions.regularMarket),
      post: parseFirstPeriod(sessions.postMarket),
    }) as MarketPeriods;
  }
  for (const nested of Object.values(record)) {
    const found = findMarketPeriods(nested);
    if (found) return found;
  }
  return undefined;
}

function parseFirstPeriod(value: unknown): TimePeriod | undefined {
  const first = Array.isArray(value) ? value[0] : undefined;
  if (!first || typeof first !== "object") return undefined;
  const period = first as Record<string, unknown>;
  const start = Date.parse(String(period.start ?? ""));
  const end = Date.parse(String(period.end ?? ""));
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : undefined;
}

function sessionAt(timestamp: number, periods: MarketPeriods | undefined): MarketSession {
  if (periods?.pre && timestamp >= periods.pre.start && timestamp <= periods.pre.end) return "pre-market";
  if (periods?.regular && timestamp >= periods.regular.start && timestamp <= periods.regular.end) return "regular";
  if (periods?.post && timestamp >= periods.post.start && timestamp <= periods.post.end) return "after-hours";
  return periods ? "closed" : "unknown";
}

function fallbackUsSession(timestamp: number): MarketSession {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  if (["Sat", "Sun"].includes(parts.weekday ?? "")) return "closed";
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "pre-market";
  if (minutes >= 9 * 60 + 30 && minutes <= 16 * 60) return "regular";
  if (minutes > 16 * 60 && minutes <= 20 * 60) return "after-hours";
  return "closed";
}

function freshness(
  marketState: MarketSession,
  ageSeconds: number,
  realtime: boolean | null,
): QuoteFreshness {
  if (realtime === false) return "delayed-or-inactive";
  if (marketState === "closed") return "market-closed";
  if (ageSeconds <= 120) return "fresh";
  if (ageSeconds <= 20 * 60) return "delayed-or-inactive";
  return "stale";
}

function quoteErrors(envelope: RawQuoteEnvelope): string[] {
  const errors = envelope.errors;
  return unique([...(errors?.invalidSymbols ?? [])].map(normalizeSymbol));
}

function isRawQuote(value: RawSchwabQuote | RawQuoteErrors | undefined): value is RawSchwabQuote {
  return Boolean(
    value &&
      typeof value === "object" &&
      ("quote" in value || "regular" in value || "extended" in value || "assetMainType" in value),
  );
}

function normalizeInputs(inputs: readonly string[]): string[] {
  const normalized = unique(inputs.map((value) => value.trim()).filter(Boolean));
  if (!normalized.length) throw new Error("At least one ticker or company name is required.");
  if (normalized.length > MAX_TICKERS) {
    throw new Error(`A maximum of ${MAX_TICKERS} tickers can be requested at once.`);
  }
  return normalized;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function looksLikeCompanyName(value: string): boolean {
  return /[\s,&]/.test(value.trim());
}

function normalizedName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|class|common|stock)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeEpoch(value: number): number {
  return value < 100_000_000_000 ? value * 1_000 : value;
}

function numberValue(value: unknown): number | undefined {
  return finite(value) ? value : undefined;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function downsample<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  const sampled: T[] = [];
  const lastIndex = values.length - 1;
  for (let index = 0; index < limit; index += 1) {
    const value = values[Math.round((index / (limit - 1)) * lastIndex)];
    if (value !== undefined) sampled.push(value);
  }
  return sampled;
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

function publicError(requested: string, error: unknown): MarketDataError {
  if (error instanceof SchwabProviderError) {
    return compact({
      requested,
      code: error.code,
      message: error.message,
      candidates: error.candidates,
    }) as MarketDataError;
  }
  return {
    requested,
    code: "upstream",
    message: error instanceof Error ? error.message : "The Schwab market-data request failed.",
  };
}

function dedupeQuotes(quotes: PriceQuote[]): PriceQuote[] {
  const seen = new Set<string>();
  return quotes.filter((quote) => {
    const key = quote.symbol.toLocaleUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeErrors(errors: MarketDataError[]): MarketDataError[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.requested.toLowerCase()}:${error.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clean(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function finitePositive(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
