import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  FormEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useToolResult, useWidgetBridge } from "@sidecar-ai/react";
import { PRICE_RANGES } from "../lib/types.js";
import type {
  CurrentPriceMeta,
  CurrentPriceResult,
  MarketDataError,
  PriceQuote,
  PriceRange,
  PriceSeries,
  ShowLivePricesMeta,
  ShowLivePricesResult,
} from "../lib/types.js";

const POLL_INTERVAL_MS = 10_000;
const MAX_TICKERS = 8;
type DashboardState = {
  result: ShowLivePricesResult;
  series: PriceSeries[];
};

/** Cross-host stock dashboard rendered by the showLivePrices tool. */
export function LivePricesWidget() {
  const initial = useToolResult<ShowLivePricesResult, ShowLivePricesMeta>();
  const bridge = useWidgetBridge();
  const [dashboard, setDashboard] = useState<DashboardState>();
  const [tickers, setTickers] = useState<string[]>([]);
  const [range, setRange] = useState<PriceRange>("1D");
  const [draftTicker, setDraftTicker] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [message, setMessage] = useState<string>();
  const polling = useRef(false);
  const loadingHistoryRef = useRef(false);
  const tickersRef = useRef<string[]>([]);

  const applyHistory = useCallback(
    (
      result: CurrentPriceResult,
      series: PriceSeries[],
      selectedRange: PriceRange,
    ) => {
      const nextResult: ShowLivePricesResult = { ...result, range: selectedRange };
      const nextTickers = unique(
        series.length
          ? series.map((item) => item.quote.symbol)
          : result.requested,
      );
      setDashboard({ result: nextResult, series });
      setRange(selectedRange);
      setTickers(nextTickers);
      tickersRef.current = nextTickers;
    },
    [],
  );

  useEffect(() => {
    const chart = initial.meta?.chart;
    const result = initial.structuredContent;
    if (!chart || !result) return;
    applyHistory(result, chart.series, chart.range);
  }, [applyHistory, initial.meta, initial.structuredContent]);

  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);

  const refreshQuotes = useCallback(async () => {
    const requestedTickers = tickersRef.current;
    if (!requestedTickers.length || polling.current || loadingHistoryRef.current) return;
    polling.current = true;
    try {
      const response = await bridge.callServerTool<
        { tickers: string[] },
        CurrentPriceResult,
        CurrentPriceMeta
      >({
        name: "getCurrentPrice",
        arguments: { tickers: requestedTickers },
      });
      if (response.structuredContent) {
        setDashboard((current) =>
          current ? mergeCurrentQuotes(current, response.structuredContent!) : current,
        );
        setMessage(undefined);
      }
    } catch (error) {
      setMessage(readError(error, "Live refresh is temporarily unavailable."));
    } finally {
      polling.current = false;
    }
  }, [bridge]);

  const tickerKey = tickers.join("|");

  useEffect(() => {
    if (!tickerKey) return;

    const refreshIfVisible = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshQuotes();
    };
    const interval = window.setInterval(refreshIfVisible, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refreshQuotes, tickerKey]);

  async function loadHistory(nextTickers: string[], nextRange: PriceRange) {
    if (!nextTickers.length) return;
    loadingHistoryRef.current = true;
    setLoadingHistory(true);
    setMessage(undefined);
    try {
      const response = await bridge.callServerTool<
        { tickers: string[]; chartRange: PriceRange },
        CurrentPriceResult,
        CurrentPriceMeta
      >({
        name: "getCurrentPrice",
        arguments: { tickers: nextTickers, chartRange: nextRange },
      });
      const result = response.structuredContent;
      const chart = response.meta?.chart;
      if (!result || !chart) {
        throw new Error("The chart history response was incomplete.");
      }
      applyHistory(result, chart.series, chart.range);
    } catch (error) {
      setMessage(readError(error, "Could not load that price window."));
    } finally {
      loadingHistoryRef.current = false;
      setLoadingHistory(false);
    }
  }

  async function submitTicker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = draftTicker.trim();
    if (!candidate) return;
    const next = unique([...tickers, candidate]);
    if (next.length > MAX_TICKERS) {
      setMessage(`You can monitor up to ${MAX_TICKERS} tickers at once.`);
      return;
    }
    setDraftTicker("");
    await loadHistory(next, range);
  }

  function removeTicker(symbol: string) {
    const nextTickers = tickers.filter((ticker) => ticker !== symbol);
    setTickers(nextTickers);
    tickersRef.current = nextTickers;
    setDashboard((current) =>
      current
        ? {
            result: {
              ...current.result,
              requested: current.result.requested.filter(
                (requested) => requested.toLocaleUpperCase() !== symbol.toLocaleUpperCase(),
              ),
              quotes: current.result.quotes.filter((quote) => quote.symbol !== symbol),
              errors: current.result.errors.filter(
                (error) => error.requested.toLocaleUpperCase() !== symbol.toLocaleUpperCase(),
              ),
            },
            series: current.series.filter((item) => item.quote.symbol !== symbol),
          }
        : current,
    );
  }

  function chooseCandidate(error: MarketDataError, symbol: string) {
    const next = unique([
      ...tickers.filter(
        (ticker) => ticker.toLocaleLowerCase() !== error.requested.toLocaleLowerCase(),
      ),
      symbol,
    ]);
    void loadHistory(next, range);
  }

  const result = dashboard?.result;
  const lastUpdated = result?.fetchedAt
    ? formatUpdatedTime(result.fetchedAt)
    : undefined;

  return (
    <main className="prices-app">
      <section className="prices-toolbar" aria-label="Chart controls">
        <div className="range-tabs" role="tablist" aria-label="Price window">
          {PRICE_RANGES.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={range === option}
              className={range === option ? "is-active" : ""}
              disabled={loadingHistory || !tickers.length}
              onClick={() => void loadHistory(tickers, option)}
            >
              {option}
            </button>
          ))}
        </div>

        <form className="ticker-form" onSubmit={(event) => void submitTicker(event)}>
          <label className="sr-only" htmlFor="ticker-input">
            Add a ticker or company
          </label>
          <input
            id="ticker-input"
            value={draftTicker}
            maxLength={100}
            placeholder="Add ticker or company"
            onChange={(event) => setDraftTicker(event.currentTarget.value)}
          />
          <button type="submit" disabled={!draftTicker.trim() || loadingHistory}>
            <PlusIcon />
            Add
          </button>
        </form>
      </section>

      {message ? <div className="notice" role="status">{message}</div> : null}

      {loadingHistory && !dashboard ? <DashboardSkeleton /> : null}

      <section className="comparison-region" aria-live="polite" aria-busy={loadingHistory}>
        {dashboard?.series.length ? (
          <ComparisonPanel
            series={dashboard.series}
            range={range}
            onRemove={removeTicker}
          />
        ) : null}
      </section>

      {result?.errors.length ? (
        <section className="lookup-errors" aria-label="Unavailable tickers">
          {result.errors.map((error) => (
            <article key={`${error.requested}-${error.code}`}>
              <div>
                <strong>{error.requested}</strong>
                <span>{error.message}</span>
              </div>
              {error.candidates?.length ? (
                <div className="candidate-list" aria-label={`Matches for ${error.requested}`}>
                  {error.candidates.map((candidate) => (
                    <button
                      key={candidate.symbol}
                      type="button"
                      onClick={() => chooseCandidate(error, candidate.symbol)}
                    >
                      {candidate.symbol}
                      <small>{candidate.name}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {!loadingHistory && dashboard && !dashboard.series.length ? (
        <div className="empty-state">
          <strong>No chart loaded</strong>
          <span>Add an exact ticker symbol to try again.</span>
        </div>
      ) : null}

      {result ? (
        <footer className="data-disclosure">
          <span>{result.provider.name}</span>
          <span aria-hidden="true">•</span>
          <span>{lastUpdated ? `Updated ${lastUpdated}` : "Waiting for prices"}</span>
        </footer>
      ) : null}
    </main>
  );
}

function ComparisonPanel(props: {
  series: PriceSeries[];
  range: PriceRange;
  onRemove(symbol: string): void;
}) {
  return (
    <article className="comparison-card">
      <div className="security-legend" aria-label="Companies in chart">
        {props.series.map((item) => (
          <LegendItem
            key={item.quote.symbol}
            series={item}
            color={seriesColor(item.quote.symbol)}
            onRemove={() => props.onRemove(item.quote.symbol)}
          />
        ))}
      </div>

      <ComparisonChart series={props.series} range={props.range} />
    </article>
  );
}

function LegendItem(props: {
  series: PriceSeries;
  color: string;
  onRemove(): void;
}) {
  const { quote } = props.series;
  const baseline = props.series.points.find((point) => Number.isFinite(point.price))?.price;
  const change = baseline && Number.isFinite(baseline)
    ? ((quote.price / baseline) - 1) * 100
    : quote.changePercent;
  const style = { "--series-color": props.color } as CSSProperties;

  return (
    <div className="legend-item" style={style}>
      <span className="legend-swatch" aria-hidden="true" />
      <div className="legend-details">
        <div className="legend-title">
          <strong>{quote.symbol}</strong>
          <span>{quote.name}</span>
        </div>
        <div className="legend-price">
          <strong>{formatMoney(quote.price, quote.currency, quote.pricePrecision)}</strong>
          <span className={change === undefined ? "is-neutral" : change >= 0 ? "is-positive" : "is-negative"}>
            {formatPercent(change)}
          </span>
        </div>
        <div className="legend-meta">
          <span className={`freshness-pill freshness-${quote.freshness}`}>
            {freshnessLabel(quote)}
          </span>
          <span>{quote.exchangeName}</span>
          <span>As of {formatQuoteTime(quote.priceAsOf)}</span>
        </div>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label={`Remove ${quote.symbol}`}
        onClick={props.onRemove}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function ComparisonChart(props: {
  series: PriceSeries[];
  range: PriceRange;
}) {
  const [hoveredTime, setHoveredTime] = useState<number>();
  const geometry = useMemo(() => comparisonGeometry(props.series), [props.series]);
  const activePoints = useMemo(
    () => geometry && hoveredTime !== undefined
      ? geometry.lines.map((line) => ({ line, point: nearestPoint(line.points, hoveredTime) }))
      : [],
    [geometry, hoveredTime],
  );

  if (!geometry || !geometry.lines.length) {
    return <div className="chart-unavailable">Not enough price history for this window.</div>;
  }

  function movePointer(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * geometry!.width;
    const ratio = clamp(
      (svgX - geometry!.plotLeft) / (geometry!.plotRight - geometry!.plotLeft),
      0,
      1,
    );
    setHoveredTime(geometry!.minTime + ratio * (geometry!.maxTime - geometry!.minTime));
  }

  const hoverX = hoveredTime === undefined
    ? undefined
    : geometry.plotLeft +
      ((hoveredTime - geometry.minTime) / Math.max(1, geometry.maxTime - geometry.minTime)) *
        (geometry.plotRight - geometry.plotLeft);
  const tooltipLeft = hoverX === undefined ? 0 : (hoverX / geometry.width) * 100;

  return (
    <figure className="comparison-chart">
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        role="img"
        aria-label={`${props.range} comparison chart for ${geometry.lines.map((line) => line.series.quote.symbol).join(", ")}, normalized to percentage change`}
        onPointerMove={movePointer}
        onPointerLeave={() => setHoveredTime(undefined)}
      >
        {geometry.yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              className="grid-line"
              x1={geometry.plotLeft}
              x2={geometry.plotRight}
              y1={tick.y}
              y2={tick.y}
            />
            <text className="axis-label" x={geometry.plotLeft - 8} y={tick.y + 4} textAnchor="end">
              {formatRelativePercent(tick.value)}
            </text>
          </g>
        ))}

        {geometry.lines.map((line) => (
          <path
            key={line.series.quote.symbol}
            d={line.path}
            fill="none"
            stroke={line.color}
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <text className="axis-label" x={geometry.plotLeft} y={geometry.height - 3}>
          {formatAxisTime(new Date(geometry.minTime).toISOString(), props.range)}
        </text>
        <text className="axis-label" x={geometry.plotRight} y={geometry.height - 3} textAnchor="end">
          {formatAxisTime(new Date(geometry.maxTime).toISOString(), props.range)}
        </text>

        {hoverX !== undefined ? (
          <g className="chart-tooltip">
            <line
              x1={hoverX}
              x2={hoverX}
              y1={geometry.plotTop}
              y2={geometry.plotBottom}
            />
            {activePoints.map(({ line, point }) => (
              <circle
                key={line.series.quote.symbol}
                cx={point.x}
                cy={point.y}
                r="4"
                fill={line.color}
                stroke="Canvas"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        ) : null}
      </svg>

      {hoveredTime !== undefined ? (
        <div
          className={`comparison-tooltip ${tooltipLeft > 68 ? "is-left" : ""}`}
          style={{ left: `${tooltipLeft}%` }}
        >
          {activePoints.map(({ line, point }) => (
            <div key={line.series.quote.symbol}>
              <span style={{ background: line.color }} aria-hidden="true" />
              <strong>{line.series.quote.symbol}</strong>
              <b>{formatMoney(point.price, line.series.quote.currency, line.series.quote.pricePrecision)}</b>
              <em>{formatRelativePercent(point.percent)}</em>
              <small>{formatHoverTime(point.time, props.range)}</small>
            </div>
          ))}
        </div>
      ) : null}
    </figure>
  );
}

function mergeCurrentQuotes(
  current: DashboardState,
  refreshed: CurrentPriceResult,
): DashboardState {
  const bySymbol = new Map(refreshed.quotes.map((quote) => [quote.symbol, quote]));
  const series = current.series.map((item) => {
    const quote = bySymbol.get(item.quote.symbol);
    if (!quote) return item;
    const points = updateLiveEndpoint(
      item.points,
      { time: quote.priceAsOf, price: quote.price },
      item.quote.priceAsOf,
    );
    return { ...item, quote, points };
  });

  return {
    series,
    result: {
      ...current.result,
      quotes: series.map((item) => item.quote),
      errors: refreshed.errors,
      fetchedAt: refreshed.fetchedAt,
      provider: refreshed.provider,
    },
  };
}

function updateLiveEndpoint(
  points: PriceSeries["points"],
  next: PriceSeries["points"][number],
  previousQuoteTime: string,
) {
  const last = points.at(-1);
  if (!last) return [next];
  const lastTimestamp = new Date(last.time).getTime();
  const nextTimestamp = new Date(next.time).getTime();
  const previousQuoteTimestamp = new Date(previousQuoteTime).getTime();
  if (lastTimestamp > nextTimestamp) return points;
  if (lastTimestamp === nextTimestamp || lastTimestamp === previousQuoteTimestamp) {
    return [...points.slice(0, -1), next];
  }
  return [...points, next];
}

type ComparisonPoint = PriceSeries["points"][number] & {
  timestamp: number;
  percent: number;
  x: number;
  y: number;
};

type ComparisonLine = {
  series: PriceSeries;
  color: string;
  points: ComparisonPoint[];
  path: string;
};

function comparisonGeometry(series: PriceSeries[]) {
  const width = 760;
  const height = 286;
  const plotLeft = 55;
  const plotRight = 750;
  const plotTop = 10;
  const plotBottom = 254;
  const prepared = series
    .map((item) => {
      const valid = item.points
        .map((point) => ({ ...point, timestamp: new Date(point.time).getTime() }))
        .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.timestamp))
        .sort((left, right) => left.timestamp - right.timestamp);
      if (valid.length < 2) return undefined;
      return {
        series: item,
        color: seriesColor(item.quote.symbol),
        points: valid,
      };
    })
    .filter((line): line is NonNullable<typeof line> => Boolean(line));
  if (!prepared.length) return undefined;

  const commonStart = Math.max(...prepared.map((line) => line.points[0]!.timestamp));
  const normalized = prepared
    .map((line) => {
      const overlapping = line.points.filter((point) => point.timestamp >= commonStart);
      const comparable = overlapping.length >= 2 ? overlapping : line.points;
      const baseline = comparable[0]?.price;
      if (!baseline) return undefined;
      return {
        series: line.series,
        color: line.color,
        points: comparable.map((point) => ({
          ...point,
          percent: ((point.price / baseline) - 1) * 100,
        })),
      };
    })
    .filter((line): line is NonNullable<typeof line> => Boolean(line));
  if (!normalized.length) return undefined;

  const timestamps = normalized.flatMap((line) => line.points.map((point) => point.timestamp));
  const percentages = normalized.flatMap((line) => line.points.map((point) => point.percent));
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const rawMin = Math.min(0, ...percentages);
  const rawMax = Math.max(0, ...percentages);
  const padding = Math.max((rawMax - rawMin) * 0.1, 0.2);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const span = max - min || 1;
  const timeSpan = maxTime - minTime || 1;
  const lines: ComparisonLine[] = normalized.map((line) => {
    const points = line.points.map((point) => ({
      ...point,
      x: plotLeft + ((point.timestamp - minTime) / timeSpan) * (plotRight - plotLeft),
      y: plotBottom - ((point.percent - min) / span) * (plotBottom - plotTop),
    }));
    return {
      ...line,
      points,
      path: points
        .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
        .join(" "),
    };
  });
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    value: max - ratio * span,
    y: plotTop + ratio * (plotBottom - plotTop),
  }));

  return {
    width,
    height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    minTime,
    maxTime,
    lines,
    yTicks,
  };
}

function nearestPoint(points: ComparisonPoint[], timestamp: number): ComparisonPoint {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((points[middle]?.timestamp ?? timestamp) < timestamp) low = middle + 1;
    else high = middle;
  }
  const next = points[low] ?? points[0]!;
  const previous = points[Math.max(0, low - 1)] ?? next;
  return Math.abs(previous.timestamp - timestamp) <= Math.abs(next.timestamp - timestamp)
    ? previous
    : next;
}

function seriesColor(symbol: string): string {
  let hash = 2_166_136_261;
  for (const character of symbol.toLocaleUpperCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  const hue = hash % 360;
  const saturation = 64 + ((hash >>> 8) % 3) * 7;
  const lightness = 43 + ((hash >>> 16) % 3) * 5;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-label="Loading price charts">
      <span />
      <span />
      <span />
    </div>
  );
}

function freshnessLabel(quote: PriceQuote): string {
  if (quote.isRealtime === true && quote.freshness === "fresh") return "Real-time";
  if (quote.isRealtime === false) return "Delayed";
  if (quote.freshness === "market-closed") return "Market closed";
  if (quote.freshness === "fresh") return "Fresh";
  if (quote.freshness === "delayed-or-inactive") return "May be delayed";
  return "Stale";
}

function formatMoney(value: number, currency: string, precision: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: Math.min(precision, 4),
      maximumFractionDigits: Math.min(precision, 4),
    }).format(value);
  } catch {
    return `${value.toFixed(Math.min(precision, 4))} ${currency}`;
  }
}

function formatPercent(value: number | undefined): string {
  if (value === undefined) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatRelativePercent(value: number): string {
  if (Math.abs(value) < 0.005) return "0.00%";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatUpdatedTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatQuoteTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function formatAxisTime(value: string | undefined, range: PriceRange): string {
  if (!value) return "";
  const date = new Date(value);
  if (range === "1D") {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatHoverTime(value: string, range: PriceRange): string {
  const date = new Date(value);
  if (range === "1D" || range === "5D") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}
