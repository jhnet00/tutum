"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { withCsrfHeader } from "@/lib/csrf";

const API_BASE_URL = "/api/proxy";
const WS_BASE_URL =
    typeof window !== "undefined"
        ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`
        : "ws://localhost:8000";
const MAX_DECIMAL_PLACES = 6;

const toFixedDecimal = (value: unknown) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Number(parsed.toFixed(MAX_DECIMAL_PLACES));
};

export interface HoldingAsset {
    id?: string;
    symbol: string;
    name: string;
    amount: number;
    averagePrice: number;
    currentPrice: number;
    change: number;
    changePercent: number;
    value: number;
    profit: number;
    profitPercent: number;
    assetType?: string; // "crypto" | "stock" | "cash"
    memo?: string;
    buyReason?: string;
    aiAnalysis?: string;
}

export type PriceStreamStatus = "connecting" | "connected" | "reconnecting" | "fallback";

interface AssetContextType {
    holdings: HoldingAsset[];
    isLoading: boolean;
    error: string | null;
    priceStreamStatus: PriceStreamStatus;
    fetchHoldings: () => Promise<void>;
    addHoldings: (newHoldings: any[]) => Promise<void>;
    updateAsset: (assetId: string, data: { average_price?: number; quantity?: number }) => Promise<void>;
    deleteAsset: (assetId: string) => Promise<void>;
    resetHoldings: () => void;
    refreshPrices: () => void;
}

const AssetContext = createContext<AssetContextType | undefined>(undefined);

// Mock data for initial guest mode experience
const mockHoldings: HoldingAsset[] = [
    {
        id: "mock-btc",
        symbol: "BTC",
        name: "Bitcoin",
        amount: 0.45,
        averagePrice: 38500,
        currentPrice: 42400,
        change: 3900,
        changePercent: 10.13,
        value: 19080,
        profit: 1755,
        profitPercent: 10.13,
    },
    {
        id: "mock-eth",
        symbol: "ETH",
        name: "Ethereum",
        amount: 5.2,
        averagePrice: 2150,
        currentPrice: 2340,
        change: 190,
        changePercent: 8.84,
        value: 12168,
        profit: 988,
        profitPercent: 8.84,
    },
    {
        id: "mock-sol",
        symbol: "SOL",
        name: "Solana",
        amount: 125,
        averagePrice: 105.2,
        currentPrice: 98.5,
        change: -6.7,
        changePercent: -6.37,
        value: 12312.5,
        profit: -837.5,
        profitPercent: -6.37,
    },
    {
        id: "mock-nvda",
        symbol: "NVDA",
        name: "Nvidia",
        amount: 15,
        averagePrice: 750.4,
        currentPrice: 882.5,
        change: 132.1,
        changePercent: 17.6,
        value: 13237.5,
        profit: 1981.5,
        profitPercent: 17.6,
    },
];

export function AssetProvider({ children }: { children: React.ReactNode }) {
    const [holdings, setHoldings] = useState<HoldingAsset[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [priceStreamStatus, setPriceStreamStatus] = useState<PriceStreamStatus>("connecting");
    const { user, token, isLoading: authLoading } = useAuth();
    const isLocalMockUser = user?.id === "mock-user" || user?.login_type?.includes("mock");
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wsConnectedRef = useRef(false);
    const pendingControllersRef = useRef<Set<AbortController>>(new Set());

    const apiFetch = useCallback(async (path: string, init: RequestInit = {}, timeoutMs = 30000) => {
        const controller = new AbortController();
        pendingControllersRef.current.add(controller);
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            return await fetch(`${API_BASE_URL}${path}`, {
                ...init,
                credentials: init.credentials ?? "include",
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
            pendingControllersRef.current.delete(controller);
        }
    }, []);

    useEffect(() => {
        return () => {
            pendingControllersRef.current.forEach((controller) => controller.abort());
            pendingControllersRef.current.clear();
        };
    }, []);

    const fetchHoldings = useCallback(async () => {
        if (authLoading) {
            setIsLoading(true);
            return;
        }

        if (!user?.id) {
            setError(null);
            setHoldings(mockHoldings);
            setIsLoading(false);
            return;
        }

        if (isLocalMockUser) {
            setError(null);
            setHoldings(mockHoldings);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            // MariaDB portfolio API (JWT 인증)
            const response = await apiFetch(`/api/v1/portfolio`, {
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            });
            if (!response.ok) throw new Error("자산 정보를 불러오는데 실패했습니다.");

            const data = await response.json();

            // portfolio API는 배열을 직접 반환
            if (Array.isArray(data) && data.length > 0) {
                const mappedAssets = data.map((a: any) => {
                    const quantity = a.quantity || 0;
                    const avgPrice = a.avg_buy_price || 0;

                    return {
                        id: String(a.id),
                        symbol: a.asset_code,
                        name: a.asset_name || a.asset_code,
                        amount: quantity,
                        averagePrice: avgPrice,
                        currentPrice: avgPrice, // 초기값, refreshPrices에서 실시간 갱신
                        change: 0,
                        changePercent: 0,
                        value: avgPrice * quantity,
                        profit: 0,
                        profitPercent: 0,
                        assetType: a.asset_type || "crypto",
                    };
                });
                setHoldings(mappedAssets);
            } else {
                setHoldings([]);
            }
        } catch (err: any) {
            console.error("Fetch portfolio error:", err);
            setError(err.message);
            setHoldings([]);
        } finally {
            setIsLoading(false);
        }
    }, [authLoading, user?.id, token, apiFetch, isLocalMockUser]);

    useEffect(() => {
        fetchHoldings();
    }, [fetchHoldings]);

    const refreshAccessTokenForMutation = useCallback(async (): Promise<string | null> => {
        if (!user?.id) return null;

        try {
            const response = await apiFetch(`/api/v1/auth/refresh`, {
                method: "POST",
                credentials: "include",
                headers: withCsrfHeader(),
            });

            if (!response.ok) return null;

            const data = await response.json();
            return typeof data?.access_token === "string" ? data.access_token : null;
        } catch (err) {
            console.warn("Failed to refresh access token for asset mutation:", err);
            return null;
        }
    }, [apiFetch, user?.id]);

    const apiMutate = useCallback(async (
        path: string,
        init: RequestInit = {},
        options: { json?: boolean } = {},
    ) => {
        const buildHeaders = (accessToken?: string | null) => withCsrfHeader({
            ...(options.json ? { "Content-Type": "application/json" } : {}),
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...(init.headers ?? {}),
        });

        let accessToken = token;
        if (!accessToken && user?.id) {
            accessToken = await refreshAccessTokenForMutation();
        }

        let response = await apiFetch(path, {
            ...init,
            headers: buildHeaders(accessToken),
        });

        if ((response.status === 401 || response.status === 403) && user?.id) {
            const refreshedToken = await refreshAccessTokenForMutation();
            if (refreshedToken && refreshedToken !== accessToken) {
                response = await apiFetch(path, {
                    ...init,
                    headers: buildHeaders(refreshedToken),
                });
            }
        }

        return response;
    }, [apiFetch, refreshAccessTokenForMutation, token, user?.id]);

    const addHoldings = async (newHoldings: any[]) => {
        if (!user?.id) {
            console.warn("User not logged in, skipping server sync");
            return;
        }

        if (isLocalMockUser) {
            const added = newHoldings.map((h, index) => {
                const quantity = toFixedDecimal(h.quantity);
                const price = toFixedDecimal(h.price);
                return {
                    id: `mock-${Date.now()}-${index}`,
                    symbol: h.symbol,
                    name: h.name || h.symbol,
                    amount: quantity,
                    averagePrice: price,
                    currentPrice: price,
                    change: 0,
                    changePercent: 0,
                    value: quantity * price,
                    profit: 0,
                    profitPercent: 0,
                    assetType: h.type === "currency" ? "cash" : (h.type || "crypto"),
                } satisfies HoldingAsset;
            });
            setHoldings((prev) => [...prev, ...added]);
            return;
        }

        try {
            // MariaDB portfolio bulk API 형식으로 변환
            const bulkData = {
                assets: newHoldings.map(h => ({
                    asset_code: h.symbol,
                    asset_name: h.name || h.symbol,
                    asset_type: h.type === "currency" ? "cash" : (h.type || "crypto"),
                    quantity: toFixedDecimal(h.quantity),
                    avg_buy_price: toFixedDecimal(h.price),
                    currency: h.currency || "KRW",
                }))
            };

            const response = await apiMutate(`/api/v1/portfolio/bulk`, {
                method: "POST",
                body: JSON.stringify(bulkData)
            }, { json: true });

            if (!response.ok) throw new Error("자산 등록 실패");

            await fetchHoldings();

        } catch (err) {
            console.error("Add holdings error:", err);
            throw err;
        }
    };

    const updateAsset = async (assetId: string, data: { average_price?: number; quantity?: number }) => {
        if (!user?.id) return;

        if (isLocalMockUser) {
            setHoldings((prev) =>
                prev.map((asset) => {
                    if (asset.id !== assetId) return asset;
                    const averagePrice = data.average_price ?? asset.averagePrice;
                    const amount = data.quantity ?? asset.amount;
                    const currentPrice = asset.currentPrice || averagePrice;
                    const change = currentPrice - averagePrice;
                    const profit = (currentPrice - averagePrice) * amount;
                    const changePercent = averagePrice > 0 ? (change / averagePrice) * 100 : 0;
                    return {
                        ...asset,
                        averagePrice,
                        amount,
                        change,
                        changePercent,
                        value: amount * currentPrice,
                        profit,
                        profitPercent: changePercent,
                    };
                })
            );
            return;
        }

        try {
            // MariaDB portfolio API 필드명으로 변환
            const patchData: any = {};
            if (data.average_price !== undefined) patchData.avg_buy_price = data.average_price;
            if (data.quantity !== undefined) patchData.quantity = data.quantity;

            const response = await apiMutate(`/api/v1/portfolio/${assetId}`, {
                method: "PATCH",
                body: JSON.stringify(patchData),
            }, { json: true });

            if (!response.ok) throw new Error("자산 수정 실패");

            await fetchHoldings();
        } catch (err) {
            console.error("Update asset error:", err);
            throw err;
        }
    };

    const deleteAsset = async (assetId: string) => {
        if (!user?.id) return;

        if (isLocalMockUser) {
            setHoldings((prev) => prev.filter((asset) => asset.id !== assetId));
            return;
        }

        try {
            const response = await apiMutate(`/api/v1/portfolio/${assetId}`, {
                method: "DELETE",
            });

            if (!response.ok) throw new Error("자산 삭제 실패");

            await fetchHoldings();
        } catch (err) {
            console.error("Delete asset error:", err);
            throw err;
        }
    };

    const resetHoldings = () => {
        setHoldings(mockHoldings);
        localStorage.setItem("tutum_holdings", JSON.stringify(mockHoldings));
    };

    const applyPriceMap = useCallback((priceMap: Record<string, number>) => {
        if (Object.keys(priceMap).length === 0) return;
        setHoldings((prev) => prev.map(asset => {
            const key = String(asset.symbol || "").toUpperCase();
            const newPrice = priceMap[key];
            if (newPrice && newPrice > 0) {
                return {
                    ...asset,
                    currentPrice: newPrice,
                    change: newPrice - asset.averagePrice,
                    changePercent: asset.averagePrice > 0 ? ((newPrice - asset.averagePrice) / asset.averagePrice) * 100 : 0,
                    value: asset.amount * newPrice,
                    profit: (newPrice - asset.averagePrice) * asset.amount,
                    profitPercent: asset.averagePrice > 0 ? ((newPrice - asset.averagePrice) / asset.averagePrice) * 100 : 0
                };
            }
            return asset;
        }));
    }, []);

    const holdingSymbols = useMemo(() => {
        const symbols = holdings
            .map((h) => String(h.symbol || "").toUpperCase().replace("KRW-", ""))
            .filter(Boolean);
        return [...new Set(symbols)].sort();
    }, [holdings]);
    const holdingSymbolsKey = holdingSymbols.join(",");

    // 현금(통화) 자산 심볼 목록
    const cashSymbolsList = useMemo(() => {
        const symbols = holdings
            .filter((h) => h.assetType === "cash")
            .map((h) => String(h.symbol || "").toUpperCase())
            .filter(Boolean);
        return [...new Set(symbols)].sort();
    }, [holdings]);
    const cashSymbolsKey = cashSymbolsList.join(",");

    const refreshPrices = useCallback(async () => {
        const symbols = holdingSymbolsKey
            ? holdingSymbolsKey.split(",").filter(Boolean)
            : [];
        if (symbols.length === 0) return;
        const cashSymbols = new Set(
            cashSymbolsKey ? cashSymbolsKey.split(",").filter(Boolean) : []
        );

        try {
            // 코인, 주식, 현금 심볼 분리
            const cryptoSymbols: string[] = [];
            const stockSymbols: string[] = [];
            const currencySymbols: string[] = [];

            symbols.forEach(symbol => {
                // 현금(통화) 자산은 환율 조회로 분리
                if (cashSymbols.has(symbol)) {
                    currencySymbols.push(symbol);
                    return;
                }
                // 코인 심볼 패턴 (알파벳 대문자 2-5자)
                if (/^[A-Z]{2,5}$/.test(symbol) && !symbol.match(/^\d/)) {
                    // 주식 티커와 구분하기 위해 일반적인 코인 심볼 확인
                    const cryptoList = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "DOT", "BNB", "MATIC", "LINK"];
                    if (cryptoList.includes(symbol)) {
                        cryptoSymbols.push(symbol);
                    } else {
                        stockSymbols.push(symbol);
                    }
                } else if (symbol.match(/^\d{6}$/)) {
                    // 국내 주식 (6자리 숫자)
                    stockSymbols.push(symbol);
                } else {
                    // 해외 주식
                    stockSymbols.push(symbol);
                }
            });

            const priceMap: Record<string, number> = {};

            // 코인 시세 조회
            if (cryptoSymbols.length > 0) {
                try {
                    const cryptoResponse = await apiFetch(
                        `/api/v1/market/prices/crypto?tickers=${cryptoSymbols.join(",")}`
                    );
                    if (cryptoResponse.ok) {
                        const cryptoData = await cryptoResponse.json();
                        cryptoData.prices?.forEach((p: any) => {
                            if (!p.error) {
                                const symbol = p.ticker?.replace("KRW-", "") || "";
                                priceMap[symbol] = p.price;
                            }
                        });
                    }
                } catch (e) {
                    console.warn("코인 시세 조회 실패:", e);
                }
            }

            // 주식 시세 조회
            if (stockSymbols.length > 0) {
                try {
                    const stockResponse = await apiFetch(
                        `/api/v1/market/prices/stocks?symbols=${stockSymbols.join(",")}`
                    );
                    if (stockResponse.ok) {
                        const stockData = await stockResponse.json();
                        stockData.prices?.forEach((p: any) => {
                            if (!p.error && p.price) {
                                priceMap[p.code] = p.price;
                            }
                        });
                    }
                } catch (e) {
                    console.warn("주식 시세 조회 실패:", e);
                }
            }

            // 현금(통화) 환율 조회
            for (const sym of currencySymbols) {
                try {
                    if (sym === "KRW") {
                        priceMap[sym] = 1;
                        continue;
                    }
                    const rateResponse = await apiFetch(
                        `/api/v1/market/exchange-rate?from=${sym}&to=KRW`
                    );
                    if (rateResponse.ok) {
                        const rateData = await rateResponse.json();
                        if (rateData.rate) priceMap[sym] = rateData.rate;
                    }
                } catch (e) {
                    console.warn(`환율 조회 실패 (${sym}):`, e);
                }
            }

            applyPriceMap(priceMap);
            if (!wsConnectedRef.current) {
                setPriceStreamStatus("fallback");
            }
        } catch (err) {
            console.error("시세 갱신 실패:", err);
            if (!wsConnectedRef.current) {
                setPriceStreamStatus("fallback");
            }
        }
    }, [holdingSymbolsKey, cashSymbolsKey, applyPriceMap, apiFetch]);

    useEffect(() => {
        let active = true;
        if (!holdingSymbolsKey) {
            setPriceStreamStatus("fallback");
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            return;
        }

        const connectWs = () => {
            if (wsRef.current) return;
            setPriceStreamStatus((prev) => (prev === "connected" ? "reconnecting" : "connecting"));

            const url = `${WS_BASE_URL}/api/v1/market/ws?symbols=${encodeURIComponent(holdingSymbolsKey)}&interval_ms=2000`;
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                wsConnectedRef.current = true;
                setPriceStreamStatus("connected");
            };

            ws.onmessage = (event) => {
                if (!active) return;
                try {
                    const payload = JSON.parse(event.data);
                    if (payload?.type !== "prices" || !Array.isArray(payload?.items)) return;

                    const priceMap: Record<string, number> = {};
                    for (const item of payload.items) {
                        if (!item || item.error) continue;
                        const symbol = String(item.symbol || item.code || item.ticker || "")
                            .replace("KRW-", "")
                            .toUpperCase();
                        const price = typeof item.price === "string" ? parseFloat(item.price) : Number(item.price || 0);
                        if (symbol && price > 0) priceMap[symbol] = price;
                    }
                    applyPriceMap(priceMap);
                } catch {
                    // Ignore malformed frame
                }
            };

            ws.onerror = () => {
                wsConnectedRef.current = false;
                setPriceStreamStatus("fallback");
            };

            ws.onclose = () => {
                wsConnectedRef.current = false;
                setPriceStreamStatus("reconnecting");
                wsRef.current = null;
                if (active) {
                    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
                    reconnectTimerRef.current = setTimeout(connectWs, 2000);
                }
            };
        };

        connectWs();
        refreshPrices();

        const fallbackInterval = setInterval(() => {
            if (!wsConnectedRef.current) refreshPrices();
        }, 30000);

        return () => {
            active = false;
            clearInterval(fallbackInterval);
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [holdingSymbolsKey, refreshPrices]);

    return (
        <AssetContext.Provider value={{ holdings, isLoading, error, priceStreamStatus, fetchHoldings, addHoldings, updateAsset, deleteAsset, resetHoldings, refreshPrices }}>
            {children}
        </AssetContext.Provider>
    );
}

export function useAsset() {
    const context = useContext(AssetContext);
    if (context === undefined) {
        throw new Error("useAsset must be used within an AssetProvider");
    }
    return context;
}
