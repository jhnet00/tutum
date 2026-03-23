"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  type AreaData,
  type CandlestickData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useTheme } from "next-themes";
import { LineChart, BarChart3 } from "lucide-react";
import type { ChartAsset } from "@/lib/types/chart-asset";
import { formatPercent } from "@/lib/types/chart-asset";

type Timeframe = "1D" | "1W" | "1M" | "1Y";

const TIMEFRAMES: Timeframe[] = ["1D", "1W", "1M", "1Y"];
const WS_RECONNECT_MS = 2000;
const HISTORY_LIMIT = 200;
const WS_PUSH_INTERVAL_MS = 5000;

const FX_RATE = {
  USD: 1450,
  JPY: 9.5,
  CNY: 200,
  EUR: 1550,
} as const;

type CandlePoint = {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
};

function toBackendTimeframe(tf: Timeframe): string {
  if (tf === "1W") return "W";
  if (tf === "1M") return "M";
  if (tf === "1Y") return "Y";
  return "D";
}

function isIntraday(tf: Timeframe): boolean {
  void tf;
  return false;
}

function intradayBucketSeconds(tf: Timeframe): number {
  void tf;
  return 0;
}

function normalizeSymbol(raw: string): string {
  return String(raw || "").replace("KRW-", "").trim().toUpperCase();
}

function buildWsBaseUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const parsed = new URL(apiUrl);
    return `${parsed.protocol === "https:" ? "wss:" : "ws:"}//${parsed.host}`;
  } catch {
    if (typeof window !== "undefined") {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${window.location.host}`;
    }
    return "ws://localhost:8000";
  }
}

function parseTime(raw: unknown): Date | null {
  if (typeof raw === "number") return new Date(raw * 1000);
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (raw && typeof raw === "object" && "year" in (raw as any) && "month" in (raw as any) && "day" in (raw as any)) {
    const y = Number((raw as any).year);
    const m = Number((raw as any).month);
    const d = Number((raw as any).day);
    return new Date(Date.UTC(y, m - 1, d));
  }
  return null;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function normalizeHistoryTime(raw: unknown, intraday: boolean): Time {
  const d = parseTime(raw);
  if (intraday) {
    if (d) return Math.floor(d.getTime() / 1000) as UTCTimestamp;
    if (typeof raw === "number") return raw as UTCTimestamp;
    return Math.floor(Date.now() / 1000) as UTCTimestamp;
  }
  if (typeof raw === "string" && raw.includes("T")) return raw.split("T")[0] as Time;
  if (d) return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` as Time;
  return String(raw || "") as Time;
}

function resolveFxRate(asset: ChartAsset): number {
  if (asset.kind === "crypto") return 1;
  const country = String(asset.country || "").trim().toUpperCase();
  if (!country || ["KR", "KOR", "KOREA"].includes(country)) return 1;
  if (["US", "USA"].includes(country)) return FX_RATE.USD;
  if (["JP", "JPN"].includes(country)) return FX_RATE.JPY;
  if (["CN", "CHN"].includes(country)) return FX_RATE.CNY;
  if (["EU", "EUR", "DE", "FR", "IT", "ES"].includes(country)) return FX_RATE.EUR;
  return 1;
}

function resolveChartFxRate(asset: ChartAsset, rows: Array<{ close: number }>): number {
  const baseRate = resolveFxRate(asset);
  if (asset.kind === "crypto") return baseRate;

  const country = String(asset.country || "").trim().toUpperCase();
  if (!country || ["KR", "KOR", "KOREA"].includes(country)) return baseRate;

  const latestClose = Number(rows[rows.length - 1]?.close ?? 0);
  const currentPrice = Number(asset.price ?? 0);
  if (Number.isFinite(latestClose) && latestClose > 0 && Number.isFinite(currentPrice) && currentPrice > 0) {
    return currentPrice / latestClose;
  }

  return baseRate;
}

function buildFallbackRows(prices: number[]): CandlePoint[] {
  const now = new Date();
  return prices.map((close, index) => {
    const previous = index > 0 ? prices[index - 1] : close;
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (prices.length - index - 1)));
    const high = Math.max(previous, close);
    const low = Math.min(previous, close);
    return {
      time: `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}` as Time,
      open: previous,
      high,
      low,
      close,
    };
  });
}

