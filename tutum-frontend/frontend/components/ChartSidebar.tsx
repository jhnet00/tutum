"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Heart } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useFavorites } from "@/context/FavoritesContext";
import { useAsset } from "@/contexts/AssetContext";
import type { ChartAsset } from "@/lib/types/chart-asset";
import { formatPercent, toLogo } from "@/lib/types/chart-asset";

interface ChartSidebarProps {
  assets: ChartAsset[];
  onSelectAsset?: (asset: ChartAsset) => void;
  currentAsset?: ChartAsset | null;
}

type MainTab = "market" | "portfolio" | "favorites";
type CategoryTab = "stock" | "crypto";

type LiveChange = { changePercent: number; isPositive: boolean };
const STOCK_BATCH_SIZE = 4;
const CRYPTO_BATCH_SIZE = 8;
const REQUEST_GAP_MS = 180;

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatPrice(price?: number): string {
  const n = toNumber(price);
  return Math.round(n).toLocaleString("ko-KR");
}

function normalizeSymbol(symbol: string): string {
  return String(symbol || "").replace("KRW-", "").toUpperCase();
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickFiniteNumber(...values: unknown[]): number {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return Number.NaN;
}

function resolveStockChangePercent(row: any): number {
  const direct = pickFiniteNumber(
    row?.changeRate,
    row?.raw?.output?.rate,
    row?.raw?.output?.prdy_ctrt
  );
  if (Number.isFinite(direct)) return direct;

  const price = toNumber(row?.price, Number.NaN);
  const change = toNumber(row?.change, Number.NaN);
  const previousClose = price - change;
  if (Number.isFinite(price) && Number.isFinite(change) && previousClose > 0) {
    return (change / previousClose) * 100;
  }

  return Number.NaN;
}

function resolveCryptoChangePercent(row: any): number {
  return pickFiniteNumber(row?.changeRate, row?.change_percent);
}

export default function ChartSidebar({ assets, onSelectAsset, currentAsset }: ChartSidebarProps) {
  const [mainTab, setMainTab] = useState<MainTab>("market");
  const [categoryTab, setCategoryTab] = useState<CategoryTab>("stock");
  const [livePriceMap, setLivePriceMap] = useState<Record<string, number>>({});
  const [liveChangeMap, setLiveChangeMap] = useState<Record<string, LiveChange>>({});
  const { favorites, toggleFavorite } = useFavorites();
  const { holdings } = useAsset();

  const assetMetaMap = useMemo(() => {
    const map: Record<string, ChartAsset> = {};
    for (const asset of assets) {
      map[normalizeSymbol(asset.symbol)] = asset;
    }
    return map;
  }, [assets]);

  const portfolioAssets = useMemo<ChartAsset[]>(() => {
    return holdings
      .filter((item) => item.assetType !== "cash")
      .map((item) => {
        const key = normalizeSymbol(item.symbol);
        const meta = assetMetaMap[key];
        const kind: "stock" | "crypto" = item.assetType === "crypto" ? "crypto" : (meta?.kind ?? "stock");
        const changePercent = toNumber(item.changePercent);
        return {
          symbol: key,
          name: item.name || meta?.name || key,
          kind,
          country: meta?.country || (kind === "crypto" ? "GLOBAL" : "KR"),
          price: toNumber(item.currentPrice || item.averagePrice || meta?.price),
          changePercent,
          isPositive: changePercent >= 0,
          logo: meta?.logo || toLogo(key),
        };
      });
  }, [holdings, assetMetaMap]);

  const displayedAssets = useMemo<ChartAsset[]>(() => {
    if (mainTab === "portfolio") return portfolioAssets;
    if (mainTab === "favorites") return assets.filter((asset) => favorites.includes(asset.symbol));
    return assets;
  }, [mainTab, portfolioAssets, assets, favorites]);

  const filteredAssets = useMemo(
    () => displayedAssets.filter((asset) => asset.kind === categoryTab),
    [displayedAssets, categoryTab]
  );

  const liveAssetSet = useMemo(() => {
    const all = [...assets, ...portfolioAssets];
    const uniq: Record<string, ChartAsset> = {};
    for (const asset of all) {
      uniq[normalizeSymbol(asset.symbol)] = asset;
    }
    return Object.values(uniq);
  }, [assets, portfolioAssets]);

  const fetchLivePrices = useCallback(async () => {
    const stockSymbols = liveAssetSet.filter((asset) => asset.kind === "stock").map((asset) => normalizeSymbol(asset.symbol));
    const cryptoSymbols = liveAssetSet.filter((asset) => asset.kind === "crypto").map((asset) => normalizeSymbol(asset.symbol));

    const nextPriceMap: Record<string, number> = {};
    const nextChangeMap: Record<string, LiveChange> = {};

    if (stockSymbols.length > 0) {
      for (const [index, batch] of chunkArray(stockSymbols, STOCK_BATCH_SIZE).entries()) {
        try {
          if (index > 0) await sleep(REQUEST_GAP_MS);
          const res = await fetch(`/api/proxy/api/v1/market/prices/stocks?symbols=${batch.join(",")}`);
          if (!res.ok) continue;

          const data = await res.json();
          for (const row of data?.prices ?? []) {
            const key = normalizeSymbol(row?.code);
            const price = toNumber(row?.price, NaN);
            if (!key || !Number.isFinite(price) || price <= 0) continue;
            nextPriceMap[key] = price;

            const rate = resolveStockChangePercent(row);
            if (Number.isFinite(rate)) {
              nextChangeMap[key] = { changePercent: rate, isPositive: rate >= 0 };
            }
          }
        } catch (error) {
          console.warn("stock price fetch failed:", error);
        }
      }
    }

    if (cryptoSymbols.length > 0) {
      for (const [index, batch] of chunkArray(cryptoSymbols, CRYPTO_BATCH_SIZE).entries()) {
        try {
          if (index > 0) await sleep(REQUEST_GAP_MS);
          const res = await fetch(`/api/proxy/api/v1/market/prices/crypto?tickers=${batch.join(",")}`);
          if (!res.ok) continue;

          const data = await res.json();
          for (const row of data?.prices ?? []) {
            const key = normalizeSymbol(row?.ticker);
            const price = toNumber(row?.price, NaN);
            if (!key || !Number.isFinite(price) || price <= 0) continue;
            nextPriceMap[key] = price;

            const rate = resolveCryptoChangePercent(row);
            if (Number.isFinite(rate)) {
              nextChangeMap[key] = { changePercent: rate, isPositive: rate >= 0 };
            }
          }
        } catch (error) {
          console.warn("crypto price fetch failed:", error);
        }
      }
    }

    if (Object.keys(nextPriceMap).length > 0) setLivePriceMap(nextPriceMap);
    if (Object.keys(nextChangeMap).length > 0) setLiveChangeMap(nextChangeMap);
  }, [liveAssetSet]);

  useEffect(() => {
    fetchLivePrices();
    const timer = setInterval(fetchLivePrices, 30000);
    return () => clearInterval(timer);
  }, [fetchLivePrices]);

  const resolvedAsset = useCallback(
    (asset: ChartAsset): ChartAsset => {
      const key = normalizeSymbol(asset.symbol);
      const livePrice = livePriceMap[key];
      const liveChange = liveChangeMap[key];
      return {
        ...asset,
        price: Number.isFinite(livePrice) ? livePrice : asset.price,
        changePercent: liveChange ? liveChange.changePercent : asset.changePercent,
        isPositive: liveChange ? liveChange.isPositive : asset.isPositive,
      };
    },
    [livePriceMap, liveChangeMap]
  );

  const selected = currentAsset ? resolvedAsset(currentAsset) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden border-l-0 border-zinc-200 bg-white md:border-l dark:border-zinc-900 dark:bg-black">
      <div className="flex border-b border-zinc-100 dark:border-zinc-900">
        {[
          { key: "market", label: "마켓" },
          { key: "portfolio", label: "보유" },
          { key: "favorites", label: "관심" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setMainTab(tab.key as MainTab)}
            className={cn(
              "relative flex-1 py-3 text-sm font-semibold transition-colors",
              mainTab === tab.key
                ? "text-fuchsia-600 dark:text-fuchsia-200"
                : "text-zinc-400 hover:text-fuchsia-600 dark:hover:text-fuchsia-200"
            )}
          >
            {tab.label}
            {mainTab === tab.key && <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-gradient-to-r from-violet-500 to-fuchsia-500" />}
          </button>
        ))}
      </div>

      <div className="flex gap-4 border-b border-zinc-50 px-4 py-3 text-xs font-bold text-zinc-500 dark:border-zinc-950 dark:text-zinc-400">
        {[
          { key: "stock", label: "주식" },
          { key: "crypto", label: "코인" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setCategoryTab(tab.key as CategoryTab)}
            className={cn(
              "transition-colors",
              categoryTab === tab.key ? "text-fuchsia-600 dark:text-fuchsia-200" : "hover:text-fuchsia-600 dark:hover:text-fuchsia-200"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="flex flex-col">
            {filteredAssets.map((asset) => {
              const row = resolvedAsset(asset);
              const key = normalizeSymbol(row.symbol);
              const isActive = currentAsset?.symbol === row.symbol;
              const changeText = formatPercent(row.changePercent);
              const positive = row.isPositive ?? toNumber(row.changePercent) >= 0;
              return (
                <button
                  key={key}
                  onClick={() => onSelectAsset?.(row)}
                  className={cn(
                    "flex w-full items-center justify-between border-b border-zinc-50 px-4 py-3 text-left transition-colors dark:border-zinc-950/40",
                    "hover:bg-fuchsia-500/6 dark:hover:bg-fuchsia-500/10",
                    isActive && "bg-fuchsia-500/8 dark:bg-fuchsia-500/12"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                      {row.logo || toLogo(row.symbol)}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{row.name}</p>
                      <p className="text-[10px] font-medium uppercase text-zinc-400">{row.symbol}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{formatPrice(row.price)}</p>
                      <p className={cn("text-[10px] font-bold", positive ? "text-fuchsia-600 dark:text-fuchsia-300" : "text-zinc-500 dark:text-zinc-300")}>{changeText}</p>
                    </div>
                    <span
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleFavorite(row.symbol);
                      }}
                      className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Heart
                        className={cn(
                          "h-4 w-4 transition-all",
                          favorites.includes(row.symbol) ? "fill-fuchsia-500 text-fuchsia-500" : "text-zinc-400"
                        )}
                      />
                    </span>
                  </div>
                </button>
              );
            })}

            {filteredAssets.length === 0 && (
              <div className="px-4 py-12 text-center text-xs font-semibold text-zinc-500">
                표시할 종목이 없습니다.
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {selected && (
        <div className="border-t border-zinc-100 bg-zinc-50/70 px-4 py-4 dark:border-zinc-900 dark:bg-zinc-950/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-zinc-900 dark:text-zinc-100">{selected.symbol}</p>
              <p className="text-xs text-zinc-500">{selected.name}</p>
            </div>
            <p className="text-sm font-black text-zinc-900 dark:text-zinc-100">{formatPrice(selected.price)}</p>
          </div>
          <p className={cn("mt-1 text-xs font-bold", (selected.isPositive ?? true) ? "text-fuchsia-600 dark:text-fuchsia-300" : "text-zinc-500 dark:text-zinc-300")}>
            {formatPercent(selected.changePercent)}
          </p>
        </div>
      )}
    </div>
  );
}
