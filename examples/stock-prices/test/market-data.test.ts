import assert from "node:assert/strict";
import { test } from "node:test";
import { YahooMarketDataClient } from "../lib/market-data.js";
import { SchwabMarketDataClient } from "../lib/schwab-market-data.js";

const NOW = 1_700_000_000_000;

test("Yahoo adapter returns a timestamped regular-session snapshot", async () => {
  const fetcher = mockFetch((url) => {
    assert.match(url.pathname, /\/chart\/AAPL$/);
    return jsonResponse(yahooChart({
      symbol: "AAPL",
      regularMarketPrice: 101.25,
      regularMarketTime: NOW / 1_000 - 5,
    }));
  });
  const client = new YahooMarketDataClient({ fetch: fetcher, now: () => NOW });

  const result = await client.getCurrentPrices(["AAPL"]);

  assert.equal(result.quotes.length, 1);
  assert.equal(result.quotes[0]?.symbol, "AAPL");
  assert.equal(result.quotes[0]?.price, 101.25);
  assert.equal(result.quotes[0]?.priceType, "regular-market-price");
  assert.equal(result.quotes[0]?.freshness, "fresh");
  assert.equal(result.quotes[0]?.source, "Yahoo Finance");
  assert.equal(result.errors.length, 0);
});

test("Yahoo adapter resolves a confident company name and reports an invalid symbol", async () => {
  const fetcher = mockFetch((url) => {
    if (url.pathname.includes("/finance/search")) {
      const query = url.searchParams.get("q");
      if (query === "Apple Inc") {
        return jsonResponse({
          quotes: [
            {
              symbol: "AAPL",
              longname: "Apple Inc.",
              quoteType: "EQUITY",
              exchange: "NMS",
              exchDisp: "NASDAQ",
              score: 30_000,
            },
          ],
        });
      }
      return jsonResponse({ quotes: [] });
    }
    if (url.pathname.endsWith("/AAPL")) return jsonResponse(yahooChart({ symbol: "AAPL" }));
    return jsonResponse({ chart: { result: null, error: { code: "Not Found", description: "missing" } } });
  });
  const client = new YahooMarketDataClient({ fetch: fetcher, now: () => NOW });

  const result = await client.getCurrentPrices(["Apple Inc", "NO-SUCH-SYMBOL"]);

  assert.equal(result.quotes[0]?.symbol, "AAPL");
  assert.equal(result.quotes[0]?.requested, "Apple Inc");
  assert.deepEqual(result.errors.map((error) => error.code), ["not-found"]);
});

test("Yahoo long-range history keeps the current 1D quote as its headline price", async () => {
  const requestedRanges: string[] = [];
  const fetcher = mockFetch((url) => {
    const range = url.searchParams.get("range") ?? "";
    requestedRanges.push(range);
    if (range === "1d") {
      return jsonResponse(yahooChart({
        symbol: "AAPL",
        regularMarketPrice: 101.25,
        regularMarketTime: NOW / 1_000 - 5,
        closes: [100.5, 101],
      }));
    }
    if (range === "5y") {
      return jsonResponse(yahooChart({
        symbol: "AAPL",
        regularMarketPrice: 55,
        regularMarketTime: NOW / 1_000 - 86_400,
        closes: [50.5, 51],
      }));
    }
    throw new Error(`Unexpected Yahoo range: ${range}`);
  });
  const client = new YahooMarketDataClient({ fetch: fetcher, now: () => NOW });

  const loaded = await client.getPriceSeries(["AAPL"], "5Y");

  assert.deepEqual(requestedRanges, ["1d", "5y"]);
  assert.equal(loaded.result.quotes[0]?.price, 101.25);
  assert.equal(loaded.result.quotes[0]?.priceAsOf, new Date(NOW - 5_000).toISOString());
  assert.deepEqual(loaded.series[0]?.points.map((point) => point.price), [50.5, 51]);
});

