"use client";

import Link from "next/link";
import { HeartIcon } from "./Icons";
import { useLocalWatchlist } from "../lib/hooks/useLocalWatchlist";
import LightweightSparkline from "./Sparkline";
import { CoinData } from "../lib/types";

interface CoinItemProps {
  coin: CoinData;
}

export default function CoinItem({ coin }: CoinItemProps) {
  const { isInWatchlist, toggleWatchlist } = useLocalWatchlist();
  const isPositive = (coin.change24h ?? 0) >= 0;

  // Skip rendering if essential data is missing
  if (!coin.price || !coin.symbol) {
    return null;
  }

  return (
    <Link href={`/coin/${coin.symbol}`}>
      <div className="group flex items-center rounded-xl px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        {/* Heart Icon - First */}
        <button
          onClick={(e) => {
            e.preventDefault();
            toggleWatchlist(coin.symbol);
          }}
          className={`rounded-full p-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            isInWatchlist(coin.symbol)
              ? "text-red-500"
              : "text-zinc-300 dark:text-zinc-700"
          }`}
        >
          <HeartIcon 
            className="h-5 w-5" 
            fill={isInWatchlist(coin.symbol) ? "currentColor" : "none"} 
            stroke={isInWatchlist(coin.symbol) ? "none" : "currentColor"}
          />
        </button>

        {/* Coin Name - Second */}
        <div className="w-24 ml-2">
          <p className="font-bold text-zinc-900 dark:text-zinc-100">
            {coin.symbol}
          </p>
          <p className="text-xs text-zinc-500 truncate">
            {coin.name}
          </p>
        </div>

        {/* Price - Third */}
        <div className="text-left min-w-[120px] ml-4">
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            ${coin.price?.toLocaleString() ?? 'N/A'}
          </p>
        </div>

        {/* Change 24h - Fourth */}
        <div className="text-left min-w-[80px] ml-4">
          <p
            className={`text-sm font-medium ${
              isPositive
                ? "text-profit"
                : "text-loss"
            }`}
          >
            {isPositive ? "+" : ""}
            {(coin.change24h ?? 0).toFixed(2)}%
          </p>
        </div>

        {/* Sparkline Chart - Fifth (right-most) */}
        <div className="hidden h-10 w-24 sm:block ml-auto">
          <LightweightSparkline
            data={coin.sparklineData?.map((v, i) => ({ value: v, date: i.toString() })) || []}
            width={96}
            height={40}
          />
        </div>
      </div>
    </Link>
  );
}
