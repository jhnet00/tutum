"use client";

import { useEffect, useState } from "react";
import LoadingSkeleton from "./LoadingSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown, RefreshCcw } from "lucide-react";

interface MarketIndex {
    symbol: string;
    name: string;
    price: number | string;
    change?: number; // percent
    volume?: number;
    currency: string;
    type: 'STOCK' | 'CRYPTO';
}

export default function MarketSnapshot() {
    const [indices, setIndices] = useState<MarketIndex[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

            // Parallel fetch for Key Indices
            const [samsungRes, btcRes] = await Promise.allSettled([
                fetch(`${API_URL}/api/v1/market/price/domestic/005930`), // Samsung Electronics
                fetch(`${API_URL}/api/v1/market/price/crypto/KRW-BTC`)   // Bitcoin
            ]);

            const newIndices: MarketIndex[] = [];

            // 1. Samsung Electronics (KIS)
            if (samsungRes.status === "fulfilled" && samsungRes.value.ok) {
                const data = await samsungRes.value.json();
                // KIS 'output' structure depends on actual API response, simplified here based on service mock
                // If Mock mode in backend: returns { code, price, raw: ... }
                // We assume 'price' is available.
                const price = Number(data.price || data.output?.stck_prpr || 0);
                // KIS often returns change rate in output.prdy_ctrt
                const change = Number(data.raw?.output?.prdy_ctrt || 0);

                newIndices.push({
                    symbol: "005930",
                    name: "삼성전자",
                    price: price,
                    change: change,
                    currency: String(data.currency || "KRW").toUpperCase(),
                    type: 'STOCK'
                });
            } else {
                // Fallback / Error item
                newIndices.push({ symbol: "005930", name: "삼성전자", price: "Error", currency: "KRW", type: 'STOCK' });
            }

            // 2. Bitcoin (Upbit/CCXT)
            if (btcRes.status === "fulfilled" && btcRes.value.ok) {
                const data = await btcRes.value.json();
                // CryptoClient returns { ticker, price, change_percent, volume }
                newIndices.push({
                    symbol: "BTC",
                    name: "Bitcoin",
                    price: Number(data.price || 0),
                    change: data.change_percent, // CCXT usually returns exact % (e.g. 1.5 or 0.015 depending on exchange, assume % for display logic check)
                    currency: String(data.currency || "KRW").toUpperCase(),
                    type: 'CRYPTO'
                });
            } else {
                newIndices.push({ symbol: "BTC", name: "Bitcoin", price: "Error", currency: "KRW", type: 'CRYPTO' });
            }

            setIndices(newIndices);
            setLastUpdated(new Date());

        } catch (err) {
            console.error("Market data fetch error:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // Refresh every 30 seconds
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    const formatPrice = (price: number | string, currency: string) => {
        if (typeof price === 'string') return price;
        return new Intl.NumberFormat('ko-KR', { style: 'currency', currency }).format(price);
    };

    const formatChange = (change: number | undefined) => {
        if (change === undefined) return null;
        const isPositive = change > 0;
        const colorClass = isPositive ? "text-profit" : (change < 0 ? "text-loss" : "text-zinc-500"); // User Custom: Mint=Up, Burgundy=Down
        const Icon = isPositive ? ArrowUp : (change < 0 ? ArrowDown : null);

        return (
            <div className={`flex items-center text-sm font-medium ${colorClass}`}>
                {Icon && <Icon className="mr-1 h-3 w-3" />}
                {change > 0 ? "+" : ""}{change.toFixed(2)}%
            </div>
        );
    };

    if (loading && indices.length === 0) {
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
                    <h2 className="text-xl font-bold text-foreground">주요 지수</h2>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {lastUpdated && <span>{lastUpdated.toLocaleTimeString()} 기준</span>}
                        <button onClick={fetchData} className="p-1 hover:bg-muted rounded-full transition-colors">
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
                                tutum AI Market Watch
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
