// Simple in-memory cache for CoinGecko API responses
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class MemoryCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  
  get<T>(key: string, ttlSeconds: number): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    const now = Date.now();
    const age = (now - entry.timestamp) / 1000; // seconds
    
    if (age > ttlSeconds) {
      // Don't delete immediately on age, let GET caller decide if they want stale data
      return null;
    }
    
    return entry.data as T;
  }

  // Get data regardless of TTL (useful for 429 fallback)
  getStale<T>(key: string): T | null {
    const entry = this.cache.get(key);
    return entry ? (entry.data as T) : null;
  }
  
  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }
  
  clear(): void {
    this.cache.clear();
  }
}

// Export singleton instance
export const apiCache = new MemoryCache();

// Seed initial data for development/testing to handle initial rate limits
// These are realistic prices used as fallback
apiCache.set('coingecko_prices', {
  'bitcoin': { usd: 96435.21, usd_24h_change: 1.39, usd_market_cap: 1900000000, usd_24h_vol: 35000000000 },
  'ethereum': { usd: 3325.31, usd_24h_change: -0.02, usd_market_cap: 400000000, usd_24h_vol: 15000000000 },
  'binancecoin': { usd: 935.66, usd_24h_change: -1.12, usd_market_cap: 140000000, usd_24h_vol: 1200000000 },
  'solana': { usd: 145.03, usd_24h_change: -0.25, usd_market_cap: 65000000, usd_24h_vol: 4500000000 },
  'ripple': { usd: 2.12, usd_24h_change: -2.12, usd_market_cap: 120000000, usd_24h_vol: 3200000000 },
  'cardano': { usd: 0.409, usd_24h_change: -2.90, usd_market_cap: 14500000, usd_24h_vol: 450000000 },
  'dogecoin': { usd: 0.145, usd_24h_change: -1.77, usd_market_cap: 21000000, usd_24h_vol: 1100000000 },
  'avalanche-2': { usd: 14.47, usd_24h_change: -1.80, usd_market_cap: 5800000, usd_24h_vol: 320000000 },
  'polkadot': { usd: 2.22, usd_24h_change: -2.23, usd_market_cap: 3200000, usd_24h_vol: 120000000 }
});
