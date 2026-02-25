"use client";

import { useState, useEffect, useCallback } from "react";
import { mockWatchlist, type WatchlistItem } from "@/lib/mock-data";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// 주식/코인 심볼 목록
const STOCK_SYMBOLS = ["005930", "TSLA", "NVDA", "AAPL"];
const CRYPTO_SYMBOLS = ["BTC", "ETH", "SOL", "ADA"];

const STOCK_NAMES: Record<string, string> = {
  "005930": "삼성전자",
  "TSLA": "Tesla Inc.",
  "NVDA": "NVIDIA Corp.",
  "AAPL": "Apple Inc.",
};

const CRYPTO_NAMES: Record<string, string> = {
  "BTC": "Bitcoin",
  "ETH": "Ethereum",
  "SOL": "Solana",
  "ADA": "Cardano",
};

interface WatchlistData {
  crypto: WatchlistItem[];
  stocks: WatchlistItem[];
}

export default function WatchlistSidebar({
  onSelectSymbol,
}: {
  onSelectSymbol: (symbol: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"popular" | "assets" | "watchlist">("popular");
  const [selectedSymbol, setSelectedSymbol] = useState("005930");
  const [watchlistData, setWatchlistData] = useState<WatchlistData>(mockWatchlist);
  const [loading, setLoading] = useState(true);

  const fetchWatchlistData = useCallback(async () => {
    try {
      // 코인 시세 조회
      const cryptoResponse = await fetch(
        `${API_BASE_URL}/api/v1/market/prices/crypto?tickers=${CRYPTO_SYMBOLS.join(",")}`
      );
      const cryptoData = cryptoResponse.ok ? await cryptoResponse.json() : { prices: [] };

      // 주식 시세 조회
      const stockResponse = await fetch(
        `${API_BASE_URL}/api/v1/market/prices/stocks?symbols=${STOCK_SYMBOLS.join(",")}`
      );
      const stockData = stockResponse.ok ? await stockResponse.json() : { prices: [] };

      // 코인 데이터 변환
      const cryptoItems: WatchlistItem[] = cryptoData.prices
        ?.filter((p: any) => !p.error)
        .map((p: any) => {
          const symbol = p.ticker?.replace("KRW-", "") || "";
          return {
            name: CRYPTO_NAMES[symbol] || symbol,
            symbol: symbol,
            price: p.price || 0,
            change: 0, // 단일 시세 조회에서는 변동액 계산 불가
            changePercent: p.change_percent || 0,
            data: [], // 히스토리 데이터는 별도 API 필요
          };
        }) || [];

      // 주식 데이터 변환
      const stockItems: WatchlistItem[] = stockData.prices
        ?.filter((p: any) => !p.error && p.price)
        .map((p: any) => ({
          name: STOCK_NAMES[p.code] || p.code,
          symbol: p.code,
          price: p.price || 0,
          change: p.change || 0,
          changePercent: p.price > 0 && p.change ? (p.change / (p.price - p.change)) * 100 : 0,
          data: [],
        })) || [];

      // 데이터가 있으면 업데이트, 없으면 mock 유지
      setWatchlistData({
        crypto: cryptoItems.length > 0 ? cryptoItems : mockWatchlist.crypto,
        stocks: stockItems.length > 0 ? stockItems : mockWatchlist.stocks,
      });
    } catch (error) {
      console.error("관심종목 데이터 로드 실패:", error);
      // 에러 시 mock 데이터 유지
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWatchlistData();

    // 30초마다 자동 갱신
    const interval = setInterval(fetchWatchlistData, 30000);
    return () => clearInterval(interval);
  }, [fetchWatchlistData]);

  const handleSelectSymbol = (symbol: string) => {
    setSelectedSymbol(symbol);
    onSelectSymbol(symbol);
  };

  const formatPrice = (price: number, symbol: string) => {
    // 코인 심볼 확인
    const isCrypto = CRYPTO_SYMBOLS.includes(symbol);
    // 국내 주식 (숫자 6자리)
    const isDomestic = /^\d{6}$/.test(symbol);

    if (isCrypto || isDomestic) {
      return `${price.toLocaleString()}원`;
    }
    return `$${price.toLocaleString()}`;
  };

  // 모든 리스트 합치기 (검색용)
  const allList = [...watchlistData.crypto, ...watchlistData.stocks];
  const selectedItem = allList.find((item) => item.symbol === selectedSymbol);

  // 현재 탭에 맞는 리스트 선택
  const currentList = activeTab === "popular" ? watchlistData.stocks :
    activeTab === "watchlist" ? watchlistData.crypto :
      allList;

  return (
    <div className="flex h-full flex-col border-l border-gray-800 bg-gray-950">
      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        {[
          { key: "popular", label: "인기" },
          { key: "assets", label: "자산" },
          { key: "watchlist", label: "관심" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex-1 py-3 text-sm font-medium transition ${activeTab === tab.key
              ? "border-b-2 border-profit-soft text-profit"
              : "text-gray-400 hover:text-white"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-profit-soft"></div>
        </div>
      )}

      {/* Watchlist */}
      {!loading && (
        <div className="flex-1 overflow-y-auto">
          {currentList.map((item) => (
            <button
              key={item.symbol}
              onClick={() => handleSelectSymbol(item.symbol)}
              className={`w-full border-b border-gray-800/50 px-4 py-3 text-left transition hover:bg-gray-900 ${selectedSymbol === item.symbol ? "bg-gray-900" : ""
                }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{item.symbol}</span>
                    <span className="text-xs text-gray-500">{item.name}</span>
                  </div>
                  <div className="mt-1 text-sm text-gray-300">
                    {formatPrice(item.price, item.symbol)}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-sm font-medium ${item.changePercent >= 0 ? "text-profit" : "text-loss"
                      }`}
                  >
                    {item.changePercent >= 0 ? "+" : ""}
                    {item.changePercent.toFixed(2)}%
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Selected Item Detail */}
      {selectedItem && (
        <div className="border-t border-gray-800 bg-gray-900 p-4">
          <div className="mb-3">
            <h3 className="text-lg font-bold text-white">
              {selectedItem.symbol}
              <span className="ml-2 text-sm font-normal text-gray-400">
                {selectedItem.name}
              </span>
            </h3>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-white">
                {formatPrice(selectedItem.price, selectedItem.symbol)}
              </span>
              <span
                className={`text-sm font-medium ${selectedItem.changePercent >= 0 ? "text-profit" : "text-loss"
                  }`}
              >
                {selectedItem.changePercent >= 0 ? "+" : ""}
                {selectedItem.changePercent.toFixed(2)}%
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              실시간 자동 갱신 (30초)
            </p>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">시가 (추정)</span>
              <span className="text-white">
                {formatPrice(selectedItem.price * 0.98, selectedItem.symbol)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">고가 (추정)</span>
              <span className="text-profit">
                {formatPrice(selectedItem.price * 1.02, selectedItem.symbol)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">저가 (추정)</span>
              <span className="text-loss">
                {formatPrice(selectedItem.price * 0.96, selectedItem.symbol)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
