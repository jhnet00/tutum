"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, PieChart, BarChart3, ListChecks, Plus, Loader2, LayoutGrid, ChevronDown, Clock, Trophy, Settings2, GripVertical, Check, ChevronLeft, ChevronRight, Activity, ShieldAlert, PieChart as PieChartIcon, Lightbulb, Sparkles, Trash2, Pencil, X, Cloud, CloudRain, CloudSun, Snowflake, SunMedium } from "lucide-react";
import Footer from "@/components/Footer";
import AssetAllocationChart from "@/components/AssetAllocationChart";
import AddAssetModal from "@/components/AddAssetModal";
import { useAsset, HoldingAsset } from "@/contexts/AssetContext";
import PersonalizedNewsCarousel from "@/components/PersonalizedNewsCarousel";
import { TopAssetsChartCard, TrendChartCard } from "@/components/PortfolioDashboardCharts";
import PortfolioHeatmap from "@/components/PortfolioHeatmap";
import PortfolioOverviewDashboard from "@/components/PortfolioOverviewDashboard";
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import Sparkline from "@/components/Sparkline";
import { useEffect } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { motion, Reorder, AnimatePresence } from "framer-motion";
import SellAssetDialog from "@/components/SellAssetDialog";
import AIInsightsModal from "@/components/AIInsightsModal";

// Crafted Boutique Color Palette
const COLORS = [
    "#10B981", // Sage (Positive)
    "#F43F5E", // Soft Rose (Negative)
    "#6366F1", // Indigo
    "#F59E0B", // Amber
    "#8B5CF6", // Violet
    "#06B6D4", // Cyan
    "#EC4899", // Pink
    "#3B82F6"  // Blue
];

