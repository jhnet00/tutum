"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, useInView } from "framer-motion";
import Image from "next/image";

const FEATURES = [
    {
        title: "언제 어디서나 실시간 확인",
        description: "데스크탑부터 모바일까지, 모든 기기에서 완벽하게 동기화되는 나만의 금융 대시보드.",
        image: "/images/ipad-chart1.png",
        side: "left",
        tags: ["#FinOps", "#Real_Time_Price"]
    },
    {
        title: "AI 기반의 정밀한 데이터 분석",
        description: "복잡한 수치들을 한눈에 이해하기 쉽게 시각화합니다. 포트폴리오의 건강 상태를 AI가 매일 체크해 드립니다.",
        image: "/images/ipad-ai1.png",
        side: "right",
        tags: ["#AI_Powered", "#Only_For_You", "#Personalized"]
    },
    {
        title: "터치 한 번으로 끝나는 자산 등록",
        description: "여러 증권사와 지갑의 내역을 캡처만 하세요. Tutum AI가 종목명, 수량, 평단가를 자동으로 인식합니다.",
        image: "/images/iphone-ocr1.png",
        side: "left",
        isPhone: true,
        tags: ["#OCR_Engine", "#Easy_Access"]
    }
];

export default function ScrollRevealSection() {
    return (
        <section className="py-24 lg:py-40 bg-white dark:bg-zinc-950 overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <div className="mx-auto max-w-2xl text-center mb-24 lg:mb-32">
                    <motion.h2 
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.6 }}
                        className="text-3xl font-black tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-5xl uppercase"
                    >
                        PREMIUM ASSET EXPERIENCE
                    </motion.h2>
                    <motion.p 
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        className="mt-6 text-lg leading-8 text-zinc-600 dark:text-zinc-400"
                    >
                        Tutum이 제공하는 압도적인 정교함과 편의성을 직접 경험해 보세요.
                        금융 생활의 질이 한 단계 올라갑니다.
                    </motion.p>
                </div>

                <div className="space-y-40 lg:space-y-64">
                    {FEATURES.map((feature, index) => (
                        <FeatureItem key={index} feature={feature} index={index} />
                    ))}
                </div>
            </div>
        </section>
    );
}

function FeatureItem({ feature, index }: { feature: any, index: number }) {
    const ref = useRef(null);
    const isInView = useInView(ref, { once: false, amount: 0.3 });
    const { scrollYProgress } = useScroll({
        target: ref,
        offset: ["start end", "end start"]
    });

    const scale = useTransform(scrollYProgress, [0, 0.5], [0.8, 1]);
    const y = useTransform(scrollYProgress, [0, 1], [100, -100]);

    return (
        <div 
            ref={ref}
            id={index === 0 ? "feature-step-01" : undefined}
            className={`flex flex-col ${feature.side === 'right' ? 'lg:flex-row-reverse' : 'lg:flex-row'} items-center gap-12 lg:gap-24`}
        >
            {/* Visual Part */}
            <motion.div 
                style={{ scale, y }}
                className="flex-1 relative w-full"
            >
                <div className={`relative mx-auto ${feature.isPhone ? 'max-w-[280px] sm:max-w-[320px]' : 'max-w-[500px] lg:max-w-none shadow-2xl rounded-2xl overflow-hidden border-[4px] lg:border-[8px] border-zinc-700 bg-zinc-800 ring-1 ring-black/10 dark:border-zinc-600 dark:bg-zinc-700 dark:ring-white/14'}`}>
                    <div className={feature.isPhone ? "relative aspect-[9/19.5] rounded-[3rem] border-[8px] border-zinc-900 dark:border-zinc-800 bg-zinc-800 overflow-hidden shadow-2xl ring-1 ring-black/5 dark:ring-white/20" : "relative aspect-[4/3] rounded-[0.9rem] overflow-hidden"}>
                        <Image 
                            src={feature.image} 
                            alt={feature.title} 
                            fill
                            className={feature.isPhone ? "object-cover" : "object-contain opacity-100"}
                        />
                    </div>
                    
                    {/* Floating decoration elements */}
                    <motion.div 
                        animate={{ y: [0, -20, 0] }}
                        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute -top-6 -right-6 lg:-top-12 lg:-right-12 h-20 w-20 lg:h-32 lg:w-32 bg-violet-500/20 dark:bg-violet-500/30 rounded-full blur-2xl -z-10"
                    />
                </div>
            </motion.div>

            {/* Text Part */}
            <div className="flex-1 text-center lg:text-left">
                <motion.div
                    initial={{ opacity: 0, x: feature.side === 'right' ? 50 : -50 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                >
                    <span className="text-violet-500 dark:text-violet-400 font-technical text-lg tracking-widest uppercase mb-4 block">
                        STEP {String(index + 1).padStart(2, '0')}
                    </span>
                    <h3 className="text-2xl sm:text-4xl font-black text-zinc-900 dark:text-zinc-100 mb-6 leading-tight">
                        {feature.title}
                    </h3>
                    <p className="text-base sm:text-xl text-zinc-500 dark:text-zinc-400 font-medium leading-relaxed">
                        {feature.description}
                    </p>
                    
                    <div className="mt-10 flex flex-wrap justify-center lg:justify-start gap-4">
                        {feature.tags && feature.tags.map((tag: string, i: number) => (
                            <div key={i} className={`flex items-center gap-2 px-4 py-2 rounded-full border ${i % 2 === 0 ? 'border-indigo-100 dark:border-indigo-500/20 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' : 'border-fuchsia-100 dark:border-fuchsia-500/20 bg-fuchsia-50 dark:bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300'} text-xs font-bold tracking-wider shadow-sm`}>
                                <span className={i % 2 === 0 ? "text-indigo-500" : "text-fuchsia-500"}>#</span>
                                {tag.replace('#', '')}
                            </div>
                        ))}
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
