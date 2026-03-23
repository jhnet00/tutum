"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

interface News {
    id: string;
    title: string;
    summary: string;
    content: string;
    time: string;
    category: string;
    source: string;
    url?: string;
}

export default function NewsSection() {
    const [newsList, setNewsList] = useState<News[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedNews, setSelectedNews] = useState<News | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(5);
    const ITEMS_PER_PAGE = 6;

    useEffect(() => {
        const fetchNews = async () => {
            setLoading(true);
            try {
                // Fetch simple list for current page
                const res = await fetch(`/api/public/news?page=${currentPage}&limit=${ITEMS_PER_PAGE}`);
                const result = await res.json();
                if (result.all) {
                    setNewsList(result.all);
                }
                if (result.pagination && result.pagination.totalPages) {
                    setTotalPages(result.pagination.totalPages);
                }
            } catch (e) {
                console.error("Failed to fetch news", e);
            } finally {
                setLoading(false);
            }
        };
        fetchNews();
    }, [currentPage]);

    const truncateTitle = (title: string, maxLength: number = 30) => {
        if (title.length > maxLength) {
            return title.slice(0, maxLength) + "...";
        }
        return title;
    };

    const handlePageChange = (page: number) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    };

    return (
        <section id="news" className="bg-background px-4 py-8 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl md:text-2xl font-black text-foreground uppercase tracking-tight">Market News</h2>
                        <p className="text-muted-foreground mt-1 text-xs md:text-sm font-medium">실시간 AI 수집 뉴스</p>
                    </div>
                </div>

                {/* News Grid */}
                {loading ? (
                    <div className="grid grid-cols-3 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-6">
                        {[1, 2, 3, 4, 5, 6].map(i => (
                            <div key={i} className="aspect-square sm:aspect-auto sm:h-40 bg-zinc-100 dark:bg-zinc-900 animate-pulse rounded-xl sm:rounded-2xl" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-6">
                        {newsList.map((item) => (
                            <div
                                key={item.id}
                                onClick={() => setSelectedNews(item)}
                                className="group cursor-pointer"
                            >
                                <Card className="h-full border-none bg-white dark:bg-zinc-900/50 shadow-sm sm:shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden relative aspect-square sm:aspect-auto sm:h-full">
                                    {/* Gradient Accent - Desktop Only */}
                                    <div className="hidden sm:block absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-violet-500/10 to-transparent blur-xl rounded-bl-3xl transition-opacity opacity-50 group-hover:opacity-100" />

                                    <CardContent className="p-3 sm:p-5 flex flex-col h-full justify-between relative z-10">
                                        {/* Metadata - Mobile: Time Only, Desktop: Full */}
                                        <div className="flex items-center justify-end sm:justify-between mb-1.5 sm:mb-3">
                                            <Badge variant="outline" className="hidden sm:inline-flex bg-zinc-50 dark:bg-white/5 border-zinc-200 dark:border-white/10 text-[10px] px-2 py-0.5 font-bold text-zinc-500 group-hover:border-violet-500/30 group-hover:text-violet-500 transition-colors">
                                                {item.category}
                                            </Badge>
                                            <span className="text-[10px] sm:text-[10px] font-medium text-zinc-400 sm:text-zinc-400">{item.time}</span>
                                        </div>

                                        {/* Title */}
                                        <h3 className="text-[18px] leading-tight sm:text-lg font-bold text-zinc-900 dark:text-zinc-100 sm:leading-snug group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors line-clamp-3 sm:line-clamp-2 md:line-clamp-3 break-keep tracking-tight mb-1 sm:mb-2">
                                            {truncateTitle(item.title, 35)}
                                        </h3>

                                        {/* Footer - Desktop Only */}
                                        <div className="hidden sm:flex mt-auto items-center justify-between pt-2">
                                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{item.source}</span>
                                            <ExternalLink className="h-3 w-3 text-zinc-300 group-hover:text-violet-500 transition-colors" />
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pagination */}
                <div className="mt-8 flex justify-center items-center gap-2">
                    {(() => {
                        const startPage = Math.floor((currentPage - 1) / 5) * 5 + 1;
                        const endPage = Math.min(startPage + 4, totalPages);

                        return (
                            <>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handlePageChange(Math.max(1, startPage - 5))}
                                    disabled={startPage === 1}
                                    className="h-8 w-8 rounded-full"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>

                                {Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i).map((page) => (
                                    <Button
                                        key={page}
                                        variant={currentPage === page ? "default" : "ghost"}
                                        size="sm"
                                        onClick={() => handlePageChange(page)}
                                        className={`h-8 w-8 rounded-full p-0 font-bold ${currentPage === page ? "bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-500/30" : "text-zinc-500"}`}
                                    >
                                        {page}
                                    </Button>
                                ))}

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handlePageChange(Math.min(totalPages, startPage + 5))}
                                    disabled={endPage === totalPages}
                                    className="h-8 w-8 rounded-full"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </>
                        );
                    })()}
                </div>
            </div>

            {/* News Detail Dialog */}
            <Dialog open={!!selectedNews} onOpenChange={(open) => !open && setSelectedNews(null)}>
                <DialogContent className="w-full max-w-lg h-[80vh] flex flex-col gap-0 rounded-[2rem] bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 p-0 overflow-hidden shadow-2xl outline-none">
                    {/* Header Image or Gradient Area (Optional, using simple header for now but styled) */}
                    <DialogHeader className="px-6 py-6 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 backdrop-blur-xl shrink-0">
                        <div className="flex items-center gap-2 mb-3">
                            <Badge variant="secondary" className="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 hover:bg-indigo-200 border-none px-2.5 py-0.5 text-xs font-bold rounded-md">
                                {selectedNews?.category}
                            </Badge>
                            <span className="text-xs font-medium text-zinc-400">
                                {selectedNews?.time} · {selectedNews?.source}
                            </span>
                        </div>
                        <DialogTitle className="text-xl md:text-2xl font-black leading-snug text-zinc-900 dark:text-zinc-100 tracking-tight break-keep">
                            {selectedNews?.title}
                        </DialogTitle>
                    </DialogHeader>

                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto scrollbar-thin p-6 md:p-8">
                        <article className="prose prose-zinc dark:prose-invert max-w-none">
                            {selectedNews?.content ? (
                                selectedNews.content.split('\n').map((paragraph, idx) => (
                                    paragraph.trim() && (
                                        <p key={idx} className="mb-4 text-base md:text-lg leading-relaxed text-zinc-600 dark:text-zinc-300 font-medium break-keep">
                                            {paragraph.trim()}
                                        </p>
                                    )
                                ))
                            ) : (
                                <p className="text-base text-zinc-500">내용을 불러올 수 없습니다.</p>
                            )}
                        </article>
                    </div>

                    {/* Footer */}
                    <DialogFooter className="p-6 border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
                        {selectedNews?.url && (
                            <Button asChild className="w-full h-12 text-base font-bold rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 shadow-lg" size="lg">
                                <a href={selectedNews.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2">
                                    <span>원본 기사 전문 보기</span>
                                    <ExternalLink className="h-4 w-4" />
                                </a>
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    );
}
