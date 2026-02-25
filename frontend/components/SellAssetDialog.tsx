"use client";

import React, { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { HoldingAsset } from "@/context/AssetContext";
import { useAuth } from "@/contexts/AuthContext";

interface SellAssetDialogProps {
    asset: HoldingAsset | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSellComplete?: () => void;
}

export default function SellAssetDialog({
    asset,
    open,
    onOpenChange,
    onSellComplete,
}: SellAssetDialogProps) {
    const [sellQuantity, setSellQuantity] = useState("");
    const [sellPrice, setSellPrice] = useState("");
    const [sellReason, setSellReason] = useState("");
    const [memo, setMemo] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { token } = useAuth();

    if (!asset) return null;

    const quantity = parseFloat(sellQuantity) || 0;
    const price = parseFloat(sellPrice) || 0;
    const averagePrice = asset.averagePrice || 0;

    // 실현손익 계산
    const realizedProfit = (price - averagePrice) * quantity;
    const profitRate = averagePrice > 0 ? ((price - averagePrice) / averagePrice) * 100 : 0;

    const handleSell = async () => {
        if (quantity <= 0 || quantity > asset.amount) {
            alert("유효한 매도 수량을 입력하세요.");
            return;
        }

        if (price <= 0) {
            alert("유효한 매도가를 입력하세요.");
            return;
        }

        setIsSubmitting(true);

        try {
            const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

            const response = await fetch(`${API_BASE_URL}/api/v1/assets/${asset.id}/sell`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify({
                    quantity,
                    sell_price: price,
                    sell_reason: sellReason || null,
                    sell_date: new Date().toISOString(),
                    memo: memo || null,
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || "매도 실패");
            }

            const result = await response.json();
            alert(`매도 완료!\n실현손익: ${result.realized_profit.toLocaleString()}원`);

            // Reset form
            setSellQuantity("");
            setSellPrice("");
            setSellReason("");
            setMemo("");

            onOpenChange(false);
            onSellComplete?.();
        } catch (error) {
            console.error("Sell error:", error);
            alert(error instanceof Error ? error.message : "매도 중 오류가 발생했습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold">
                        {asset.name} 매도
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* 현재 보유 정보 */}
                    <Card className="bg-muted">
                        <CardContent className="pt-4">
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">보유 수량</span>
                                    <span className="font-bold">{asset.amount}주</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">평균 매수가</span>
                                    <span className="font-bold">
                                        {averagePrice.toLocaleString()}원
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">현재가</span>
                                    <span className="font-bold">
                                        {asset.currentPrice.toLocaleString()}원
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* 매도 수량 */}
                    <div>
                        <Label htmlFor="quantity">매도 수량</Label>
                        <Input
                            id="quantity"
                            type="number"
                            placeholder={`최대 ${asset.amount}주`}
                            value={sellQuantity}
                            onChange={(e) => setSellQuantity(e.target.value)}
                            max={asset.amount}
                            min={0}
                            step="0.01"
                        />
                    </div>

                    {/* 매도가 */}
                    <div>
                        <Label htmlFor="price">매도가</Label>
                        <Input
                            id="price"
                            type="number"
                            placeholder="매도 가격 입력"
                            value={sellPrice}
                            onChange={(e) => setSellPrice(e.target.value)}
                            min={0}
                            step="0.01"
                        />
                    </div>

                    {/* 매도 사유 */}
                    <div>
                        <Label htmlFor="reason">매도 사유</Label>
                        <Select value={sellReason} onValueChange={setSellReason}>
                            <SelectTrigger id="reason">
                                <SelectValue placeholder="사유 선택 (선택사항)" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="목표가 도달">목표가 도달</SelectItem>
                                <SelectItem value="손절">손절</SelectItem>
                                <SelectItem value="리밸런싱">리밸런싱</SelectItem>
                                <SelectItem value="긴급 자금">긴급 자금</SelectItem>
                                <SelectItem value="기타">기타</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* 메모 */}
                    <div>
                        <Label htmlFor="memo">메모 (선택)</Label>
                        <Textarea
                            id="memo"
                            placeholder="추가 메모..."
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            rows={3}
                        />
                    </div>

                    {/* 예상 실현손익 */}
                    {quantity > 0 && price > 0 && (
                        <Card
                            className={`${
                                realizedProfit >= 0
                                    ? "bg-profit-soft border-profit-soft"
                                    : "bg-loss-soft border-loss-soft"
                            }`}
                        >
                            <CardContent className="pt-4">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium">예상 실현손익</span>
                                        <div className="flex items-center gap-1">
                                            {realizedProfit >= 0 ? (
                                                <TrendingUp className="h-4 w-4 text-profit" />
                                            ) : (
                                                <TrendingDown className="h-4 w-4 text-loss" />
                                            )}
                                            <span
                                                className={`text-lg font-black ${
                                                    realizedProfit >= 0
                                                        ? "text-profit"
                                                        : "text-loss"
                                                }`}
                                            >
                                                {realizedProfit >= 0 ? "+" : ""}
                                                {realizedProfit.toLocaleString()}원
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium">수익률</span>
                                        <span
                                            className={`text-sm font-bold ${
                                                profitRate >= 0
                                                    ? "text-profit"
                                                    : "text-loss"
                                            }`}
                                        >
                                            {profitRate >= 0 ? "+" : ""}
                                            {profitRate.toFixed(2)}%
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        취소
                    </Button>
                    <Button
                        onClick={handleSell}
                        disabled={isSubmitting || quantity <= 0 || price <= 0}
                        className="bg-loss-solid text-white hover:brightness-110"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                처리 중...
                            </>
                        ) : (
                            "매도 확인"
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
