"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BrainCircuit,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudRain,
  CloudSun,
  Hash,
  Loader2,
  RefreshCcw,
  Settings2,
  Snowflake,
  Sparkles,
  SunMedium,
  TrendingUp,
} from "lucide-react";

import AssetAllocationChart from "@/components/AssetAllocationChart";
import PersonalizedNewsCarousel from "@/components/PersonalizedNewsCarousel";
import PortfolioHeatmap from "@/components/PortfolioHeatmap";
import { TopAssetsChartCard, TrendChartCard } from "@/components/PortfolioDashboardCharts";
import EmptyPortfolioState from "@/components/dashboard/EmptyPortfolioState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { HoldingAsset } from "@/context/AssetContext";

type DashboardInsightsResponse = {
  generatedAt: string;
  cacheHit: boolean;
  holdingsState: "ready" | "empty" | "error";
  insights: {
    forecast: {
      level: "얼음" | "비" | "흐림" | "맑음" | "아주 맑음";
      title: string;
      summary: string;
      bullets: string[];
    };
    cards: Array<{
      id: string;
      title: string;
      body: string;
      tone: "positive" | "neutral" | "caution";
    }>;
    hashtags: string[];
    topMovers: Array<{
      symbol: string;
      name: string;
      rank: 1 | 2 | 3;
      profitPercent: number;
    }>;
    marketContext: {
      recommendedAssets: string[];
      recommendedKeywords: string[];
      newsCount: number;
    };
  };
};

type MarketIndexItem = {
  id: string;
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  currency: string;
  marketStatus: "open" | "closed" | "unknown";
  updatedAt: string | null;
  stale: boolean;
  available: boolean;
  source: "yahoo" | "cache" | "last_good" | "error";
};

type MarketIndicesResponse = {
  generatedAt: string;
  items: MarketIndexItem[];
};

type Props = {
  holdings: HoldingAsset[];
  isLoading: boolean;
  error: string | null;
};

type ChartItem = {
  symbol: string;
  name: string;
  value: number;
  color: string;
  changePercent: number;
};

const CHART_COLORS = ["#7c3aed", "#d946ef", "#2563eb", "#0f766e", "#f59e0b", "#e11d48", "#8b5cf6", "#14b8a6"];
const DEFAULT_CANVAS_ORDER = ["heatmap", "topAssets", "trend", "keywords", "market", "signal"];
const MARKET_CACHE_KEY = "tutum_market_indices_cache";
const FALLBACK_MARKET_INDICES: MarketIndexItem[] = [
  { id: "kospi", symbol: "KOSPI", name: "코스피", price: 2642.18, changePercent: 0.82, currency: "KRW", marketStatus: "closed", updatedAt: null, stale: true, available: true, source: "last_good" },
  { id: "sp500", symbol: "S&P 500", name: "S&P 500", price: 5124.61, changePercent: 0.47, currency: "USD", marketStatus: "closed", updatedAt: null, stale: true, available: true, source: "last_good" },
  { id: "nasdaq", symbol: "NASDAQ", name: "NASDAQ", price: 16084.22, changePercent: -0.18, currency: "USD", marketStatus: "closed", updatedAt: null, stale: true, available: true, source: "last_good" },
];
const TOP_LIST_META = {
  winners: { label: "상승률" },
  losers: { label: "하락률" },
  holdings: { label: "보유 규모" },
} as const;
const FORECAST_VISUALS = {
  "얼음": { Icon: Snowflake, shell: "from-slate-900 via-violet-900 to-fuchsia-950", badge: "빙결 경보", bullet: "bg-cyan-200" },
  "비": { Icon: CloudRain, shell: "from-slate-900 via-purple-900 to-fuchsia-900", badge: "보수적 운영", bullet: "bg-fuchsia-200" },
  "흐림": { Icon: Cloud, shell: "from-zinc-900 via-violet-900 to-slate-950", badge: "관망 구간", bullet: "bg-violet-200" },
  "맑음": { Icon: CloudSun, shell: "from-violet-900 via-fuchsia-800 to-pink-700", badge: "무난한 흐름", bullet: "bg-pink-100" },
  "아주 맑음": { Icon: SunMedium, shell: "from-fuchsia-700 via-purple-700 to-violet-900", badge: "수익 주도", bullet: "bg-amber-100" },
} as const;

