"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, ArrowRight, Building2, Bitcoin, Banknote, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

const SLIDES = [
    {
        id: "value-prop",
        title: <>흩어진 나의 모든 자산,<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-500 font-extrabold pb-2">Tutum AI</span>가 하나로.</>,
        description: "주식부터 코인까지. 여기저기 흩어진 자산 정보를 수동 입력 없이 AI 엔진으로 단 1초 만에 통합하고 분석하세요.",
        cta: "무료로 시작하기",
        ctaLink: "/login",
        type: "tablet-showcase",
        image: "/images/ipad-dashboard1.png",
    },
    {
        id: "how-to-ocr",
        title: <>사진만 찍으세요.<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 font-extrabold pb-2">기록은 AI가</span> 합니다.</>,
        description: "복잡한 자산 내역, 더 이상 직접 입력하지 마세요. Tutum의 OCR 엔진이 항목별로 정확하게 분류하여 포트폴리오에 반영합니다.",
        cta: "무료로 시작하기",
        ctaLink: "/login",
        type: "device-transition",
        images: ["/images/iphone-dashboard1.png", "/images/iphone-ocr1.png"],
    },
    {
        id: "service-depth",
        title: <>전문가 수준의,<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 font-extrabold pb-2">자산 리포트</span>를 매일.</>,
        description: "실시간 시세 반영부터 종목별 수익 곡선, 위험도 분석까지. 나만을 위한 고도화된 자산 관리 대시보드를 모든 기기에서 경험하세요.",
        cta: "무료로 시작하기",
        ctaLink: "/login",
        type: "tablet-showcase",
        image: "/images/ipad-dashboard2.png",
    },
];

