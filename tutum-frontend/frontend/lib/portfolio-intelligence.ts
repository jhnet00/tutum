export type MarketIndexItem = {
  id: "kospi" | "sp500" | "nasdaq";
  symbol: "^KS11" | "^GSPC" | "^IXIC";
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  currency: "KRW" | "USD";
  marketStatus: "open" | "closed" | "unknown";
  updatedAt: string | null;
  stale: boolean;
  available: boolean;
  source: "yahoo" | "cache" | "last_good" | "error";
};
