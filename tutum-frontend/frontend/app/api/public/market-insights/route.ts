import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type BackendInsightCard = {
  id?: string;
  title?: string;
  body?: string;
  tone?: "positive" | "neutral" | "caution" | string;
};

const FALLBACK_INSIGHT_CARDS = [
  {
    id: "fallback-liquidity",
    title: "실시간 브리핑 준비 중",
    body: "시장 브리핑 원문이 일시적으로 비어 있어도 핵심 홈 화면은 계속 사용할 수 있게 유지하고 있습니다.",
    tone: "neutral",
  },
  {
    id: "fallback-risk",
    title: "변동성 확대 시 분산 확인",
    body: "종목과 코인 비중이 한쪽에 치우쳤다면 새 이슈가 들어오기 전까지 비중 점검을 우선하는 편이 안전합니다.",
    tone: "caution",
  },
  {
    id: "fallback-watch",
    title: "핵심 보유 자산 우선 체크",
    body: "새 뉴스 수집이 지연될 때는 보유 비중이 큰 자산부터 가격, 거래량, 최근 공시를 먼저 확인하는 흐름이 좋습니다.",
    tone: "positive",
  },
] as const;

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
    const response = await fetch(`${getBackendBaseUrl()}/api/v1/market/insights`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        cacheHit: false,
        cards: [...FALLBACK_INSIGHT_CARDS],
      });
    }

    const payload = await response.json();
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];

    return NextResponse.json({
      generatedAt: payload?.generatedAt ?? new Date().toISOString(),
      cacheHit: Boolean(payload?.cacheHit),
      cards: cards.map((card: BackendInsightCard, index: number) => ({
        id: card.id ?? `market-${index + 1}`,
        title: card.title ?? "",
        body: card.body ?? "",
        tone:
          card.tone === "positive" || card.tone === "caution" || card.tone === "neutral"
            ? card.tone
            : "neutral",
      })),
    });
  } catch (error) {
    console.warn("Public market insights fallback activated:", error);
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        cacheHit: false,
        cards: [...FALLBACK_INSIGHT_CARDS],
      },
    );
  }
}
