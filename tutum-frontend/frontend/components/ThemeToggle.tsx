"use client";

import * as React from "react";
import { MoreVertical, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = React.useState(false);
    const [isOpen, setIsOpen] = React.useState(false);
    const dropdownRef = React.useRef<HTMLDivElement>(null);
    const buttonRef = React.useRef<HTMLButtonElement>(null);

    React.useEffect(() => {
        setMounted(true);
    }, []);

    // Robust click outside handler
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current && 
                !dropdownRef.current.contains(event.target as Node) &&
                buttonRef.current && 
                !buttonRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    if (!mounted) {
        return (
            <Button variant="ghost" size="icon" className="h-9 w-9">
                <MoreVertical className="h-4 w-4" />
            </Button>
        );
    }

    return (
        <div className="relative">
            <Button
                ref={buttonRef}
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setIsOpen(!isOpen)}
            >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">메뉴 열기</span>
            </Button>

            {isOpen && (
                <div 
                    ref={dropdownRef}
                    className="absolute right-0 mt-2 w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-[150] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
                >
                    <div className="p-2 space-y-1">
                        <div className="px-3 py-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                            환경 설정
                        </div>
                        <button
                            className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors group"
                            onClick={() => {
                                setTheme(theme === "dark" ? "light" : "dark");
                            }}
                        >
                            <div className="flex items-center gap-3 text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100">
                                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                                <span>화면 모드 변경</span>
                            </div>
                            <div
                                className={cn(
                                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                                    theme === "dark" ? "bg-indigo-500" : "bg-zinc-300 dark:bg-zinc-600"
                                )}
                            >
                                <span
                                    className={cn(
                                        "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform",
                                        theme === "dark" ? "translate-x-6" : "translate-x-0.5"
                                    )}
                                />
                            </div>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
