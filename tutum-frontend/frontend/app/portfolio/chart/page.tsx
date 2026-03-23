"use client";

import { useEffect, useMemo, useState } from "react";
import AdvancedChart from "@/components/AdvancedChart";
import ChartSidebar from "@/components/ChartSidebar";
import type { ChartAsset } from "@/lib/types/chart-asset";

type WatchlistItem = {
  symbol: string;
  name: string;
  price?: number;
  change?: number;
  market?: string;
  history?: number[];
};

const FALLBACK_ASSETS: ChartAsset[] = [
  { symbol: "NVDA", name: "NVIDIA", kind: "stock", country: "US", price: 0, changePercent: 0, isPositive: true, logo: "N" },
  { symbol: "005930", name: "삼성전자", kind: "stock", country: "KR", price: 0, changePercent: 0, isPositive: true, logo: "S" },
  { symbol: "BTC", name: "Bitcoin", kind: "crypto", country: "GLOBAL", price: 0, changePercent: 0, isPositive: true, logo: "B" },
  { symbol: "ETH", name: "Ethereum", kind: "crypto", country: "GLOBAL", price: 0, changePercent: 0, isPositive: true, logo: "E" },
];

function mapWatchlistItem(item: WatchlistItem, kind: "stock" | "crypto"): ChartAsset {
  const change = Number(item.change ?? 0);
  return {
    symbol: String(item.symbol || "").toUpperCase(),
    name: item.name || item.symbol || "Unknown",
    kind,
    country: kind === "stock" ? (item.market || "US") : "GLOBAL",
    price: Number(item.price ?? 0),
    changePercent: change,
    isPositive: change >= 0,
    logo: String(item.symbol || "?").slice(0, 1).toUpperCase(),
    history: Array.isArray(item.history)
      ? item.history.map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : undefined,
  };
}

export default function ChartPage() {
  const [assets, setAssets] = useState<ChartAsset[]>(FALLBACK_ASSETS);
  const [selectedAsset, setSelectedAsset] = useState<ChartAsset>(FALLBACK_ASSETS[0]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadWatchlist() {
      try {
        const res = await fetch("/api/public/watchlist", { cache: "no-store" });
        if (!res.ok) throw new Error(`watchlist status=${res.status}`);

        const data = await res.json();
        const stocks: ChartAsset[] = Array.isArray(data?.stocks)
          ? data.stocks.map((item: WatchlistItem) => mapWatchlistItem(item, "stock"))
          : [];
        const crypto: ChartAsset[] = Array.isArray(data?.crypto)
          ? data.crypto.map((item: WatchlistItem) => mapWatchlistItem(item, "crypto"))
          : [];

        const merged = [...stocks, ...crypto].filter((asset) => asset.symbol);
        if (!cancelled && merged.length > 0) {
          setAssets(merged);
          setSelectedAsset((prev) => merged.find((asset) => asset.symbol === prev.symbol) ?? merged[0]);
        }
      } catch (error) {
        console.error("Failed to load watchlist assets:", error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadWatchlist();
    return () => {
      cancelled = true;
    };
  }, []);

  const safeSelectedAsset = useMemo(
    () => {
      const base = assets.find((asset) => asset.symbol === selectedAsset.symbol);
      if (base) return { ...base, ...selectedAsset };
      return selectedAsset ?? assets[0] ?? FALLBACK_ASSETS[0];
    },
    [assets, selectedAsset]
  );

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-hidden md:flex-row">
      <main className="relative min-h-[420px] flex-1 border-b border-zinc-200 md:min-h-0 md:border-b-0 md:border-r dark:border-zinc-800">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">차트 종목 로딩 중...</div>
        ) : (
          <AdvancedChart selectedAsset={safeSelectedAsset} />
        )}
      </main>

      <aside className="h-[320px] w-full shrink-0 border-t border-zinc-200 bg-white md:h-full md:w-80 md:border-t-0 dark:border-zinc-800 dark:bg-zinc-950">
        <ChartSidebar assets={assets} onSelectAsset={setSelectedAsset} currentAsset={safeSelectedAsset} />
      </aside>
    </div>
  );
}
