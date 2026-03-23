/**
 * Asset Type and Currency Detector
 * Auto-detects asset type (stock/crypto/etf) and currency from symbol
 */

export type AssetType = 'stock' | 'crypto' | 'etf';
export type Currency = 'KRW' | 'USD' | 'JPY';

// Known cryptocurrency symbols
const CRYPTO_SYMBOLS = new Set([
  'BTC',
  'ETH',
  'XRP',
  'USDT',
  'BNB',
  'SOL',
  'ADA',
  'DOGE',
]);

/**
 * Detects asset type from symbol pattern
 * @param symbol - The asset symbol (e.g., '005930', 'TSLA', 'BTC')
 * @returns Asset type: 'stock', 'crypto', or 'etf'
 */
export function detectAssetType(symbol: string): AssetType {
  if (!symbol) return 'stock';

  const upperSymbol = symbol.toUpperCase().trim();

  // Check for crypto symbols
  if (CRYPTO_SYMBOLS.has(upperSymbol)) {
    return 'crypto';
  }

  // Check for ETF (contains "ETF" in symbol)
  if (upperSymbol.includes('ETF')) {
    return 'etf';
  }

  // Check for Korean stock code (6-digit number)
  if (/^\d{6}$/.test(upperSymbol)) {
    return 'stock';
  }

  // Check for US stock (3-4 letter uppercase)
  if (/^[A-Z]{3,4}$/.test(upperSymbol)) {
    return 'stock';
  }

  // Default to stock
  return 'stock';
}

/**
 * Detects currency based on symbol and asset type
 * @param symbol - The asset symbol (e.g., '005930', 'TSLA', 'BTC')
 * @returns Currency: 'KRW', 'USD', or 'JPY'
 */
export function detectCurrency(symbol: string): Currency {
  if (!symbol) return 'KRW';

  const upperSymbol = symbol.toUpperCase().trim();

  // Korean stock code (6-digit number) -> KRW
  if (/^\d{6}$/.test(upperSymbol)) {
    return 'KRW';
  }

  // Crypto -> USD
  if (CRYPTO_SYMBOLS.has(upperSymbol)) {
    return 'USD';
  }

  // US stock (3-4 letter uppercase) -> USD
  if (/^[A-Z]{3,4}$/.test(upperSymbol)) {
    return 'USD';
  }

  // Default to KRW
  return 'KRW';
}

/**
 * Detects both asset type and currency in one call
 * @param symbol - The asset symbol
 * @returns Object with assetType and currency
 */
export function detectAsset(symbol: string) {
  return {
    assetType: detectAssetType(symbol),
    currency: detectCurrency(symbol),
  };
}
