"use client";

import React, { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, TrendingUp, TrendingDown, AlertTriangle, Target, Lightbulb } from "lucide-react";

interface AIInsightsModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export default function AIInsightsModal({ open, onOpenChange }: AIInsightsModalProps) {
    // Mock AI insights data
    const insights = {
        summary: "포트폴리오가 전반적으로 균형잡힌 구성을 보이고 있습니다. 기술주 중심의 공격적 투자 성향이 보이며, 최근 수익률이 개선되고 있습니다.",
        strengths: [
            "기술주와 암호화폐의 균형잡힌 분산 투자",
            "성장 가능성이 높은 종목 위주로 구성",
            "변동성 관리가 잘 되어있습니다",
            "평균 보유 기간이 적절하여 단기 트레이딩 리스크 최소화"
        ],
        weaknesses: [
            "배당주 비중이 낮아 안정적인 현금흐름 부족",
            "섹터 집중도가 높아 특정 산업 리스크 노출",
            "손절 기준이 명확하지 않아 손실 확대 가능성"
        ],
        recommendations: [
            {
                title: "포트폴리오 리밸런싱",
                description: "기술주 비중을 60%로 줄이고, 배당주 20%, 채권 10%를 추가하여 안정성을 높이세요.",
                priority: "high"
            },
            {
                title: "손절 기준 설정",
                description: "각 종목별로 -10% 손절 기준을 설정하고 자동 알림을 활성화하세요.",
                priority: "high"
            },
            {
                title: "섹터 다각화",
                description: "헬스케어, 에너지 섹터를 추가하여 리스크를 분산하세요.",
                priority: "medium"
            },
            {
                title: "정기 리뷰 일정",
                description: "월 1회 포트폴리오 리뷰를 통해 목표 대비 성과를 점검하세요.",
                priority: "low"
            }
        ],
        riskAnalysis: {
            level: "중간",
            score: 6.5,
            factors: [
                "변동성: 중간 (일 평균 2.3%)",
                "집중도: 높음 (상위 3종목이 70% 차지)",
                "유동성: 양호 (대부분 대형주)"
            ]
        }
    };

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case "high": return "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400";
            case "medium": return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400";
            case "low": return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400";
            default: return "bg-muted text-muted-foreground";
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-black flex items-center gap-2">
                        <Sparkles className="h-6 w-6 text-purple-500" />
                        AI 포트폴리오 인사이트
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-6">
                    {/* Summary */}
                    <Card className="bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/20 border-purple-200 dark:border-purple-800">
                        <CardContent className="pt-6">
                            <p className="text-sm leading-relaxed">{insights.summary}</p>
                        </CardContent>
                    </Card>

                    {/* Strengths */}
                    <div>
                        <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-emerald-500" />
                            강점
                        </h3>
                        <div className="space-y-2">
                            {insights.strengths.map((strength, idx) => (
                                <div key={idx} className="flex items-start gap-2 text-sm">
                                    <span className="text-emerald-500 mt-0.5">✓</span>
                                    <span>{strength}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Weaknesses */}
                    <div>
                        <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-500" />
                            개선 포인트
                        </h3>
                        <div className="space-y-2">
                            {insights.weaknesses.map((weakness, idx) => (
                                <div key={idx} className="flex items-start gap-2 text-sm">
                                    <span className="text-amber-500 mt-0.5">⚠</span>
                                    <span>{weakness}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Recommendations */}
                    <div>
                        <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                            <Lightbulb className="h-5 w-5 text-indigo-500" />
                            맞춤 추천
                        </h3>
                        <div className="space-y-3">
                            {insights.recommendations.map((rec, idx) => (
                                <Card key={idx} className="border-l-4 border-l-indigo-500">
                                    <CardContent className="pt-4">
                                        <div className="flex items-start justify-between mb-2">
                                            <h4 className="font-bold text-sm">{rec.title}</h4>
                                            <Badge className={getPriorityColor(rec.priority)}>
                                                {rec.priority === "high" ? "높음" : rec.priority === "medium" ? "중간" : "낮음"}
                                            </Badge>
                                        </div>
                                        <p className="text-sm text-muted-foreground">{rec.description}</p>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>

                    {/* Risk Analysis */}
                    <Card className="bg-muted">
                        <CardContent className="pt-6">
                            <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                                <Target className="h-5 w-5 text-rose-500" />
                                리스크 분석
                            </h3>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">위험도</span>
                                    <div className="flex items-center gap-2">
                                        <div className="w-32 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                                            <div 
                                                className="h-full bg-amber-500"
                                                style={{ width: `${(insights.riskAnalysis.score / 10) * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-sm font-bold">{insights.riskAnalysis.level}</span>
                                    </div>
                                </div>
                                <div className="mt-3 space-y-1">
                                    {insights.riskAnalysis.factors.map((factor, idx) => (
                                        <p key={idx} className="text-sm text-muted-foreground">• {factor}</p>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </DialogContent>
        </Dialog>
    );
}
