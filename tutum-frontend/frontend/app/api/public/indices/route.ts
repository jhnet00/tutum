import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type BackendIndexItem = {
  id?: string;
  symbol?: string;
  name?: string;
  price?: number | null;
  change?: number | null;
  changePercent?: number | null;
  currency?: string;
  marketStatus?: string;
  updatedAt?: string | null;
  stale?: boolean;
  available?: boolean;
  source?: string;
};

const FALLBACK_INDEX_ITEMS = [
  {
    id: "kospi-fallback",
    symbol: "KOSPI",
    name: "코스피",
    price: null,
    change: null,
    changePercent: null,
    currency: "KRW",
    marketStatus: "unknown",
    updatedAt: null,
    stale: true,
    available: false,
    source: "error",
  },
  {
    id: "sp500-fallback",
    symbol: "S&P 500",
    name: "미국 대표 지수",
    price: null,
    change: null,
    changePercent: null,
    currency: "USD",
    marketStatus: "unknown",
    updatedAt: null,
    stale: true,
    available: false,
    source: "error",
  },
  {
    id: "nasdaq100-fallback",
    symbol: "NASDAQ 100",
    name: "나스닥 100",
    price: null,
    change: null,
    changePercent: null,
    currency: "USD",
    marketStatus: "unknown",
    updatedAt: null,
    stale: true,
    available: false,
    source: "error",
  },
] as const satisfies BackendIndexItem[];

function getBackendBaseUrl(): string {
  return (
    process.env.BACKEND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_BASE_URL ||
    "http://localhost:8000"
  );
}

export async function GET() {
  try {
    const response = await fetch(`${getBackendBaseUrl()}/api/v1/market/indices`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        items: [...FALLBACK_INDEX_ITEMS],
      });
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];

    return NextResponse.json({
      generatedAt: payload?.generatedAt ?? new Date().toISOString(),
      items: items.map((item: BackendIndexItem) => ({
        id: item.id ?? "",
        symbol: item.symbol ?? "",
        name: item.name ?? "",
        price: typeof item.price === "number" ? item.price : null,
        change: typeof item.change === "number" ? item.change : null,
        changePercent: typeof item.changePercent === "number" ? item.changePercent : null,
        currency: item.currency ?? "KRW",
        marketStatus: item.marketStatus ?? "unknown",
        updatedAt: item.updatedAt ?? null,
        stale: Boolean(item.stale),
        available: Boolean(item.available),
        source: item.source ?? "error",
      })),
    });
  } catch (error) {
    console.warn("Public indices fallback activated:", error);
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        items: [...FALLBACK_INDEX_ITEMS],
      },
    );
  }
}