test("Yahoo adapter deduplicates a ticker and company-name alias", async () => {
  const fetcher = mockFetch((url) => {
    if (url.pathname.includes("/finance/search")) {
      return jsonResponse({
        quotes: [
          {
            symbol: "AAPL",
            longname: "Apple Inc.",
            quoteType: "EQUITY",
            exchange: "NMS",
            exchDisp: "NASDAQ",
            score: 30_000,
          },
        ],
      });
    }
    return jsonResponse(yahooChart({ symbol: "AAPL" }));
  });
  const client = new YahooMarketDataClient({ fetch: fetcher, now: () => NOW });

  const result = await client.getCurrentPrices(["AAPL", "Apple Inc"]);

  assert.deepEqual(result.requested, ["AAPL", "Apple Inc"]);
  assert.deepEqual(result.quotes.map((quote) => quote.symbol), ["AAPL"]);
  assert.equal(result.errors.length, 0);
});

test("Schwab adapter selects the newest timestamped extended-hours trade", async () => {
  const fetcher = schwabFixtureFetch({ realtime: true });
  const client = new SchwabMarketDataClient({
    accessToken: "test-access",
    fetch: fetcher,
    now: () => NOW,
  });

  const result = await client.getCurrentPrices(["AAPL"]);
  const quote = result.quotes[0];

  assert.equal(quote?.price, 102.5);
  assert.equal(quote?.priceType, "last-trade");
  assert.equal(quote?.priceSession, "after-hours");
  assert.equal(quote?.marketState, "after-hours");
  assert.equal(quote?.isRealtime, true);
  assert.equal(quote?.regularMarketPrice, 101);
  assert.equal(quote?.source, "Charles Schwab");
});

test("Schwab adapter never labels a delayed quote as fresh", async () => {
  const client = new SchwabMarketDataClient({
    accessToken: "test-access",
    fetch: schwabFixtureFetch({ realtime: false }),
    now: () => NOW,
  });

  const result = await client.getCurrentPrices(["AAPL"]);

  assert.equal(result.quotes[0]?.isRealtime, false);
  assert.equal(result.quotes[0]?.freshness, "delayed-or-inactive");
});

test("Schwab adapter deduplicates a ticker and company-name alias", async () => {
  const quotedSymbolLists: string[] = [];
  const base = schwabFixtureFetch({ realtime: true });
  const fetcher = mockFetch((url, init) => {
    if (url.pathname.endsWith("/instruments")) {
      return jsonResponse({
        instruments: [
          {
            symbol: "AAPL",
            description: "Apple Inc.",
            exchange: "NASDAQ",
            assetType: "EQUITY",
          },
        ],
      });
    }
    if (url.pathname.endsWith("/quotes")) {
      quotedSymbolLists.push(url.searchParams.get("symbols") ?? "");
    }
    return base(url, init);
  });
  const client = new SchwabMarketDataClient({
    accessToken: "test-access",
    fetch: fetcher,
    now: () => NOW,
  });

  const result = await client.getCurrentPrices(["AAPL", "Apple Inc"]);

  assert.deepEqual(quotedSymbolLists, ["AAPL"]);
  assert.deepEqual(result.requested, ["AAPL", "Apple Inc"]);
  assert.deepEqual(result.quotes.map((quote) => quote.symbol), ["AAPL"]);
  assert.equal(result.errors.length, 0);
});

test("Schwab chart history stays out of model-visible results and has usable points", async () => {
  const client = new SchwabMarketDataClient({
    accessToken: "test-access",
    fetch: schwabFixtureFetch({ realtime: true }),
    now: () => NOW,
  });

  const loaded = await client.getPriceSeries(["AAPL"], "1D");

  assert.equal(loaded.result.quotes.length, 1);
  assert.equal(loaded.result.range, "1D");
  assert.equal(loaded.series[0]?.points.length, 3);
  assert.equal(loaded.series[0]?.points.at(-1)?.price, 102.5);
});

test("getCurrentPrice history responses omit the render tool's range field", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => jsonResponse(yahooChart({ symbol: "AAPL" })));
  process.env.MARKET_DATA_PROVIDER = "yahoo";

  try {
    const { default: currentPriceTool } = await import(
      "../server/get-current-price/tool.js"
    );
    const response = await currentPriceTool.execute(
      {
        tickers: ["AAPL"],
        chartRange: "1D",
      },
      {} as never,
    );

    assert.ok(response.structuredContent);
    assert.equal("range" in response.structuredContent, false);
    const meta = response._meta as { chart?: { range?: string } } | undefined;
    assert.equal(meta?.chart?.range, "1D");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent Schwab calls share one OAuth refresh", async () => {
  let tokenRequests = 0;
  const base = schwabFixtureFetch({ realtime: true });
  const fetcher = mockFetch(async (url, init) => {
    if (url.pathname === "/v1/oauth/token") {
      tokenRequests += 1;
      await Promise.resolve();
      return jsonResponse({ access_token: "fresh-access", expires_in: 1_800 });
    }
    return base(url, init);
  });
  const client = new SchwabMarketDataClient({
    clientId: "client",
    clientSecret: "secret",
    refreshToken: "refresh",
    fetch: fetcher,
    now: () => NOW,
  });

  await Promise.all([
    client.getCurrentPrices(["AAPL"]),
    client.getCurrentPrices(["MSFT"]),
  ]);

  assert.equal(tokenRequests, 1);
});

