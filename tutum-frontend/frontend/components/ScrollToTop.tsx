"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ScrollToTop() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const toggleVisibility = () => {
            const scrollHeight = document.documentElement.scrollHeight;
            const scrollTop = document.documentElement.scrollTop;
            const windowHeight = document.documentElement.clientHeight;
            
            // Show when scrolled > 50%
            if (scrollTop > (scrollHeight - windowHeight) / 2) {
                setIsVisible(true);
            } else {
                setIsVisible(false);
            }
        };

        window.addEventListener("scroll", toggleVisibility);
        return () => window.removeEventListener("scroll", toggleVisibility);
    }, []);

    const scrollToTop = () => {
        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    };

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.8, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8, y: 20 }}
                    className="fixed bottom-8 right-8 z-[100]"
                >
                    <Button
                        size="icon"
                        variant="default"
                        onClick={scrollToTop}
                        className="h-12 w-12 rounded-full shadow-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:scale-110 active:scale-95 transition-all"
                    >
                        <ArrowUp className="h-6 w-6" />
                        <span className="sr-only">맨 위로 가기</span>
                    </Button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
