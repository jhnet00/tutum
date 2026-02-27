"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, TrendingUp, TrendingDown, Activity, Calendar } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts";
import { useAuth } from "@/contexts/AuthContext";

interface Transaction {
    id: string;
    symbol: string;
    name: string;
    transaction_type: "buy" | "sell";
    quantity: number;
    price: number;
    total_amount: number;
    buy_reason?: string;
    sell_reason?: string;
    realized_profit?: number;
    transaction_date: string;
}

interface TradingStats {
    total_buys: number;
    total_sells: number;
    avg_holding_days: number;
    realized_return: number;
    win_rate: number;
    total_realized_profit: number;
    buy_reasons_distribution: Record<string, number>;
    sell_reasons_distribution: Record<string, number>;
}

export default function TradingAnalysisPage() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [stats, setStats] = useState<TradingStats | null>(null);
    const [aiAnalysis, setAiAnalysis] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const { token } = useAuth();

    const requestAIAnalysis = useCallback(
        async (txData: Transaction[]) => {
            try {
                const prompt = `
다음은 사용자의 거래 이력입니다:
${JSON.stringify(txData, null, 2)}

                분석해주세요:
1. 매수 패턴 (어떤 이유로 주로 매수하는지)
2. 매도 패턴 (손절 vs 익절 비율)
3. 보유 기간 경향
4. 개선 포인트 3가지
5. 잘하고 있는 점 3가지

친근하고 격려하는 톤으로 작성해주세요.
                `;

                const res = await fetch("/api/proxy/api/v1/chat/bedrock", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({ prompt }),
                });

                const data = await res.json();
                setAiAnalysis(data.response || "AI 분석을 불러올 수 없습니다.");
            } catch (error) {
                console.error("AI analysis failed:", error);
                setAiAnalysis("AI 분석 중 오류가 발생했습니다.");
            }
        },
        [token],
    );

    const loadData = useCallback(async () => {
        if (!token) return;

        try {
            // Load transactions
            const txRes = await fetch(`/api/v1/transactions`, {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });
            const txData = await txRes.json();
            setTransactions(txData);

            // Load analysis stats
            const statsRes = await fetch(`/api/v1/transactions/analysis`, {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });
            const statsData = await statsRes.json();
            setStats(statsData);

            // Request AI analysis
            if (txData.length > 0) {
                await requestAIAnalysis(txData);
            }
        } catch (error) {
            console.error("Failed to load trading data:", error);
        } finally {
            setLoading(false);
        }
    }, [requestAIAnalysis, token]);

    useEffect(() => {
        if (token) {
            loadData();
        }
    }, [loadData, token]);

    if (loading) {
        return (
            <div className="container mx-auto p-6">
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                    <p className="mt-4 text-muted-foreground">거래 이력을 불러오는 중...</p>
                </div>
            </div>
        );
    }

    if (!stats || transactions.length === 0) {
        return (
            <div className="container mx-auto p-6">
                <Card>
                    <CardContent className="py-12 text-center">
                        <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-xl font-bold mb-2">거래 이력이 없습니다</h3>
                        <p className="text-muted-foreground">
                            자산을 매수하거나 매도하면 여기에서 분석 결과를 확인할 수 있습니다.
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Prepare chart data
    const buyReasonsData = Object.entries(stats.buy_reasons_distribution).map(([name, value]) => ({
        name,
        value,
    }));

    const sellReasonsData = Object.entries(stats.sell_reasons_distribution).map(([name, value]) => ({
        name,
        value,
    }));

    const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981"];

    return (
        <div className="container mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-black mb-2">AI 매매 분석</h1>
                <p className="text-muted-foreground">
                    당신의 투자 패턴을 AI가 분석했습니다
                </p>
            </div>

            {/* Overview Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            총 매수 횟수
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-black">{stats.total_buys}회</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            총 매도 횟수
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-black">{stats.total_sells}회</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            평균 보유 기간
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-black">{stats.avg_holding_days.toFixed(0)}일</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            실현 수익률
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p
                            className={`text-3xl font-black ${
                                stats.realized_return >= 0 ? "text-profit" : "text-loss"
                            }`}
                        >
                            {stats.realized_return >= 0 ? "+" : ""}
                            {stats.realized_return.toFixed(2)}%
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* AI Insights */}
            {aiAnalysis && (
                <Card className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/20 dark:to-purple-950/20 border-2 border-primary/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-indigo-500 animate-pulse" />
                            AI 인사이트
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="prose dark:prose-invert max-w-none">
                            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                                {aiAnalysis}
                            </pre>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Buy Pattern */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-profit" />
                            매수 패턴 분석
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {buyReasonsData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={300}>
                                <PieChart>
                                    <Pie
                                        data={buyReasonsData}
                                        dataKey="value"
                                        nameKey="name"
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={80}
                                        label
                                    >
                                        {buyReasonsData.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={COLORS[index % COLORS.length]}
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <p className="text-center text-muted-foreground py-12">
                                매수 데이터가 없습니다
                            </p>
                        )}
                    </CardContent>
                </Card>

                {/* Sell Pattern */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <TrendingDown className="h-5 w-5 text-loss" />
                            매도 패턴 분석
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm text-muted-foreground">승률</p>
                                    <p className="text-2xl font-black text-profit">
                                        {stats.win_rate.toFixed(1)}%
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">실현 손익</p>
                                    <p
                                        className={`text-2xl font-black ${
                                            stats.total_realized_profit >= 0
                                                ? "text-profit"
                                                : "text-loss"
                                        }`}
                                    >
                                        {stats.total_realized_profit >= 0 ? "+" : ""}
                                        {stats.total_realized_profit.toLocaleString()}원
                                    </p>
                                </div>
                            </div>

                            {sellReasonsData.length > 0 && (
                                <ResponsiveContainer width="100%" height={200}>
                                    <BarChart data={sellReasonsData}>
                                        <XAxis dataKey="name" />
                                        <YAxis />
                                        <Tooltip />
                                        <Bar dataKey="value" fill="#10b981" />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Recent Transactions */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        최근 거래 이력
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {transactions.slice(0, 10).map((tx) => (
                            <div
                                key={tx.id}
                                className="flex items-center gap-4 p-3 bg-muted rounded-lg"
                            >
                                <Badge
                                    variant={tx.transaction_type === "buy" ? "default" : "destructive"}
                                >
                                    {tx.transaction_type === "buy" ? "매수" : "매도"}
                                </Badge>
                                <div className="flex-1">
                                    <p className="font-bold">
                                        {tx.name} ({tx.symbol})
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {tx.quantity}주 @ {tx.price.toLocaleString()}원
                                    </p>
                                </div>
                                {tx.realized_profit !== undefined && tx.realized_profit !== null && (
                                    <div
                                        className={`font-bold ${
                                            tx.realized_profit >= 0
                                                ? "text-profit"
                                                : "text-loss"
                                        }`}
                                    >
                                        {tx.realized_profit >= 0 ? "+" : ""}
                                        {tx.realized_profit.toLocaleString()}원
                                    </div>
                                )}
                                <span className="text-xs text-muted-foreground">
                                    {new Date(tx.transaction_date).toLocaleDateString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
