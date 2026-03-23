"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
    Zap, 
    TrendingUp, 
    Sparkles, 
    Check, 
    ArrowRight,
    LayoutGrid,
    Brain,
    Rocket
} from "lucide-react";

// Mock 데이터
const DEMO_ASSETS = [
    { symbol: "AAPL", name: "Apple", price: 180000, change: 2.5, type: "stock" },
    { symbol: "TSLA", name: "Tesla", price: 250000, change: -1.2, type: "stock" },
    { symbol: "BTC", name: "Bitcoin", price: 65000000, change: 5.8, type: "crypto" },
    { symbol: "ETH", name: "Ethereum", price: 4500000, change: 3.2, type: "crypto" },
    { symbol: "005930", name: "삼성전자", price: 75000, change: 1.8, type: "stock" },
];

const MOCK_AI_ANALYSIS = `안녕하세요! 포트폴리오를 분석했습니다.

**강점:**
✅ 기술주와 암호화폐의 균형잡힌 분산 투자
✅ 성장 가능성이 높은 종목 위주로 구성
✅ 변동성 관리가 잘 되어있습니다

**개선 포인트:**
💡 배당주 비중을 늘려 안정적인 현금흐름 확보 추천
💡 섹터 다각화로 리스크 분산 고려

전반적으로 공격적이면서도 균형잡힌 포트폴리오입니다!`;

