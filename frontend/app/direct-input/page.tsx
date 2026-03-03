"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, ArrowLeft, Building2, Bitcoin, Banknote, ChevronRight, Wallet, PieChart, Check, Trash2, X } from "lucide-react";
import PortfolioHeader from "@/components/PortfolioHeader";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useAsset } from "@/contexts/AssetContext";
import { Loader2 } from "lucide-react";

const API_BASE_URL = '/api/proxy';

// --- Types & Mock Data ---

type AssetType = "stock" | "crypto" | "currency";

interface Asset {
    id: string;
    symbol: string;
    name: string;
    type: AssetType;
    market?: string;
    logo?: string;
}

interface CartItem extends Asset {
    uid: string; // Unique ID for cart item
    quantity: number;
    price: number; // Average Price or Exchange Rate
    date: string;
    currency?: "KRW" | "USD";
    account?: string;
    memo?: string;
    buyReason?: string;
    aiAnalysis?: string;
}

const BUY_REASONS = [
    { label: "기술적 신호", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800" },
    { label: "뉴스", color: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700" },
    { label: "감정적 판단", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800" },
    { label: "손절 라인", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800" },
    { label: "지지선 진입", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800" },
    { label: "돌파 매매", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800" },
    { label: "목표가 도달", color: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400 border-rose-200 dark:border-rose-800" },
    { label: "유튜브", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800" },
];

const POPULAR_STOCKS: Asset[] = [
    // 국내 주식
    { id: "005930", symbol: "005930", name: "삼성전자", type: "stock", market: "KR", logo: "" },
    { id: "000660", symbol: "000660", name: "SK하이닉스", type: "stock", market: "KR", logo: "" },
    { id: "035420", symbol: "035420", name: "NAVER", type: "stock", market: "KR", logo: "" },
    { id: "035720", symbol: "035720", name: "카카오", type: "stock", market: "KR", logo: "" },
    { id: "005380", symbol: "005380", name: "현대차", type: "stock", market: "KR", logo: "" },
    { id: "000270", symbol: "000270", name: "기아", type: "stock", market: "KR", logo: "" },
    { id: "373220", symbol: "373220", name: "LG에너지솔루션", type: "stock", market: "KR", logo: "" },
    { id: "068270", symbol: "068270", name: "셀트리온", type: "stock", market: "KR", logo: "" },
    { id: "105560", symbol: "105560", name: "KB금융", type: "stock", market: "KR", logo: "" },
    { id: "055550", symbol: "055550", name: "신한지주", type: "stock", market: "KR", logo: "" },
    // 미국 주식 (메가캡)
    { id: "NVDA", symbol: "NVDA", name: "NVIDIA", type: "stock", market: "US", logo: "" },
    { id: "AAPL", symbol: "AAPL", name: "Apple", type: "stock", market: "US", logo: "" },
    { id: "MSFT", symbol: "MSFT", name: "Microsoft", type: "stock", market: "US", logo: "" },
    { id: "GOOGL", symbol: "GOOGL", name: "Alphabet", type: "stock", market: "US", logo: "" },
    { id: "AMZN", symbol: "AMZN", name: "Amazon", type: "stock", market: "US", logo: "" },
    { id: "META", symbol: "META", name: "Meta", type: "stock", market: "US", logo: "" },
    { id: "TSLA", symbol: "TSLA", name: "Tesla", type: "stock", market: "US", logo: "" },
    // 미국 주식 (기타)
    { id: "AVGO", symbol: "AVGO", name: "Broadcom", type: "stock", market: "US", logo: "" },
    { id: "TSM", symbol: "TSM", name: "TSMC", type: "stock", market: "US", logo: "" },
    { id: "JPM", symbol: "JPM", name: "JPMorgan", type: "stock", market: "US", logo: "" },
    { id: "V", symbol: "V", name: "Visa", type: "stock", market: "US", logo: "" },
    { id: "WMT", symbol: "WMT", name: "Walmart", type: "stock", market: "US", logo: "" },
    { id: "DIS", symbol: "DIS", name: "Disney", type: "stock", market: "US", logo: "" },
    { id: "UBER", symbol: "UBER", name: "Uber", type: "stock", market: "US", logo: "" },
    { id: "BABA", symbol: "BABA", name: "Alibaba", type: "stock", market: "US", logo: "" },
    { id: "AMD", symbol: "AMD", name: "AMD", type: "stock", market: "US", logo: "" },
    { id: "NFLX", symbol: "NFLX", name: "Netflix", type: "stock", market: "US", logo: "" },
    { id: "INTC", symbol: "INTC", name: "Intel", type: "stock", market: "US", logo: "" },
    { id: "PLTR", symbol: "PLTR", name: "Palantir", type: "stock", market: "US", logo: "" },
    { id: "COIN", symbol: "COIN", name: "Coinbase", type: "stock", market: "US", logo: "" },
    // ETF
    { id: "360750", symbol: "360750", name: "TIGER 미국S&P500", type: "stock", market: "KR", logo: "" },
    { id: "SCHD", symbol: "SCHD", name: "Schwab US Dividend Equity", type: "stock", market: "US", logo: "" },
    { id: "TQQQ", symbol: "TQQQ", name: "ProShares UltraPro QQQ", type: "stock", market: "US", logo: "" },
    { id: "SOXL", symbol: "SOXL", name: "Direxion Daily Semi Bull 3X", type: "stock", market: "US", logo: "" },
];

const POPULAR_CRYPTO: Asset[] = [
    { id: "BTC", symbol: "BTC", name: "Bitcoin", type: "crypto", logo: "" },
    { id: "ETH", symbol: "ETH", name: "Ethereum", type: "crypto", logo: "" },
    { id: "XRP", symbol: "XRP", name: "Ripple", type: "crypto", logo: "" },
    { id: "SOL", symbol: "SOL", name: "Solana", type: "crypto", logo: "" },
    { id: "DOGE", symbol: "DOGE", name: "Dogecoin", type: "crypto", logo: "" },
    { id: "ADA", symbol: "ADA", name: "Cardano", type: "crypto", logo: "" },
    { id: "AVAX", symbol: "AVAX", name: "Avalanche", type: "crypto", logo: "" },
    { id: "DOT", symbol: "DOT", name: "Polkadot", type: "crypto", logo: "" },
    { id: "LINK", symbol: "LINK", name: "Chainlink", type: "crypto", logo: "" },
];

const CURRENCIES: Asset[] = [
    { id: "KRW", symbol: "KRW", name: "원화 (KRW)", type: "currency" },
    { id: "USD", symbol: "USD", name: "달러 (USD)", type: "currency" },
    { id: "JPY", symbol: "JPY", name: "엔화 (JPY)", type: "currency" },
    { id: "CNY", symbol: "CNY", name: "위안화 (CNY)", type: "currency" },
];

const MAX_DECIMAL_PLACES = 6;
const DECIMAL_INPUT_REGEX = new RegExp(`^\\d*(\\.\\d{0,${MAX_DECIMAL_PLACES}})?$`);

function normalizeDecimalInput(rawValue: string): string | null {
    const stripped = rawValue.replace(/,/g, "").trim();

    if (stripped === "") return "";
    if (stripped === ".") return "0.";

    const normalized = stripped.startsWith(".") ? `0${stripped}` : stripped;
    if (!DECIMAL_INPUT_REGEX.test(normalized)) return null;

    return normalized;
}

function toFixedDecimal(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(MAX_DECIMAL_PLACES));
}

function parseDecimalValue(rawValue: string): number {
    const parsed = Number((rawValue || "").replace(/,/g, ""));
    return toFixedDecimal(parsed);
}

function formatDecimalInput(rawValue: string): string {
    if (!rawValue) return "";

    const stripped = rawValue.replace(/,/g, "");
    const hasDot = stripped.includes(".");
    const [integerPartRaw, decimalPartRaw = ""] = stripped.split(".");

    const integerPart = integerPartRaw === "" ? "0" : integerPartRaw;
    const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "") || "0";
    const formattedInteger = Number(normalizedInteger).toLocaleString("ko-KR", {
        maximumFractionDigits: 0,
    });

    if (!hasDot) return formattedInteger;
    return `${formattedInteger}.${decimalPartRaw}`;
}

function formatDecimalNumber(value: number): string {
    return toFixedDecimal(value).toLocaleString("ko-KR", {
        maximumFractionDigits: MAX_DECIMAL_PLACES,
    });
}

// --- Main Component ---

export default function DirectRegisterPage() {
    const router = useRouter();
    const { user } = useAuth();
    const { addHoldings } = useAsset();
    const [currentStep, setCurrentStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Step 1 State
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<Asset[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [formValues, setFormValues] = useState({ quantity: "", price: "", memo: "", buyReason: "", aiAnalysis: "" });
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [cart, setCart] = useState<CartItem[]>([]);

    // Exchange rate state
    const [exchangeRate, setExchangeRate] = useState<number | null>(null);
    const [isLoadingRate, setIsLoadingRate] = useState(false);

    // 종목 검색 debounce (300ms)
    useEffect(() => {
        const q = searchQuery.trim();
        if (!q) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }
        setIsSearching(true);
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(
                    `${API_BASE_URL}/api/v1/market/search?q=${encodeURIComponent(q)}&limit=30`
                );
                if (res.ok) {
                    const data = await res.json();
                    setSearchResults(
                        (data.results || []).map((r: any) => ({
                            id: r.id,
                            symbol: r.symbol,
                            name: r.name,
                            type: r.type as AssetType,
                            market: r.market ?? undefined,
                            logo: "",
                        }))
                    );
                } else {
                    throw new Error("API 오류");
                }
            } catch {
                // API 실패 시 로컬 필터 fallback
                const local = [...POPULAR_STOCKS, ...POPULAR_CRYPTO].filter(
                    (s) =>
                        s.name.toLowerCase().includes(q.toLowerCase()) ||
                        s.symbol.toLowerCase().includes(q.toLowerCase())
                );
                setSearchResults(local);
            } finally {
                setIsSearching(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Column resize state
    const [columnWidths, setColumnWidths] = useState({
        name: 200,
        type: 120,
        quantity: 120,
        price: 180,
        date: 120,
        account: 120,
    });
    const resizingCol = useRef<{ field: string, startX: number, startWidth: number } | null>(null);

    // Mobile view state (for screens < 1024px to match lg breakpoint)
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 1024);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // pending_assets 로드 (CSV/OCR에서 전달된 데이터)
    useEffect(() => {
        const pending = localStorage.getItem("pending_assets");
        if (pending) {
            try {
                const items = JSON.parse(pending) as CartItem[];
                if (items.length > 0) {
                    setCart(items);
                    setCurrentStep(2); // CSV/OCR에서 넘어오면 즉시 확인 단계로 진입
                }
            } catch (e) {
                console.error("pending_assets 파싱 실패:", e);
            } finally {
                localStorage.removeItem("pending_assets");
            }
        }
    }, []);

    const steps = [
        { number: 1, title: "리스트 채우기", id: "fill" },
        { number: 2, title: "확인", id: "review" },
        { number: 3, title: "완료", id: "complete" },
    ];

    // --- Handlers ---

    // Fetch exchange rate from backend
    const fetchExchangeRate = async (fromCurrency: string, toCurrency: string = "KRW") => {
        setIsLoadingRate(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/exchange-rate?from_currency=${fromCurrency}&to_currency=${toCurrency}`);
            if (!response.ok) throw new Error("Failed to fetch exchange rate");
            const data = await response.json();
            setExchangeRate(data.rate);
        } catch (error) {
            console.error("Exchange rate fetch error:", error);
            setExchangeRate(null);
        } finally {
            setIsLoadingRate(false);
        }
    };

    // Auto-update price field when exchange rate is fetched for currency
    useEffect(() => {
        if (selectedAsset?.type === 'currency' && selectedAsset.id !== 'KRW' && exchangeRate) {
            setFormValues(prev => ({ ...prev, price: toFixedDecimal(exchangeRate).toString() }));
        }
    }, [exchangeRate, selectedAsset]);

    const handleSelect = (asset: Asset) => {
        setSelectedAsset(asset);
        setExchangeRate(null); // Reset exchange rate

        // Default values for Currency
        if (asset.type === 'currency') {
            if (asset.id === 'KRW') {
                setFormValues({ quantity: "", price: "1", memo: "", buyReason: "", aiAnalysis: "" });
                setExchangeRate(1);
            } else {
                setFormValues({ quantity: "", price: "", memo: "", buyReason: "", aiAnalysis: "" });
                // Fetch exchange rate for non-KRW currencies and auto-set as price
                fetchExchangeRate(asset.id, "KRW");
            }
        } else {
            setFormValues({ quantity: "", price: "", memo: "", buyReason: "", aiAnalysis: "" });
        }
    };

    const handleAIAnalysis = () => {
        setIsAnalyzing(true);
        // Simulate AI Delay
        setTimeout(() => {
            const reasons = ["뉴스", "기술적 신호", "돌파 매매", "지지선 진입"];
            const randomReason = reasons[Math.floor(Math.random() * reasons.length)];
            const aiText = `AI 분석 결과: ${selectedAsset?.name}의 최근 변동성은 긍정적입니다. ${randomReason}에 기반한 진입이 유효해 보입니다.`;

            setFormValues(prev => ({
                ...prev,
                buyReason: randomReason,
                memo: aiText,
                aiAnalysis: aiText
            }));
            setIsAnalyzing(false);
        }, 1500);
    };

    const handleAddToCart = () => {
        if (!selectedAsset || !formValues.quantity || !formValues.price) return;

        const quantity = parseDecimalValue(formValues.quantity);
        const price = parseDecimalValue(formValues.price);
        if (quantity <= 0 || price <= 0) return;

        const newItem: CartItem = {
            ...selectedAsset,
            uid: Math.random().toString(36).substr(2, 9),
            quantity,
            price,
            date: new Date().toISOString(),
            memo: formValues.memo,
            buyReason: formValues.buyReason,
            aiAnalysis: formValues.aiAnalysis
        };

        setCart([...cart, newItem]);

        // Reset Form
        setSelectedAsset(null);
        setFormValues({ quantity: "", price: "", memo: "", buyReason: "", aiAnalysis: "" });
    };

    const handleRemoveFromCart = (uid: string) => {
        setCart(cart.filter(item => item.uid !== uid));
    };

    const handleEditCartItem = (item: CartItem) => {
        // Load item data into form
        setSelectedAsset(item);
        setFormValues({
            quantity: toFixedDecimal(item.quantity).toString(),
            price: toFixedDecimal(item.price).toString(),
            memo: item.memo || "",
            buyReason: item.buyReason || "",
            aiAnalysis: item.aiAnalysis || ""
        });
        // Remove from cart (will be re-added when user clicks add again)
        handleRemoveFromCart(item.uid);
    };

    const updateCartItem = (uid: string, field: keyof CartItem, value: any) => {
        setCart(prev =>
            prev.map(item => {
                if (item.uid !== uid) return item;
                if (field === "quantity" || field === "price") {
                    return { ...item, [field]: toFixedDecimal(Number(value) || 0) };
                }
                return { ...item, [field]: value };
            })
        );
    };

    // Column resize handlers
    const onMouseDown = (e: React.MouseEvent, field: string) => {
        resizingCol.current = {
            field,
            startX: e.pageX,
            startWidth: (columnWidths as any)[field],
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
        if (!resizingCol.current) return;
        const diff = e.pageX - resizingCol.current.startX;
        const newWidth = Math.max(80, resizingCol.current.startWidth + diff);
        setColumnWidths(prev => ({
            ...prev,
            [resizingCol.current!.field]: newWidth
        }));
    };

    const onMouseUp = () => {
        resizingCol.current = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    const handleNext = async () => {
        if (currentStep === 1) {
            if (cart.length === 0) return; // Can't proceed if empty
            setCurrentStep(2);
        } else if (currentStep === 2) {
            // Final Submission to Backend
            setIsSubmitting(true);
            try {
                // AssetContext의 addHoldings 활용 (내부적으로 fetchHoldings 호출함)
                await addHoldings(cart);

                console.log("Assets registered successfully via Context");
                setCurrentStep(3);

                // Clear local pending assets
                localStorage.removeItem("pending_assets");
            } catch (error) {
                console.error("❌ Registration error:", error);
                alert(error instanceof Error ? error.message : "등록 중 오류가 발생했습니다.");
            } finally {
                setIsSubmitting(false);
            }
        } else {
            router.push("/portfolio/asset");
        }
    };

    const handlePrevious = () => {
        if (currentStep > 1) {
            setCurrentStep(currentStep - 1);
        }
    };

    const getLabels = (type: AssetType) => {
        if (type === 'currency') {
            return { quantity: "보유 금액", price: "환율" };
        }
        return { quantity: "보유 수량", price: "평균 단가" };
    };

    return (
        <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950 transition-colors duration-300">
            <PortfolioHeader />
            <div className="flex flex-1">
                {/* Sidebar Navigation - hidden on mobile/tablet (< 1024px) */}
                {!isMobile ? (
                    <aside className="w-72 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-8">
                        <h1 className="mb-10 text-xl font-black text-zinc-900 dark:text-zinc-100 uppercase tracking-tight">자산 직접 등록</h1>
                        <nav className="relative flex flex-col gap-8">
                            <div className="absolute left-3 top-3 bottom-3 w-[1px] border-l border-dashed border-zinc-300 dark:border-zinc-700 z-0" />
                            {steps.map((step) => (
                                <button
                                    key={step.number}
                                    onClick={() => {
                                        // Only allow going back or if cart is not empty
                                        if (step.number < currentStep || (step.number === 2 && cart.length > 0)) {
                                            setCurrentStep(step.number);
                                        }
                                    }}
                                    disabled={step.number > currentStep && (step.number === 3 || (step.number === 2 && cart.length === 0))}
                                    className="group relative z-10 flex items-center gap-4 text-left outline-none disabled:opacity-50"
                                >
                                    <div
                                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 ${currentStep >= step.number
                                            ? "bg-zinc-900 border-zinc-900 dark:bg-white dark:border-white shadow-lg"
                                            : "bg-zinc-50 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                                            }`}
                                    >
                                        {currentStep > step.number ? (
                                            <Check className="h-3.5 w-3.5 text-white dark:text-zinc-900" strokeWidth={4} />
                                        ) : (
                                            <div className={`h-2 w-2 rounded-full ${currentStep === step.number ? "bg-white dark:bg-zinc-900" : "bg-transparent"}`} />
                                        )}
                                    </div>
                                    <span className={`text-sm font-bold transition-colors duration-300 ${currentStep === step.number
                                        ? "text-zinc-900 dark:text-white"
                                        : "text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-900 dark:group-hover:text-zinc-300"
                                        }`}>
                                        {step.title}
                                    </span>
                                </button>
                            ))}
                        </nav>
                    </aside>
                ) : null}

                {/* Main Content Area */}
                <main className={`flex-1 overflow-y-auto flex flex-col ${isMobile ? 'p-4 pb-24' : 'p-8 lg:p-12'}`}>
                    {/* Mobile Progress Indicator */}
                    {isMobile && currentStep < 3 && (
                        <div className="flex items-center justify-between mb-6 px-2">
                            {steps.map((step) => (
                                <div key={step.number} className="flex flex-col items-center gap-2 flex-1 relative">
                                    <div className={`h-1 w-full rounded-full transition-all duration-300 ${currentStep >= step.number ? "bg-zinc-900 dark:bg-white" : "bg-zinc-200 dark:bg-zinc-800"}`} />
                                    <span className={`text-[10px] font-black uppercase tracking-widest ${currentStep === step.number ? "text-zinc-900 dark:text-white" : "text-zinc-400"}`}>
                                        {step.title}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className={`mx-auto w-full flex flex-col ${isMobile ? '' : 'max-w-[1600px] h-full'}`}>

                        {/* Title Section (Dynamic) */}
                        <div className={isMobile ? 'mb-4' : 'mb-10'}>
                            {currentStep === 1 && (
                                <>
                                    <h2 className={`font-black tracking-tight text-zinc-900 dark:text-white mb-2 ${isMobile ? 'text-xl' : 'text-3xl'}`}>어떤 자산을 가지고 계신가요?</h2>
                                    <p className={`text-zinc-500 font-medium ${isMobile ? 'text-xs' : ''}`}>리스트에 자산을 모두 담은 후, 한 번에 등록하세요.</p>
                                </>
                            )}
                            {currentStep === 2 && (
                                <>
                                    <h2 className={`font-black tracking-tight text-zinc-900 dark:text-white mb-2 ${isMobile ? 'text-xl' : 'text-3xl'}`}>등록 내용을 확인해주세요</h2>
                                    <p className={`text-zinc-500 font-medium ${isMobile ? 'text-xs' : ''}`}>총 {cart.length}개의 자산을 등록합니다.</p>
                                </>
                            )}
                            {currentStep === 3 && (
                                <>
                                    <h2 className={`font-black tracking-tight text-zinc-900 dark:text-white mb-2 ${isMobile ? 'text-xl' : 'text-3xl'}`}>등록이 완료되었습니다 🎉</h2>
                                    <p className={`text-zinc-500 font-medium ${isMobile ? 'text-xs' : ''}`}>포트폴리오 화면에서 자산을 확인하세요.</p>
                                </>
                            )}
                        </div>

                        {/* Step 1: Fill List (Split Layout) */}
                        {currentStep === 1 && (
                            <div className="flex flex-col lg:flex-row gap-8 items-start min-h-0 lg:h-[calc(100vh-320px)]">
                                {/* LEFT: Asset Selection */}
                                <Card className="flex-1 w-full lg:w-2/3 h-full border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm flex flex-col overflow-hidden min-h-[500px] lg:min-h-0">
                                    <Tabs defaultValue="stock" className="flex flex-col h-full">
                                        <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 space-y-4">
                                            <TabsList className="bg-zinc-100 dark:bg-zinc-950 p-1 rounded-xl w-full grid grid-cols-3">
                                                <TabsTrigger value="stock" className="bg-transparent data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-sm rounded-lg py-2.5 font-bold">주식</TabsTrigger>
                                                <TabsTrigger value="crypto" className="bg-transparent data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-sm rounded-lg py-2.5 font-bold">코인</TabsTrigger>
                                                <TabsTrigger value="cash" className="bg-transparent data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-sm rounded-lg py-2.5 font-bold">현금</TabsTrigger>
                                            </TabsList>
                                            <div className="relative group">
                                                <Search className="absolute left-4 top-3.5 h-5 w-5 text-zinc-400 group-focus-within:text-emerald-500 transition-colors" />
                                                <Input
                                                    placeholder="이름, 심볼 또는 종목코드 검색"
                                                    value={searchQuery}
                                                    onChange={(e) => setSearchQuery(e.target.value)}
                                                    className="pl-12 h-12 text-base bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 focus-visible:ring-emerald-500 rounded-xl"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                                            {/* 검색 중일 때: 전체 검색 결과 표시 (탭 구분 없음) */}
                                            {searchQuery.trim() ? (
                                                <div className="space-y-3">
                                                    {isSearching ? (
                                                        <div className="flex items-center justify-center py-12 text-zinc-400">
                                                            <Loader2 className="w-6 h-6 animate-spin mr-2" />
                                                            <span className="text-sm font-medium">검색 중...</span>
                                                        </div>
                                                    ) : searchResults.length === 0 ? (
                                                        <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                                                            <Search className="w-8 h-8 mb-2 opacity-40" />
                                                            <p className="text-sm font-medium">검색 결과가 없습니다</p>
                                                            <p className="text-xs text-zinc-400 mt-1">&quot;{searchQuery}&quot; 와(과) 일치하는 종목이 없어요</p>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <p className="text-xs font-bold text-zinc-400 px-1">
                                                                검색 결과 {searchResults.length}개
                                                            </p>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                                                                {searchResults.map((asset) => (
                                                                    <AssetItem key={`${asset.type}-${asset.id}`} item={asset} onSelect={handleSelect} isSelected={selectedAsset?.id === asset.id} />
                                                                ))}
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            ) : (
                                                /* 검색어 없을 때: 인기 종목 탭 */
                                                <>
                                                    <TabsContent value="stock" className="mt-0 space-y-2 h-full">
                                                        <p className="text-xs font-bold text-zinc-400 px-1 mb-3">인기 주식</p>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                                                            {POPULAR_STOCKS.map((stock) => (
                                                                <AssetItem key={stock.id} item={stock} onSelect={handleSelect} isSelected={selectedAsset?.id === stock.id} />
                                                            ))}
                                                        </div>
                                                    </TabsContent>
                                                    <TabsContent value="crypto" className="mt-0 space-y-2 h-full">
                                                        <p className="text-xs font-bold text-zinc-400 px-1 mb-3">인기 코인</p>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                                                            {POPULAR_CRYPTO.map((coin) => (
                                                                <AssetItem key={coin.id} item={coin} onSelect={handleSelect} isSelected={selectedAsset?.id === coin.id} />
                                                            ))}
                                                        </div>
                                                    </TabsContent>
                                                    <TabsContent value="cash" className="mt-0 space-y-2 h-full">
                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                                                            {CURRENCIES.map((curr) => (
                                                                <AssetItem key={curr.id} item={curr} onSelect={handleSelect} isSelected={selectedAsset?.id === curr.id} />
                                                            ))}
                                                        </div>
                                                    </TabsContent>
                                                </>
                                            )}
                                        </div>
                                    </Tabs>
                                </Card>

                                {/* RIGHT: Input Form */}
                                <div className="w-full lg:w-[400px] xl:w-[480px] h-full flex flex-col gap-6 shrink-0">
                                    {selectedAsset ? (
                                        <Card className="flex-1 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl shadow-zinc-200/50 dark:shadow-zinc-950/50 flex flex-col animate-in slide-in-from-right-4 duration-500">
                                            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                                                <div className="flex flex-col items-center text-center gap-3">
                                                    <div className="w-16 h-16 rounded-2xl bg-white dark:bg-zinc-800 flex items-center justify-center text-zinc-500 shadow-sm border border-zinc-100 dark:border-zinc-700 p-3">
                                                        {selectedAsset.logo ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img src={selectedAsset.logo} alt={selectedAsset.name} className="w-full h-full object-contain" onError={(e) => e.currentTarget.style.display = 'none'} />
                                                        ) : (
                                                            <Building2 className="w-8 h-8" />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <Badge variant="outline" className="mb-1.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
                                                            {selectedAsset.type === 'stock' ? 'Stock' : selectedAsset.type === 'crypto' ? 'Crypto' : 'Currency'}
                                                        </Badge>
                                                        <h2 className="text-xl font-black text-zinc-900 dark:text-white">{selectedAsset.name}</h2>
                                                    </div>
                                                </div>
                                            </div>

                                            <CardContent className="flex-1 p-6 space-y-6 flex flex-col justify-center">
                                                <div className="space-y-5">
                                                    <div className="space-y-2">
                                                        <label className="text-sm font-bold text-zinc-700 dark:text-zinc-300 flex justify-between">
                                                            {getLabels(selectedAsset.type).quantity}
                                                            <span className="text-xs font-normal text-zinc-400">필수 입력</span>
                                                        </label>
                                                        <div className="relative">
                                                            <Input
                                                                type="text"
                                                                inputMode="decimal"
                                                                placeholder="0"
                                                                value={formatDecimalInput(formValues.quantity)}
                                                                onChange={(e) => {
                                                                    const normalized = normalizeDecimalInput(e.target.value);
                                                                    if (normalized !== null) {
                                                                        setFormValues({ ...formValues, quantity: normalized });
                                                                    }
                                                                }}
                                                                className="h-14 text-xl font-bold bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 focus-visible:ring-emerald-500 pl-4 pr-10"
                                                            />
                                                        </div>
                                                        {/* Exchange Rate Display for Currency - Below Quantity Input */}
                                                        {selectedAsset.type === 'currency' && selectedAsset.id !== 'KRW' && formValues.quantity && (
                                                            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-xs font-bold text-blue-700 dark:text-blue-400">원화 환산</span>
                                                                    {isLoadingRate ? (
                                                                        <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                                                                    ) : exchangeRate ? (
                                                                        <span className="text-base font-black text-blue-900 dark:text-blue-300">
                                                                            ≈ {(parseDecimalValue(formValues.quantity) * exchangeRate).toLocaleString('ko-KR', { maximumFractionDigits: 0 })} KRW
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-xs text-zinc-500">환율 정보 없음</span>
                                                                    )}
                                                                </div>
                                                                {exchangeRate && (
                                                                    <p className="text-[10px] text-blue-600 dark:text-blue-500 mt-1">
                                                                        1 {selectedAsset.id} = {exchangeRate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} KRW
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Price Input - Hidden for Currency */}
                                                    {selectedAsset.type !== 'currency' && (
                                                        <div className="space-y-2">
                                                            <label className="text-sm font-bold text-zinc-700 dark:text-zinc-300 flex justify-between">
                                                                {getLabels(selectedAsset.type).price}
                                                                <span className="text-xs font-normal text-zinc-400">필수 입력</span>
                                                            </label>
                                                            <div className="relative">
                                                                <Input
                                                                    type="text"
                                                                    inputMode="decimal"
                                                                    placeholder="0"
                                                                    value={formatDecimalInput(formValues.price)}
                                                                    onChange={(e) => {
                                                                        const normalized = normalizeDecimalInput(e.target.value);
                                                                        if (normalized !== null) {
                                                                            setFormValues({ ...formValues, price: normalized });
                                                                        }
                                                                    }}
                                                                    className="h-14 text-xl font-bold bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 focus-visible:ring-emerald-500 pl-4 pr-10"
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Buy Reason Section - Hidden for Currency */}
                                                {selectedAsset.type !== 'currency' && (
                                                    <div className="space-y-3">
                                                        <div className="flex justify-between items-center">
                                                            <label className="text-sm font-bold text-zinc-700 dark:text-zinc-300">매수 사유</label>
                                                            <button
                                                                onClick={handleAIAnalysis}
                                                                disabled={isAnalyzing}
                                                                className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 hover:underline disabled:opacity-50"
                                                            >
                                                                {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />}
                                                                AI 분석 및 자동 입력
                                                            </button>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            {BUY_REASONS.map((reason) => (
                                                                <button
                                                                    key={reason.label}
                                                                    onClick={() => setFormValues({ ...formValues, buyReason: reason.label })}
                                                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${formValues.buyReason === reason.label
                                                                        ? `${reason.color} ring-2 ring-offset-1 ring-zinc-200 dark:ring-zinc-700`
                                                                        : "bg-white dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                                                        }`}
                                                                >
                                                                    {reason.label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="space-y-2">
                                                    <label className="text-sm font-bold text-zinc-700 dark:text-zinc-300">메모 / AI 분석</label>
                                                    <textarea
                                                        value={formValues.memo}
                                                        onChange={(e) => setFormValues({ ...formValues, memo: e.target.value })}
                                                        placeholder="AI 분석 버튼을 누르면 자동으로 작성됩니다."
                                                        className="w-full h-24 p-3 text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus-visible:ring-emerald-500 resize-none font-medium text-zinc-600 dark:text-zinc-300"
                                                    />
                                                </div>

                                                <Button
                                                    className="w-full h-14 text-lg font-bold bg-zinc-900 dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 rounded-xl shadow-lg transition-all active:scale-[0.98]"
                                                    onClick={handleAddToCart}
                                                    disabled={
                                                        !formValues.quantity ||
                                                        !formValues.price ||
                                                        parseDecimalValue(formValues.quantity) <= 0 ||
                                                        parseDecimalValue(formValues.price) <= 0
                                                    }
                                                >
                                                    리스트에 추가
                                                </Button>
                                            </CardContent>
                                        </Card>
                                    ) : (
                                        <Card className="flex-1 border-dashed border-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col items-center justify-center text-center p-8 shadow-none min-h-[200px] lg:min-h-0">
                                            <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4 text-zinc-400">
                                                <PieChart className="w-8 h-8" />
                                            </div>
                                            <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-2">자산을 선택해주세요</h3>
                                            <p className="text-zinc-500 text-sm max-w-[200px]">
                                                왼쪽 목록에서 추가하실 자산을 선택해 주세요.
                                            </p>
                                        </Card>
                                    )}

                                    {/* Mini Cart Preview */}
                                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
                                        <div className="flex justify-between items-center mb-4">
                                            <span className="font-bold text-zinc-900 dark:text-white">현재 담긴 자산</span>
                                            <Badge className="bg-emerald-500 text-white">{cart.length}개</Badge>
                                        </div>
                                        {cart.length > 0 ? (
                                            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                                                {cart.slice().reverse().map((item) => (
                                                    <div
                                                        key={item.uid}
                                                        className="relative flex items-center gap-2 p-2 pr-3 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 shrink-0 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
                                                        onClick={() => handleEditCartItem(item)}
                                                    >
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRemoveFromCart(item.uid);
                                                            }}
                                                            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                        <div className="w-6 h-6 rounded bg-white dark:bg-zinc-800 flex items-center justify-center text-[10px] border border-zinc-100 dark:border-zinc-700">
                                                            {item.name[0]}
                                                        </div>
                                                        <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{item.name}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-sm text-zinc-400 text-center py-2 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg">
                                                아직 담긴 자산이 없습니다.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 2: Review (Editable Table + Mobile Cards) */}
                        {currentStep === 2 && (
                            <>
                                {/* Desktop Table View */}
                                <Card className="hidden sm:flex border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 shadow-sm overflow-hidden flex-1 flex-col">
                                    <div className="overflow-x-auto flex-1">
                                        <table className="w-full min-w-[900px] text-sm text-left border-collapse table-fixed">
                                            <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 z-10">
                                                <tr>
                                                    <th style={{ width: columnWidths.name }} className="px-4 py-4 font-bold relative group/header">
                                                        종목명/심볼
                                                        <div onMouseDown={(e) => onMouseDown(e, 'name')} className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-200 dark:bg-zinc-800 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity z-30" />
                                                    </th>
                                                    <th style={{ width: columnWidths.type }} className="px-4 py-4 font-bold relative group/header">
                                                        자산 종류
                                                        <div onMouseDown={(e) => onMouseDown(e, 'type')} className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-200 dark:bg-zinc-800 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity z-30" />
                                                    </th>
                                                    <th style={{ width: columnWidths.quantity }} className="px-4 py-4 font-bold relative group/header">
                                                        보유량
                                                        <div onMouseDown={(e) => onMouseDown(e, 'quantity')} className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-200 dark:bg-zinc-800 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity z-30" />
                                                    </th>
                                                    <th style={{ width: columnWidths.price }} className="px-4 py-4 font-bold relative group/header">
                                                        평단가/환율
                                                        <div onMouseDown={(e) => onMouseDown(e, 'price')} className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-200 dark:bg-zinc-800 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity z-30" />
                                                    </th>
                                                    <th style={{ width: columnWidths.date }} className="px-4 py-4 font-bold relative group/header">
                                                        날짜
                                                        <div onMouseDown={(e) => onMouseDown(e, 'date')} className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-200 dark:bg-zinc-800 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity z-30" />
                                                    </th>
                                                    <th style={{ width: columnWidths.account }} className="px-4 py-4 font-bold relative group/header">
                                                        계좌/비고
                                                        <div onMouseDown={(e) => onMouseDown(e, 'account')} className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-200 dark:bg-zinc-800 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity z-30" />
                                                    </th>
                                                    <th className="px-4 py-4 font-bold text-center w-[60px]">삭제</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-transparent">
                                                {cart.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={7} className="px-6 py-16 text-center text-zinc-400">
                                                            등록할 자산이 없습니다. 이전 단계에서 자산을 추가해주세요.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    cart.map((item) => (
                                                        <tr key={item.uid} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors group">
                                                            <td className="px-4 py-3">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 border border-zinc-200 dark:border-zinc-700 shrink-0">
                                                                        {item.type === 'stock' ? <Building2 className="h-5 w-5" /> : item.type === 'crypto' ? <Bitcoin className="h-5 w-5" /> : <Banknote className="h-5 w-5" />}
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <input
                                                                            type="text"
                                                                            value={item.name}
                                                                            onChange={(e) => updateCartItem(item.uid, 'name', e.target.value)}
                                                                            className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white font-bold transition-all p-1"
                                                                        />
                                                                        <input
                                                                            type="text"
                                                                            value={item.symbol}
                                                                            onChange={(e) => updateCartItem(item.uid, 'symbol', e.target.value)}
                                                                            className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-500 text-[10px] font-medium p-1"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <Select
                                                                    value={item.type}
                                                                    onValueChange={(val: AssetType) => updateCartItem(item.uid, 'type', val)}
                                                                >
                                                                    <SelectTrigger className="w-full h-9 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 font-bold text-xs">
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent className="dark:bg-zinc-900 dark:border-zinc-800 font-bold">
                                                                        <SelectItem value="stock">주식</SelectItem>
                                                                        <SelectItem value="crypto">코인</SelectItem>
                                                                        <SelectItem value="currency">현금</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <Input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.000001"
                                                                    value={item.quantity}
                                                                    onChange={(e) => updateCartItem(item.uid, 'quantity', parseDecimalValue(e.target.value))}
                                                                    className="h-9 bg-transparent border-none hover:bg-zinc-100 dark:hover:bg-zinc-900 focus-visible:ring-emerald-500 text-right font-bold text-zinc-900 dark:text-zinc-100"
                                                                />
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <div className="flex items-center gap-2">
                                                                    <Input
                                                                        type="text"
                                                                        inputMode="decimal"
                                                                        value={formatDecimalNumber(item.price)}
                                                                        onChange={(e) => {
                                                                            const normalized = normalizeDecimalInput(e.target.value);
                                                                            if (normalized !== null) {
                                                                                updateCartItem(item.uid, 'price', parseDecimalValue(normalized));
                                                                            }
                                                                        }}
                                                                        className={`flex-1 h-9 bg-transparent border-none hover:bg-zinc-100 dark:hover:bg-zinc-900 focus-visible:ring-emerald-500 text-right font-bold ${(item.currency || 'KRW') === 'USD' ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400'}`}
                                                                    />
                                                                    <Select
                                                                        value={item.currency || 'KRW'}
                                                                        onValueChange={(val: "KRW" | "USD") => updateCartItem(item.uid, 'currency', val)}
                                                                    >
                                                                        <SelectTrigger className="w-[65px] h-8 bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-[10px] font-black shrink-0">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                        <SelectContent className="dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                                                                            <SelectItem value="KRW" className="text-[10px] font-bold">KRW</SelectItem>
                                                                            <SelectItem value="USD" className="text-[10px] font-bold">USD</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <input
                                                                    type="date"
                                                                    value={item.date?.split('T')[0] || new Date().toISOString().split('T')[0]}
                                                                    onChange={(e) => updateCartItem(item.uid, 'date', e.target.value)}
                                                                    className="w-full bg-transparent border-none text-xs font-bold text-zinc-500 dark:text-zinc-400 focus:outline-none p-1"
                                                                />
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <Input
                                                                    type="text"
                                                                    value={item.account || ""}
                                                                    onChange={(e) => updateCartItem(item.uid, 'account', e.target.value)}
                                                                    placeholder="계좌명"
                                                                    className="h-9 bg-transparent border-none hover:bg-zinc-100 dark:hover:bg-zinc-900 focus-visible:ring-emerald-500 font-medium text-xs"
                                                                />
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <button
                                                                    onClick={() => handleRemoveFromCart(item.uid)}
                                                                    className="p-2 text-zinc-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-all"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </Card>

                                {/* Mobile Card View */}
                                <div className="sm:hidden flex-1 flex flex-col gap-4 overflow-y-auto pb-4">
                                    {cart.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center text-zinc-400 py-16 bg-zinc-50 dark:bg-zinc-900/30 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
                                            <p className="font-bold">등록할 자산이 없습니다.</p>
                                            <p className="text-xs">이전 단계에서 자산을 추가해주세요.</p>
                                        </div>
                                    ) : (
                                        cart.map((item) => (
                                            <Card key={item.uid} className="p-4 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 shadow-sm space-y-4 relative">
                                                <button
                                                    onClick={() => handleRemoveFromCart(item.uid)}
                                                    className="absolute top-3 right-3 p-2 text-zinc-300 hover:text-rose-500 transition-colors"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>

                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                                                        {item.type === 'stock' ? <Building2 className="h-5 w-5" /> : item.type === 'crypto' ? <Bitcoin className="h-5 w-5" /> : <Banknote className="h-5 w-5" />}
                                                    </div>
                                                    <div className="flex-1">
                                                        <input
                                                            type="text"
                                                            value={item.name}
                                                            onChange={(e) => updateCartItem(item.uid, 'name', e.target.value)}
                                                            className="w-full bg-transparent font-black text-lg text-zinc-900 dark:text-white focus:outline-none"
                                                            placeholder="종목명"
                                                        />
                                                        <input
                                                            type="text"
                                                            value={item.symbol}
                                                            onChange={(e) => updateCartItem(item.uid, 'symbol', e.target.value)}
                                                            className="w-full bg-transparent text-xs text-zinc-500 focus:outline-none"
                                                            placeholder="심볼"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black uppercase text-zinc-500">자산 종류</label>
                                                        <Select value={item.type} onValueChange={(val: AssetType) => updateCartItem(item.uid, 'type', val)}>
                                                            <SelectTrigger className="h-10 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 font-bold">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent className="dark:bg-zinc-900">
                                                                <SelectItem value="stock">주식</SelectItem>
                                                                <SelectItem value="crypto">코인</SelectItem>
                                                                <SelectItem value="currency">현금</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black uppercase text-zinc-500">보유량</label>
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            step="0.000001"
                                                            value={item.quantity}
                                                            onChange={(e) => updateCartItem(item.uid, 'quantity', parseDecimalValue(e.target.value))}
                                                            className="h-10 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 font-bold"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-black uppercase text-zinc-500">평단가/환율</label>
                                                    <div className="flex items-center gap-2">
                                                        <Input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={formatDecimalNumber(item.price)}
                                                            onChange={(e) => {
                                                                const normalized = normalizeDecimalInput(e.target.value);
                                                                if (normalized !== null) {
                                                                    updateCartItem(item.uid, 'price', parseDecimalValue(normalized));
                                                                }
                                                            }}
                                                            className={`flex-1 h-12 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-right font-black text-xl ${(item.currency || 'KRW') === 'USD' ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400'}`}
                                                        />
                                                        <Select value={item.currency || 'KRW'} onValueChange={(val: "KRW" | "USD") => updateCartItem(item.uid, 'currency', val)}>
                                                            <SelectTrigger className="w-[70px] h-12 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 font-black text-xs">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent className="dark:bg-zinc-900">
                                                                <SelectItem value="KRW" className="font-bold">KRW</SelectItem>
                                                                <SelectItem value="USD" className="font-bold">USD</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black uppercase text-zinc-500">날짜</label>
                                                        <input
                                                            type="date"
                                                            value={item.date?.split('T')[0] || new Date().toISOString().split('T')[0]}
                                                            onChange={(e) => updateCartItem(item.uid, 'date', e.target.value)}
                                                            className="w-full h-10 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 text-sm font-bold text-zinc-600 dark:text-zinc-400"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black uppercase text-zinc-500">계좌/비고</label>
                                                        <Input
                                                            type="text"
                                                            value={item.account || ""}
                                                            onChange={(e) => updateCartItem(item.uid, 'account', e.target.value)}
                                                            className="h-10 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 font-medium text-xs"
                                                            placeholder="계좌명"
                                                        />
                                                    </div>
                                                </div>
                                            </Card>
                                        ))
                                    )}
                                </div>
                            </>
                        )}

                        {/* Step 3: Complete */}
                        {currentStep === 3 && (
                            <div className="flex-1 flex flex-col items-center justify-center text-center pb-20">
                                <div className="w-24 h-24 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-8 animate-in zoom-in duration-500">
                                    <Check className="w-12 h-12" strokeWidth={4} />
                                </div>
                                <h3 className="text-4xl font-black text-zinc-900 dark:text-white mb-4">등록이 완료되었습니다!</h3>
                                <p className="text-zinc-500 text-lg mb-12">
                                    총 <span className="text-emerald-600 font-bold">{cart.length}</span>개의 자산이 포트폴리오에 추가되었습니다.
                                </p>
                                <Button
                                    className="px-12 py-6 text-lg rounded-full font-bold bg-zinc-900 dark:bg-white text-white dark:text-black hover:scale-105 transition-transform"
                                    onClick={() => router.push("/portfolio/asset")}
                                >
                                    내 자산 확인하러 가기
                                </Button>
                            </div>
                        )}

                        {/* Navigation Footer (Steps 1 & 2) */}
                        {currentStep < 3 && (
                            <div className={`mt-auto pt-8 flex items-center justify-center gap-4 ${isMobile ? 'fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md p-4 border-t border-zinc-100 dark:border-zinc-800 z-50' : ''}`}>
                                <button
                                    onClick={handlePrevious}
                                    disabled={currentStep === 1}
                                    className={`px-8 md:px-10 py-3 md:py-4 rounded-full font-bold transition-all text-sm md:text-base ${currentStep === 1
                                        ? "opacity-0 pointer-events-none"
                                        : "bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800"
                                        }`}
                                >
                                    이전
                                </button>
                                <button
                                    onClick={handleNext}
                                    disabled={cart.length === 0 || isSubmitting}
                                    className={`px-8 md:px-10 py-3 md:py-4 rounded-full font-bold shadow-xl transition-all flex items-center gap-2 text-sm md:text-base ${cart.length === 0 || isSubmitting
                                        ? "bg-zinc-200 text-zinc-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-600 shadow-none"
                                        : "bg-emerald-600 text-white shadow-emerald-900/20 hover:bg-emerald-500 hover:scale-105 active:scale-95"
                                        }`}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            등록 중...
                                        </>
                                    ) : (
                                        currentStep === 2 ? "등록 완료" : "다음"
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}

function AssetItem({ item, onSelect, isSelected }: { item: Asset, onSelect: any, isSelected: boolean }) {
    return (
        <button
            onClick={() => onSelect(item)}
            className={`flex items-center gap-4 p-4 rounded-2xl border transition-all text-left w-full group relative overflow-hidden
                ${isSelected
                    ? "border-emerald-500 bg-emerald-50/20 dark:bg-emerald-500/10 ring-2 ring-emerald-500 ring-offset-2 ring-offset-white dark:ring-offset-black z-10"
                    : "border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 hover:border-emerald-500/50 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
        >
            <div className="w-12 h-12 rounded-xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0 overflow-hidden border border-zinc-100 dark:border-zinc-700">
                {item.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.logo} alt={item.name} className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} />
                ) : item.type === 'stock' ? (
                    <Building2 className="h-6 w-6" />
                ) : item.type === 'crypto' ? (
                    <Bitcoin className="h-6 w-6" />
                ) : (
                    <Banknote className="h-6 w-6" />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <span className={`font-bold text-base truncate ${isSelected ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-900 dark:text-white"}`}>
                        {item.name}
                    </span>
                    {item.market && <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{item.market}</Badge>}
                </div>
                <div className="flex items-center text-xs font-medium text-zinc-500">
                    <span className="truncate">{item.symbol}</span>
                </div>
            </div>
            <div className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${isSelected ? "bg-emerald-500 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-300 group-hover:text-emerald-500 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-900/50"}`}>
                {isSelected ? <ChevronRight className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            </div>
        </button>
    );
}
