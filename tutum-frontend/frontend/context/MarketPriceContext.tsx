"use client";

/**
 * MarketPriceContext — 전역 시세 단일 소스 (Single Source of Truth)
 *
 * MarketSnapshot / WatchlistPreview / WatchlistSidebar 가
 * 각각 독립적으로 API를 호출해 같은 종목의 가격이 다르게 보이는 문제를 해결합니다.
 *
 * - WebSocket 연결 → 실패 시 30초마다 REST 배치 API 폴백
 * - 단일 sessionStorage 캐시(market_prices_unified, 2분 TTL)
 *   → 어느 컴포넌트가 읽어도 같은 시점의 가격 보장
 */

import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    useRef,
    useMemo,
    type ReactNode,
} from "react";

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface MarketPrice {
    price: number;
    changePercent: number;
    isKRW: boolean;
}

export type StreamStatus = "connecting" | "connected" | "reconnecting" | "fallback";

interface MarketPriceContextValue {
    priceMap: Record<string, MarketPrice>;
    streamStatus: StreamStatus;
    lastUpdated: Date | null;
    refresh: () => void;
}

// ── 상수 ──────────────────────────────────────────────────────────────────────

const ALL_STOCK_SYMBOLS = ["005930", "TSLA", "NVDA", "AAPL"];
const ALL_CRYPTO_SYMBOLS = ["BTC", "ETH", "SOL", "ADA", "USDT", "XRP", "DOGE", "AVAX", "DOT"];

const API_BASE_URL = "/api/proxy";
const CACHE_KEY = "market_prices_unified";
const CACHE_TTL_MS = 2 * 60 * 1000; // 2분

// ── 캐시 헬퍼 ─────────────────────────────────────────────────────────────────

function loadCache(): Record<string, MarketPrice> | null {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts > CACHE_TTL_MS) return null;
        return data;
    } catch { return null; }
}

function saveCache(data: Record<string, MarketPrice>) {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch { /* ignore quota errors */ }
}

// ── Context ───────────────────────────────────────────────────────────────────

const MarketPriceContext = createContext<MarketPriceContextValue>({
    priceMap: {},
    streamStatus: "connecting",
    lastUpdated: null,
    refresh: () => {},
});