export default function TestflightPage() {
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState(1);
    const [selectedAssets, setSelectedAssets] = useState<typeof DEMO_ASSETS>([]);
    const [showGuide, setShowGuide] = useState(true);

    const totalSteps = 4;

    const handleAssetSelect = (asset: typeof DEMO_ASSETS[0]) => {
        if (selectedAssets.find(a => a.symbol === asset.symbol)) {
            setSelectedAssets(selectedAssets.filter(a => a.symbol !== asset.symbol));
        } else {
            setSelectedAssets([...selectedAssets, asset]);
        }
    };

    const handleNext = () => {
        if (currentStep < totalSteps) {
            setCurrentStep(currentStep + 1);
            setShowGuide(true);
        }
    };

    const handleComplete = () => {
        router.push("/login");
    };

    // 가이드 툴팁
    const GuideTooltip = ({ message }: { message: string }) => (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute -top-16 left-1/2 -translate-x-1/2 bg-primary text-white px-4 py-2 rounded-xl shadow-xl z-50 whitespace-nowrap"
        >
            {message}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-primary" />
        </motion.div>
    );

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-zinc-950 dark:via-zinc-900 dark:to-indigo-950">
            {/* Header */}
            <div className="container mx-auto px-4 py-8">
                <div className="text-center mb-8">
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center justify-center gap-2 mb-4"
                    >
                        <Zap className="h-8 w-8 text-primary" />
                        <h1 className="text-4xl font-black">Tutum 10초 체험</h1>
                    </motion.div>
                    <p className="text-muted-foreground text-lg">
                        실제 기능을 바로 체험해보세요
                    </p>
                </div>

                {/* Step Indicator */}
                <div className="flex items-center justify-center gap-2 mb-12">
                    {[1, 2, 3, 4].map((step) => (
                        <div key={step} className="flex items-center">
                            <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
                                    step <= currentStep
                                        ? "bg-primary text-white"
                                        : "bg-muted text-muted-foreground"
                                }`}
                            >
                                {step < currentStep ? <Check className="h-5 w-5" /> : step}
                            </div>
                            {step < 4 && (
                                <div
                                    className={`w-12 h-1 mx-2 transition-all ${
                                        step < currentStep ? "bg-primary" : "bg-muted"
                                    }`}
                                />
                            )}
                        </div>
                    ))}
                </div>

                {/* Content */}
                <div className="max-w-4xl mx-auto">
                    <AnimatePresence mode="wait">
                        {/* Step 1: 자산 선택 */}
                        {currentStep === 1 && (
                            <motion.div
                                key="step1"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                            >
                                <Card className="border-2 border-primary/20 shadow-xl">
                                    <CardHeader>
                                        <CardTitle className="text-2xl flex items-center gap-2">
                                            <LayoutGrid className="h-6 w-6 text-primary" />
                                            Step 1: 자산 추가하기
                                        </CardTitle>
                                        <p className="text-muted-foreground">
                                            관심있는 자산을 선택해보세요
                                        </p>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative">
                                            {showGuide && selectedAssets.length === 0 && (
                                                <GuideTooltip message="👆 여기를 클릭해보세요!" />
                                            )}
                                            {DEMO_ASSETS.map((asset) => {
                                                const isSelected = selectedAssets.find(
                                                    (a) => a.symbol === asset.symbol
                                                );
                                                return (
                                                    <motion.div
                                                        key={asset.symbol}
                                                        whileHover={{ scale: 1.02 }}
                                                        whileTap={{ scale: 0.98 }}
                                                    >
                                                        <Card
                                                            className={`cursor-pointer transition-all ${
                                                                isSelected
                                                                    ? "border-2 border-primary bg-primary/5"
                                                                    : "border hover:border-primary/50"
                                                            }`}
                                                            onClick={() => {
                                                                handleAssetSelect(asset);
                                                                setShowGuide(false);
                                                            }}
                                                        >
                                                            <CardContent className="p-4">
                                                                <div className="flex items-center justify-between">
                                                                    <div>
                                                                        <p className="font-bold text-lg">
                                                                            {asset.name}
                                                                        </p>
                                                                        <p className="text-sm text-muted-foreground">
                                                                            {asset.symbol}
                                                                        </p>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <p className="font-bold">
                                                                            {asset.price.toLocaleString()}원
                                                                        </p>
                                                                        <p
                                                                            className={`text-sm ${
                                                                                asset.change >= 0
                                                                                    ? "text-emerald-500"
                                                                                    : "text-rose-500"
                                                                            }`}
                                                                        >
                                                                            {asset.change >= 0 ? "+" : ""}
                                                                            {asset.change}%
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                {isSelected && (
                                                                    <div className="mt-2 flex items-center gap-1 text-primary text-sm font-bold">
                                                                        <Check className="h-4 w-4" />
                                                                        선택됨
                                                                    </div>
                                                                )}
                                                            </CardContent>
                                                        </Card>
                                                    </motion.div>
                                                );
                                            })}
                                        </div>
                                        <Button
                                            className="w-full mt-6"
                                            size="lg"
                                            onClick={handleNext}
                                            disabled={selectedAssets.length === 0}
                                        >
                                            다음 단계
                                            <ArrowRight className="ml-2 h-5 w-5" />
                                        </Button>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        )}

                        {/* Step 2: 포트폴리오 확인 */}
                        {currentStep === 2 && (
                            <motion.div
                                key="step2"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                            >
                                <Card className="border-2 border-primary/20 shadow-xl">
                                    <CardHeader>
                                        <CardTitle className="text-2xl flex items-center gap-2">
                                            <TrendingUp className="h-6 w-6 text-emerald-500" />
                                            Step 2: 포트폴리오 확인
                                        </CardTitle>
                                        <p className="text-muted-foreground">
                                            실시간으로 업데이트되는 포트폴리오
                                        </p>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-4">
                                            {/* 총 자산 */}
                                            <div className="p-6 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl text-white">
                                                <p className="text-sm opacity-90">총 평가금액</p>
                                                <p className="text-4xl font-black mt-2">
                                                    {(
                                                        selectedAssets.reduce(
                                                            (sum, a) => sum + a.price,
                                                            0
                                                        ) * 1.05
                                                    ).toLocaleString()}
                                                    원
                                                </p>
                                                <p className="text-sm mt-2 flex items-center gap-1">
                                                    <TrendingUp className="h-4 w-4" />
                                                    +5.0% (수익)
                                                </p>
                                            </div>

                                            {/* 자산 목록 */}
                                            <div className="space-y-2">
                                                {selectedAssets.map((asset) => (
                                                    <div
                                                        key={asset.symbol}
                                                        className="flex items-center justify-between p-4 bg-muted rounded-lg"
                                                    >
                                                        <div>
                                                            <p className="font-bold">{asset.name}</p>
                                                            <p className="text-sm text-muted-foreground">
                                                                {asset.symbol}
                                                            </p>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className="font-bold">
                                                                {asset.price.toLocaleString()}원
                                                            </p>
                                                            <p
                                                                className={`text-sm ${
                                                                    asset.change >= 0
                                                                        ? "text-emerald-500"
                                                                        : "text-rose-500"
                                                                }`}
                                                            >
                                                                {asset.change >= 0 ? "+" : ""}
                                                                {asset.change}%
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        <Button
                                            className="w-full mt-6"
                                            size="lg"
                                            onClick={handleNext}
                                        >
                                            다음 단계
                                            <ArrowRight className="ml-2 h-5 w-5" />
                                        </Button>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        )}

                        {/* Step 3: AI 분석 */}
                        {currentStep === 3 && (
                            <motion.div
                                key="step3"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                            >
                                <Card className="border-2 border-primary/20 shadow-xl">
                                    <CardHeader>
                                        <CardTitle className="text-2xl flex items-center gap-2">
                                            <Brain className="h-6 w-6 text-purple-500" />
                                            Step 3: AI 분석 결과
                                        </CardTitle>
                                        <p className="text-muted-foreground">
                                            AI가 포트폴리오를 분석했어요
                                        </p>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="p-6 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/20 rounded-xl">
                                            <div className="flex items-center gap-2 mb-4">
                                                <Sparkles className="h-5 w-5 text-purple-500 animate-pulse" />
                                                <p className="font-bold text-lg">AI 인사이트</p>
                                            </div>
                                            <div className="prose dark:prose-invert max-w-none">
                                                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                                                    {MOCK_AI_ANALYSIS}
                                                </pre>
                                            </div>
                                        </div>
                                        <Button
                                            className="w-full mt-6"
                                            size="lg"
                                            onClick={handleNext}
                                        >
                                            다음 단계
                                            <ArrowRight className="ml-2 h-5 w-5" />
                                        </Button>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        )}

                        {/* Step 4: 완료 */}
                        {currentStep === 4 && (
                            <motion.div
                                key="step4"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                            >
                                <Card className="border-2 border-primary/20 shadow-xl text-center">
                                    <CardContent className="p-12">
                                        <motion.div
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            transition={{ delay: 0.2, type: "spring" }}
                                        >
                                            <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
                                                <Check className="h-10 w-10 text-white" />
                                            </div>
                                        </motion.div>
                                        <h2 className="text-3xl font-black mb-4">
                                            체험 완료! 🎉
                                        </h2>
                                        <p className="text-muted-foreground text-lg mb-8">
                                            Tutum의 강력한 기능을 경험하셨나요?
                                            <br />
                                            지금 바로 무료로 시작하세요!
                                        </p>
                                        <motion.div
                                            animate={{ scale: [1, 1.05, 1] }}
                                            transition={{ repeat: Infinity, duration: 2 }}
                                        >
                                            <Button
                                                size="lg"
                                                className="text-lg px-8 py-6"
                                                onClick={handleComplete}
                                            >
                                                <Rocket className="mr-2 h-6 w-6" />
                                                무료로 시작하기
                                            </Button>
                                        </motion.div>
                                        <p className="text-sm text-muted-foreground mt-4">
                                            신용카드 필요 없음 · 언제든 해지 가능
                                        </p>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
