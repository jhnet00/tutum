/**
 * 코인 데이터 타입 정의
 * CoinGecko API 응답 형식을 기반으로 설계됨
 */
export interface CoinData {
  id: string;            // CoinGecko ID (예: 'bitcoin')
  symbol: string;        // 티커 심볼 (예: 'BTC')
  name: string;          // 표시 이름 (예: 'Bitcoin')
  price?: number;        // 현재가 (USD)
  change24h?: number;    // 24시간 변동률 (%)
  volume24h?: number;    // 24시간 거래량
  marketCap?: number;    // 시가총액
  sparklineData: number[]; // 미니 차트용 가격 데이터
}

/**
 * 추적 대상 코인 목록
 * CoinGecko API 호출 시 사용됩니다.
 */
export const TRACKED_COINS = [
  'bitcoin',
  'ethereum',
  'binancecoin',
  'solana',
  'ripple',
  'cardano',
  'dogecoin',
  'avalanche-2',
  'polkadot'
];

/**
 * 티커 심볼 → CoinGecko ID 매핑
 * UI에서 심볼로 표시하고 API 호출 시 ID로 변환합니다.
 */
export const COIN_ID_MAP: Record<string, string> = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'BNB': 'binancecoin',
  'SOL': 'solana',
  'XRP': 'ripple',
  'ADA': 'cardano',
  'DOGE': 'dogecoin',
  'AVAX': 'avalanche-2',
  'DOT': 'polkadot',
};
