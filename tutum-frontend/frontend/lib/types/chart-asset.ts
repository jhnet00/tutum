export type ChartAssetKind = "stock" | "crypto";

export interface ChartAsset {
  symbol: string;
  name: string;
  kind: ChartAssetKind;
  country?: string;
  price?: number;
  changePercent?: number;
  isPositive?: boolean;
  logo?: string;
  history?: number[];
}

export function formatPercent(value?: number): string {
  const n = Number(value ?? 0);
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function toLogo(symbol: string): string {
  return (symbol || "?").slice(0, 1).toUpperCase();
}