export default function HeroCarousel() {
    const { user, isLoading } = useAuth();
    const [current, setCurrent] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const [phoneToggle, setPhoneToggle] = useState(false);

    const nextSlide = useCallback(() => {
        setCurrent((prev) => (prev + 1) % SLIDES.length);
    }, []);

    const prevSlide = () => {
        setCurrent((prev) => (prev - 1 + SLIDES.length) % SLIDES.length);
    };

    useEffect(() => {
        if (isPaused) return;
        const interval = setInterval(nextSlide, 7000); // 7 second interval
        return () => clearInterval(interval);
    }, [isPaused, nextSlide]);

    // Phone screen toggle interval (for slide 2)
    useEffect(() => {
        if (current === 1) {
            const interval = setInterval(() => {
                setPhoneToggle(prev => !prev);
            }, 3000);
            return () => clearInterval(interval);
        }
    }, [current]);

    return (
        <div 
            className="relative h-[100svh] sm:h-[800px] lg:h-[850px] w-full overflow-hidden bg-white dark:bg-zinc-950 transition-colors duration-500"
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
        >
            <AnimatePresence mode="wait">
                <motion.div
                    key={current}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute inset-0 flex items-center justify-center"
                >
                    <div className="mx-auto max-w-7xl px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-8 lg:gap-12 items-center h-full pt-16 sm:pt-0">
                        {/* Text Content */}
                        <div className="text-center lg:text-left z-10 order-1 lg:order-1 flex flex-col justify-center">
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2, duration: 0.5 }}
                            >
                                    <div className="mb-6 sm:mb-8 flex justify-center lg:justify-start">
                                    <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 sm:px-4 sm:py-1.5 text-[10px] font-bold tracking-[0.15em] text-cyan-500 dark:text-cyan-400 border border-cyan-500/30 bg-cyan-900/10 dark:bg-cyan-900/10 backdrop-blur-xl uppercase shadow-[0_0_15px_-3px_rgba(34,211,238,0.3)]">
                                        <span className="flex h-1.5 w-1.5 rounded-full bg-cyan-500 animate-[pulse_2s_infinite]" />
                                        <span>SYSTEM INITIALIZED v3.0</span>
                                    </div>
                                </div>

                                <h1 className="text-4xl xs:text-[2.6rem] sm:text-6xl lg:text-7xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 leading-[1.15] lg:leading-[1.1] break-keep whitespace-pre-line">
                                    {SLIDES[current].title}
                                </h1>
                                
                                <p className="mt-6 text-base sm:text-lg leading-relaxed text-zinc-500 dark:text-zinc-400 font-medium max-w-xl mx-auto lg:mx-0 break-keep">
                                    {SLIDES[current].description}
                                </p>
                                
                                <div className="mt-8 sm:mt-12 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 sm:gap-6">
                                    <Button asChild size="lg" className="h-12 sm:h-14 px-8 sm:px-10 text-sm sm:text-base font-bold bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white transition-all shadow-[0_0_20px_-5px_rgba(99,102,241,0.5)] rounded-2xl w-full sm:w-auto overflow-hidden group border-0">
                                        <Link href="/testflight" className="flex items-center gap-2 justify-center relative z-10">
                                            <Zap className="h-4 w-4 sm:h-5 sm:w-5" />
                                            10초 무료체험
                                        </Link>
                                    </Button>
                                    <Button asChild size="lg" className="h-12 sm:h-14 px-8 sm:px-10 text-sm sm:text-base font-bold bg-zinc-900 dark:bg-white text-white dark:text-black hover:opacity-90 transition-all shadow-[0_0_20px_-5px_rgba(99,102,241,0.5)] dark:shadow-[0_0_30px_-5px_rgba(255,255,255,0.4)] rounded-2xl w-full sm:w-auto overflow-hidden group border border-zinc-800 dark:border-transparent" disabled={isLoading}>
                                        <Link href={user ? "/portfolio/asset" : "/login"} className="flex items-center gap-2 justify-center relative z-10">
                                            {isLoading ? (
                                                <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                                            ) : user ? (
                                                "나의 자산"
                                            ) : (
                                                "로그인 하기"
                                            )}
                                            {!isLoading && <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 group-hover:translate-x-1 transition-transform" />}
                                        </Link>
                                    </Button>
                                    <Link href="#feature-step-01" className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors flex items-center gap-1.5 py-2">
                                        자세히 알아보기
                                    </Link>
                                </div>
                            </motion.div>
                        </div>

                        {/* Visual Content */}
                        <div className="relative flex justify-center items-center h-[280px] sm:h-[450px] lg:h-full order-2 lg:order-2 mt-4 sm:mt-0">
                            {SLIDES[current].type === "typography" && (
                                <motion.div 
                                    className="relative w-full max-w-[500px] grid grid-cols-2 gap-4"
                                    initial={{ scale: 0.8, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ delay: 0.3, duration: 0.8 }}
                                >
                                    {/* Abstract UI Elements representing growth/assets */}
                                    <div className="h-32 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center justify-center gap-2 backdrop-blur-xl animate-float">
                                        <Bitcoin className="h-8 w-8 text-emerald-500" />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">CRYPTO</span>
                                    </div>
                                    <div className="h-32 rounded-3xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center gap-2 animate-float-delayed">
                                        <Building2 className="h-8 w-8 text-zinc-400" />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">STOCKS</span>
                                    </div>
                                    <div className="h-32 rounded-3xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center gap-2 col-span-2 animate-float">
                                        <div className="flex items-center gap-4">
                                            <Zap className="h-8 w-8 text-amber-500" />
                                            <div className="flex flex-col">
                                                <span className="text-xl font-black text-indigo-600 dark:text-indigo-400">+24.8%</span>
                                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">REALTIME GROWTH</span>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {SLIDES[current].type === "device-transition" && (
                                <motion.div 
                                    className="relative w-[140px] h-[300px] xs:w-[180px] xs:h-[380px] sm:w-[320px] sm:h-[650px] rounded-[2.5rem] sm:rounded-[4rem] border-[6px] sm:border-[10px] border-zinc-900 dark:border-zinc-800 ring-1 ring-black/5 dark:ring-white/20 overflow-hidden bg-black shadow-2xl"
                                    initial={{ y: 40, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.3, duration: 0.8 }}
                                >
                                    <AnimatePresence mode="wait">
                                        <motion.div
                                            key={phoneToggle ? "phone-2" : "phone-1"}
                                            initial={{ opacity: 0, scale: 1.1 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 1 }}
                                            className="w-full h-full relative"
                                        >
                                            <Image 
                                                src={phoneToggle ? SLIDES[current].images![1] : SLIDES[current].images![0]} 
                                                alt="Phone Interface" 
                                                fill
                                                className="object-cover rounded-[2rem]"
                                            />
                                            {/* OCR Scanning Overlay (Mock) */}
                                            {!phoneToggle && (
                                                <motion.div 
                                                    className="absolute inset-x-0 h-1 bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,1)] z-20"
                                                    animate={{ top: ["10%", "90%", "10%"] }}
                                                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                                                />
                                            )}
                                        </motion.div>
                                    </AnimatePresence>
                                </motion.div>
                            )}

                            {SLIDES[current].type === "tablet-showcase" && (
                                <motion.div 
                                    className="relative w-[110%] lg:w-[130%] max-w-[900px] aspect-[4/3] rounded-xl sm:rounded-2xl border-[4px] sm:border-[6px] lg:border-[8px] border-zinc-700 bg-zinc-800 ring-1 ring-black/10 dark:border-zinc-600 dark:bg-zinc-700 dark:ring-white/14 shadow-2xl overflow-hidden translate-x-0 lg:-translate-x-12"
                                    initial={{ rotateY: -15, opacity: 0, scale: 0.9 }}
                                    animate={{ rotateY: 0, opacity: 1, scale: 1 }}
                                    transition={{ delay: 0.3, duration: 1 }}
                                >
                                    {SLIDES[current].image && (
                                        <div className="absolute inset-[6px] rounded-[0.7rem] overflow-hidden">
                                            <Image 
                                                src={SLIDES[current].image!} 
                                                alt="Tablet Interface" 
                                                fill
                                                className="object-contain opacity-100"
                                                priority
                                            />
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </div>
                    </div>
                </motion.div>
            </AnimatePresence>

            {/* Navigation Controls */}
            <div className="absolute inset-x-0 bottom-6 sm:bottom-12 flex items-center justify-center gap-4 sm:gap-8 z-30">
                <button 
                    onClick={prevSlide}
                    className="h-12 w-12 rounded-full border border-zinc-200 dark:border-zinc-800 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                >
                    <ChevronLeft className="h-6 w-6 text-zinc-500" />
                </button>
                
                {/* Dots */}
                <div className="flex gap-3">
                    {SLIDES.map((_, i) => (
                        <button
                            key={i}
                            onClick={() => setCurrent(i)}
                            className={`h-2 transition-all duration-500 rounded-full ${current === i ? "w-8 bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.6)]" : "w-2 bg-zinc-300 dark:bg-zinc-700"}`}
                        />
                    ))}
                </div>

                <button 
                    onClick={nextSlide}
                    className="h-12 w-12 rounded-full border border-zinc-200 dark:border-zinc-800 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                >
                    <ChevronRight className="h-6 w-6 text-zinc-500" />
                </button>
            </div>

            {/* Background Decoration - Updated Colors */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-violet-600/15 blur-[120px] mix-blend-screen" />
                <div className="absolute top-[20%] right-[-5%] w-[400px] h-[400px] rounded-full bg-cyan-500/15 blur-[100px] mix-blend-screen" />
                <div className="absolute bottom-[-10%] left-[20%] w-[600px] h-[600px] rounded-full bg-indigo-600/10 blur-[130px] mix-blend-screen" />
            </div>

            <div className="absolute inset-x-0 bottom-0 -z-10 transform-gpu overflow-hidden blur-3xl translate-y-1/2 pointer-events-none" aria-hidden="true">
                <div 
                    className="relative left-[calc(50%)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 bg-gradient-to-t from-indigo-500/20 to-transparent opacity-40 sm:w-[72.1875rem]" 
                    style={{ clipPath: 'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)' }} 
                />
            </div>
            
            <style jsx>{`
                @keyframes float {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-15px); }
                }
                @keyframes float-delayed {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-10px); }
                }
                .animate-float {
                    animation: float 6s ease-in-out infinite;
                }
                .animate-float-delayed {
                    animation: float-delayed 8s ease-in-out infinite 1s;
                }
            `}</style>
        </div>
    );
}
