"use client";

/**
 * useMarketPrices - 사이드바용 실시간 시세 조회 훅
 *
 * 주식(KIS)과 코인(Upbit) 배치 API를 호출하여
 * 30초 간격으로 실시간 가격을 갱신합니다.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { allAssets } from "../mock-data";

const API_BASE_URL = "/api/proxy";

export interface MarketPrice {
    price: number;        // 현재가 (주식: USD/KRW 원본, 코인: KRW)
    changePercent: number; // 변동률 (%)
    isKRW: boolean;       // true면 이미 KRW, false면 USD
}

export type StreamStatus = "connecting" | "connected" | "reconnecting" | "fallback";

// allAssets에서 주식/코인 심볼 추출
const STOCK_SYMBOLS = allAssets
    .filter((a) => a.type === "주식")
    .map((a) => a.symbol);

const CRYPTO_SYMBOLS = allAssets
    .filter((a) => a.type === "코인")
    .map((a) => a.symbol);

export function useMarketPrices() {
    const [prices, setPrices] = useState<Record<string, MarketPrice>>({});
    const [loading, setLoading] = useState(true);
    const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
    const mountedRef = useRef(true);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wsConnectedRef = useRef(false);

    const allSymbols = useMemo(() => [...new Set([...STOCK_SYMBOLS, ...CRYPTO_SYMBOLS])], []);

    const wsUrl =
        typeof window !== "undefined"
            ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`
            : "ws://localhost:8000";

    const fetchPrices = useCallback(async () => {
        try {
            const results: Record<string, MarketPrice> = {};

            // 주식 + 코인 배치 API 동시 호출
            const [stockRes, cryptoRes] = await Promise.allSettled([
                STOCK_SYMBOLS.length > 0
                    ? fetch(`${API_BASE_URL}/api/v1/market/prices/stocks?symbols=${STOCK_SYMBOLS.join(",")}`)
                    : null,
                CRYPTO_SYMBOLS.length > 0
                    ? fetch(`${API_BASE_URL}/api/v1/market/prices/crypto?tickers=${CRYPTO_SYMBOLS.join(",")}`)
                    : null,
            ]);

            // 주식 처리
            if (stockRes.status === "fulfilled" && stockRes.value?.ok) {
                const data = await stockRes.value.json();
                if (data.prices) {
                    for (const p of data.prices) {
                        if (p.error) continue;
                        const price = typeof p.price === "string" ? parseFloat(p.price) : p.price;
                        const change = typeof p.change === "string" ? parseFloat(p.change) : (p.change || 0);
                        const prevPrice = price - change;
                        const changePercent = prevPrice !== 0 ? (change / prevPrice) * 100 : 0;
                        // 6자리 숫자면 한국 주식 (KRW), 아니면 미국 주식 (USD)
                        const isKRW = /^\d{6}$/.test(p.code);

                        results[p.code] = { price, changePercent, isKRW };
                    }
                }
            }

            // 코인 처리 (Upbit는 KRW 반환)
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

            if (mountedRef.current && Object.keys(results).length > 0) {
                setPrices(results);
                if (!wsConnectedRef.current) setStreamStatus("fallback");
            }
        } catch (err) {
            console.error("시세 데이터 로드 실패:", err);
            if (!wsConnectedRef.current) setStreamStatus("fallback");
        } finally {
            if (mountedRef.current) {
                setLoading(false);
            }
        }
    }, []);

    const applyWsItems = useCallback((items: any[]) => {
        if (!mountedRef.current || !Array.isArray(items)) return;

        const next: Record<string, MarketPrice> = {};
        for (const p of items) {
            if (!p || p.error) continue;
            const symbol = String(p.symbol || p.code || p.ticker || "")
                .replace("KRW-", "")
                .toUpperCase();
            if (!symbol) continue;

            const price = typeof p.price === "string" ? parseFloat(p.price) : Number(p.price || 0);
            const change = typeof p.change === "string" ? parseFloat(p.change) : Number(p.change || 0);
            const changePercentRaw = p.change_percent ?? p.changePercent;
            const hasChangePercent = typeof changePercentRaw === "number" || typeof changePercentRaw === "string";
            const changePercent = hasChangePercent
                ? Number(changePercentRaw)
                : (price - change !== 0 ? (change / (price - change)) * 100 : 0);
            const isKRW = /^\d{6}$/.test(symbol) || CRYPTO_SYMBOLS.includes(symbol);

            next[symbol] = { price, changePercent, isKRW };
        }

        if (Object.keys(next).length > 0) {
            setPrices((prev) => ({ ...prev, ...next }));
            setLoading(false);
        }
    }, []);

    const connectWs = useCallback(() => {
        if (!mountedRef.current || wsRef.current) return;
        setStreamStatus((prev) => (prev === "connected" ? "reconnecting" : "connecting"));

        const url = `${wsUrl}/api/v1/market/ws?symbols=${encodeURIComponent(allSymbols.join(","))}&interval_ms=2000`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            wsConnectedRef.current = true;
            setLoading(false);
            setStreamStatus("connected");
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg?.type === "prices") {
                    applyWsItems(msg.items || []);
                }
            } catch {
                // ignore malformed frames
            }
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
        connectWs();
        fetchPrices();

        // WS 비연결 상태일 때만 REST 폴백 폴링
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

    return { prices, loading, streamStatus };
}