const FORECAST_PREVIEW_ORDER: DashboardInsightsResponse["insights"]["forecast"][] = [
  {
    level: "얼음",
    title: "리스크 관리가 우선인 구간",
    summary: "손실 자산 비중이 높아 추가 진입보다 구조 점검이 필요한 흐름입니다.",
    bullets: ["손실 자산 비중 축소", "현금 여력 확보", "추가 매수보다 분산 재점검"],
  },
  {
    level: "비",
    title: "방어적으로 접근할 시점",
    summary: "과도한 확장보다 현재 보유 자산의 집중도와 변동성을 정리하는 편이 유리합니다.",
    bullets: ["변동성 높은 종목 점검", "뉴스 이벤트 확인", "현금 비중 보강"],
  },
  {
    level: "흐림",
    title: "관망이 필요한 중립 구간",
    summary: "추세는 유지되지만 확신은 약합니다. 포지션을 키우기보다 균형을 보는 편이 낫습니다.",
    bullets: ["상위 자산 집중도 확인", "분할 대응 유지", "급격한 비중 변경 자제"],
  },
  {
    level: "맑음",
    title: "무리 없는 상승 흐름",
    summary: "상위 수익 자산이 포트폴리오를 끌고 있습니다. 이익 보존과 리밸런싱이 핵심입니다.",
    bullets: ["상위 수익 자산 추세 유지", "현금 비중 무난", "분산 상태 양호"],
  },
  {
    level: "아주 맑음",
    title: "강한 수익 주도 구간",
    summary: "상위 자산 성과가 뚜렷합니다. 무리한 확장보다 이익을 지키는 운영이 더 중요합니다.",
    bullets: ["1위 수익 자산 주도", "과열 비중 점검", "이익 실현 계획 병행"],
  },
];

function formatWon(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatIndexPrice(value: number | null, currency: string) {
  if (value === null) return "Not available";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);
}

