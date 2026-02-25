"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { MOCK_COINS } from "../../../lib/mock-data";
import AdvancedChart from "@/components/AdvancedChart";
import { Asset } from "@/lib/mock-data";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// 심볼 -> 이름 매핑
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
    async function fetchCoinData() {
      if (!symbol) return;

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/v1/market/price/crypto/${symbol}`
        );

        if (!response.ok) {
          throw new Error("코인 시세 조회 실패");
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error);
        }

        setCoin({
          symbol: symbol,
          name: COIN_NAMES[symbol] || symbol,
          price: data.price || 0,
          change24h: data.change_percent || 0,
          volume24h: data.volume || 0,
          marketCap: 0,
        });
      } catch (err) {
        console.error("코인 데이터 로드 실패:", err);
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
          setError("실시간 데이터를 불러오지 못해 캐시된 데이터를 표시합니다.");
        } else {
          setError("코인을 찾을 수 없습니다.");
        }
      } finally {
        setLoading(false);
      }
    }

    fetchCoinData();

    const interval = setInterval(fetchCoinData, 30000);
    return () => clearInterval(interval);
  }, [symbol]);

  // AdvancedChart에 전달할 Asset 형식으로 변환
  const chartAsset: Asset | null = coin
    ? {
        symbol: coin.symbol,
        name: coin.name,
        price: coin.price.toLocaleString(),
        change: `${coin.change24h >= 0 ? "+" : ""}${coin.change24h.toFixed(2)}%`,
        isPositive: coin.change24h >= 0,
        type: "코인",
        logo: coin.symbol.substring(0, 1),
        logoColor: "bg-orange-500 text-white",
      }
    : null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-zinc-500 dark:text-zinc-400">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!coin && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
            코인을 찾을 수 없습니다
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 mb-8">
            요청하신 코인 ({symbol})을 찾을 수 없습니다.
          </p>
          <Link
            href="/"
            className="inline-block bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold px-6 py-3 rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all"
          >
            홈으로 돌아가기
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
        ← 뒤로 가기
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
            시가총액
          </p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {coin?.marketCap ? `$${coin.marketCap.toLocaleString()}` : "-"}
          </p>
        </div>
        <div className="glass rounded-2xl p-6 shadow-lg">
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
            24시간 거래량
          </p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {coin?.volume24h ? coin.volume24h.toLocaleString() : "-"}
          </p>
        </div>
        <div className="glass rounded-2xl p-6 shadow-lg">
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
            24시간 변동률
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
            가격 차트
          </h2>
        </div>
        <div className="h-[500px]">
          {chartAsset && <AdvancedChart selectedAsset={chartAsset} />}
        </div>
      </div>

      {/* Trading Section Placeholder */}
      <div className="glass rounded-3xl p-8 shadow-2xl shadow-blue-500/10">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-6">
          거래
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="text-center py-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
            <p className="text-zinc-500 dark:text-zinc-400 font-semibold">
              매수 주문
            </p>
            <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-2">
              로그인 후 이용 가능합니다
            </p>
          </div>
          <div className="text-center py-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
            <p className="text-zinc-500 dark:text-zinc-400 font-semibold">
              매도 주문
            </p>
            <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-2">
              로그인 후 이용 가능합니다
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
