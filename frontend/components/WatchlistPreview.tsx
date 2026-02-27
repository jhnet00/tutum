"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronLeft } from "lucide-react";
import Sparkline from "./Sparkline";
import { Button } from "@/components/ui/button";
import { useRef } from "react"; // Keep original useRef import
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

interface Asset {
    name: string;
    symbol: string;
    price: number;
    change: number;
    market?: string;
    history?: number[];
    changePercent: number;
    data: { value: number; date: string }[];
}

interface WatchlistData {
    crypto: Asset[];
    stocks: Asset[];
}

const CACHE_KEY = "watchlist_cache";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분

function loadFromCache(): { data: WatchlistData; ts: number } | null {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch { return null; }
}

function saveToCache(data: WatchlistData) {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch { /* ignore */ }
}

export default function WatchlistPreview() {
    const { user } = useAuth();
    const [data, setData] = useState<WatchlistData | null>(null);
    const [loading, setLoading] = useState(true);
    const [isStale, setIsStale] = useState(false);
    const getSparklineColor = (isPositive: boolean): string =>
        isPositive ? "rgb(32, 123, 112)" : "rgb(108, 52, 60)";

    useEffect(() => {
        // 캐시 즉시 표시 후 백그라운드 갱신
        const cached = loadFromCache();
        if (cached) {
            setData(cached.data);
            setLoading(false);
            const isExpired = Date.now() - cached.ts > CACHE_TTL_MS;
            if (!isExpired) return; // 신선하면 재요청 생략
            setIsStale(true);
        }

        async function loadData() {
            try {
                const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
                const stockSymbols = ["005930", "TSLA", "NVDA", "AAPL"];
                const cryptoSymbols = ["BTC", "ETH", "USDT", "ADA"];
                const stockNames: any = { "005930": "삼성전자", "TSLA": "Tesla Inc.", "NVDA": "NVIDIA Corp.", "AAPL": "Apple Inc." };
                const cryptoNames: any = { "BTC": "Bitcoin", "ETH": "Ethereum", "USDT": "Tether", "ADA": "Cardano" };

                const fetchHistory = async (type: string, s: string) => {
                    try {
                        const r = await fetch(`${API_URL}/api/v1/market/history/${type}/${s}?timeframe=D&count=30`);
                        const json = await r.json();
                        return json?.history?.length ? json : { history: [] };
                    } catch { return { history: [] }; }
                };

                const [stockResults, cryptoResults] = await Promise.all([
                    Promise.all(stockSymbols.map(s => fetchHistory("stock", s))),
                    Promise.all(cryptoSymbols.map(s => fetchHistory("crypto", s))),
                ]);

                const formatAsset = (res: any, symbol: string, name: string) => {
                    const history = res?.history || [];
                    const last = history.length > 0 ? history[history.length - 1] : { close: 0, open: 0 };
                    const first = history.length > 0 ? history[0] : { close: 0 };
                    const changePercent = first?.close > 0 ? ((last.close - first.close) / first.close) * 100 : 0;
                    return {
                        name,
                        symbol,
                        price: last.close,
                        change: last.close - first.close,
                        changePercent: parseFloat(changePercent.toFixed(2)),
                        data: history.map((h: any) => ({ value: h.close, date: h.date })),
                        history: history.map((h: any) => h.close)
                    };
                };

                // 모든 심볼이 빈 배열이면 캐시 유지 (API 전체 장애 상황)
                const allEmpty = [...stockResults, ...cryptoResults].every(r => !r?.history?.length);
                if (allEmpty && data) {
                    setIsStale(true);
                    return;
                }

                const freshData = {
                    stocks: stockSymbols.map((s, i) => formatAsset(stockResults[i], s, stockNames[s])),
                    crypto: cryptoSymbols.map((s, i) => formatAsset(cryptoResults[i], s, cryptoNames[s])),
                };
                setData(freshData);
                setIsStale(false);
                saveToCache(freshData);
            } catch (error) {
                console.error("Failed to load watchlist:", error);
                if (!data) setLoading(false);
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, []);

    const AssetCard = ({ asset, rank }: { asset: Asset; rank: number }) => {
        const isPositive = asset.change >= 0;

        return (
            <div className="flex w-[280px] shrink-0 flex-col justify-between rounded-xl bg-card p-6 transition-all hover:bg-accent/50 select-none">
                {/* Header */}
                <div className="mb-6 flex items-start justify-between">
                    <span className="text-lg font-medium text-muted-foreground">{rank}</span>
                    <Sparkline
                        data={asset.data}
                        color={getSparklineColor(isPositive)}
                        width={120}
                        height={40}
                    />
                </div>

                {/* Asset Info */}
                <div>
                    <div className="mb-1 flex items-center gap-2">
                        {/* Logo Placeholder */}
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold">
                            {asset.symbol.substring(0, 2)}
                        </div>
                        <span className="text-sm font-medium text-muted-foreground">{asset.name}</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-lg font-bold text-foreground">
                            {asset.symbol.match(/^[0-9]+$/) || ['BTC', 'ETH', 'USDT', 'ADA'].includes(asset.symbol)
                                ? `₩${asset.price.toLocaleString()}`
                                : `$${asset.price.toLocaleString()}`}
                        </span>
                        <span className={`text-sm font-medium ${isPositive ? 'text-profit' : 'text-loss'}`}>
                            {isPositive ? '+' : ''}{asset.changePercent}%
                        </span>
                    </div>
                </div>
            </div>
        );
    };

    // Drag to scroll logic
    const useDragScroll = () => {
        const ref = useRef<HTMLDivElement>(null);
        const [isDragging, setIsDragging] = useState(false);
        const [startX, setStartX] = useState(0);
        const [scrollLeft, setScrollLeft] = useState(0);
        const [showLeftArrow, setShowLeftArrow] = useState(false);
        const [showRightArrow, setShowRightArrow] = useState(true);

        const checkScrollButtons = useCallback(() => {
            if (!ref.current) return;
            const { scrollLeft, scrollWidth, clientWidth } = ref.current;
            setShowLeftArrow(scrollLeft > 0);
            setShowRightArrow(Math.ceil(scrollLeft + clientWidth) < scrollWidth);
        }, []);

        useEffect(() => {
            checkScrollButtons();
            window.addEventListener('resize', checkScrollButtons);
            return () => window.removeEventListener('resize', checkScrollButtons);
        }, [checkScrollButtons]);

        const onMouseDown = (e: React.MouseEvent) => {
            if (!ref.current) return;
            setIsDragging(true);
            setStartX(e.pageX - ref.current.offsetLeft);
            setScrollLeft(ref.current.scrollLeft); // Original line, kept
        };

        const onMouseLeave = () => {
            setIsDragging(false);
        };

        const onMouseUp = () => {
            setIsDragging(false);
        };

        const onMouseMove = (e: React.MouseEvent) => {
            if (!isDragging || !ref.current) return;
            e.preventDefault();
            const x = e.pageX - ref.current.offsetLeft;
            const walk = (x - startX) * 1.5; // Scroll speed multiplier
            ref.current.scrollLeft = scrollLeft - walk;
            checkScrollButtons();
        };

        const scrollBy = (offset: number) => {
            if (ref.current) {
                ref.current.scrollBy({ left: offset, behavior: 'smooth' });
                setTimeout(checkScrollButtons, 300); // Check after animation
            }
        };

        return {
            ref,
            isDragging,
            showLeftArrow,
            showRightArrow,
            scrollBy,
            checkScrollButtons, // Exported to use in onScroll
            events: { onMouseDown, onMouseLeave, onMouseUp, onMouseMove }
        };
    };

    const LoginCard = () => (
        <div className="flex w-[280px] shrink-0 flex-col items-center justify-center rounded-xl bg-gray-900 p-6 text-center border border-gray-800 select-none">
            <p className="mb-6 text-sm font-medium text-gray-300">
                {user ? "자산 리포트에서 상세 분석을 확인하세요" : "로그인하고 더 많은 트렌딩 종목을 확인하세요"}
            </p>
            <Button asChild variant="outline" className="w-full rounded-full border-gray-700 bg-black text-white hover:bg-gray-800">
                <Link href={user ? "/portfolio/asset" : "/login"}>
                    {user ? "나의 자산 보기" : "로그인하기"}
                </Link>
            </Button>
        </div>
    );

    const Section = ({ title, assets }: { title: string; assets: Asset[] }) => {
        const { ref, isDragging, showLeftArrow, showRightArrow, scrollBy, checkScrollButtons, events } = useDragScroll();

        return (
            <div className="mb-12 relative group">
                <div className="mb-6 flex items-center justify-between">
                    <h3 className="text-xl font-bold text-foreground">{title}</h3>
                </div>

                {/* Left Arrow */}
                {showLeftArrow && (
                    <button
                        onClick={() => scrollBy(-300)}
                        className="absolute left-0 top-[60%] z-10 -translate-y-1/2 rounded-full border border-gray-200 bg-white/80 p-2 shadow-lg backdrop-blur-sm transition-all hover:bg-white hover:scale-110 disabled:opacity-0"
                    >
                        <ChevronLeft className="h-6 w-6 text-gray-900" />
                    </button>
                )}

                {/* Right Arrow */}
                {showRightArrow && (
                    <button
                        onClick={() => scrollBy(300)}
                        className="absolute right-0 top-[60%] z-10 -translate-y-1/2 rounded-full border border-gray-200 bg-white/80 p-2 shadow-lg backdrop-blur-sm transition-all hover:bg-white hover:scale-110 disabled:opacity-0"
                    >
                        <ChevronRight className="h-6 w-6 text-gray-900" />
                    </button>
                )}

                <div
                    ref={ref}
                    {...events}
                    onScroll={checkScrollButtons}
                    className={`flex w-full space-x-8 overflow-x-auto pb-4 select-none no-scrollbar ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                    style={{ scrollBehavior: 'auto' }}
                >
                    {assets.map((asset, i) => (
                        <div key={asset.symbol} className="pointer-events-none" onMouseDown={(e) => e.stopPropagation()}>
                            <div className="pointer-events-auto">
                                <AssetCard asset={asset} rank={i + 1} />
                            </div>
                        </div>
                    ))}
                    <LoginCard />
                </div>
            </div>
        );
    };

    if (loading && !data) {
        return (
            <section className="bg-background px-4 py-12 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-7xl">
                    <div className="animate-pulse space-y-8">
                        <div className="h-8 w-48 bg-muted rounded"></div>
                        <div className="grid grid-cols-4 gap-4">
                            {[1, 2, 3, 4].map(i => (
                                <div key={i} className="h-40 bg-muted rounded"></div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section id="market" className="bg-background px-4 pt-20 pb-8 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-10 flex items-center gap-3">
                    <h2 className="text-3xl font-bold text-foreground">주식 & 코인 TOP 10</h2>
                    {isStale && (
                        <Badge variant="outline" className="text-xs text-muted-foreground border-muted-foreground/40">
                            캐시 데이터
                        </Badge>
                    )}
                </div>

                <Section title="주식" assets={data.stocks} />
                <Section title="코인" assets={data.crypto} />
            </div>
        </section>
    );
}
