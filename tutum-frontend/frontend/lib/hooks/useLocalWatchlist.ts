"use client";

import { useState, useEffect } from "react";

export function useLocalWatchlist() {
  const [watchlist, setWatchlist] = useState<string[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("tutum_watchlist");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        setWatchlist(parsed.filter((item): item is string => typeof item === "string"));
      }
    } catch {
      localStorage.removeItem("tutum_watchlist");
    }
  }, []);

  const toggleWatchlist = (symbol: string) => {
    const next = watchlist.includes(symbol)
      ? watchlist.filter((s) => s !== symbol)
      : [...watchlist, symbol];

    setWatchlist(next);
    localStorage.setItem("tutum_watchlist", JSON.stringify(next));
  };

  const isInWatchlist = (symbol: string) => watchlist.includes(symbol);

  return { watchlist, toggleWatchlist, isInWatchlist };
}
