"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, RefreshCcw } from "lucide-react";

import LoadingSkeleton from "./LoadingSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PublicMarketIndex = {
  id: string;
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string;
  marketStatus: "open" | "closed" | "unknown";
  updatedAt: string | null;
  stale: boolean;
  available: boolean;
  source: "yahoo" | "cache" | "last_good" | "error";
};

type IndicesResponse = {
  generatedAt: string;
  items: PublicMarketIndex[];
};

function formatPrice(price: number | null, currency: string) {
  if (price === null) return "Not available";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(price);
}

function formatUpdatedAt(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function MarketSnapshot() {
  const [items, setItems] = useState<PublicMarketIndex[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchIndices = async () => {
    try {
      setError(false);
      const response = await fetch("/api/public/indices", { cache: "no-store" });
      if (!response.ok) throw new Error(`indices fetch failed: ${response.status}`);
      const payload = (await response.json()) as IndicesResponse;
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setGeneratedAt(payload.generatedAt ?? null);
    } catch (fetchError) {
      console.error("Market snapshot fetch error:", fetchError);
      setItems([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchIndices();
  }, []);

  if (loading) {
    return (
      <section id="market" className="bg-background px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-black text-foreground">Market Indices</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <LoadingSkeleton />
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
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-foreground">Market Indices</h2>
            {error ? (
              <Badge variant="outline" className="border-amber-300/60 text-amber-600">
                Error fallback
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {generatedAt ? <span>{formatUpdatedAt(generatedAt)} update</span> : null}
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => void fetchIndices()}>
              <RefreshCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {items.map((item) => {
            const isPositive = (item.changePercent ?? 0) > 0;
            const isNegative = (item.changePercent ?? 0) < 0;
            const statusTone = item.available ? "text-foreground" : "text-muted-foreground";
            const ChangeIcon = isPositive ? ArrowUpRight : isNegative ? ArrowDownRight : AlertCircle;

            return (
              <Card
                key={item.id || item.symbol}
                className="border border-zinc-200 bg-white/70 shadow-sm transition-colors dark:border-white/10 dark:bg-zinc-900/50"
              >
                <CardHeader className="space-y-3 pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-sm font-black tracking-[0.12em] text-muted-foreground uppercase">
                        {item.name}
                      </CardTitle>
                      <p className="mt-1 text-xs font-semibold text-muted-foreground">{item.symbol}</p>
                    </div>
                    <Badge variant="outline" className="border-border/70 text-[10px] font-bold uppercase">
                      {item.marketStatus}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className={`text-2xl font-black tracking-tight ${statusTone}`}>
                    {formatPrice(item.price, item.currency)}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div
                      className={[
                        "flex items-center gap-1 text-sm font-bold",
                        isPositive ? "text-emerald-600" : "",
                        isNegative ? "text-rose-600" : "",
                        !isPositive && !isNegative ? "text-muted-foreground" : "",
                      ].join(" ")}
                    >
                      <ChangeIcon className="h-4 w-4" />
                      <span>
                        {item.changePercent === null ? "Not available" : `${item.changePercent > 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`}
                      </span>
                    </div>
                    <div className="text-right text-[11px] font-medium text-muted-foreground">
                      <div>{item.source}</div>
                      <div>{item.stale ? "stale" : "fresh"}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
