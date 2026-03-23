"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import LoadingSkeleton from "./LoadingSkeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { Fingerprint, ArrowRight, ScanLine } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface Insight {
    id: number;
    type: string;
    title: string;
    content: string;
    confidence?: number;
    level?: string;
    priority?: string;
    timestamp: string;
}

export default function InsightPreview() {
    const { user } = useAuth();
    const [insights, setInsights] = useState<Insight[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/public/insights/sample")
            .then((res) => res.json())
            .then((data) => {
                if (data.insights) setInsights(data.insights);
            })
            .catch(() => {
                // 에러 시에도 기본 샘플 데이터를 보여주어 블러 처리가 자연스럽게 보이도록 함
                setInsights([
                    { id: 1, type: "summary", title: "샘플 인사이트", content: "로그인 후 실시간 AI 분석 결과를 확인하세요.", timestamp: new Date().toISOString() },
                    { id: 2, type: "risk", title: "샘플 리스크", content: "자산 변동성에 대한 실시간 알림을 제공합니다.", timestamp: new Date().toISOString() },
                    { id: 3, type: "action", title: "샘플 행동", content: "포트폴리오 최적화 제안을 받아보세요.", timestamp: new Date().toISOString() }
                ]);
            });
    }, []);

    const getCardStyle = (type: string) => {
        switch (type) {
            case "summary":
                return "border-none bg-white dark:bg-white/10 shadow-xl";
            case "risk":
                return "border-none bg-white dark:bg-white/10 shadow-xl";
            case "action":
                return "border-none bg-white dark:bg-white/10 shadow-xl";
            default:
                return "border-none bg-white dark:bg-white/10 shadow-xl";
        }
    };

    const getIcon = (type: string) => {
        return (
            <div className="bg-zinc-100 dark:bg-white/5 p-1 rounded-xl border border-zinc-200 dark:border-white/10 shadow-inner overflow-hidden w-16 h-16 flex items-center justify-center">
                <DotLottieReact
                    src="https://lottie.host/7355ea35-b73f-4aef-a187-6aaf2c8c40f4/gcBPqH0jIx.lottie"
                    loop
                    autoplay
                    className="w-24 h-24"
                />
            </div>
        );
    };

    if (insights.length === 0) {
        return (
            <section className="bg-background px-4 py-12 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-7xl">
                    <h2 className="mb-6 text-2xl font-bold text-foreground">AI Insights</h2>
                    <div className="grid gap-6 md:grid-cols-3">
                        <LoadingSkeleton />
                        <LoadingSkeleton />
                        <LoadingSkeleton />
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section id="features" className="relative py-20 overflow-hidden">
            {/* Strong Experimental Background */}
            <div className="absolute inset-0 bg-[#0B0C15] dark:bg-[#0B0C15]">
                 <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-to-b from-indigo-900/40 via-violet-900/20 to-transparent pointer-events-none" />
                 <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-600/20 blur-[150px]" />
                 <div className="absolute top-[20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-fuchsia-600/10 blur-[150px]" />
            </div>

            <div className="mx-auto max-w-7xl relative px-4 sm:px-6 lg:px-8">
                {/* Content Header - NOT Blurred */}
                <div className="mb-10 flex items-end justify-between relative z-20">
                    <div>
                        <Badge className="mb-4 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-bold px-3 py-1 rounded-full text-[10px] uppercase tracking-widest animate-pulse">
                             Live AI Analysis
                        </Badge>
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight text-white uppercase leading-none break-keep">
                            AI 분석<br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">인사이트</span>
                        </h2>
                    </div>
                    <div className="hidden md:block text-right">
                        <p className="text-indigo-200/60 font-medium text-sm">Tutum AI가 실시간으로 분석한<br/>시장 흐름과 포트폴리오 전략</p>
                    </div>
                </div>

                {/* Content Grid (Blurred) */}
                <div className="grid gap-6 md:grid-cols-3 filter blur-sm select-none pointer-events-none relative z-0 opacity-50">
                    {insights.map((insight) => (
                        <Card key={insight.id} className="border border-white/5 bg-white/5 backdrop-blur-sm shadow-xl hover:bg-white/10 transition-colors">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-3 text-lg text-white">
                                    <div className="h-10 w-10 rounded-lg bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                                        <span className="text-xl">🤖</span>
                                    </div>
                                    {insight.title}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="mb-4 text-sm text-zinc-400 leading-relaxed">
                                    {insight.content}
                                </p>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Glassmorphism Overlay */}
                <div className="absolute inset-x-4 inset-y-20 md:inset-0 md:top-32 flex flex-col items-center justify-center z-10">
                    <div className="relative p-1 rounded-[2.5rem] bg-gradient-to-b from-white/20 to-transparent">
                        <div className="relative text-center p-8 md:p-16 bg-[#0F111A]/90 backdrop-blur-2xl rounded-[2.4rem] shadow-2xl border border-white/10 max-w-lg mx-auto overflow-hidden">
                             {/* Glow effect inside card */}
                            <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent animate-spin-slow pointer-events-none" />
                            
                            <div className="relative z-10 flex flex-col items-center space-y-8">
                                {/* Fingerprint Scanning Animation */}
                                <div className="relative">
                                    <div className="w-24 h-24 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center shadow-[0_0_40px_-10px_rgba(99,102,241,0.5)] relative overflow-hidden group">
                                         <div className="absolute inset-0 bg-gradient-to-t from-indigo-500/20 to-transparent" />
                                         <Fingerprint className="text-indigo-400 h-10 w-10 opacity-80" />
                                         {/* Scanning Line */}
                                         <div className="absolute inset-x-0 h-0.5 bg-cyan-400 blur-[2px] animate-scan-vertical top-0 w-full shadow-[0_0_10px_#22d3ee]" />
                                    </div>
                                    <div className="absolute -bottom-2 -right-2 bg-zinc-800 rounded-full p-1.5 border border-zinc-700">
                                        <ScanLine className="w-4 h-4 text-cyan-400 animate-pulse" />
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-3xl md:text-4xl font-black text-white mb-4 tracking-tight drop-shadow-md break-keep">
                                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300">
                                            프리미엄 리포트
                                        </span>
                                    </h3>
                                    <p className="text-sm md:text-base text-zinc-400 font-medium leading-relaxed break-keep">
                                        로그인하고 <b>실시간 종목 추천</b>과<br />
                                        <b>포트폴리오 위험도 분석</b>을 즉시 확인하세요.
                                    </p>
                                </div>

                                {/* Slide to Unlock Visual */}
                                <Link href={user ? "/portfolio/asset" : "/login"} className="w-full group">
                                    <div className="relative w-full h-16 bg-zinc-950/50 rounded-full border border-white/10 p-1 flex items-center shadow-inner overflow-hidden hover:border-indigo-500/50 transition-colors">
                                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-shimmer" />
                                        
                                        <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm font-semibold tracking-widest uppercase animate-pulse group-hover:text-zinc-300 transition-colors">
                                            {user ? "자산 분석하러 가기" : "밀어서 잠금해제"}
                                        </div>
                                        
                                        <div className="relative h-14 w-14 bg-gradient-to-br from-white to-zinc-200 rounded-full shadow-[0_0_20px_rgba(255,255,255,0.3)] flex items-center justify-center z-10 transition-all duration-300 group-hover:translate-x-[calc(100%_-_10px)] group-hover:scale-110">
                                            <ArrowRight className="text-zinc-900 h-6 w-6" />
                                        </div>
                                    </div>
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>

                <style jsx>{`
                    @keyframes scan-vertical {
                        0%, 100% { top: 0%; opacity: 0; }
                        10%, 90% { opacity: 1; }
                        50% { top: 100%; }
                    }
                    .animate-scan-vertical {
                        animation: scan-vertical 2s linear infinite;
                    }
                    @keyframes shimmer {
                        100% { transform: translateX(100%); }
                    }
                    .animate-shimmer {
                        animation: shimmer 2s infinite;
                    }
                `}</style>
            </div >
        </section >
    );
}
