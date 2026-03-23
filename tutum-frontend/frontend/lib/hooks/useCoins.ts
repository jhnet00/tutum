"use client";

/**
 * useCoins - 肄붿씤 ?곗씠?곕? 媛?몄삤??而ㅼ뒪? ??
 *
 * Upbit API瑜??듯빐 ?ㅼ떆媛?肄붿씤 ?쒖꽭瑜?議고쉶?⑸땲??
 * 30珥?媛꾧꺽?쇰줈 ?먮룞 媛깆떊?⑸땲??
 */

import { useState, useEffect, useCallback } from "react";
import { CoinData } from "../types";
import { MOCK_COINS } from "../mock-data";

const API_BASE_URL = '/api/proxy';

// Upbit?먯꽌 吏?먰븯??肄붿씤 ?щ낵 紐⑸줉
const TRACKED_TICKERS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "DOT"];

// ?щ낵 -> ?대쫫 留ㅽ븨 (Upbit API???대쫫???쒓?濡?諛섑솚?섎?濡??곷Ц ?대쫫 ?좎?)
const COIN_NAMES: Record<string, { id: string; name: string }> = {
  "BTC": { id: "bitcoin", name: "Bitcoin" },
  "ETH": { id: "ethereum", name: "Ethereum" },
  "SOL": { id: "solana", name: "Solana" },
  "XRP": { id: "ripple", name: "Ripple" },
  "DOGE": { id: "dogecoin", name: "Dogecoin" },
  "ADA": { id: "cardano", name: "Cardano" },
  "AVAX": { id: "avalanche-2", name: "Avalanche" },
  "DOT": { id: "polkadot", name: "Polkadot" },
  "BNB": { id: "binancecoin", name: "Binance Coin" },
};

const COINS_CACHE_KEY = "coins_data_cache";
const COINS_CACHE_TTL_MS = 5 * 60 * 1000;

function loadCoinsCache(): CoinData[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(COINS_CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > COINS_CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}

function saveCoinsCache(data: CoinData[]) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(COINS_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* ignore */ }
}

export function useCoins() {
  const [coins, setCoins] = useState<CoinData[]>(() => loadCoinsCache() ?? MOCK_COINS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCoins = useCallback(async () => {
    try {
      const tickerParam = TRACKED_TICKERS.join(",");
      const response = await fetch(`${API_BASE_URL}/api/v1/market/prices/crypto?tickers=${tickerParam}`);

      if (!response.ok) {
        throw new Error("코인 시세 조회 실패");
      }

      const data = await response.json();

      if (data.prices && data.prices.length > 0) {
        setCoins((prevCoins) => {
          const updatedCoins: CoinData[] = data.prices
            .filter((p: any) => !p.error)
            .map((p: any) => {
              const symbol = p.ticker?.replace("KRW-", "") || "";
              const coinInfo = COIN_NAMES[symbol] || { id: symbol.toLowerCase(), name: symbol };
              const prevCoin = prevCoins.find((c) => c.symbol === symbol);
              const sparklineData = prevCoin?.sparklineData || [p.price];
              const newSparkline = [...sparklineData, p.price].slice(-7);

              return {
                id: coinInfo.id,
                symbol,
                name: coinInfo.name,
                price: p.price,
                change24h: p.change_percent || 0,
                volume24h: p.volume || 0,
                marketCap: 0,
                sparklineData: newSparkline,
              };
            });

          if (updatedCoins.length > 0) {
            setError(null);
            saveCoinsCache(updatedCoins);
            return updatedCoins;
          }
          return prevCoins;
        });
      }
    } catch (err) {
      console.error("코인 데이터 로드 실패:", err);
      setError("코인 데이터를 불러오지 못했습니다. Mock 데이터를 표시합니다.");
      // 에러 시 mock 데이터 유지
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 珥덇린 濡쒕뱶
    fetchCoins();

    // 30珥덈쭏???먮룞 媛깆떊
    const interval = setInterval(fetchCoins, 30000);

    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ?섎룞 ?덈줈怨좎묠 ?⑥닔
  const refresh = useCallback(() => {
    setLoading(true);
    fetchCoins();
  }, [fetchCoins]);

  return { coins, loading, error, refresh };
}



