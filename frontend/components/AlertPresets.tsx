"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export default function AlertPresets() {
    const { user } = useAuth();
    const [isHovered, setIsHovered] = useState(false);
    const [isAutoActive, setIsAutoActive] = useState(false);

    // Auto animation loop every 3 seconds
    useState(() => {
        const interval = setInterval(() => {
            setIsAutoActive(true);
            setTimeout(() => setIsAutoActive(false), 1500); // Active for 1.5s
        }, 4500); // Every 4.5s
        return () => clearInterval(interval);
    });

    // Combine states
    const isActive = isHovered || isAutoActive;

    return (
        <section className="relative overflow-hidden py-24 sm:py-32">
            {/* Bold Atmospheric Background - Neo-Fintech */}
            <div className="absolute inset-0 bg-background pointer-events-none">
                <div className="absolute top-[-20%] right-[-10%] w-[80%] h-[80%] rounded-full bg-violet-600/10 blur-[120px]" />
                <div className="absolute bottom-[-20%] left-[-10%] w-[80%] h-[80%] rounded-full bg-cyan-500/10 blur-[120px]" />
                <div className="absolute top-[40%] left-[20%] w-[40%] h-[40%] rounded-full bg-indigo-500/10 blur-[100px]" />
            </div>

            <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
                <div className="grid md:grid-cols-2 gap-12 lg:gap-20 items-center">
                    
                    {/* Left: Notification Visuals */}
                    <div className="relative order-1 flex justify-center md:justify-end">
                         {/* Glowing Backdrop */}
                         <div className="absolute inset-0 bg-gradient-to-t from-zinc-100/50 via-transparent to-transparent dark:from-zinc-900/50 rounded-full blur-2xl opacity-50" />

                        {/* Notification Stack */}
                        <div className="relative w-full max-w-[360px] flex flex-col gap-4 items-center md:items-end">
                            {/* Mock Noti 1 */}
                            <motion.div 
                                initial={{ x: -20, opacity: 0 }}
                                whileInView={{ x: 0, opacity: 1 }}
                                transition={{ delay: 0.2 }}
                                className="flex items-center gap-4 p-4 pr-6 rounded-2xl bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl shadow-2xl border border-white/20 dark:border-white/5 w-full transform hover:scale-105 transition-transform duration-500 z-10"
                            >
                                <div className="h-12 w-12 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0 shadow-inner">
                                    <span className="text-xl">📈</span>
                                </div>
                                <div className="text-left flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-bold text-foreground">Tutum</span>
                                        <span className="text-[11px] text-zinc-400">방금 전</span>
                                    </div>
                                    <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                                        <span className="font-bold text-foreground">삼성전자</span> 3.5% 급등! 목표가 도달 🚀
                                    </p>
                                </div>
                            </motion.div>

                            {/* Mock Noti 2 */}
                            <motion.div 
                                initial={{ x: -20, opacity: 0 }}
                                whileInView={{ x: 0, opacity: 1 }}
                                transition={{ delay: 0.4 }}
                                className="flex items-center gap-4 p-4 pr-6 rounded-2xl bg-white/70 dark:bg-zinc-900/70 backdrop-blur-md shadow-lg border border-white/20 dark:border-white/5 w-[90%] md:mr-4 scale-95 opacity-80"
                            >
                                <div className="h-12 w-12 rounded-xl bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center flex-shrink-0 shadow-inner">
                                    <span className="text-xl">📰</span>
                                </div>
                                <div className="text-left flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-bold text-foreground">News</span>
                                        <span className="text-[11px] text-zinc-400">10분 전</span>
                                    </div>
                                    <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300 truncate">
                                        보유하신 <span className="font-bold text-foreground">BTC</span> 관련 중요 속보
                                    </p>
                                </div>
                            </motion.div>
                        </div>
                    </div>

                    {/* Right: Copy & CTA */}
                    <div className="text-center md:text-left order-2 flex flex-col items-center md:items-start">
                        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-foreground mb-6 tracking-tight leading-tight">
                            중요한 타이밍,<br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-500 to-indigo-500">절대 놓치지 마세요.</span>
                        </h2>
                        <p className="text-lg text-muted-foreground mb-10 leading-relaxed max-w-md mx-auto md:mx-0">
                            시장이 요동칠 때 가장 먼저 알려드립니다.<br />
                            앱 푸시, 문자, 이메일 등 원하는 방식으로<br />
                            세밀한 자산 변동 알림을 받아보세요.
                        </p>

                         {/* Auto-Animating CTA */}
                         <div className="relative inline-flex group cursor-pointer" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
                             <Link href={user ? "/portfolio/asset" : "/login"} className="absolute inset-0 z-10" />
                             <div className={`
                                 flex items-center gap-5 pl-2 pr-8 py-2.5 rounded-full border-2 transition-all duration-500
                                 ${isActive ? 'border-violet-500 bg-violet-500/5 pr-10 shadow-[0_0_30px_-5px_rgba(139,92,246,0.3)] scale-105' : 'border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 hover:scale-105'}
                             `}>
                                 <div className={`
                                     w-14 h-14 rounded-full flex items-center justify-center transition-all duration-500 shadow-sm
                                     ${isActive ? 'bg-violet-500 text-white translate-x-1 rotate-12' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 group-hover:bg-violet-500 group-hover:text-white'}
                                 `}>
                                     <Bell className={`h-6 w-6 transition-transform duration-500 ${isActive ? 'scale-110' : 'group-hover:rotate-12'}`} />
                                 </div>
                                 <div className="text-left">
                                     <div className={`text-lg font-bold transition-colors duration-300 ${isActive ? 'text-violet-600 dark:text-violet-400' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-violet-600 dark:group-hover:text-violet-400'}`}>
                                         {user ? "알림 설정 관리" : "알림 켜기"}
                                     </div>
                                     <div className="text-xs font-medium text-zinc-400">
                                         {user ? "실시간 자산 변동 알림" : "로그인이 필요합니다"}
                                     </div>
                                 </div>
                                 <ChevronRight className={`h-5 w-5 text-zinc-300 transition-all duration-500 ${isActive ? 'opacity-100 translate-x-2 text-violet-500' : 'opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-2 group-hover:text-violet-500'}`} />
                             </div>
                         </div>
                    </div>

                </div>
            </div>
        </section>
    );
}
