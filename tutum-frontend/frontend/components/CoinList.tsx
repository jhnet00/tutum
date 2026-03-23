"use client";

import { useCoins } from "../lib/hooks/useCoins";
import CoinItem from "./CoinItem";

export default function CoinList() {
  const { coins, loading, error } = useCoins();

  if (loading) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm dark:bg-zinc-900">
        <div className="flex animate-pulse flex-col gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-zinc-100 dark:bg-zinc-800" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm dark:bg-zinc-900">
        <p className="text-zinc-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-3xl p-6 shadow-2xl shadow-blue-500/10">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gradient">
          실시간 시세
        </h2>
        <span className="rounded-full bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-1 text-sm font-semibold text-white">
          {coins.length}개 코인
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {coins.map((coin) => (
          <CoinItem key={coin.id} coin={coin} />
        ))}
      </div>
    </div>
  );
}
