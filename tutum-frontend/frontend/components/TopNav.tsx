"use client";

import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Menu, Activity, Loader2 } from "lucide-react";

const navLinks = [
    { href: "#market", label: "증시" },
    { href: "#news", label: "뉴스" },
    { href: "#feature-step-01", label: "주요 기능" },
];

export default function TopNav() {
    const router = useRouter();
    const { user, token, isLoading } = useAuth();
    
    // Only rely on AuthContext state, not cookies directly
    const isUserLoggedIn = !!(user || token);

    return (
        <nav className="sticky top-0 z-[100] border-b border-gray-200/50 dark:border-white/5 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl transition-all duration-300">
            <div className="w-full px-4 sm:px-6 lg:px-8">
                <div className="flex h-16 items-center justify-between">
                    {/* Logo */}
                    <div className="flex-shrink-0">
                        <Link 
                            href={isUserLoggedIn ? "/portfolio/asset" : "/"} 
                            className="flex items-center gap-2 cursor-pointer"
                        >
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white shadow-md">
                                <Activity className="h-5 w-5" />
                            </div>
                            <span className="text-2xl font-black bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600 dark:from-indigo-400 dark:via-purple-400 dark:to-fuchsia-400 text-transparent bg-clip-text hover:opacity-80 transition-opacity">tutum</span>
                        </Link>
                    </div>

                    {/* Desktop Menu */}
                    <div className="hidden md:block">
                        <div className="ml-10 flex items-baseline space-x-4">
                            {navLinks.map((link) => (
                                <a
                                    key={link.label}
                                    href={link.href}
                                    className="rounded-md px-3 py-2 text-base font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-black dark:hover:text-white"
                                >
                                    {link.label}
                                </a>
                            ))}
                        </div>
                    </div>
                    {/* Desktop Buttons */}
                    <div className="hidden items-center gap-2 md:flex text-black dark:text-white">
                        <ThemeToggle />
                        <Button
                            className="bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200 font-bold min-w-[80px]"
                            onClick={() => router.push(isUserLoggedIn ? "/portfolio/asset" : "/login")}
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : isUserLoggedIn ? (
                                "나의 자산"
                            ) : (
                                "로그인"
                            )}
                        </Button>
                    </div>

                    {/* Mobile Menu */}
                    <div className="flex items-center gap-2 md:hidden">
                        <ThemeToggle />
                        <Sheet>
                            <SheetTrigger asChild>
                                <Button variant="ghost" size="icon">
                                    <Menu className="h-5 w-5" />
                                    <span className="sr-only">메뉴 열기</span>
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="right" className="w-[300px] p-0">
                                <SheetHeader className="p-6 border-b">
                                    <SheetTitle>
                                        tutum
                                    </SheetTitle>
                                </SheetHeader>
                                <div className="mt-6 flex flex-col gap-4">
                                    {navLinks.map((link) => (
                                        <a
                                            key={link.href}
                                            href={link.href}
                                            className="text-lg text-muted-foreground transition hover:text-foreground"
                                        >
                                            {link.label}
                                        </a>
                                    ))}
                                    <Separator className="my-2" />
                                    <div className="flex flex-col gap-2 p-6">
                                        <Button
                                            className="w-full bg-black text-white dark:bg-zinc-100 dark:text-zinc-900 font-bold h-12 rounded-xl shadow-lg shadow-indigo-500/10"
                                            onClick={() => router.push(isUserLoggedIn ? "/portfolio/asset" : "/login")}
                                            disabled={isLoading}
                                        >
                                            {isLoading ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : isUserLoggedIn ? (
                                                "나의 자산"
                                            ) : (
                                                "로그인"
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </SheetContent>
                        </Sheet>
                    </div>
                </div>
            </div>
        </nav>
    );
}