function isLikelyBrokenHistory(asset: ChartAsset, rows: CandlePoint[]): boolean {
  if (rows.length < 2) return true;

  const latest = Number(rows[rows.length - 1]?.close ?? 0);
  const current = Number(asset.price ?? 0);
  if (!Number.isFinite(latest) || latest <= 0) return true;
  if (!Number.isFinite(current) || current <= 0) return false;

  if (asset.kind === "crypto") {
    const ratio = latest / current;
    return !(0.85 <= ratio && ratio <= 1.15);
  }

  const country = String(asset.country || "").trim().toUpperCase();
  if (["KR", "KOR", "KOREA"].includes(country) || /^\d{6}$/.test(asset.symbol)) {
    if (current > 10000 && latest < 1000) return true;
    const ratio = latest / current;
    return !(0.85 <= ratio && ratio <= 1.15);
  }

  const fx = current / latest;
  return !(900 <= fx && fx <= 1800);
}

function formatTimeAxisLabel(time: unknown, timeframe: Timeframe): string {
  const d = parseTime(time);
  if (!d) return "";
  if (isIntraday(timeframe)) return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  if (timeframe === "1D" || timeframe === "1W") return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  if (timeframe === "1M") return `${d.getUTCFullYear()}.${pad2(d.getUTCMonth() + 1)}`;
  if (timeframe === "1Y") return `${d.getUTCFullYear()}`;
  return `${d.getUTCFullYear()}.${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())}`;
}

