import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Newspaper } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface News {
  id: string;
  title: string;
  content: string;
  time: string;
  category: string;
  source: string;
  url?: string;
}

type RawNewsItem = Partial<News> & {
  summary?: string;
  link?: string;
  published_at?: string;
  section?: string;
};

interface PersonalizedNewsCarouselProps {
  keywords: string[];
}

function normalizeNewsItem(item: RawNewsItem): News {
  const content = item.content || item.summary || "";

  return {
    id: item.id || "",
    title: item.title || "",
    content,
    time: item.time || item.published_at || "",
    category: item.category || item.section || "general",
    source: item.source || "unknown",
    url: item.url || item.link,
  };
}

function normalizeNewsList(items: unknown): News[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => normalizeNewsItem((item || {}) as RawNewsItem));
}

function getNewsAction(item: News): { href: string; label: string } | null {
  const directUrl = item.url?.trim();
  if (directUrl) {
    return { href: directUrl, label: "원문 보기" };
  }

  const query = [item.source, item.title].filter(Boolean).join(" ");
  if (!query) {
    return null;
  }

  return {
    href: `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(query)}`,
    label: "관련 기사 찾기",
  };
}

export default function PersonalizedNewsCarousel({ keywords }: PersonalizedNewsCarouselProps) {
  const [news, setNews] = useState<News[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedNews, setSelectedNews] = useState<News | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const fallbackQuery = useMemo(() => {
    const unique = Array.from(new Set(keywords.map((item) => item?.trim()).filter(Boolean)));
    return unique.slice(0, 4).join(" ");
  }, [keywords]);

  const selectedNewsAction = selectedNews ? getNewsAction(selectedNews) : null;

  useEffect(() => {
    let isCancelled = false;

    const fetchNews = async () => {
      setLoading(true);
      try {
        const recommendedRes = await fetch("/api/public/news?mode=recommended&limit=6", {
          credentials: "include",
        });
        const recommendedResult = await recommendedRes.json();
        const recommendedNews = normalizeNewsList(recommendedResult?.all);

        if (!isCancelled && recommendedNews.length > 0) {
          setNews(recommendedNews);
          return;
        }

        if (fallbackQuery) {
          const queryRes = await fetch(`/api/public/news?query=${encodeURIComponent(fallbackQuery)}&limit=6`);
          const queryResult = await queryRes.json();
          const queryNews = normalizeNewsList(queryResult?.all);

          if (!isCancelled && queryNews.length > 0) {
            setNews(queryNews);
            return;
          }
        }

        const fallbackRes = await fetch("/api/public/news?limit=6");
        const fallbackResult = await fallbackRes.json();
        if (!isCancelled) {
          setNews(normalizeNewsList(fallbackResult?.all));
        }
      } catch (fetchError) {
        console.error("Failed to fetch personalized news", fetchError);
        if (!isCancelled) {
          setNews([]);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    void fetchNews();

    return () => {
      isCancelled = true;
    };
  }, [fallbackQuery]);

  const scroll = (direction: "left" | "right") => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, clientWidth } = scrollContainerRef.current;
    const next = direction === "left" ? scrollLeft - clientWidth : scrollLeft + clientWidth;
    scrollContainerRef.current.scrollTo({ left: next, behavior: "smooth" });
  };

  if (!loading && news.length === 0) {
    return (
      <div className="rounded-[1.8rem] border border-dashed border-border bg-muted/25 p-10 text-center">
        <p className="text-sm font-medium text-muted-foreground">보유 자산과 관련된 뉴스가 아직 없습니다.</p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Newspaper className="h-4 w-4" />
          </div>
          <h3 className="text-lg font-black tracking-tight text-foreground">뉴스</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full border border-border bg-background"
            onClick={() => scroll("left")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full border border-border bg-background"
            onClick={() => scroll("right")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="relative">
        <div ref={scrollContainerRef} className="scrollbar-hide flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
          {loading
            ? Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="min-w-[288px] snap-start md:min-w-[360px]">
                  <Card className="border-border bg-card shadow-none">
                    <CardContent className="space-y-4 p-5">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-4 w-4/5" />
                      <div className="flex justify-between">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ))
            : news.map((item) => (
                <div
                  key={item.id}
                  className="min-w-[288px] cursor-pointer snap-start md:min-w-[360px]"
                  onClick={() => setSelectedNews(item)}
                >
                  <Card className="h-full border-border bg-card shadow-none transition-transform duration-200 hover:-translate-y-1">
                    <CardContent className="flex h-full flex-col p-5">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <Badge variant="secondary" className="border-none bg-muted px-2 py-0 text-[10px] text-muted-foreground">
                          {item.category}
                        </Badge>
                        <span className="text-[10px] font-medium text-muted-foreground">{item.time}</span>
                      </div>
                      <h4 className="mb-3 line-clamp-2 text-base font-black leading-snug text-foreground">{item.title}</h4>
                      <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
                        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">{item.source}</span>
                        <span className="text-xs font-bold text-muted-foreground">자세히 보기</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ))}
        </div>
      </div>

      <Dialog open={!!selectedNews} onOpenChange={(open) => !open && setSelectedNews(null)}>
        <DialogContent className="flex h-[80vh] w-full max-w-[700px] flex-col gap-0 overflow-hidden rounded-[2rem] border-border bg-background p-0 shadow-2xl outline-none">
          {selectedNews ? (
            <>
              <DialogHeader className="shrink-0 border-b border-border bg-background/95 px-6 py-6">
                <div className="mb-3 flex items-center gap-2">
                  <Badge variant="outline" className="h-5 border-primary/30 px-2 py-0 text-[10px] text-primary">
                    {selectedNews.category}
                  </Badge>
                  <span className="text-xs font-medium text-muted-foreground">{selectedNews.time}</span>
                </div>
                <DialogTitle className="text-2xl font-black leading-tight text-foreground md:text-3xl">
                  {selectedNews.title}
                </DialogTitle>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto border-y border-border px-8 py-4">
                <article className="max-w-none py-2">
                  {selectedNews.content ? (
                    selectedNews.content.split("\n").map((paragraph, index) => (
                      paragraph.trim() ? (
                        <p key={index} className="mb-4 break-keep text-base leading-relaxed text-foreground/90">
                          {paragraph.trim()}
                        </p>
                      ) : null
                    ))
                  ) : (
                    <p className="text-base text-muted-foreground">상세 내용이 아직 없습니다.</p>
                  )}
                </article>
              </div>

              <DialogFooter className="flex flex-col items-center justify-between gap-4 p-8 pt-4 sm:flex-row">
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                  <span className="rounded bg-muted px-2 py-1">{selectedNews.source}</span>
                </div>
                <div className="flex w-full gap-3 sm:w-auto">
                  <Button variant="outline" className="h-12 flex-1 rounded-xl font-bold sm:flex-initial" onClick={() => setSelectedNews(null)}>
                    닫기
                  </Button>
                  {selectedNewsAction ? (
                    <Button asChild className="h-12 flex-1 gap-2 rounded-xl font-bold sm:flex-initial">
                      <a href={selectedNewsAction.href} target="_blank" rel="noopener noreferrer">
                        {selectedNewsAction.label}
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  ) : null}
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </section>
  );
}
