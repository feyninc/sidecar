# Live Stock Prices MCP

A Sidecar MCP app with one data tool and one render tool:

- `getCurrentPrice` returns fresh, timestamped prices for up to eight stocks or ETFs. It is intended as model context inside a larger answer and does not render UI.
- `showLivePrices` renders an interactive chart dashboard. Users can switch between `1D`, `5D`, `1M`, `6M`, `YTD`, `1Y`, and `5Y`, add or remove tickers, inspect points on hover, and expand the dashboard.

The render tool mounts the widget once. The widget calls `getCurrentPrice` every 10 seconds for current quotes and uses its widget-only `chartRange` input when a user changes the history window. This follows the decoupled MCP Apps pattern and avoids remounting a second widget on every refresh.

## What “current price” means

There is no universal scalar called the exact current stock price. A stock trades on multiple venues, and these values are different concepts:

- **last trade**: the price of the most recent eligible execution;
- **bid/ask**: the best currently displayed buying and selling prices;
- **mark/midpoint**: a derived reference value;
- **regular close**: the latest regular-session closing price;
- **extended-hours trade**: a pre-market or after-hours execution.

This MCP returns the newest timestamped market observation its active provider exposes and labels it. Every quote includes `priceAsOf`, `regularMarketPrice`, `regularMarketTime`, `marketState`, `priceSession`, `priceType`, `isRealtime`, freshness, source, and—when available—bid, ask, and venue. It never substitutes fetch time for trade time.

Google can show consumer quotes because it licenses data from exchanges and providers. Its own disclosure says availability and delays vary by exchange, the data is not verified, and redistribution is restricted. A free consumer display is not the same thing as a free redistributable API.

## Providers

### Schwab (preferred private MVP)

Schwab Trader API – Individual has no per-call API fee for an approved Schwab client and supplies official batch quotes, provider-reported real-time flags, bid/ask data, extended-hours fields, and historical candles. Configure it with:

```dotenv
MARKET_DATA_PROVIDER=schwab
SCHWAB_CLIENT_ID=...
SCHWAB_CLIENT_SECRET=...
SCHWAB_REFRESH_TOKEN=...
```

For a short local test, `SCHWAB_ACCESS_TOKEN` can be supplied instead. Access tokens typically expire in roughly 30 minutes. Refresh authorization has a hard lifetime of roughly seven days, after which the user must complete Schwab OAuth again.

Important limits:

- A Schwab brokerage account, approved developer role, approved app, OAuth authorization, and applicable exchange agreements are required.
- Trader API – Individual is for the authorized user’s personal use. Do not run one person’s token as a public/shared quote service. A public product needs Schwab’s Commercial product and explicit market-data redistribution rights.
- Treat v1 coverage as US-listed equities and ETFs. Direct international-exchange coverage is not promised.
- This app uses 10-second batch REST polling for portable ChatGPT/Claude behavior. Schwab WebSocket streaming can replace the polling loop later, after a live approved app is available for validation.

Start at the [Schwab Trader API – Individual portal](https://developer.schwab.com/products/trader-api--individual) and use Schwab’s [OAuth guide](https://developer.schwab.com/user-guides/get-started/authenticate-with-oauth). Keep every credential server-side.

### Yahoo Finance (development fallback)

With no Schwab configuration, or with `MARKET_DATA_PROVIDER=yahoo`, the app uses Yahoo’s undocumented chart/search endpoints. This makes the example runnable without a key and provides broad international symbol coverage.

That path is intentionally labeled `unofficial-web-endpoint`: Yahoo offers no supported Finance developer API, no SLA, variable exchange delays, and says Finance data must not be redistributed. Use it for local prototyping and QA—not a public service or trading-critical workflow.

## Run locally

```sh
cd examples/stock-prices
npm install
cp .env.example .env
npm run dev
```

For a temporary HTTPS MCP endpoint that ChatGPT or Claude can reach:

```sh
npm run dev:https
```

The generated tunnel is public and this example does not implement end-user OAuth. When Schwab credentials are present, protect the endpoint with proper auth/network controls and stop temporary tunnels promptly.

Useful checks:

```sh
npm run typecheck
npm run check
npm test
npm run build:chatgpt
npm run build:claude
```

## ChatGPT and Claude UI behavior

Sidecar emits standard MCP Apps metadata for both hosts and ChatGPT compatibility metadata for the ChatGPT target. The widget can initiate `tools/call` requests, so adding tickers and refreshing data do not require a new model turn.

The host controls placement. ChatGPT renders the widget inline with the conversation, currently before the model text associated with that tool call; an app cannot insert a widget at an arbitrary token position inside a paragraph. Claude likewise associates the UI with the tool call in the conversational flow. Rich controls are best used in fullscreen, so the widget includes an **Expand** action and still degrades to the inline card.

The current implementation is live-updating polling, not protocol-level streamed tool output. MCP Apps delivers completed tool results; true push would require a long-lived Schwab WebSocket plus a separately engineered widget data channel or new Sidecar live-data support.

## Recommended product order

1. Validate this private Schwab-backed MVP against live quotes, extended hours, early closes, and the documented request limits.
2. Add an OAuth/token store suitable for the intended host and make the weekly Schwab reauthorization explicit.
3. Replace REST polling with one server-side Schwab WebSocket only if sub-10-second push materially improves the experience.
4. Before public distribution, obtain a Commercial API agreement and exchange display/redistribution rights—or choose a licensed commercial feed.
5. Add international providers exchange by exchange. Do not silently blend feeds; expose the provider and timestamp per quote.

## Source and safety notes

- [Schwab Trader API – Individual](https://developer.schwab.com/products/trader-api--individual)
- [Schwab market-data terms](https://www.schwab.com/legal/schwab-brokerage-account-agreement)
- [Yahoo exchange delays and redistribution notice](https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html)
- [Google Finance data and delay disclosure](https://www.google.com/intl/en_uk/googlefinance/disclaimer/)
- [OpenAI MCP Apps UI guidance](https://developers.openai.com/apps-sdk/build/chatgpt-ui)
- [Claude MCP Apps design guidance](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines)

Reference data only. The MCP is not a broker, does not guarantee execution prices, and should not be the sole basis for a trade.