function formatCrosshairLabel(time: unknown, timeframe: Timeframe): string {
  const d = parseTime(time);
  if (!d) return "";
  if (isIntraday(timeframe)) {
    return `${d.getUTCFullYear()}.${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
  if (timeframe === "1M") return `${d.getUTCFullYear()}.${pad2(d.getUTCMonth() + 1)}`;
  if (timeframe === "1Y") return `${d.getUTCFullYear()}`;
  return `${d.getUTCFullYear()}.${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())}`;
}

interface AdvancedChartProps {
  selectedAsset: ChartAsset;
}

export default function AdvancedChart({ selectedAsset }: AdvancedChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const historyRef = useRef<CandlePoint[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { theme } = useTheme();
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const [chartType, setChartType] = useState<"area" | "candle">("area");
  const [noDataMessage, setNoDataMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const dark = theme === "dark";
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: dark ? "#000000" : "#ffffff" },
        textColor: dark ? "#a1a1aa" : "#71717a",
        attributionLogo: false,
      },
      localization: {
        locale: "ko-KR",
        timeFormatter: (time: unknown) => formatCrosshairLabel(time, timeframe),
      },
      grid: {
        vertLines: { color: dark ? "#18181b" : "#f4f4f5" },
        horzLines: { color: dark ? "#18181b" : "#f4f4f5" },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      timeScale: {
        borderVisible: false,
        timeVisible: isIntraday(timeframe),
        secondsVisible: false,
        tickMarkFormatter: (time: unknown) => formatTimeAxisLabel(time, timeframe),
      },
      rightPriceScale: { borderVisible: false },
    });

    chartRef.current = chart;

    if (chartType === "area") {
      areaSeriesRef.current = chart.addAreaSeries({
        lineColor: "#d946ef",
        topColor: dark ? "rgba(217,70,239,0.38)" : "rgba(217,70,239,0.24)",
        bottomColor: "rgba(217,70,239,0.02)",
        lineWidth: 2,
      });
      candleSeriesRef.current = null;
    } else {
      candleSeriesRef.current = chart.addCandlestickSeries({
        upColor: "#d946ef",
        downColor: "#71717a",
        borderUpColor: "#d946ef",
        borderDownColor: "#71717a",
        wickUpColor: "#d946ef",
        wickDownColor: "#71717a",
      });
      areaSeriesRef.current = null;
    }

    const onResize = () => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      areaSeriesRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [theme, timeframe, chartType]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function fetchHistory() {
      if (!chartRef.current) return;
      historyRef.current = [];
      setNoDataMessage(null);

      const isCrypto = selectedAsset.kind === "crypto";
      const marketType = isCrypto ? "crypto" : "stock";
      const symbol = isCrypto ? `KRW-${selectedAsset.symbol}` : selectedAsset.symbol;
      const tf = toBackendTimeframe(timeframe);
      const intraday = ["1", "5", "60"].includes(tf);

      try {
        const url = `/api/proxy/api/v1/market/history/${marketType}/${symbol}?timeframe=${tf}&count=200`;
        const res = await fetch(url, { signal: controller.signal });
        if (!active) return;
        if (!res.ok) throw new Error(`history fetch failed: ${res.status}`);

        const payload = await res.json();
        const apiRows = (payload?.history ?? []).map((row: any) => ({
          time: normalizeHistoryTime(row?.date, intraday),
          open: Number(row?.open || 0),
          high: Number(row?.high || 0),
          low: Number(row?.low || 0),
          close: Number(row?.close || 0),
        }));
        const fallbackRows = Array.isArray(selectedAsset.history) && selectedAsset.history.length > 1
          ? buildFallbackRows(selectedAsset.history)
          : [];
        const rawRows = isLikelyBrokenHistory(selectedAsset, apiRows) && fallbackRows.length > 1 ? fallbackRows : apiRows;
        const fx = resolveChartFxRate(selectedAsset, rawRows);
        const rows: CandlePoint[] = rawRows.map((row) => ({
          time: row.time,
          open: row.open * (isCrypto ? 1 : fx),
          high: row.high * (isCrypto ? 1 : fx),
          low: row.low * (isCrypto ? 1 : fx),
          close: row.close * (isCrypto ? 1 : fx),
        }));

        historyRef.current = rows;
        if (rows.length === 0) {
          setNoDataMessage(typeof payload?.message === "string" ? payload.message : "차트 데이터가 없습니다.");
          if (areaSeriesRef.current) areaSeriesRef.current.setData([]);
          if (candleSeriesRef.current) candleSeriesRef.current.setData([]);
          return;
        }

        if (chartType === "area" && areaSeriesRef.current) {
          const areaData: AreaData<Time>[] = rows.map((row) => ({ time: row.time, value: row.close }));
          areaSeriesRef.current.setData(areaData);
        } else if (chartType === "candle" && candleSeriesRef.current) {
          candleSeriesRef.current.setData(rows as CandlestickData<Time>[]);
        }
        chartRef.current?.timeScale().fitContent();
      } catch (error) {
        if (!active) return;
        console.error("history fetch failed:", error);
        setNoDataMessage("차트 데이터를 불러오지 못했습니다.");
      }
    }

    fetchHistory();
    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedAsset, timeframe, chartType]);

  useEffect(() => {
    if (!isIntraday(timeframe)) {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
      return;
    }

    const symbol = normalizeSymbol(selectedAsset.symbol);
    const tfStep = intradayBucketSeconds(timeframe);
    let cancelled = false;

    const applyLivePrice = (rawPrice: number) => {
      if (!Number.isFinite(rawPrice) || rawPrice <= 0 || historyRef.current.length === 0) return;
      if (!chartRef.current) return;

      const rows = [...historyRef.current];
      const lastIdx = rows.length - 1;
      const last = rows[lastIdx];
      let next: CandlePoint = {
        ...last,
        high: Math.max(last.high, rawPrice),
        low: Math.min(last.low, rawPrice),
        close: rawPrice,
      };

      if (tfStep > 0 && typeof last.time === "number") {
        const nowSec = Math.floor(Date.now() / 1000);
        const bucket = Math.floor(nowSec / tfStep) * tfStep;
        if (bucket > last.time) {
          next = {
            time: bucket as UTCTimestamp,
            open: last.close,
            high: Math.max(last.close, rawPrice),
            low: Math.min(last.close, rawPrice),
            close: rawPrice,
          };
          rows.push(next);
          if (rows.length > HISTORY_LIMIT) rows.shift();
          if (chartType === "area" && areaSeriesRef.current) {
            areaSeriesRef.current.setData(rows.map((r) => ({ time: r.time, value: r.close })));
          } else if (chartType === "candle" && candleSeriesRef.current) {
            candleSeriesRef.current.setData(rows as CandlestickData<Time>[]);
          }
          historyRef.current = rows;
          return;
        }
      }

      rows[lastIdx] = next;
      historyRef.current = rows;
      if (chartType === "area" && areaSeriesRef.current) {
        areaSeriesRef.current.update({ time: next.time, value: next.close });
      } else if (chartType === "candle" && candleSeriesRef.current) {
        candleSeriesRef.current.update(next);
      }
    };

    const connect = () => {
      if (cancelled || wsRef.current) return;
      const wsBase = buildWsBaseUrl();
      const url = `${wsBase}/api/v1/market/ws?symbols=${encodeURIComponent(symbol)}&interval_ms=${WS_PUSH_INTERVAL_MS}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type !== "prices" || !Array.isArray(payload?.items)) return;
          const item = payload.items.find((row: any) => normalizeSymbol(row?.symbol || row?.code || row?.ticker) === symbol);
          if (!item || item.error) return;
          applyLivePrice(Number(item.price || 0));
        } catch {
          // Ignore malformed frames
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!cancelled) reconnectTimerRef.current = setTimeout(connect, WS_RECONNECT_MS);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
    };
  }, [selectedAsset.symbol, timeframe, chartType]);

  const positive = selectedAsset.isPositive ?? (selectedAsset.changePercent ?? 0) >= 0;

  return (
    <div className="flex h-full flex-col bg-white transition-colors duration-300 dark:bg-black">
      <div className="no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto border-b border-zinc-200 bg-zinc-50/50 px-4 py-2 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">
        <div className="mr-2 flex w-auto shrink-0 items-center gap-2 md:mr-4 md:w-[180px]">
          <span className="whitespace-nowrap text-sm font-black tracking-tighter text-zinc-900 dark:text-white md:text-lg">
            {/^\d{6}$/.test(selectedAsset.symbol) ? selectedAsset.name : selectedAsset.symbol}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] md:text-xs ${positive
              ? "bg-fuchsia-500/10 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-200"
              : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
          >
            {formatPercent(selectedAsset.changePercent)}
          </span>
        </div>

        <div className="mx-2 h-4 w-[1px] shrink-0 bg-zinc-200 dark:bg-zinc-700" />

        <div className="flex shrink-0 rounded-lg bg-zinc-200 p-0.5 dark:bg-zinc-800">
          <button
            onClick={() => setChartType("area")}
            className={`rounded-md p-1.5 transition-all ${chartType === "area"
              ? "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 text-white shadow-sm"
              : "text-zinc-400 hover:text-fuchsia-600 dark:hover:text-fuchsia-200"
              }`}
          >
            <LineChart className="h-4 w-4" />
          </button>
          <button
            onClick={() => setChartType("candle")}
            className={`rounded-md p-1.5 transition-all ${chartType === "candle"
              ? "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 text-white shadow-sm"
              : "text-zinc-400 hover:text-fuchsia-600 dark:hover:text-fuchsia-200"
              }`}
          >
            <BarChart3 className="h-4 w-4" />
          </button>
        </div>

        <div className="mx-2 h-4 w-[1px] shrink-0 bg-zinc-200 dark:bg-zinc-700" />

        <div className="flex shrink-0 gap-1 font-semibold">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`whitespace-nowrap rounded px-2 py-1 text-[11px] transition-colors ${timeframe === tf
                ? "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 text-white shadow-sm"
                : "hover:bg-fuchsia-500/10 hover:text-fuchsia-600 dark:hover:bg-fuchsia-500/10 dark:hover:text-fuchsia-200"
                }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="relative w-full flex-1">
        <div ref={chartContainerRef} className="absolute inset-0" />
        {noDataMessage && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <div className="rounded-md border border-zinc-700/60 bg-black/40 px-4 py-2 text-sm font-medium text-zinc-300">{noDataMessage}</div>
          </div>
        )}
      </div>
    </div>
  );
}
