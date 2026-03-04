"use client";

import { useMemo } from "react";
import LoadingSkeleton from "./LoadingSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUp, ArrowDown, RefreshCcw, AlertCircle } from "lucide-react";
import { useMarketPriceContext } from "@/context/MarketPriceContext";

interface MarketIndex {
    symbol: string;
    name: string;
    price: number;
    change?: number; // percent
    currency: string;
    type: 'STOCK' | 'CRYPTO';
}

export default function MarketSnapshot() {
    const { priceMap, streamStatus, lastUpdated, refresh } = useMarketPriceContext();

    const loading = Object.keys(priceMap).length === 0;
    const isStale = streamStatus === "reconnecting";

    const indices = useMemo<MarketIndex[]>(() => {
        const result: MarketIndex[] = [];
        if (priceMap["005930"]) {
            result.push({
                symbol: "005930", name: "삼성전자",
                price: priceMap["005930"].price,
                change: priceMap["005930"].changePercent,
                currency: "KRW",
                type: "STOCK",
            });
        }
        if (priceMap["BTC"]) {
            result.push({
                symbol: "BTC", name: "Bitcoin",
                price: priceMap["BTC"].price,
                change: priceMap["BTC"].changePercent,
                currency: "KRW",
                type: "CRYPTO",
            });
        }
        return result;
    }, [priceMap]);

    const formatPrice = (price: number, currency: string) => {
        return new Intl.NumberFormat('ko-KR', { style: 'currency', currency }).format(price);
    };

    const formatChange = (change: number | undefined) => {
        if (change === undefined) return null;
        const isPositive = change > 0;
        const colorClass = isPositive ? "text-profit" : (change < 0 ? "text-loss" : "text-zinc-500");
        const Icon = isPositive ? ArrowUp : (change < 0 ? ArrowDown : null);

        return (
            <div className={`flex items-center text-sm font-medium ${colorClass}`}>
                {Icon && <Icon className="mr-1 h-3 w-3" />}
                {change > 0 ? "+" : ""}{change.toFixed(2)}%
            </div>
        );
    };

    if (loading) {
        return (
            <section className="bg-background px-4 py-20 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-7xl">
                    <h2 className="mb-6 text-2xl font-bold text-foreground">주요 지수</h2>
                    <div className="grid gap-6 md:grid-cols-2">
                        <LoadingSkeleton />
                        <LoadingSkeleton />
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section id="market" className="bg-background px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-foreground">주요 지수</h2>
                        {isStale && (
                            <Badge variant="outline" className="flex items-center gap-1 text-xs text-muted-foreground border-muted-foreground/40">
                                <AlertCircle className="h-3 w-3" />
                                캐시 데이터
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {lastUpdated && <span>{lastUpdated.toLocaleTimeString()} 기준</span>}
                        <button onClick={refresh} className="p-1 hover:bg-muted rounded-full transition-colors">
                            <RefreshCcw className="h-3 w-3" />
                        </button>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
                    {indices.map((index) => (
                        <Card key={index.symbol} className="bg-white/60 dark:bg-zinc-900/40 backdrop-blur-md border border-zinc-200 dark:border-white/5 hover:border-indigo-500/30 transition-all hover:shadow-lg hover:-translate-y-1">
                            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                                <CardTitle className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                                    {index.type === 'STOCK' ? 'Domestic' : 'Crypto'}
                                </CardTitle>
                                <Badge variant="outline" className="bg-zinc-100 dark:bg-white/5 border-0 font-mono text-[10px]">{index.symbol}</Badge>
                            </CardHeader>
                            <CardContent>
                                <div className="text-xl sm:text-2xl font-black text-foreground">
                                    {index.name}
                                </div>
                                <div className="mt-2 flex items-baseline gap-2">
                                    <span className="text-lg sm:text-xl font-bold tracking-tight">
                                        {formatPrice(index.price, index.currency)}
                                    </span>
                                    {formatChange(index.change)}
                                </div>
                            </CardContent>
                        </Card>
                    ))}

                    {/* Placeholder for AI Watch */}
                    <Card className="bg-muted/30 border-dashed">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Tutum AI Market Watch
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center justify-center h-[60px] text-sm text-muted-foreground">
                                실시간 시장 감시 중...
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </section>
    );
}
