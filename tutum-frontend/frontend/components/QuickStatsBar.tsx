"use client";

import { useEffect, useState } from "react";

interface StatusData {
    priceUpdate: string;
    newsUpdate: string;
    aiUpdate: string;
    status: string;
}

export default function QuickStatsBar() {
    const [data, setData] = useState<StatusData | null>(null);

    useEffect(() => {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        fetch(`${API_URL}/api/v1/market/status`)
            .then((res) => res.json())
            .then(setData)
            .catch(console.error);
    }, []);

    const formatTime = (isoString: string) => {
        const date = new Date(isoString);
        const now = new Date();
        const diffMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

        if (diffMinutes < 1) return "방금 전";
        if (diffMinutes < 60) return `${diffMinutes}분 전`;
        const diffHours = Math.floor(diffMinutes / 60);
        return `${diffHours}시간 전`;
    };

    if (!data) {
        return (
            <div className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-zinc-950/50 backdrop-blur-sm px-4 py-3">
                <div className="mx-auto max-w-7xl">
                    <div className="flex animate-pulse justify-center gap-10">
                        <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-800"></div>
                        <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-800"></div>
                        <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-800"></div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-zinc-950/50 backdrop-blur-sm px-4 py-2.5">
            <div className="mx-auto flex max-w-7xl flex-wrap justify-center gap-8 sm:gap-12 text-[10px] font-medium tracking-[0.2em] text-zinc-500 dark:text-zinc-400 uppercase">
                <div className="flex items-center gap-3 group">
                    <div className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </div>
                    <span className="group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors">PRICE UPDATE:</span>
                    <span className="text-zinc-900 dark:text-zinc-100 font-bold">{formatTime(data.priceUpdate)}</span>
                </div>
                <div className="flex items-center gap-3 group">
                    <div className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
                    </div>
                    <span className="group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors">NEWS FEED:</span>
                    <span className="text-zinc-900 dark:text-zinc-100 font-bold">{formatTime(data.newsUpdate)}</span>
                </div>
                <div className="flex items-center gap-3 group">
                    <div className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-zinc-500"></span>
                    </div>
                    <span className="group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors">AI SNAPSHOT:</span>
                    <span className="text-zinc-900 dark:text-zinc-100 font-bold">{formatTime(data.aiUpdate)}</span>
                </div>
            </div>
        </div>
    );
}