export function useMarketPriceContext() {
    return useContext(MarketPriceContext);
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function MarketPriceProvider({ children }: { children: ReactNode }) {
    const [priceMap, setPriceMap] = useState<Record<string, MarketPrice>>({});
    const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const mountedRef = useRef(true);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wsConnectedRef = useRef(false);

    const allSymbols = useMemo(
        () => [...new Set([...ALL_STOCK_SYMBOLS, ...ALL_CRYPTO_SYMBOLS])],
        []
    );

    // WebSocket URL: SSR 안전 처리
    const wsUrl =
        typeof window !== "undefined"
            ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`
            : "ws://localhost:8000";

    // 가격 업데이트 + 캐시 저장
    const updatePrices = useCallback((updates: Record<string, MarketPrice>) => {
        if (!mountedRef.current || Object.keys(updates).length === 0) return;
        setPriceMap((prev) => {
            const next = { ...prev, ...updates };
            saveCache(next);
            return next;
        });
        setLastUpdated(new Date());
    }, []);

    // REST 배치 API 폴링 (WS 미연결 시 fallback)
    const fetchPrices = useCallback(async () => {
        try {
            const [stockRes, cryptoRes] = await Promise.allSettled([
                fetch(
                    `${API_BASE_URL}/api/v1/market/prices/stocks?symbols=${ALL_STOCK_SYMBOLS.join(",")}`
                ),
                fetch(
                    `${API_BASE_URL}/api/v1/market/prices/crypto?tickers=${ALL_CRYPTO_SYMBOLS.join(",")}`
                ),
            ]);

            const results: Record<string, MarketPrice> = {};

            if (stockRes.status === "fulfilled" && stockRes.value?.ok) {
                const data = await stockRes.value.json();
                if (data.prices) {
                    for (const p of data.prices) {
                        if (p.error) continue;
                        const price =
                            typeof p.price === "string" ? parseFloat(p.price) : p.price;
                        const change =
                            typeof p.change === "string"
                                ? parseFloat(p.change)
                                : p.change || 0;
                        const prevPrice = price - change;
                        const changePercent =
                            prevPrice !== 0 ? (change / prevPrice) * 100 : 0;
                        const isKRW = /^\d{6}$/.test(p.code);
                        results[p.code] = { price, changePercent, isKRW };
                    }
                }
            }

            if (cryptoRes.status === "fulfilled" && cryptoRes.value?.ok) {
                const data = await cryptoRes.value.json();
                if (data.prices) {
                    for (const p of data.prices) {
                        if (p.error) continue;
                        const symbol = p.ticker?.replace("KRW-", "") || "";
                        results[symbol] = {
                            price: p.price,
                            changePercent: p.change_percent || 0,
                            isKRW: true,
                        };
                    }
                }
            }

            if (Object.keys(results).length > 0) {
                updatePrices(results);
                if (!wsConnectedRef.current) setStreamStatus("fallback");
            }
        } catch (err) {
            console.error("[MarketPriceContext] 시세 로드 실패:", err);
            if (!wsConnectedRef.current) setStreamStatus("fallback");
        }
    }, [updatePrices]);

    // WebSocket 메시지 → 가격 적용
    const applyWsItems = useCallback(
        (items: any[]) => {
            if (!mountedRef.current || !Array.isArray(items)) return;
            const next: Record<string, MarketPrice> = {};
            for (const p of items) {
                if (!p || p.error) continue;
                const symbol = String(p.symbol || p.code || p.ticker || "")
                    .replace("KRW-", "")
                    .toUpperCase();
                if (!symbol) continue;

                const price =
                    typeof p.price === "string" ? parseFloat(p.price) : Number(p.price || 0);
                const change =
                    typeof p.change === "string"
                        ? parseFloat(p.change)
                        : Number(p.change || 0);
                const changePercentRaw = p.change_percent ?? p.changePercent;
                const changePercent =
                    typeof changePercentRaw === "number" || typeof changePercentRaw === "string"
                        ? Number(changePercentRaw)
                        : price - change !== 0
                        ? (change / (price - change)) * 100
                        : 0;
                const isKRW =
                    /^\d{6}$/.test(symbol) || ALL_CRYPTO_SYMBOLS.includes(symbol);
                next[symbol] = { price, changePercent, isKRW };
            }
            if (Object.keys(next).length > 0) updatePrices(next);
        },
        [updatePrices]
    );

    // WebSocket 연결
    const connectWs = useCallback(() => {
        if (!mountedRef.current || wsRef.current) return;
        setStreamStatus((prev) =>
            prev === "connected" ? "reconnecting" : "connecting"
        );

        const url = `${wsUrl}/api/v1/market/ws?symbols=${encodeURIComponent(
            allSymbols.join(",")
        )}&interval_ms=2000`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            wsConnectedRef.current = true;
            setStreamStatus("connected");
        };
        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg?.type === "prices") applyWsItems(msg.items || []);
            } catch { /* ignore malformed frames */ }
        };
        ws.onerror = () => {
            wsConnectedRef.current = false;
            setStreamStatus("fallback");
        };
        ws.onclose = () => {
            wsConnectedRef.current = false;
            setStreamStatus("reconnecting");
            wsRef.current = null;
            if (mountedRef.current) {
                reconnectTimerRef.current = setTimeout(connectWs, 2000);
            }
        };
    }, [allSymbols, applyWsItems, wsUrl]);

    useEffect(() => {
        mountedRef.current = true;

        // 캐시 즉시 로드 → 화면 전환 시 빈 가격 없이 표시
        const cached = loadCache();
        if (cached && Object.keys(cached).length > 0) {
            setPriceMap(cached);
            setStreamStatus("fallback");
            setLastUpdated(new Date());
        }

        connectWs();
        fetchPrices();

        // WS 비연결 시에만 30초 REST 폴링
        const interval = setInterval(() => {
            if (!wsConnectedRef.current) fetchPrices();
        }, 30000);

        return () => {
            mountedRef.current = false;
            clearInterval(interval);
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [fetchPrices, connectWs]);

    return (
        <MarketPriceContext.Provider
            value={{ priceMap, streamStatus, lastUpdated, refresh: fetchPrices }}
        >
            {children}
        </MarketPriceContext.Provider>
    );
}
