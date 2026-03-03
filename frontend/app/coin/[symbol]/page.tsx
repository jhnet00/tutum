"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { MOCK_COINS } from "../../../lib/mock-data";
import AdvancedChart from "@/components/AdvancedChart";
import type { ChartAsset } from "@/lib/types/chart-asset";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const COIN_CACHE_TTL_MS = 3 * 60 * 1000;

function loadCoinCache(symbol: string): CoinDetail | null {
  try {
    const raw = sessionStorage.getItem(`coin_detail_${symbol}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > COIN_CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}

function saveCoinCache(symbol: string, data: CoinDetail) {
  try {
    sessionStorage.setItem(`coin_detail_${symbol}`, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* ignore */ }
}

// ?щ낵 -> ?대쫫 留ㅽ븨
const COIN_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  XRP: "Ripple",
  DOGE: "Dogecoin",
  ADA: "Cardano",
  AVAX: "Avalanche",
  DOT: "Polkadot",
  BNB: "Binance Coin",
};

interface CoinDetail {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
}

export default function CoinDetailPage() {
  const params = useParams();
  const symbol = (params.symbol as string)?.toUpperCase();

  const [coin, setCoin] = useState<CoinDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;

    // 罹먯떆 利됱떆 ?쒖떆
    const cachedCoin = loadCoinCache(symbol);
    if (cachedCoin) {
      setCoin(cachedCoin);
      setLoading(false);
    }

    async function fetchCoinData() {
      if (!cachedCoin) setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/v1/market/price/crypto/${symbol}`
        );

        if (!response.ok) {
          throw new Error("肄붿씤 ?쒖꽭 議고쉶 ?ㅽ뙣");
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error);
        }

        const coinData: CoinDetail = {
          symbol: symbol,
          name: COIN_NAMES[symbol] || symbol,
          price: data.price || 0,
          change24h: data.change_percent || 0,
          volume24h: data.volume || 0,
          marketCap: 0,
        };
        saveCoinCache(symbol, coinData);
        setCoin(coinData);
      } catch (err) {
        console.error("肄붿씤 ?곗씠??濡쒕뱶 ?ㅽ뙣:", err);
        if (!cachedCoin) {
          const mockCoin = MOCK_COINS.find(
            (c) => c.symbol.toUpperCase() === symbol
          );
          if (mockCoin) {
            setCoin({
              symbol: mockCoin.symbol,
              name: mockCoin.name,
              price: mockCoin.price || 0,
              change24h: mockCoin.change24h || 0,
              volume24h: mockCoin.volume24h || 0,
              marketCap: mockCoin.marketCap || 0,
            });
            setError("?ㅼ떆媛??곗씠?곕? 遺덈윭?ㅼ? 紐삵빐 罹먯떆???곗씠?곕? ?쒖떆?⑸땲??");
          } else {
            setError("肄붿씤??李얠쓣 ???놁뒿?덈떎.");
          }
        }
      } finally {
        setLoading(false);
      }
    }

    fetchCoinData();

    const interval = setInterval(fetchCoinData, 30000);
    return () => clearInterval(interval);
  }, [symbol]);

  // AdvancedChart에 전달할 ChartAsset 형식으로 변환
  const chartAsset: ChartAsset | null = coin
    ? {
        symbol: coin.symbol,
        name: coin.name,
        price: coin.price,
        changePercent: coin.change24h,
        isPositive: coin.change24h >= 0,
        kind: "crypto",
        country: "GLOBAL",
        logo: coin.symbol.substring(0, 1),
      }
    : null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-zinc-500 dark:text-zinc-400">濡쒕뵫 以?..</p>
        </div>
      </div>
    );
  }

  if (!coin && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
            肄붿씤??李얠쓣 ???놁뒿?덈떎
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 mb-8">
            ?붿껌?섏떊 肄붿씤 ({symbol})??李얠쓣 ???놁뒿?덈떎.
          </p>
          <Link
            href="/"
            className="inline-block bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold px-6 py-3 rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all"
          >
            ?덉쑝濡??뚯븘媛湲?
          </Link>
        </div>
      </div>
    );
  }

  const isPositive = (coin?.change24h ?? 0) >= 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Back Button */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 mb-6"
      >
        ???ㅻ줈 媛湲?
      </Link>

      {/* Error Banner */}
      {error && (
        <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
          <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>
        </div>
      )}

      {/* Coin Header */}
      <div className="glass rounded-3xl p-8 shadow-2xl shadow-blue-500/10 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
              {coin?.name}
            </h1>
            <p className="text-xl text-zinc-500 dark:text-zinc-400">
              {coin?.symbol}
            </p>
          </div>
          <div className="text-right">
            <p className="text-5xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
              ₩{coin?.price?.toLocaleString()}
            </p>
            <p
              className={`text-2xl font-semibold ${
                isPositive
                  ? "text-profit"
                  : "text-loss"
              }`}
            >
              {isPositive ? "+" : ""}
              {coin?.change24h?.toFixed(2)}%
            </p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="glass rounded-2xl p-6 shadow-lg">
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
            ?쒓?珥앹븸
          </p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {coin?.marketCap ? `$${coin.marketCap.toLocaleString()}` : "-"}
          </p>
        </div>
        <div className="glass rounded-2xl p-6 shadow-lg">
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
            24?쒓컙 嫄곕옒??
          </p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {coin?.volume24h ? coin.volume24h.toLocaleString() : "-"}
          </p>
        </div>
        <div className="glass rounded-2xl p-6 shadow-lg">
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
            24?쒓컙 蹂?숇쪧
          </p>
          <p
            className={`text-2xl font-bold ${
              isPositive
                ? "text-profit"
                : "text-loss"
            }`}
          >
            {isPositive ? "+" : ""}
            {coin?.change24h?.toFixed(2)}%
          </p>
        </div>
      </div>

      {/* Chart Section */}
      <div className="glass rounded-3xl shadow-2xl shadow-blue-500/10 mb-8 overflow-hidden">
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            媛寃?李⑦듃
          </h2>
        </div>
        <div className="h-[500px]">
          {chartAsset && <AdvancedChart selectedAsset={chartAsset} />}
        </div>
      </div>

      {/* Trading Section Placeholder */}
      <div className="glass rounded-3xl p-8 shadow-2xl shadow-blue-500/10">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-6">
          嫄곕옒
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="text-center py-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
            <p className="text-zinc-500 dark:text-zinc-400 font-semibold">
              留ㅼ닔 二쇰Ц
            </p>
            <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-2">
              濡쒓렇?????댁슜 媛?ν빀?덈떎
            </p>
          </div>
          <div className="text-center py-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
            <p className="text-zinc-500 dark:text-zinc-400 font-semibold">
              留ㅻ룄 二쇰Ц
            </p>
            <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-2">
              濡쒓렇?????댁슜 媛?ν빀?덈떎
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