export default function PortfolioAssetPage() {
    const { holdings, isLoading, error, priceStreamStatus, updateAsset, deleteAsset, fetchHoldings } = useAsset();
    const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
    const [editValues, setEditValues] = useState<{ average_price: string; quantity: string }>({ average_price: '', quantity: '' });
    const [showAddModal, setShowAddModal] = useState(false);
    const [performanceMetric, setPerformanceMetric] = useState<'best' | 'worst' | 'longest'>('best');
    const [profitPeriod, setProfitPeriod] = useState<'all' | 'weekly' | 'monthly' | 'yearly' | 'loss'>('all');
    const [isEditMode, setIsEditMode] = useState(false);
    const [widgetOrder, setWidgetOrder] = useState<string[]>(['topAssets', 'trend', 'heatmap', 'risk', 'sector', 'idea', 'allocationPulse', 'keywords']);
    const [sellAsset, setSellAsset] = useState<HoldingAsset | null>(null);
    const [showAIInsights, setShowAIInsights] = useState(false);
    const [sellHistorySort, setSellHistorySort] = useState<'latest' | 'oldest' | 'amount'>('latest');
    const [benchmarkIndex, setBenchmarkIndex] = useState(0);

    // 로고 클릭 시 현황 탭으로 리셋
    const [activeTab, setActiveTab] = useState("overview");

    useEffect(() => {
        const handler = () => setActiveTab("overview");
        window.addEventListener("reset-asset-tab", handler);
        return () => window.removeEventListener("reset-asset-tab", handler);
    }, []);

    // Persistence: Load layout settings
    useEffect(() => {
        const savedOrder = localStorage.getItem('tutum_dashboard_order');
        if (savedOrder) {
            try {
                const parsed = JSON.parse(savedOrder) as string[];
                // If the saved order has legacy keys (different count or specific keys), reset to default
                const currentKeys = ['topAssets', 'trend', 'heatmap', 'risk', 'sector', 'idea', 'allocationPulse', 'keywords'];
                const hasLegacyKeys = parsed.some(key => !currentKeys.includes(key)) || parsed.length !== currentKeys.length;
                
                if (hasLegacyKeys) {
                    localStorage.removeItem('tutum_dashboard_order');
                } else {
                    setWidgetOrder(parsed);
                }
            } catch (e) {
                console.error("Failed to parse dashboard order", e);
                localStorage.removeItem('tutum_dashboard_order');
            }
        }
    }, []);

    // Persistence: Save layout settings
    useEffect(() => {
        if (widgetOrder.length > 0) {
            localStorage.setItem('tutum_dashboard_order', JSON.stringify(widgetOrder));
        }
    }, [widgetOrder]);

    useEffect(() => {
        const interval = window.setInterval(() => {
            setBenchmarkIndex((prev) => (prev + 1) % 3);
        }, 5000);
        return () => window.clearInterval(interval);
    }, []);
    const handleStartEdit = (asset: HoldingAsset) => {
        if (!asset.id) return;
        setEditingAssetId(asset.id);
        setEditValues({
            average_price: asset.averagePrice.toString(),
            quantity: asset.amount.toString()
        });
    };

    const handleSaveEdit = async () => {
        if (!editingAssetId) return;
        try {
            await updateAsset(editingAssetId, {
                average_price: Number(editValues.average_price),
                quantity: Number(editValues.quantity)
            });
            setEditingAssetId(null);
        } catch (err) {
            alert("수정 중 오류가 발생했습니다.");
        }
    };

    const moveWidget = (id: string, direction: 'left' | 'right') => {
        const index = widgetOrder.indexOf(id);
        if (index === -1) return;

        const newOrder = [...widgetOrder];
        const nextIndex = direction === 'left' ? index - 1 : index + 1;

        if (nextIndex >= 0 && nextIndex < widgetOrder.length) {
            [newOrder[index], newOrder[nextIndex]] = [newOrder[nextIndex], newOrder[index]];
            setWidgetOrder(newOrder);
        }
    };

    // 투자 자산과 현금 분리
    const investmentHoldings = holdings.filter(h => h.assetType !== "cash");
    const cashHoldings = holdings.filter(h => h.assetType === "cash");
    const totalCashValue = cashHoldings.reduce((acc, curr) => acc + curr.value, 0);

    // Calculate Totals for Header & Overview
    const totalEvaluation = holdings.reduce((acc, curr) => acc + curr.value, 0);
    const totalInvested = holdings.reduce((acc, curr) => acc + (curr.amount * curr.averagePrice), 0);
    const totalProfit = totalEvaluation - totalInvested;
    const profitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

    // Logic for Daily Profit (Mock logic using current 'change' values)
    const dailyProfitRaw = holdings.reduce((acc, curr) => acc + (curr.change * curr.amount), 0);
    const dailyProfitPercent = totalInvested > 0 ? (dailyProfitRaw / totalInvested) * 100 : 0;

    // Calculate real unrealized losses (Sum of only negative positions)
    const unrealizedLosses = holdings.reduce((acc, curr) => {
        const profit = curr.value - (curr.amount * curr.averagePrice);
        return profit < 0 ? acc + profit : acc;
    }, 0);
    const lossRate = totalInvested > 0 ? (unrealizedLosses / totalInvested) * 100 : 0;

    // Multi-period Profit Logic (Mocking with realistic ratios)
    const getProfitData = () => {
        switch(profitPeriod) {
            case 'all': return { label: '총 손익 (전체)', value: totalProfit, rate: profitRate };
            case 'weekly': return { label: '이번 주 수익', value: totalProfit * 0.12, rate: profitRate * 0.1 };
            case 'monthly': return { label: '이번 달 수익', value: totalProfit * 0.45, rate: profitRate * 0.4 };
            case 'yearly': return { label: '이번 년도 수익', value: totalProfit * 0.85, rate: profitRate * 0.8 };
            case 'loss': return { label: '총 손실 (평가손)', value: unrealizedLosses, rate: lossRate };
            default: return { label: '오늘의 수익', value: dailyProfitRaw, rate: dailyProfitPercent };
        }
    };
    const currentProfit = getProfitData();

    // Performance Metrics Logic
    const sortedByProfit = [...holdings].sort((a, b) => b.profitPercent - a.profitPercent);
    const topGainer = sortedByProfit[0];
    const topLoser = sortedByProfit[sortedByProfit.length - 1];
    
    // Mock for longest held (In real app, fetch from transaction history)
    const longestHeld = holdings.length > 0 ? holdings[0] : null;

    const currentPerformanceAsset = 
        performanceMetric === 'best' ? topGainer : 
        performanceMetric === 'worst' ? topLoser : 
        longestHeld;

    const metricTitle = 
        performanceMetric === 'best' ? "최고 수익률" : 
        performanceMetric === 'worst' ? "최저 수익률" : 
        "최장 보유 종목";

    const metricIcon = 
        performanceMetric === 'best' ? <Trophy className="h-3 w-3 text-primary" /> : 
        performanceMetric === 'worst' ? <TrendingDown className="h-3 w-3 text-destructive" /> : 
        <Clock className="h-3 w-3 text-indigo-500" />;

    // Logic for Chart Data
    const chartData = holdings.map((h, i) => ({
        symbol: h.symbol,
        name: h.name,
        value: h.value,
        color: COLORS[i % COLORS.length]
    })).sort((a, b) => b.value - a.value);

    const totalAssetWithCash = totalEvaluation;

    // Keywords for news filtering (useMemo to prevent infinite re-render)
    const assetKeywords = useMemo(() => holdings.map(h => h.name || h.symbol), [holdings]);

    const streamMeta = {
        connected: { label: "WS 연결", cls: "bg-profit-soft text-profit border-profit-soft" },
        reconnecting: { label: "재연결 중", cls: "bg-amber-500/10 text-amber-600 border-amber-300/40" },
        connecting: { label: "연결 중", cls: "bg-zinc-500/10 text-zinc-600 border-zinc-300/40" },
        fallback: { label: "REST 폴백", cls: "bg-sky-500/10 text-sky-600 border-sky-300/40" },
      }[priceStreamStatus];

    const benchmarkRows = [
        { name: "KOSPI", baseline: 5.2, note: "국내 대형주 기준" },
        { name: "S&P 500", baseline: 8.4, note: "미국 대표지수 기준" },
        { name: "NASDAQ", baseline: 11.8, note: "성장주 중심 지수" },
    ].map((item) => {
        const gap = profitRate - item.baseline;
        return {
            ...item,
            gap,
            isAhead: gap >= 0,
            status: gap >= 2 ? "상회" : gap <= -2 ? "하회" : "유사",
            trackWidth: `${Math.max(18, Math.min(100, 50 + gap * 3.2))}%`,
        };
    });
    const activeBenchmark = benchmarkRows[benchmarkIndex] ?? benchmarkRows[0];

    const forecastScore = (() => {
        let score = 2;
        if (profitRate >= 18) score += 1;
        if (profitRate >= 28) score += 1;
        if (profitRate < 0) score -= 1;
        if (profitRate < -8) score -= 1;
        if (dailyProfitPercent >= 1.2) score += 1;
        if (dailyProfitPercent <= -1.2) score -= 1;
        if (lossRate < -10) score -= 1;
        return Math.max(0, Math.min(4, score));
    })();

    const forecastStates = [
        {
            label: "얼음",
            summary: "리스크가 빠르게 응결되는 구간입니다.",
            detail: `${topLoser?.name || "하락 자산"} 비중을 먼저 덜어내고 현금 완충폭을 확보하는 편이 유리합니다.`,
            Icon: Snowflake,
            badge: "bg-white/15 text-white border-white/20 backdrop-blur-md",
            panel: "from-[#8ca6d9] via-[#445d91] to-[#0f1728]",
            tone: "text-white",
        },
        {
            label: "비",
            summary: "방어적으로 보는 편이 좋은 하루입니다.",
            detail: "단기 변동성이 커서 현금 비중과 손실 구간 확인을 먼저 하는 편이 좋습니다.",
            Icon: CloudRain,
            badge: "bg-white/15 text-white border-white/20 backdrop-blur-md",
            panel: "from-[#7b83d8] via-[#49558d] to-[#151c2f]",
            tone: "text-white",
        },
        {
            label: "흐림",
            summary: "관망이 필요한 중립 구간입니다.",
            detail: "전체 비중은 안정적이지만 추가 매수 전 흐름 확인이 필요합니다.",
            Icon: Cloud,
            badge: "bg-white/15 text-white border-white/20 backdrop-blur-md",
            panel: "from-[#8d95ad] via-[#53607a] to-[#181d2a]",
            tone: "text-white",
        },
        {
            label: "맑음",
            summary: "전반 흐름이 안정적입니다.",
            detail: `${topGainer?.name || "상위 자산"}이 분위기를 잘 끌어주고 있습니다.`,
            Icon: CloudSun,
            badge: "bg-white/15 text-white border-white/20 backdrop-blur-md",
            panel: "from-[#8fa6ff] via-[#7d69c4] to-[#1c2037]",
            tone: "text-white",
        },
        {
            label: "아주 맑음",
            summary: "오늘 포트폴리오는 매우 밝습니다.",
            detail: "수익률과 체력 모두 우호적이라 공격보다 유지 전략이 더 유리해 보입니다.",
            Icon: SunMedium,
            badge: "bg-white/15 text-white border-white/20 backdrop-blur-md",
            panel: "from-[#86b1ff] via-[#bf7dc8] to-[#1e2034]",
            tone: "text-white",
        },
    ] as const;

    const forecastMeta = forecastStates[forecastScore];
    const ForecastIcon = forecastMeta.Icon;
    const focusKeywords = [
        { label: "분산도", value: chartData.length >= 5 ? "안정" : "집중" },
        { label: "현금 비중", value: `${totalEvaluation > 0 ? ((totalCashValue / totalEvaluation) * 100).toFixed(0) : 0}%` },
        { label: "변동 온도", value: dailyProfitPercent >= 0 ? "상승" : "주의" },
        { label: "핵심 자산", value: topGainer?.symbol || chartData[0]?.symbol || "-" },
        { label: "하방 경계", value: lossRate < -8 ? "강화" : "보통" },
        { label: "뉴스 밀도", value: assetKeywords.length >= 4 ? "높음" : "보통" },
    ];
    const allocationPulseRows = chartData.slice(0, 4).map((asset) => ({
        ...asset,
        share: totalEvaluation > 0 ? (asset.value / totalEvaluation) * 100 : 0,
    }));

    return (
        <>
            <main className="mx-auto w-full max-w-[1800px] px-4 py-4 md:py-8 sm:px-6 lg:px-8 mb-8 md:mb-12 pb-24 md:pb-32">
                {/* Main Page Header (Shared) */}
                <header className="mb-4 md:mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-border pb-8">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <Badge variant="secondary" className="bg-primary/10 text-primary border-none font-bold">
                                Premium
                            </Badge>
                            <span className="text-xs text-muted-foreground font-medium tracking-wider uppercase">Portfolio Management</span>
                        </div>
                        <h1 className="text-4xl font-black tracking-tight text-foreground">나의 자산</h1>
                        <p className="mt-2 text-muted-foreground font-medium">실시간 통합 자산 관리 및 포트폴리오 분석</p>
                    </div>
                    <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:items-end">
                        <div className="w-full text-left sm:w-auto sm:text-right">
                            <div className="mb-1 flex items-center justify-start gap-2 sm:justify-end">
                                <span className="text-xs text-muted-foreground font-medium">Last updated: Just now</span>
                                <Badge variant="outline" className={`text-[10px] font-bold ${streamMeta.cls}`}>
                                    {streamMeta.label}
                                </Badge>
                            </div>
                            <div className="flex items-center justify-start gap-3 sm:justify-end">
                                <div className="w-full text-left sm:w-auto sm:text-right">
                                    <div className="text-sm md:text-base font-bold text-muted-foreground">총 자산</div>
                                    <div className="text-3xl md:text-5xl font-black text-foreground tracking-tighter">{Math.floor(totalEvaluation).toLocaleString()}원</div>
                                </div>
                            </div>
                        </div>
                        <Button
                            onClick={() => setShowAddModal(true)}
                            className="bg-gradient-to-r from-zinc-700 to-zinc-800 hover:from-zinc-600 hover:to-zinc-700 dark:from-zinc-800 dark:to-zinc-900 dark:hover:from-zinc-700 dark:hover:to-zinc-800 text-white font-bold px-6 h-11 rounded-xl shadow-sm transition-all active:scale-95 flex items-center gap-2"
                        >
                            <Plus className="h-5 w-5" />
                            <span>자산 추가</span>
                        </Button>
                    </div>
                </header>
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 md:space-y-6">
                    <TabsList className="border border-fuchsia-200/70 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-transparent p-1 dark:border-fuchsia-400/20">
                        <TabsTrigger value="overview" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-500 data-[state=active]:via-fuchsia-500 data-[state=active]:to-pink-500 data-[state=active]:text-white data-[state=active]:shadow-[0_12px_30px_-18px_rgba(217,70,239,0.7)]">
                            <BarChart3 className="h-4 w-4" />
                            <span>현황</span>
                        </TabsTrigger>
                        <TabsTrigger value="details" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-500 data-[state=active]:via-fuchsia-500 data-[state=active]:to-pink-500 data-[state=active]:text-white data-[state=active]:shadow-[0_12px_30px_-18px_rgba(217,70,239,0.7)]">
                            <LayoutGrid className="h-4 w-4" />
                            <span>상세 내역</span>
                        </TabsTrigger>
                        <TabsTrigger value="sell-history" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-500 data-[state=active]:via-fuchsia-500 data-[state=active]:to-pink-500 data-[state=active]:text-white data-[state=active]:shadow-[0_12px_30px_-18px_rgba(217,70,239,0.7)]">
                            <TrendingDown className="h-4 w-4" />
                            <span>매도 내역</span>
                        </TabsTrigger>
                    </TabsList>

                    {/* Overview Tab */}
                    <TabsContent value="overview" className="space-y-6">
                        <PortfolioOverviewDashboard holdings={holdings} isLoading={isLoading} error={error} />
                    </TabsContent>

                    {/* Details Tab (New Design Requested by User) */}
                    <TabsContent value="details">
                        <div className="space-y-6">
                            {/* Inner Header for Details Tab */}
                             <div className="overflow-hidden rounded-2xl border-2 border-fuchsia-200/70 bg-gradient-to-br from-violet-500/[0.06] via-fuchsia-500/[0.05] to-card p-4 shadow-lg md:rounded-3xl md:p-12 dark:border-fuchsia-400/20">
                                <div className="flex flex-col gap-2 mb-8">
                                    <span className="text-muted-foreground text-xs md:text-sm font-black uppercase tracking-[0.2em] mb-2">총 자산 평가액</span>
                                    <div className="flex items-baseline gap-2">
                                         <h2 className="text-2xl md:text-5xl font-black tracking-tighter text-foreground truncate">
                                            {totalAssetWithCash.toLocaleString()} <span className="text-xs md:text-base font-normal text-muted-foreground uppercase ml-1">KRW</span>
                                        </h2>
                                    </div>
                                </div>
 
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16 border-t border-border/60 pt-8 md:pt-12">
                                    <div className="space-y-8">
                                        <div className="flex justify-between items-center">
                                             <span className="text-muted-foreground font-bold uppercase tracking-tight text-sm md:text-base">총 투자 원금</span>
                                             <span className="font-black text-foreground text-lg md:text-xl">{Math.floor(totalEvaluation).toLocaleString()}원</span>
                                        </div>
                                        <div className="flex justify-between items-center text-base">
                                             <span className="text-muted-foreground font-bold uppercase tracking-tight text-xs md:text-base">매수 금액</span>
                                             <span className="text-muted-foreground font-bold text-sm md:text-base">{Math.floor(totalInvested).toLocaleString()}원</span>
                                        </div>
                                        <div className="flex justify-between items-center pt-6 border-t border-border/40">
                                            <span className="text-muted-foreground font-black uppercase tracking-widest text-xs">누적 실현 손익</span>
                                            <div className={`text-xl font-black ${totalProfit >= 0 ? "text-primary" : "text-destructive"}`}>
                                                {totalProfit > 0 ? "+" : ""}{Math.floor(totalProfit).toLocaleString()}원
                                                <span className="ml-2 text-xs opacity-80">
                                                    ({profitRate > 0 ? "+" : ""}{profitRate.toFixed(2)}%)
                                                </span>
                                            </div>
                                        </div>
                                    </div>
 
                                    <div className="space-y-8">
                                    </div>
                                </div>
                             </div>

                            {/* Detailed Table Section */}
                             <div className="flex items-center justify-between mb-4 mt-8 md:mt-12 pb-2 border-b-2 border-foreground/10">
                                <h3 className="text-lg md:text-xl font-black uppercase tracking-tighter text-foreground">보유 자산 내역 <span className="text-muted-foreground text-[10px] md:text-xs font-normal ml-2 md:ml-3">({investmentHoldings.length} Assets)</span></h3>
                             </div>
 
                             {/* Desktop Table: Hidden on Mobile */}
                             <Card className="hidden md:block border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden mx-0">
                                <CardContent className="p-0 overflow-hidden">
                                     <div className="overflow-x-auto w-full scrollbar-hide touch-pan-x">
                                         <Table className="min-w-[700px] w-full">
                                             <TableHeader className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800">
                                                <TableRow className="hover:bg-transparent border-zinc-100 dark:border-zinc-800">
                                                    <TableHead className="text-sm font-bold text-zinc-500 py-6 pl-8">종목명</TableHead>
                                                    <TableHead className="text-sm font-bold text-zinc-500 py-6 text-right">평가금액</TableHead>
                                                    <TableHead className="text-sm font-bold text-zinc-500 py-6 text-right">보유량</TableHead>
                                                    <TableHead className="text-sm font-bold text-zinc-500 py-6 text-right">평단가</TableHead>
                                                    <TableHead className="text-sm font-bold text-zinc-500 py-6 text-right">현재가</TableHead>
                                                    <TableHead className="text-sm font-bold text-zinc-500 py-6 text-right">수수익 / 수익률</TableHead>
                                                    <TableHead className="text-sm font-bold text-zinc-500 py-6 text-center">매수 사유</TableHead>
                                                    <TableHead className="text-sm font-bold text-zinc-500 py-6 text-center pr-8">관리</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {investmentHoldings.map((asset) => (
                                                    <TableRow key={asset.id || asset.symbol} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                                                        <TableCell className="py-4 pl-6">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ${asset.profit >= 0 ? "bg-profit-soft text-profit" : "bg-loss-soft text-loss"}`}>
                                                                    {asset.symbol[0]}
                                                                </div>
                                                                <div>
                                                                    <div className="font-bold text-sm text-zinc-900 dark:text-zinc-200">{asset.name}</div>
                                                                    <div className="text-xs text-zinc-500">{asset.symbol}</div>
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right py-4">
                                                            <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-200">{Math.floor(asset.value).toLocaleString()}원</div>
                                                            <div className="text-xs text-zinc-500">
                                                                {(totalEvaluation > 0 ? (asset.value / totalEvaluation) * 100 : 0).toFixed(1)}%
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right py-4 text-sm text-zinc-700 dark:text-zinc-300">
                                                            {editingAssetId === asset.id ? (
                                                                <Input 
                                                                    type="number"
                                                                    value={editValues.quantity}
                                                                    onChange={(e) => setEditValues(prev => ({ ...prev, quantity: e.target.value }))}
                                                                    className="h-8 w-24 ml-auto text-right"
                                                                />
                                                            ) : (
                                                                asset.amount.toLocaleString()
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right py-4 text-sm text-zinc-700 dark:text-zinc-300">
                                                            {editingAssetId === asset.id ? (
                                                                <Input 
                                                                    type="number"
                                                                    value={editValues.average_price}
                                                                    onChange={(e) => setEditValues(prev => ({ ...prev, average_price: e.target.value }))}
                                                                    className="h-8 w-32 ml-auto text-right"
                                                                />
                                                            ) : (
                                                                `${Math.floor(asset.averagePrice).toLocaleString()}원`
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right py-4">
                                                            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-200">{Math.floor(asset.currentPrice).toLocaleString()}원</div>
                                                        </TableCell>
                                                         <TableCell className="text-right py-6">
                                                            <div className={`font-black text-base ${asset.change >= 0 ? "text-profit" : "text-loss"}`}>
                                                                {asset.change > 0 ? "+" : ""}{Math.floor(asset.change * asset.amount).toLocaleString()}원
                                                            </div>
                                                            <div className={`text-sm font-bold ${asset.changePercent >= 0 ? "text-profit" : "text-loss"}`}>
                                                                {asset.changePercent > 0 ? "+" : ""}{asset.changePercent.toFixed(2)}%
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-center py-6">
                                                            {asset.buyReason ? (
                                                                <Badge variant="outline" className="bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700">
                                                                    {asset.buyReason}
                                                                </Badge>
                                                            ) : (
                                                                <span className="text-xs text-zinc-400">-</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right py-4 pr-6">
                                                            <div className="flex justify-center gap-1">
                                                                {editingAssetId === asset.id ? (
                                                                    <>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-8 w-8 text-profit hover:text-profit hover:bg-profit-soft"
                                                                            onClick={handleSaveEdit}
                                                                        >
                                                                            <Check className="h-4 w-4" />
                                                                        </Button>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-8 w-8 text-loss hover:text-loss hover:bg-loss-soft"
                                                                            onClick={() => setEditingAssetId(null)}
                                                                        >
                                                                            <X className="h-4 w-4" />
                                                                        </Button>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                                                                            onClick={() => handleStartEdit(asset)}
                                                                        >
                                                                            <Pencil className="h-4 w-4" />
                                                                        </Button>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-8 w-8 text-loss hover:text-loss hover:bg-loss-soft transition-colors"
                                                                            onClick={() => setSellAsset(asset)}
                                                                            title="매도"
                                                                        >
                                                                            <TrendingDown className="h-4 w-4" />
                                                                        </Button>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                                            onClick={() => {
                                                                                if (asset.id && confirm(`${asset.name}을(를) 삭제하시겠습니까?`)) {
                                                                                    deleteAsset(asset.id);
                                                                                }
                                                                            }}
                                                                        >
                                                                            <Trash2 className="h-4 w-4" />
                                                                        </Button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                                {investmentHoldings.length === 0 && (
                                                    <TableRow>
                                                        <TableCell colSpan={8} className="h-32 text-center text-zinc-500">
                                                            등록된 투자 자산이 없습니다. 자산을 추가해보세요.
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Mobile Card List: Hidden on Desktop */}
                            <div className="md:hidden space-y-4">
                                {investmentHoldings.map((asset) => (
                                    <Card key={asset.id || asset.symbol} className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden p-4">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ${asset.profit >= 0 ? "bg-profit-soft text-profit" : "bg-loss-soft text-loss"}`}>
                                                    {asset.symbol[0]}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-sm text-zinc-900 dark:text-zinc-200">{asset.name}</div>
                                                    <div className="text-xs text-zinc-500">{asset.symbol}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-zinc-400"
                                                    onClick={() => handleStartEdit(asset)}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-zinc-400"
                                                    onClick={() => asset.id && confirm(`${asset.name}을(를) 삭제하시겠습니까?`) && deleteAsset(asset.id)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-y-4 gap-x-2 border-t border-zinc-100 dark:border-zinc-800 pt-4">
                                            <div>
                                                <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">평가금액</p>
                                                <p className="font-bold text-sm">{Math.floor(asset.value).toLocaleString()}원</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">수익 / 수익률</p>
                                                <p className={`font-bold text-sm ${asset.change >= 0 ? "text-profit" : "text-loss"}`}>
                                                    {asset.change > 0 ? "+" : ""}{Math.floor(asset.change * asset.amount).toLocaleString()}원
                                                    <span className="ml-1 text-[10px]">({asset.changePercent > 0 ? "+" : ""}{asset.changePercent.toFixed(1)}%)</span>
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">보유량</p>
                                                <p className="text-sm font-medium">{asset.amount.toLocaleString()} <span className="text-[10px] text-zinc-500">{asset.symbol}</span></p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">현재가</p>
                                                <p className="text-sm font-medium">{Math.floor(asset.currentPrice).toLocaleString()}원</p>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                                {investmentHoldings.length === 0 && (
                                    <div className="py-12 text-center text-zinc-500 bg-zinc-50/50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
                                        등록된 투자 자산이 없습니다.
                                    </div>
                                )}
                            </div>

                            {/* 보유 현금 섹션 */}
                            {cashHoldings.length > 0 && (
                                <>
                                    <div className="flex items-center justify-between mb-4 mt-10 md:mt-14 pb-2 border-b-2 border-foreground/10">
                                        <h3 className="text-lg md:text-xl font-black uppercase tracking-tighter text-foreground">
                                            보유 현금
                                            <span className="text-muted-foreground text-[10px] md:text-xs font-normal ml-2 md:ml-3">
                                                ({cashHoldings.length} {cashHoldings.length === 1 ? "Currency" : "Currencies"})
                                            </span>
                                        </h3>
                                        <span className="text-sm font-bold text-muted-foreground">
                                            합계 <span className="text-foreground text-base font-black">{Math.floor(totalCashValue).toLocaleString()}원</span>
                                        </span>
                                    </div>

                                    {/* Desktop Cash Table */}
                                    <Card className="hidden md:block border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden mx-0">
                                        <CardContent className="p-0 overflow-hidden">
                                            <div className="overflow-x-auto w-full scrollbar-hide touch-pan-x">
                                                <Table className="w-full">
                                                    <TableHeader className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800">
                                                        <TableRow className="hover:bg-transparent border-zinc-100 dark:border-zinc-800">
                                                            <TableHead className="text-sm font-bold text-zinc-500 py-5 pl-8">통화</TableHead>
                                                            <TableHead className="text-sm font-bold text-zinc-500 py-5 text-right">보유량</TableHead>
                                                            <TableHead className="text-sm font-bold text-zinc-500 py-5 text-right">원화 환산</TableHead>
                                                            <TableHead className="text-sm font-bold text-zinc-500 py-5 text-center pr-8">관리</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {cashHoldings.map((asset) => (
                                                            <TableRow key={asset.id || asset.symbol} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                                                                <TableCell className="py-4 pl-6">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-sky-500/10 text-sky-600 dark:text-sky-400">
                                                                            {asset.symbol === "USD" ? "$" : asset.symbol === "EUR" ? "€" : asset.symbol === "JPY" ? "¥" : asset.symbol[0]}
                                                                        </div>
                                                                        <div>
                                                                            <div className="font-bold text-sm text-zinc-900 dark:text-zinc-200">{asset.name}</div>
                                                                            <div className="text-xs text-zinc-500">{asset.symbol}</div>
                                                                        </div>
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="text-right py-4 text-sm font-semibold text-zinc-900 dark:text-zinc-200">
                                                                    {asset.amount.toLocaleString()} {asset.symbol}
                                                                </TableCell>
                                                                <TableCell className="text-right py-4">
                                                                    <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-200">
                                                                        {Math.floor(asset.value).toLocaleString()}원
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="text-center py-4 pr-6">
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                                        onClick={() => {
                                                                            if (asset.id && confirm(`${asset.name}을(를) 삭제하시겠습니까?`)) {
                                                                                deleteAsset(asset.id);
                                                                            }
                                                                        }}
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Mobile Cash Cards */}
                                    <div className="md:hidden space-y-4">
                                        {cashHoldings.map((asset) => (
                                            <Card key={asset.id || asset.symbol} className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden p-4">
                                                <div className="flex justify-between items-center">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold bg-sky-500/10 text-sky-600 dark:text-sky-400">
                                                            {asset.symbol === "USD" ? "$" : asset.symbol === "EUR" ? "€" : asset.symbol === "JPY" ? "¥" : asset.symbol[0]}
                                                        </div>
                                                        <div>
                                                            <div className="font-bold text-sm text-zinc-900 dark:text-zinc-200">{asset.name}</div>
                                                            <div className="text-xs text-zinc-500">{asset.amount.toLocaleString()} {asset.symbol}</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-right">
                                                            <p className="font-bold text-sm text-zinc-900 dark:text-zinc-200">{Math.floor(asset.value).toLocaleString()}원</p>
                                                        </div>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-zinc-400"
                                                            onClick={() => asset.id && confirm(`${asset.name}을(를) 삭제하시겠습니까?`) && deleteAsset(asset.id)}
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </Card>
                                        ))}
                                    </div>
                                </>
                            )}

                        </div>
                    </TabsContent>

                    {/* Sell History Tab */}
                    <TabsContent value="sell-history">
                        <div className="space-y-6">
                            {/* Sell History Table */}
                            <Card>
                                <CardContent className="p-0">
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead className="bg-muted/50 border-b">
                                                <tr>
                                                    <th className="text-left p-3 text-xs font-bold text-muted-foreground">날짜</th>
                                                    <th className="text-left p-3 text-xs font-bold text-muted-foreground">종목</th>
                                                    <th className="text-right p-3 text-xs font-bold text-muted-foreground">수량</th>
                                                    <th className="text-right p-3 text-xs font-bold text-muted-foreground">매도가</th>
                                                    <th className="text-right p-3 text-xs font-bold text-muted-foreground">실현손익</th>
                                                    <th className="text-left p-3 text-xs font-bold text-muted-foreground">사유</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                                                        매도 내역이 없습니다.
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>
                </Tabs>

                <Footer />
            </main>

            {/* Add Asset Modal */}
            <AddAssetModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} />
            
            {/* Sell Asset Dialog */}
            <SellAssetDialog
                asset={sellAsset}
                open={!!sellAsset}
                onOpenChange={(open) => !open && setSellAsset(null)}
                onSellComplete={() => {
                    fetchHoldings();
                }}
            />
            
            {/* AI Insights Modal */}
            <AIInsightsModal
                open={showAIInsights}
                onOpenChange={setShowAIInsights}
            />
        </>
    );
}
