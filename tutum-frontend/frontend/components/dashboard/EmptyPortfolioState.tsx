"use client";

import Link from "next/link";
import { ArrowRight, PlusCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type EmptyPortfolioStateProps = {
  title?: string;
  description?: string;
  ctaHref?: string;
  ctaLabel?: string;
  compact?: boolean;
};

export default function EmptyPortfolioState({
  title = "자산을 등록해주세요",
  description = "등록 후 히트맵, 키워드, AI 분석이 함께 활성화됩니다.",
  ctaHref = "/direct-input",
  ctaLabel = "자산 등록하기",
  compact = false,
}: EmptyPortfolioStateProps) {
  return (
    <Card className="h-full border border-dashed border-zinc-300/80 bg-zinc-100/70 shadow-none dark:border-white/10 dark:bg-zinc-900/40">
      <CardContent className={`flex h-full flex-col items-center justify-center text-center ${compact ? "gap-3 p-5" : "gap-4 p-8"}`}>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-zinc-500 shadow-sm dark:bg-white/10 dark:text-zinc-300">
          <PlusCircle className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <p className={`${compact ? "text-base" : "text-lg"} font-black text-zinc-900 dark:text-white`}>{title}</p>
          <p className={`${compact ? "text-xs" : "text-sm"} max-w-md leading-relaxed text-zinc-500 dark:text-zinc-400`}>
            {description}
          </p>
        </div>
        <Button asChild className="rounded-full px-4 font-bold">
          <Link href={ctaHref}>
            {ctaLabel}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
