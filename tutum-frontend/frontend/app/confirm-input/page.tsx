"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PortfolioHeader from "@/components/PortfolioHeader";
import { Check, Plus, Trash2, ArrowLeft, Building2, Bitcoin, Banknote, HelpCircle, Loader2 } from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface PendingAsset {
    uid: string;
    symbol: string;
    name: string;
    type: "stock" | "crypto" | "others";
    customType?: string;
    quantity: number;
    price: number;
    currency: "KRW" | "USD";
    date: string;
    account?: string;
    market?: string;
}

export default function BulkRegisterPage() {
    const router = useRouter();
    const { user, token } = useAuth();
    const [assets, setAssets] = useState<PendingAsset[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [columnWidths, setColumnWidths] = useState({
        name: 250,
        type: 140,
        quantity: 150,
        price: 220,
        date: 140,
        account: 150,
    });

    const resizingCol = useRef<{ field: string, startX: number, startWidth: number } | null>(null);

    // Load data from LocalStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem("pending_assets");
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setAssets(parsed);
                // Clear after loading (optional, or keep for session)
                // localStorage.removeItem("pending_assets");
            } catch (e) {
                console.error("Failed to parse pending assets:", e);
            }
        }
    }, []);

    const handleAddRow = () => {
        const newAsset: PendingAsset = {
            uid: Math.random().toString(36).substr(2, 9),
            symbol: "",
            name: "",
            type: "stock",
            quantity: 0,
            price: 0,
            currency: "KRW",
            date: new Date().toISOString().split('T')[0],
            account: ""
        };
        setAssets([...assets, newAsset]);
    };

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

    const formatNumber = (val: number) => {
        return val.toLocaleString('ko-KR');
    };

    const parseNumber = (val: string) => {
        const num = parseFloat(val.replace(/,/g, ''));
        return isNaN(num) ? 0 : num;
    };

    const handleRemoveRow = (uid: string) => {
        setAssets(assets.filter(a => a.uid !== uid));
    };

    const updateAsset = (uid: string, field: keyof PendingAsset, value: any) => {
        setAssets(assets.map(a => a.uid === uid ? { ...a, [field]: value } : a));
    };

    const handleRegister = async () => {
        if (!user) {
            alert("로그인이 필요합니다.");
            return;
        }

        if (assets.length === 0) {
            alert("등록할 자산이 없습니다.");
            return;
        }

        setIsSubmitting(true);
        try {
            const payload = {
                assets: assets.map(asset => ({
                    symbol: asset.symbol,
                    name: asset.name || asset.symbol,
                    asset_type: asset.type === "others" ? (asset.customType || "etc") : asset.type,
                    quantity: asset.quantity,
                    average_price: asset.price,
                    currency: asset.currency,
                    transaction_date: asset.date,
                    account_name: asset.account
                }))
            };

            const response = await fetch(`${API_BASE_URL}/api/v1/assets/bulk`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || "자산 등록에 실패했습니다.");
            }

            const result = await response.json();
            alert(`✅ ${result.success_count}개의 자산이 성공적으로 등록되었습니다!`);
            
            localStorage.removeItem("pending_assets");
            router.push("/portfolio/asset");
        } catch (error) {
            console.error("❌ Registration error:", error);
            alert("자산 등록 중 오류가 발생했습니다: " + (error as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950 transition-colors duration-300">
            <PortfolioHeader />
            
            <div className="flex flex-1">
                {/* Left Sidebar (Simple) - Hidden on Mobile */}
                <aside className="w-72 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-8 hidden md:block">
                    <h1 className="mb-10 text-xl font-black text-zinc-900 dark:text-zinc-100 uppercase tracking-tight">자산 등록 확인</h1>
                    <div className="space-y-6">
                        <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
                            <p className="text-sm font-bold text-zinc-500 mb-1">총 등록 자산</p>
                            <p className="text-3xl font-black text-zinc-900 dark:text-white">{assets.length}개</p>
                        </div>
                        <Button 
                            variant="outline" 
                            className="w-full justify-start gap-2 rounded-xl"
                            onClick={() => router.back()}
                        >
                            <ArrowLeft className="h-4 w-4" />
                            <span>이전 단계로</span>
                        </Button>
                    </div>
                </aside>

                <main className="flex-1 p-4 md:p-12 overflow-hidden flex flex-col">
                    <div className="mx-auto w-full max-w-7xl h-full flex flex-col">
                        <header className="mb-8 flex justify-between items-end">
                            <div className="space-y-1">
                                <h2 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white flex items-center gap-3">
                                    등록 내역 확인 및 수정
                                    <Badge className="bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-none px-3 py-1">최종 단계</Badge>
                                </h2>
                                <p className="text-zinc-500 font-medium leading-relaxed">
                                    업로드된 정보를 확인하고 필요시 수정해 주세요. 새로운 자산을 행 추가로 직접 입력할 수도 있습니다.
                                </p>
                            </div>
                            <Button 
                                onClick={handleAddRow}
                                className="bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-full font-bold px-6"
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                행 추가
                            </Button>
                        </header>

                        {/* Table Area (Desktop) */}
                        <Card className="flex-1 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 shadow-sm overflow-hidden hidden md:flex flex-col">
                            <div className="overflow-x-auto flex-1 h-full scrollbar-thin">
                                <table className="w-full min-w-[1100px] text-sm text-left border-collapse table-fixed">
                                    <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800 z-20">
                                        <tr>
                                            <th style={{ width: columnWidths.name }} className="px-6 py-4 font-bold relative group/header">
                                                종목명/심볼
                                                <div onMouseDown={(e) => onMouseDown(e, 'name')} className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-200 dark:bg-zinc-800 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity z-30" />
                                            </th>
                                            <th style={{ width: columnWidths.type }} className="px-6 py-4 font-bold relative group/header">
                                                자산 종류
                                                <div onMouseDown={(e) => onMouseDown(e, 'type')} className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-200 dark:bg-zinc-800 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity z-30" />
                                            </th>
                                            <th style={{ width: columnWidths.quantity }} className="px-6 py-4 font-bold relative group/header">
                                                보유량
                                                <div onMouseDown={(e) => onMouseDown(e, 'quantity')} className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-200 dark:bg-zinc-800 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity z-30" />
                                            </th>
                                            <th style={{ width: columnWidths.price }} className="px-6 py-4 font-bold relative group/header">
                                                평단가/환율
                                                <div onMouseDown={(e) => onMouseDown(e, 'price')} className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-200 dark:bg-zinc-800 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity z-30" />
                                            </th>
                                            <th style={{ width: columnWidths.date }} className="px-6 py-4 font-bold relative group/header">
                                                날짜
                                                <div onMouseDown={(e) => onMouseDown(e, 'date')} className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-200 dark:bg-zinc-800 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity z-30" />
                                            </th>
                                            <th style={{ width: columnWidths.account }} className="px-6 py-4 font-bold relative group/header">
                                                계좌/비고
                                                <div onMouseDown={(e) => onMouseDown(e, 'account')} className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-200 dark:bg-zinc-800 cursor-col-resize opacity-0 group-hover/header:opacity-100 transition-opacity z-30" />
                                            </th>
                                            <th className="px-6 py-4 font-bold text-center w-20">삭제</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-transparent">
                                        {assets.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="px-6 py-20 text-center">
                                                    <div className="flex flex-col items-center justify-center text-zinc-400 gap-3">
                                                        <HelpCircle className="h-10 w-10 opacity-20" />
                                                        <p className="font-medium">등록할 자산이 없습니다. 행 추가를 눌러 직접 입력해 보세요.</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            assets.map((asset) => (
                                                <tr key={asset.uid} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors group">
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 border border-zinc-200 dark:border-zinc-700 shrink-0 shadow-sm">
                                                                {asset.type === 'stock' ? <Building2 className="h-5 w-5" /> : asset.type === 'crypto' ? <Bitcoin className="h-5 w-5" /> : <Banknote className="h-5 w-5" />}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <input 
                                                                    type="text" 
                                                                    value={asset.name} 
                                                                    onChange={(e) => updateAsset(asset.uid, 'name', e.target.value)}
                                                                    placeholder="삼성전자/BTC"
                                                                    className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white font-bold transition-all p-1"
                                                                />
                                                                <input 
                                                                    type="text" 
                                                                    value={asset.symbol} 
                                                                    onChange={(e) => updateAsset(asset.uid, 'symbol', e.target.value)}
                                                                    placeholder="005930"
                                                                    className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-500 text-[10px] font-medium p-1"
                                                                />
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="space-y-2">
                                                            <Select 
                                                                value={asset.type} 
                                                                onValueChange={(val: any) => updateAsset(asset.uid, 'type', val)}
                                                            >
                                                                <SelectTrigger className="w-full h-9 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 font-bold text-xs ring-offset-emerald-500">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent className="dark:bg-zinc-900 dark:border-zinc-800 font-bold">
                                                                    <SelectItem value="stock">주식</SelectItem>
                                                                    <SelectItem value="crypto">코인</SelectItem>
                                                                    <SelectItem value="others">기타</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                            {asset.type === 'others' && (
                                                                <Input
                                                                    type="text"
                                                                    value={asset.customType || ""}
                                                                    onChange={(e) => updateAsset(asset.uid, 'customType', e.target.value.slice(0, 100))}
                                                                    placeholder=""
                                                                    className="h-8 text-[10px] font-medium bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 focus-visible:ring-emerald-500"
                                                                />
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <Input 
                                                            type="number" 
                                                            value={asset.quantity} 
                                                            onChange={(e) => updateAsset(asset.uid, 'quantity', parseFloat(e.target.value))}
                                                            className="h-9 bg-transparent border-none hover:bg-zinc-100 dark:hover:bg-zinc-900 focus-visible:ring-emerald-500 text-right font-bold text-zinc-900 dark:text-zinc-100 transition-all"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <Input 
                                                                type="text" 
                                                                value={formatNumber(asset.price)} 
                                                                onChange={(e) => updateAsset(asset.uid, 'price', parseNumber(e.target.value))}
                                                                className={`flex-1 h-9 bg-transparent border-none hover:bg-zinc-100 dark:hover:bg-zinc-900 focus-visible:ring-emerald-500 text-right font-bold transition-all ${asset.currency === 'USD' ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400'}`}
                                                            />
                                                            <Select 
                                                                value={asset.currency} 
                                                                onValueChange={(val: any) => updateAsset(asset.uid, 'currency', val)}
                                                            >
                                                                <SelectTrigger className="w-[70px] h-8 bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-[10px] font-black shrink-0">
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
                                                            value={asset.date.split('T')[0]} 
                                                            onChange={(e) => updateAsset(asset.uid, 'date', e.target.value)}
                                                            className="w-full bg-transparent border-none text-xs font-bold text-zinc-500 dark:text-zinc-400 focus:outline-none p-1"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <Input 
                                                            type="text" 
                                                            value={asset.account || ""} 
                                                            onChange={(e) => updateAsset(asset.uid, 'account', e.target.value)}
                                                            placeholder="업비트/미래에셋"
                                                            className="h-9 bg-transparent border-none hover:bg-zinc-100 dark:hover:bg-zinc-900 focus-visible:ring-emerald-500 font-medium text-xs transition-all"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <button 
                                                            onClick={() => handleRemoveRow(asset.uid)}
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

                            {/* Footer / Submit (Desktop) */}
                            <div className="p-6 bg-zinc-50 dark:bg-zinc-900/80 border-t border-zinc-200 dark:border-zinc-800 hidden md:flex justify-center items-center gap-6">
                                <div className="text-sm font-medium text-zinc-500">
                                    총 <span className="text-zinc-900 dark:text-white font-bold">{assets.length}개</span>의 자산이 등록될 예정입니다.
                                </div>
                                <Button 
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 px-12 h-12 rounded-full font-black shadow-xl shadow-emerald-500/20 active:scale-95 transition-all text-lg"
                                    onClick={handleRegister}
                                    disabled={assets.length === 0 || isSubmitting}
                                >
                                    {isSubmitting ? "등록 중..." : "자산 일괄 등록하기"}
                                </Button>
                            </div>
                        </Card>

                        {/* Mobile View (Card List) */}
                        <div className="md:hidden flex-1 flex flex-col gap-4 overflow-y-auto pb-24 scrollbar-none">
                            {assets.length === 0 ? (
                                <div className="flex flex-col items-center justify-center text-zinc-400 py-20 bg-zinc-50 dark:bg-zinc-900/30 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800">
                                    <HelpCircle className="h-12 w-12 opacity-20 mb-4" />
                                    <p className="font-bold">등록할 자산이 없습니다.</p>
                                    <p className="text-xs">하단 버튼을 눌러 새 자산을 추가하세요.</p>
                                </div>
                            ) : (
                                assets.map((asset) => (
                                    <Card key={asset.uid} className="p-5 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 shadow-sm space-y-4 relative">
                                        <button 
                                            onClick={() => handleRemoveRow(asset.uid)}
                                            className="absolute top-4 right-4 p-2 text-zinc-300 hover:text-rose-500 transition-colors"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>

                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                                                {asset.type === 'stock' ? <Building2 className="h-5 w-5" /> : asset.type === 'crypto' ? <Bitcoin className="h-5 w-5" /> : <Banknote className="h-5 w-5" />}
                                            </div>
                                            <div className="flex-1">
                                                <input 
                                                    type="text" 
                                                    value={asset.name} 
                                                    onChange={(e) => updateAsset(asset.uid, 'name', e.target.value)}
                                                    className="w-full bg-transparent font-black text-lg text-zinc-900 dark:text-white focus:outline-none"
                                                    placeholder="종목명"
                                                />
                                                <input 
                                                    type="text" 
                                                    value={asset.symbol} 
                                                    onChange={(e) => updateAsset(asset.uid, 'symbol', e.target.value)}
                                                    className="w-full bg-transparent text-xs text-zinc-500 focus:outline-none"
                                                    placeholder="심볼/티커"
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase text-zinc-500">자산 종류</label>
                                                <Select value={asset.type} onValueChange={(val: any) => updateAsset(asset.uid, 'type', val)}>
                                                    <SelectTrigger className="h-10 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 font-bold">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="dark:bg-zinc-900">
                                                        <SelectItem value="stock">주식</SelectItem>
                                                        <SelectItem value="crypto">코인</SelectItem>
                                                        <SelectItem value="others">기타</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                {asset.type === 'others' && (
                                                    <Input
                                                        type="text"
                                                        value={asset.customType || ""}
                                                        onChange={(e) => updateAsset(asset.uid, 'customType', e.target.value.slice(0, 100))}
                                                        className="h-8 text-xs bg-white dark:bg-zinc-900"
                                                        placeholder=""
                                                    />
                                                )}
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase text-zinc-500">보유량</label>
                                                <Input 
                                                    type="number" 
                                                    value={asset.quantity} 
                                                    onChange={(e) => updateAsset(asset.uid, 'quantity', parseFloat(e.target.value))}
                                                    className="h-10 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 font-bold"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase text-zinc-500">평단가/환율</label>
                                            <div className="flex items-center gap-2">
                                                <Input 
                                                    type="text" 
                                                    value={formatNumber(asset.price)} 
                                                    onChange={(e) => updateAsset(asset.uid, 'price', parseNumber(e.target.value))}
                                                    className={`flex-1 h-12 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-right font-black text-xl ${asset.currency === 'USD' ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400'}`}
                                                />
                                                <Select value={asset.currency} onValueChange={(val: any) => updateAsset(asset.uid, 'currency', val)}>
                                                    <SelectTrigger className="w-[80px] h-12 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 font-black text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="dark:bg-zinc-900">
                                                        <SelectItem value="KRW" className="font-bold">KRW</SelectItem>
                                                        <SelectItem value="USD" className="font-bold">USD</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase text-zinc-500">날짜</label>
                                                <input type="date" value={asset.date.split('T')[0]} onChange={(e) => updateAsset(asset.uid, 'date', e.target.value)} className="w-full h-10 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 text-sm font-bold text-zinc-600 dark:text-zinc-400" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase text-zinc-500">계좌/비고</label>
                                                <Input type="text" value={asset.account || ""} onChange={(e) => updateAsset(asset.uid, 'account', e.target.value)} className="h-10 bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 font-medium text-xs" placeholder="예: 업비트" />
                                            </div>
                                        </div>
                                    </Card>
                                ))
                            )}
                        </div>

                        {/* Mobile Fixed Footer */}
                        <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl border-t border-zinc-200 dark:border-zinc-800 z-50">
                            <Button 
                                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 h-14 rounded-2xl font-black text-lg shadow-xl shadow-emerald-500/20"
                                onClick={handleRegister}
                                disabled={assets.length === 0 || isSubmitting}
                            >
                                {isSubmitting ? "등록 중..." : `${assets.length}개 자산 일괄 등록`}
                            </Button>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
