import { NextResponse } from 'next/server';

export async function GET() {
    const insights = [
        {
            id: 1,
            type: "summary",
            title: "시장 요약",
            content: "현재 시장은 전반적인 상승세를 보이며, 기술주 중심의 강세가 뚜렷합니다. 특히 AI 관련 섹터의 거래량이 급증하고 있습니다.",
            confidence: 92,
            timestamp: new Date().toISOString()
        },
        {
            id: 2,
            type: "risk",
            title: "리스크 감지",
            content: "일부 암호화폐 자산에서 변동성 확대가 예상됩니다. 특히 단기 급등에 따른 차익 실현 매물 출회 가능성에 유의하세요.",
            level: "high",
            timestamp: new Date().toISOString()
        },
        {
            id: 3,
            type: "action",
            title: "추천 행동",
            content: "상승 추세가 강한 종목 위주로 포트폴리오 비중을 재조정하는 것을 권장합니다. 현금 비중은 15% 수준 유지가 유리할 수 있습니다.",
            priority: "medium",
            timestamp: new Date().toISOString()
        }
    ];

    return NextResponse.json({ insights });
}