function schwabFixtureFetch(options: { realtime: boolean }) {
  return mockFetch((url) => {
    if (url.pathname.endsWith("/quotes")) {
      const symbols = (url.searchParams.get("symbols") ?? "AAPL").split(",");
      return jsonResponse(Object.fromEntries(symbols.map((symbol) => [symbol, schwabQuote(symbol, options.realtime)])));
    }
    if (url.pathname.endsWith("/markets/equity")) {
      return jsonResponse({
        equity: {
          EQ: {
            sessionHours: {
              regularMarket: [{ start: iso(NOW - 8 * 60 * 60_000), end: iso(NOW - 2 * 60 * 60_000) }],
              postMarket: [{ start: iso(NOW - 2 * 60 * 60_000 + 1), end: iso(NOW + 2 * 60 * 60_000) }],
            },
          },
        },
      });
    }
    if (url.pathname.endsWith("/pricehistory")) {
      return jsonResponse({
        symbol: url.searchParams.get("symbol"),
        empty: false,
        candles: [
          { datetime: NOW - 120_000, close: 100 },
          { datetime: NOW - 60_000, close: 101 },
          { datetime: NOW - 500, close: 102.5 },
        ],
      });
    }
    if (url.pathname.endsWith("/instruments")) {
      return jsonResponse({ instruments: [] });
    }
    throw new Error(`Unexpected Schwab request: ${url}`);
  });
}

function schwabQuote(symbol: string, realtime: boolean) {
  return {
    symbol,
    assetMainType: "EQUITY",
    quoteType: realtime ? "NBBO" : "DELAYED",
    realtime,
    reference: {
      description: symbol === "AAPL" ? "Apple Inc." : "Microsoft Corporation",
      exchange: "Q",
      exchangeName: "NASDAQ",
    },
    quote: {
      lastPrice: 101.5,
      tradeTime: NOW - 2_000,
      lastMICId: "XNAS",
      bidPrice: 102.45,
      askPrice: 102.55,
      closePrice: 99,
      highPrice: 103,
      lowPrice: 98,
      totalVolume: 1_000_000,
    },
    regular: {
      regularMarketLastPrice: 101,
      regularMarketTradeTime: NOW - 2 * 60 * 60_000,
    },
    extended: {
      lastPrice: 102.5,
      tradeTime: NOW - 500,
      bidPrice: 102.45,
      askPrice: 102.55,
    },
  };
}

function yahooChart(options: {
  symbol: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  closes?: number[];
}) {
  const regularTime = options.regularMarketTime ?? NOW / 1_000 - 5;
  return {
    chart: {
      error: null,
      result: [
        {
          meta: {
            symbol: options.symbol,
            currency: "USD",
            exchangeName: "NMS",
            fullExchangeName: "NasdaqGS",
            instrumentType: "EQUITY",
            regularMarketTime: regularTime,
            regularMarketPrice: options.regularMarketPrice ?? 101.25,
            previousClose: 100,
            longName: "Apple Inc.",
            priceHint: 2,
            currentTradingPeriod: {
              pre: { start: NOW / 1_000 - 10_000, end: NOW / 1_000 - 5_000 },
              regular: { start: NOW / 1_000 - 4_999, end: NOW / 1_000 + 5_000 },
              post: { start: NOW / 1_000 + 5_001, end: NOW / 1_000 + 10_000 },
            },
          },
          timestamp: [NOW / 1_000 - 60, NOW / 1_000 - 5],
          indicators: { quote: [{ close: options.closes ?? [100.5, 101] }] },
        },
      ],
    },
  };
}

function mockFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return handler(url, init);
  }) as typeof globalThis.fetch;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function iso(value: number): string {
  return new Date(value).toISOString();
}