function buildFallbackInsights(holdings: HoldingAsset[]): DashboardInsightsResponse {
  const investmentHoldings = holdings.filter((item) => item.assetType !== "cash");

  if (investmentHoldings.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      cacheHit: false,
      holdingsState: "empty",
      insights: {
        forecast: {
          level: "흐림",
          title: "자산을 등록하면 분석이 시작됩니다",
          summary: "보유 자산이 있어야 AI 인사이트, forecast, 키워드가 함께 활성화됩니다.",
          bullets: ["자산 quota 활성화", "AI 인사이트 생성", "개인화 뉴스 추천 시작"],
        },
        cards: [],
        hashtags: [],
        topMovers: [],
        marketContext: { recommendedAssets: [], recommendedKeywords: [], newsCount: 0 },
      },
    };
  }

  const totalEvaluation = investmentHoldings.reduce((sum, item) => sum + item.value, 0);
  const totalInvested = investmentHoldings.reduce((sum, item) => sum + item.averagePrice * item.amount, 0);
  const totalProfit = totalEvaluation - totalInvested;
  const profitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  const positiveCount = investmentHoldings.filter((item) => item.profitPercent >= 0).length;
  const negativeCount = investmentHoldings.filter((item) => item.profitPercent < 0).length;
  const cashValue = holdings.filter((item) => item.assetType === "cash").reduce((sum, item) => sum + item.value, 0);
  const cashShare = totalEvaluation + cashValue > 0 ? (cashValue / (totalEvaluation + cashValue)) * 100 : 0;

  const forecast =
    profitRate >= 18 ? FORECAST_PREVIEW_ORDER[4] :
    profitRate >= 7 ? FORECAST_PREVIEW_ORDER[3] :
    profitRate >= 0 ? FORECAST_PREVIEW_ORDER[2] :
    profitRate >= -8 ? FORECAST_PREVIEW_ORDER[1] :
    FORECAST_PREVIEW_ORDER[0];

  const topMovers = [...investmentHoldings]
    .sort((left, right) => right.profitPercent - left.profitPercent)
    .slice(0, 3)
    .map((item, index) => ({
      symbol: item.symbol,
      name: item.name,
      rank: (index + 1) as 1 | 2 | 3,
      profitPercent: Number(item.profitPercent.toFixed(2)),
    }));

  const hashtags = [
    topMovers[0] ? `#${topMovers[0].symbol}주도` : null,
    investmentHoldings.length >= 4 ? "#분산유지" : "#집중포지션",
    cashShare >= 15 ? "#현금완충" : "#현금낮음",
    negativeCount >= positiveCount ? "#손실관리" : "#수익우세",
    ...investmentHoldings.slice(0, 3).map((item) => `#${(item.name || item.symbol).replace(/\s+/g, "")}`),
  ].filter(Boolean) as string[];

  return {
    generatedAt: new Date().toISOString(),
    cacheHit: false,
    holdingsState: "ready",
    insights: {
      forecast,
      cards: [
        {
          id: "fallback-1",
          title: "상위 수익 자산 흐름",
          body: topMovers[0]
            ? `${topMovers[0].name}이 현재 수익률 상단을 이끌고 있습니다. 1등 자산의 추세 유지 여부를 먼저 체크하는 편이 좋습니다.`
            : "상위 수익 자산을 계산할 데이터가 아직 충분하지 않습니다.",
          tone: "positive",
        },
        {
          id: "fallback-2",
          title: "포지션 균형",
          body: `수익 자산 ${positiveCount}개, 손실 자산 ${negativeCount}개입니다. ${negativeCount > positiveCount ? "손실 포지션 정리가 우선입니다." : "수익 우위 구간이 유지되고 있습니다."}`,
          tone: negativeCount > positiveCount ? "caution" : "neutral",
        },
        {
          id: "fallback-3",
          title: "현금 여력",
          body: `현금 비중은 ${cashShare.toFixed(1)}%입니다. ${cashShare < 5 ? "대응 여력이 낮으니 추가 진입은 신중하게 보는 편이 낫습니다." : "완충 여력은 무난한 편입니다."}`,
          tone: cashShare < 5 ? "caution" : "neutral",
        },
      ],
      hashtags: hashtags.slice(0, 8),
      topMovers,
      marketContext: {
        recommendedAssets: investmentHoldings.slice(0, 3).map((item) => item.symbol),
        recommendedKeywords: hashtags.map((tag) => tag.replace(/^#/, "")).slice(0, 4),
        newsCount: 0,
      },
    },
  };
}

function toneClass(tone: "positive" | "neutral" | "caution") {
  if (tone === "positive") return "border-emerald-200/70 bg-emerald-50/80 dark:border-emerald-400/20 dark:bg-emerald-500/10";
  if (tone === "caution") return "border-amber-200/70 bg-amber-50/80 dark:border-amber-400/20 dark:bg-amber-500/10";
  return "border-zinc-200/70 bg-zinc-50/80 dark:border-white/10 dark:bg-white/5";
}

export default function PortfolioOverviewDashboard({ holdings, isLoading, error }: Props) {
  const [dashboardData, setDashboardData] = useState<DashboardInsightsResponse | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [marketIndices, setMarketIndices] = useState<MarketIndexItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [forecastPreviewIndex, setForecastPreviewIndex] = useState(0);
  const [marketRefreshKey, setMarketRefreshKey] = useState(0);
  const [isCanvasEditMode, setIsCanvasEditMode] = useState(false);
  const [canvasOrder, setCanvasOrder] = useState<string[]>(DEFAULT_CANVAS_ORDER);
  const [topListMode, setTopListMode] = useState<"winners" | "losers" | "holdings">("winners");

  const investmentHoldings = useMemo(() => holdings.filter((item) => item.assetType !== "cash"), [holdings]);
  const cashValue = useMemo(
    () => holdings.filter((item) => item.assetType === "cash").reduce((sum, item) => sum + item.value, 0),
    [holdings],
  );
  const investmentEvaluation = useMemo(
    () => investmentHoldings.reduce((sum, item) => sum + item.value, 0),
    [investmentHoldings],
  );
  const totalInvested = useMemo(
    () => investmentHoldings.reduce((sum, item) => sum + item.averagePrice * item.amount, 0),
    [investmentHoldings],
  );
  const totalPortfolioValue = investmentEvaluation + cashValue;
  const totalProfit = investmentEvaluation - totalInvested;
  const profitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  const positiveCount = investmentHoldings.filter((item) => item.profitPercent >= 0).length;
  const negativeCount = investmentHoldings.filter((item) => item.profitPercent < 0).length;
  const chartData = useMemo<ChartItem[]>(
    () =>
      investmentHoldings
        .map((item, index) => ({
          symbol: item.symbol,
          name: item.name,
          value: item.value,
          color: CHART_COLORS[index % CHART_COLORS.length],
          changePercent: item.changePercent,
        }))
        .sort((left, right) => right.value - left.value),
    [investmentHoldings],
  );
  const keywordSeed = useMemo(() => investmentHoldings.map((item) => item.name || item.symbol), [investmentHoldings]);
  const fallbackDashboard = useMemo(() => buildFallbackInsights(holdings), [holdings]);
  const activeDashboard = dashboardData ?? fallbackDashboard;
  const holdingsState = activeDashboard.holdingsState;
  const activeForecasts = useMemo(() => {
    const merged = [activeDashboard.insights.forecast];
    FORECAST_PREVIEW_ORDER.forEach((item) => {
      if (item.level !== activeDashboard.insights.forecast.level) merged.push(item);
    });
    return merged;
  }, [activeDashboard]);
  const forecast = process.env.NODE_ENV === "production"
    ? activeDashboard.insights.forecast
    : activeForecasts[forecastPreviewIndex % activeForecasts.length];
  const topListMeta = TOP_LIST_META[topListMode];
  const topListRows = useMemo(() => {
    const base = [...investmentHoldings];

    if (topListMode === "losers") {
      return base.sort((left, right) => left.profitPercent - right.profitPercent).slice(0, 3).map((item, index) => ({
        rank: index + 1,
        symbol: item.symbol,
        name: item.name,
        metricValue: item.profitPercent,
        isCurrency: false,
      }));
    }

    if (topListMode === "holdings") {
      return base.sort((left, right) => right.value - left.value).slice(0, 3).map((item, index) => ({
        rank: index + 1,
        symbol: item.symbol,
        name: item.name,
        metricValue: item.value,
        isCurrency: true,
      }));
    }

    return base.sort((left, right) => right.profitPercent - left.profitPercent).slice(0, 3).map((item, index) => ({
      rank: index + 1,
      symbol: item.symbol,
      name: item.name,
      metricValue: item.profitPercent,
      isCurrency: false,
    }));
  }, [investmentHoldings, topListMode]);
  const forecastVisual = FORECAST_VISUALS[forecast.level];

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("tutum_overview_canvas_order");
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as string[];
      const isValid =
        Array.isArray(parsed) &&
        parsed.length === DEFAULT_CANVAS_ORDER.length &&
        DEFAULT_CANVAS_ORDER.every((item) => parsed.includes(item));

      if (isValid) {
        setCanvasOrder(parsed);
      }
    } catch (storageError) {
      console.error("Failed to parse canvas order:", storageError);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("tutum_overview_canvas_order", JSON.stringify(canvasOrder));
  }, [canvasOrder]);

  const moveCanvasWidget = (widgetId: string, direction: -1 | 1) => {
    setCanvasOrder((current) => {
      const index = current.indexOf(widgetId);
      if (index === -1) return current;

      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;

      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;

    const loadDashboardInsights = async () => {
      if (investmentHoldings.length === 0) {
        setDashboardData(null);
        setDashboardError(null);
        setDashboardLoading(false);
        return;
      }

      try {
        setDashboardLoading(true);
        setDashboardError(null);
        const response = await fetch("/api/proxy/api/v1/portfolio/dashboard-insights", {
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) throw new Error(`dashboard insights fetch failed: ${response.status}`);
        const payload = (await response.json()) as DashboardInsightsResponse;
        if (!cancelled) setDashboardData(payload);
      } catch (fetchError) {
        console.error("Dashboard insights fetch error:", fetchError);
        if (!cancelled) {
          setDashboardData(null);
          setDashboardError("dashboard_insights_unavailable");
        }
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    };

    void loadDashboardInsights();
    return () => {
      cancelled = true;
    };
  }, [investmentHoldings.length, holdings]);

  useEffect(() => {
    let cancelled = false;

    const loadMarketIndices = async () => {
      try {
        setMarketLoading(true);
        setMarketError(null);
        const response = await fetch("/api/public/indices", { cache: "no-store" });
        if (!response.ok) throw new Error(`market indices fetch failed: ${response.status}`);
        const payload = (await response.json()) as MarketIndicesResponse;
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (items.length === 0) throw new Error("market indices empty");
        if (!cancelled) {
          setMarketIndices(items);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(items));
          }
        }
      } catch (fetchError) {
        console.error("Market indices fetch error:", fetchError);
        const fallbackItems = (() => {
          if (typeof window === "undefined") return FALLBACK_MARKET_INDICES;
          try {
            const cached = window.localStorage.getItem(MARKET_CACHE_KEY);
            const parsed = cached ? JSON.parse(cached) : null;
            return Array.isArray(parsed) && parsed.length > 0 ? parsed : FALLBACK_MARKET_INDICES;
          } catch {
            return FALLBACK_MARKET_INDICES;
          }
        })();

        if (!cancelled) {
          setMarketIndices(fallbackItems);
          setMarketError("market_indices_fallback");
        }
      } finally {
        if (!cancelled) setMarketLoading(false);
      }
    };

    void loadMarketIndices();
    return () => {
      cancelled = true;
    };
  }, [marketRefreshKey]);

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-[2rem] border border-border/70 bg-card p-8">
        <Loader2 className="h-10 w-10 animate-spin text-fuchsia-500" />
        <p className="text-sm font-semibold text-muted-foreground">포트폴리오를 불러오는 중입니다.</p>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-rose-200/70 bg-rose-50/80 dark:border-rose-400/20 dark:bg-rose-500/10">
        <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-8 w-8 text-rose-500" />
          <p className="text-lg font-black text-foreground">데이터를 불러오지 못했습니다</p>
          <p className="max-w-lg text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const renderCanvasWidget = (widgetId: string) => {
    switch (widgetId) {
      case "heatmap":
        return holdingsState !== "ready" || chartData.length === 0 ? (
          <EmptyPortfolioState
            title={holdingsState === "error" ? "히트맵을 불러오지 못했습니다" : "자산을 등록해주세요"}
            description={
              holdingsState === "error"
                ? "데이터가 정상화되면 히트맵이 다시 표시됩니다."
                : "자산을 등록하면 시각화 카드가 함께 활성화됩니다."
            }
          />
        ) : (
          <PortfolioHeatmap data={chartData} />
        );
      case "topAssets":
        return holdingsState !== "ready" || chartData.length === 0 ? <EmptyPortfolioState compact /> : <TopAssetsChartCard data={chartData} />;
      case "trend":
        return holdingsState !== "ready" || chartData.length === 0 ? <EmptyPortfolioState compact /> : <TrendChartCard data={chartData} />;
      case "keywords":
        return (
          <Card className="h-full min-h-[320px] border-border/70 bg-card shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">
                <Hash className="h-4 w-4" />
                포트폴리오 키워드
              </CardTitle>
            </CardHeader>
            <CardContent>
              {holdingsState !== "ready" ? (
                <EmptyPortfolioState compact />
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2.5">
                    {activeDashboard.insights.hashtags.slice(0, 8).map((tag, index) => (
                      <div
                        key={tag}
                        className={`px-1 py-1 text-[15px] font-black tracking-[-0.01em] sm:text-base ${index % 3 === 0
                          ? "text-violet-700 dark:text-zinc-100"
                          : index % 3 === 1
                            ? "text-fuchsia-700 dark:text-zinc-100"
                            : "text-rose-700 dark:text-zinc-100"}`}
                      >
                        {tag}
                      </div>
                    ))}
                  </div>
                  <div className="rounded-[1.3rem] border border-fuchsia-200/70 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-rose-500/10 px-4 py-3 text-sm leading-6 text-muted-foreground dark:border-fuchsia-400/20">
                    오늘 키워드는 <span className="font-black text-foreground">{activeDashboard.insights.hashtags.slice(0, 2).join(" · ") || "#포트폴리오분석"}</span> 중심입니다.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      case "market":
        return (
          <Card className="h-full min-h-[320px] border-border/70 bg-card shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
              <CardTitle className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">
                <TrendingUp className="h-4 w-4" />
                시장 체크
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => setMarketRefreshKey((current) => current + 1)}
              >
                <RefreshCcw className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {marketLoading ? (
                <div className="flex min-h-[160px] items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : marketIndices.length === 0 ? (
                <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 text-center">
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                  <p className="text-sm font-bold text-foreground">지수 데이터를 불러오지 못했습니다.</p>
                  {marketError ? <p className="text-xs text-muted-foreground">실시간 응답이 없으면 마지막 캐시 또는 mock snapshot을 사용합니다.</p> : null}
                </div>
              ) : (
                marketIndices.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-[1.2rem] border border-fuchsia-200/40 bg-gradient-to-r from-violet-500/5 via-fuchsia-500/5 to-transparent px-4 py-3 dark:border-fuchsia-400/15">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-foreground">{item.name}</p>
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{item.symbol}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-foreground">{formatIndexPrice(item.price, item.currency)}</p>
                      <p
                        className={[
                          "text-xs font-black",
                          (item.changePercent ?? 0) > 0 ? "text-fuchsia-600 dark:text-fuchsia-300" : "",
                          (item.changePercent ?? 0) < 0 ? "text-zinc-500 dark:text-zinc-300" : "",
                          (item.changePercent ?? 0) === 0 ? "text-muted-foreground" : "",
                        ].join(" ")}
                      >
                        {item.changePercent === null ? "Not available" : `${item.changePercent > 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        );
      case "signal":
        return (
          <Card className="h-full min-h-[320px] border-border/70 bg-card shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">
                <Sparkles className="h-4 w-4" />
                AI 시그널
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {holdingsState !== "ready" ? (
                <EmptyPortfolioState compact />
              ) : (
                <>
                  <div className="rounded-[1.3rem] border border-border/70 bg-background/75 p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">관심 자산</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeDashboard.insights.marketContext.recommendedAssets.slice(0, 4).map((asset) => (
                        <span key={asset} className="rounded-full bg-fuchsia-500/10 px-3 py-1.5 text-xs font-black text-fuchsia-600 dark:text-fuchsia-200">
                          {asset}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[1.3rem] border border-border/70 bg-background/75 p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">관심 키워드</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeDashboard.insights.marketContext.recommendedKeywords.slice(0, 4).map((keyword) => (
                        <span key={keyword} className="rounded-full px-3 py-1.5 text-xs font-black text-foreground">
                          #{keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[1.3rem] border border-border/70 bg-background/75 px-4 py-3 text-sm text-muted-foreground">
                    연결된 뉴스 수: <span className="font-black text-foreground">{activeDashboard.insights.marketContext.newsCount}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        {dashboardLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {dashboardError ? (
          <Badge variant="outline" className="border-amber-300/60 text-amber-600">
            rule fallback
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="relative overflow-hidden border-border/70 bg-card shadow-none xl:col-span-4">
          <div className="absolute inset-0 opacity-90">
            <div className="absolute -left-10 top-0 h-36 w-36 rounded-full bg-fuchsia-500/10 blur-3xl dark:bg-fuchsia-500/15" />
            <div className="absolute right-0 top-12 h-32 w-32 rounded-full bg-violet-500/10 blur-3xl dark:bg-violet-500/15" />
          </div>
          <CardContent className="relative flex min-h-[298px] flex-col justify-between p-5 md:p-6">
            <div className="space-y-3">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">총손익</p>
              <p className="text-[3rem] font-black leading-none tracking-[-0.05em] md:text-[3.1rem]">
                <span
                  className={
                    totalProfit >= 0
                      ? "bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent dark:from-violet-300 dark:via-fuchsia-300 dark:to-rose-300"
                      : "text-zinc-500 dark:text-zinc-400"
                  }
                >
                  {totalProfit > 0 ? "+" : ""}
                  {Math.round(totalProfit).toLocaleString()}
                </span>
              </p>
              <p className={`text-base font-black ${totalProfit >= 0 ? "text-fuchsia-600 dark:text-fuchsia-200" : "text-zinc-500 dark:text-zinc-400"}`}>
                {profitRate > 0 ? "+" : ""}
                {profitRate.toFixed(2)}%
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="rounded-[1.35rem] border border-border/70 bg-background/75 p-3.5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">포트 가치</p>
                <p className="mt-2 text-lg font-black text-foreground">{formatCompactNumber(totalPortfolioValue)}</p>
              </div>
              <div className="rounded-[1.35rem] border border-border/70 bg-background/75 p-3.5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">수익 자산</p>
                <p className="mt-2 text-lg font-black text-foreground">{positiveCount}</p>
              </div>
              <div className="rounded-[1.35rem] border border-border/70 bg-background/75 p-3.5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">손실 자산</p>
                <p className="mt-2 text-lg font-black text-foreground">{negativeCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card shadow-none xl:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
            <CardTitle className="text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">Top 3 {topListMeta.label}</CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1 rounded-full px-3 text-xs font-black text-muted-foreground">
                  {topListMeta.label}
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem onClick={() => setTopListMode("winners")}>상승률</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTopListMode("losers")}>하락률</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTopListMode("holdings")}>보유 규모</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent className="space-y-3 pb-5">
            {topListRows.length === 0 ? (
              <EmptyPortfolioState compact />
            ) : (
              topListRows.map((item) => (
                <div
                  key={`${item.rank}-${item.symbol}`}
                  className="flex items-center justify-between gap-4 rounded-[1.35rem] border border-border/70 bg-background/70 px-4 py-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="w-10 text-center text-lg font-black tracking-[-0.04em] text-muted-foreground">
                      {String(item.rank).padStart(2, "0")}
                    </div>
                    <div className="min-w-0">
                      <p className={`truncate text-base font-black ${item.rank === 1 ? "text-foreground" : "text-zinc-500 dark:text-zinc-300"}`}>
                        {item.name}
                      </p>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{item.symbol}</p>
                    </div>
                  </div>
                  <div
                    className={[
                      "text-right text-xl font-black tracking-[-0.04em]",
                      item.isCurrency
                        ? "bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent dark:from-violet-300 dark:via-fuchsia-300 dark:to-rose-300"
                        : item.metricValue >= 0
                          ? "bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent dark:from-violet-300 dark:via-fuchsia-300 dark:to-rose-300"
                          : "text-zinc-500 dark:text-zinc-300",
                    ].join(" ")}
                  >
                    {item.isCurrency ? formatCompactNumber(item.metricValue) : `${item.metricValue > 0 ? "+" : ""}${item.metricValue.toFixed(2)}%`}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card shadow-none xl:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">자산 quota</CardTitle>
          </CardHeader>
          <CardContent className="min-h-[298px] px-4 pb-4 md:px-5">
            {holdingsState !== "ready" || chartData.length === 0 ? (
              <EmptyPortfolioState compact />
            ) : (
              <AssetAllocationChart data={chartData} compact />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="border-border/70 bg-card shadow-none xl:col-span-6">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">
              <BrainCircuit className="h-4 w-4" />
              AI 인사이트
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {holdingsState !== "ready" ? (
              <EmptyPortfolioState compact />
            ) : (
              <>
                {activeDashboard.insights.cards.slice(0, 3).map((card) => (
                  <div key={card.id} className={`rounded-[1.4rem] border p-4 ${toneClass(card.tone)}`}>
                    <p className="text-sm font-black text-foreground">{card.title}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{card.body}</p>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2 pt-1">
                  {activeDashboard.insights.hashtags.slice(0, 4).map((tag) => (
                    <div
                      key={tag}
                      className="rounded-full border border-fuchsia-200/70 bg-fuchsia-50 px-3 py-1.5 text-xs font-black text-fuchsia-700 dark:border-fuchsia-400/20 dark:bg-fuchsia-500/10 dark:text-fuchsia-200"
                    >
                      {tag}
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-fuchsia-200/60 bg-card shadow-none xl:col-span-6 dark:border-fuchsia-400/20">
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
            <CardTitle className="text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">AI forecast</CardTitle>
            {process.env.NODE_ENV !== "production" && holdingsState === "ready" ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-fuchsia-500 hover:bg-fuchsia-500/10 hover:text-fuchsia-600"
                onClick={() => setForecastPreviewIndex((current) => current + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {holdingsState !== "ready" ? (
              <EmptyPortfolioState compact />
            ) : (
              <div className="space-y-4">
                <div className={`relative overflow-hidden rounded-[1.7rem] border border-white/10 bg-gradient-to-br ${forecastVisual.shell} p-5 text-white shadow-[0_18px_60px_-28px_rgba(217,70,239,0.75)]`}>
                  <div className="absolute -left-10 top-0 h-32 w-32 rounded-full bg-white/10 blur-3xl" />
                  <div className="absolute bottom-0 right-0 h-28 w-28 rounded-full bg-fuchsia-300/20 blur-3xl" />
                  <div className="relative flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-white/85 backdrop-blur-sm">
                        {forecastVisual.badge}
                      </span>
                      <h3 className="text-4xl font-black tracking-[-0.06em]">{forecast.level}</h3>
                      <p className="text-base font-black text-white/95">{forecast.title}</p>
                    </div>
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/10 backdrop-blur-md">
                      <forecastVisual.Icon className="h-8 w-8 text-white" />
                    </div>
                  </div>
                  <p className="relative mt-4 max-w-xl text-sm leading-6 text-white/80">{forecast.summary}</p>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {forecast.bullets.slice(0, 2).map((item) => (
                    <div key={item} className="flex items-start gap-3 rounded-[1.2rem] border border-fuchsia-200/50 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-transparent px-4 py-3 dark:border-fuchsia-400/20">
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${forecastVisual.bullet}`} />
                      <p className="text-sm font-medium leading-6 text-foreground">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <PersonalizedNewsCarousel keywords={keywordSeed} />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-3 px-1">
          <div className="flex items-center gap-3">
            {isCanvasEditMode ? (
              <p className="text-xs font-medium text-muted-foreground">좌우 버튼으로 카드 순서를 바꿀 수 있습니다.</p>
            ) : null}
            <Button
              variant={isCanvasEditMode ? "default" : "outline"}
              size="sm"
              className="gap-2 rounded-full"
              onClick={() => setIsCanvasEditMode((current) => !current)}
            >
              <Settings2 className="h-4 w-4" />
              {isCanvasEditMode ? "편집 완료" : "위치 편집"}
            </Button>
          </div>
        </div>

        <div className="grid auto-rows-fr gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {canvasOrder.map((widgetId) => (
            <div key={widgetId} className="h-full min-h-[320px]">
              <div className="relative h-full">
                {isCanvasEditMode ? (
                  <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-full bg-background/95"
                      onClick={() => moveCanvasWidget(widgetId, -1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-full bg-background/95"
                      onClick={() => moveCanvasWidget(widgetId, 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
                {renderCanvasWidget(widgetId)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
