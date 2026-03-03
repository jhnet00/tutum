"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Bell, MoreVertical, User, LayoutDashboard, LineChart, Sun, Moon, Search, Star, Activity, LogOut, CheckCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";

import { allAssets, Asset } from "@/lib/mock-data";
import { useAuth } from "@/contexts/AuthContext";
import { useFavorites } from "@/context/FavoritesContext";
import ProfileModal from "./ProfileModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// SAMPLE_NOTIFICATIONS 제거 (리얼 API 연동)

export default function PortfolioHeader() {
    const { user, logout } = useAuth();
    const pathname = usePathname();
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const [isNotificationOpen, setIsNotificationOpen] = useState(false);

    // Notifications State
    const [notifications, setNotifications] = useState<any[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);

    // Notification Polling (30s)
    useEffect(() => {
        const fetchNotifications = async () => {
            try {
                const apiUrl = '/api/proxy';
                const res = await fetch(`${apiUrl}/api/v1/notifications?limit=20`);
                if (res.ok) {
                    const data = await res.json();
                    setNotifications(data.notifications || []);
                    setUnreadCount(data.unread_count || 0);
                }
            } catch (error) {
                console.error("Failed to fetch notifications:", error);
            }
        };

        // Initial fetch
        fetchNotifications();

        // Polling
        const interval = setInterval(fetchNotifications, 30000);
        return () => clearInterval(interval);
    }, []);

    // Time Ago Utils
    const getTimeAgo = (dateString: string) => {
        const now = new Date();
        const date = new Date(dateString);
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

        if (diffInSeconds < 60) return "방금 전";
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}분 전`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}시간 전`;
        return `${Math.floor(diffInSeconds / 86400)}일 전`;
    };

    // Search State
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [activeSearchTab, setActiveSearchTab] = useState("주식");
    const [searchQuery, setSearchQuery] = useState("");

    const { favorites, toggleFavorite, isFavorite } = useFavorites();

    useEffect(() => {
        setMounted(true);
    }, []);

    // Filtered Assets for Search
    const getFilteredAssets = () => {
        let filtered = allAssets;

        // Tab Filter
        if (activeSearchTab !== "통합") {
            filtered = filtered.filter(asset => asset.type === activeSearchTab);
        }

        // Search Query Filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(asset =>
                asset.name.toLowerCase().includes(query) ||
                asset.symbol.toLowerCase().includes(query)
            );
        }

        return filtered;
    };

    const filteredAssets = getFilteredAssets();

    return (
        <header className="h-16 flex items-center justify-between px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0 sticky top-0 z-50">
            {/* ... Logo and Nav ... */}
            <div className="flex items-center gap-8">
                {/* Logo */}
                {/* Logo - PortfolioHeader는 로그인된 상태에서만 보이므로 항상 portfolio/asset으로 연결 */}
                <Link href="/portfolio/asset" onClick={() => window.dispatchEvent(new Event('reset-asset-tab'))} className="flex items-center gap-2 group">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
                        <Activity className="h-5 w-5" />
                    </div>
                    <span className="text-2xl font-black bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600 dark:from-indigo-400 dark:via-purple-400 dark:to-fuchsia-400 text-transparent bg-clip-text group-hover:opacity-80 transition-opacity">Tutum</span>
                </Link>

                {/* Main Navigation */}
                <nav className="flex items-center gap-1">
                    <Link href="/portfolio/chart">
                        <Button
                            variant="ghost"
                            className={cn(
                                "gap-2 text-base font-medium h-9 px-4",
                                pathname.startsWith('/portfolio/chart')
                                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white"
                                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                            )}
                        >
                            <LineChart className="h-4 w-4" />
                            차트
                        </Button>
                    </Link>
                    <Link href="/portfolio/asset">
                        <Button
                            variant="ghost"
                            className={cn(
                                "gap-2 text-base font-medium h-9 px-4",
                                pathname.startsWith('/portfolio/asset')
                                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white"
                                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                            )}
                        >
                            <LayoutDashboard className="h-4 w-4" />
                            자산
                        </Button>
                    </Link>
                </nav>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-3">
                <div className="relative hidden md:block">
                    {/* Search Input Container */}
                    <div className="relative flex items-center z-50">
                        <Search className="absolute left-3 h-4 w-4 text-zinc-400 z-10" />
                        <input
                            type="text"
                            placeholder="주식, 코인 검색"
                            className={cn(
                                "bg-zinc-100 dark:bg-zinc-900 border-none rounded-t-2xl rounded-b-2xl pl-9 pr-12 py-2 text-sm w-96 text-zinc-900 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-300 dark:focus:ring-zinc-700 transition-all",
                                isSearchOpen && "rounded-b-none ring-1 ring-zinc-300 dark:ring-zinc-700 bg-white dark:bg-zinc-900"
                            )}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onFocus={() => {
                                setIsSearchOpen(true);
                                setIsMenuOpen(false);
                                setIsNotificationOpen(false);
                            }}
                        />
                        <div className="absolute right-3 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 font-mono shadow-sm">
                            Ctrl K
                        </div>
                    </div>

                    {/* Search Dropdown */}
                    {isSearchOpen && (
                        <>
                            <div
                                className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
                                onClick={() => setIsSearchOpen(false)}
                            />
                            <div className="absolute top-full left-0 right-0 bg-white dark:bg-zinc-900 border-x border-b border-zinc-200 dark:border-zinc-700 rounded-b-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                {/* Search Tabs */}
                                <div className="flex items-center gap-1 p-2 border-b border-zinc-100 dark:border-zinc-800 overflow-x-auto no-scrollbar">
                                    {["주식", "코인"].map(tab => (
                                        <button
                                            key={tab}
                                            onClick={() => setActiveSearchTab(tab)}
                                            className={cn(
                                                "px-3 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap",
                                                activeSearchTab === tab
                                                    ? "bg-zinc-900 dark:bg-white text-white dark:text-black shadow-sm"
                                                    : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                            )}
                                        >
                                            {tab}
                                        </button>
                                    ))}
                                </div>

                                {/* Search Results / Recommendations */}
                                <div className="max-h-[400px] overflow-y-auto p-2">
                                    <div className="text-[10px] font-semibold text-zinc-400 px-2 py-1 mb-1">
                                        {searchQuery ? "검색 결과" : `인기 ${activeSearchTab}`}
                                    </div>

                                    {filteredAssets.length > 0 ? (
                                        <div className="space-y-0.5">
                                            {filteredAssets.slice(0, 10).map((asset) => (
                                                <button
                                                    key={asset.symbol}
                                                    className="w-full flex items-center justify-between px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 rounded-lg group transition-colors text-left"
                                                    onClick={() => {
                                                        setIsSearchOpen(false);
                                                    }}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn(
                                                            "w-8 h-8 rounded-full flex items-center justify-center font-bold text-[10px] text-white overflow-hidden relative border border-zinc-100 dark:border-zinc-700",
                                                            asset.logoColor || "bg-zinc-500"
                                                        )}>
                                                            {asset.logo}
                                                            <span className="absolute bottom-0 right-0 text-[8px] bg-white dark:bg-zinc-800 px-0.5 text-zinc-900 dark:text-white border-l border-t border-zinc-100 dark:border-zinc-700">{asset.country}</span>
                                                        </div>
                                                        <div>
                                                            <div className="font-bold text-sm text-zinc-900 dark:text-zinc-100 group-hover:text-emerald-500 transition-colors">
                                                                {asset.name}
                                                            </div>
                                                            <div className="text-xs text-zinc-400 font-medium">
                                                                {asset.symbol}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            toggleFavorite(asset.symbol);
                                                        }}
                                                        className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full transition-colors"
                                                    >
                                                        <Star
                                                            className={cn(
                                                                "h-4 w-4 transition-all",
                                                                isFavorite(asset.symbol)
                                                                    ? "text-yellow-400 fill-yellow-400"
                                                                    : "text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-400"
                                                            )}
                                                        />
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="py-8 text-center text-xs text-zinc-400">
                                            검색 결과가 없습니다.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="h-6 w-[1px] bg-zinc-200 dark:bg-zinc-800 mx-2 hidden md:block" />

                <Popover open={isNotificationOpen} onOpenChange={(open) => {
                    setIsNotificationOpen(open);
                    if (open) {
                        setIsMenuOpen(false);
                        setIsUserMenuOpen(false);
                        setIsSearchOpen(false);
                    }
                }}>
                    <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white relative">
                            <Bell className="h-5 w-5" />
                            {unreadCount > 0 && (
                                <span className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full border-2 border-white dark:border-zinc-950"></span>
                            )}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="end">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
                            <span className="font-semibold text-sm">알림</span>
                            <span className="text-xs text-zinc-400 hover:text-zinc-600 cursor-pointer">모두 읽음 표시</span>
                        </div>
                        <div className="max-h-[300px] overflow-y-auto">
                            {notifications.length === 0 ? (
                                <div className="py-8 text-center text-xs text-zinc-400">
                                    새로운 알림이 없습니다.
                                </div>
                            ) : (
                                notifications.map((notification) => (
                                    <div key={notification.id} className={cn(
                                        "flex flex-col gap-1 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors border-b border-zinc-50 dark:border-zinc-800/50 last:border-0",
                                        !notification.is_read && "bg-blue-50/30 dark:bg-blue-900/10"
                                    )}>
                                        <div className="flex items-start justify-between">
                                            <span className={cn("text-sm font-medium", !notification.is_read ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400")}>
                                                {notification.title}
                                            </span>
                                            <span className="text-[10px] text-zinc-400 whitespace-nowrap ml-2">{getTimeAgo(notification.created_at)}</span>
                                        </div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                                            {notification.message}
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="p-2 border-t border-zinc-100 dark:border-zinc-800 text-center">
                            <button className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 font-medium w-full py-1">
                                알림 전체보기
                            </button>
                        </div>
                    </PopoverContent>
                </Popover>

                <div className="relative">
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors",
                            isMenuOpen && "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white"
                        )}
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                    >
                        <MoreVertical className="h-5 w-5" />
                    </Button>

                    {isMenuOpen && (
                        <div className="absolute right-0 mt-3 w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
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
                                    <div className="flex items-center gap-3 text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white">
                                        {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                                        <span>화면 모드 변경</span>
                                    </div>
                                    <div
                                        className={cn(
                                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                                            mounted && theme === "dark" ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform",
                                                mounted && theme === "dark" ? "translate-x-6" : "translate-x-0.5"
                                            )}
                                        />
                                    </div>
                                </button>
                                <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                                    <User className="h-4 w-4" />
                                    <span>일반 설정</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="relative">
                    <div
                        className="w-9 h-9 rounded-full bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center font-bold text-sm text-white dark:text-zinc-900 ml-2 cursor-pointer hover:opacity-90 transition-opacity shadow-sm overflow-hidden border-2 border-transparent hover:border-emerald-500 transition-all"
                        onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    >
                        <User className="h-5 w-5" />
                    </div>

                    {isUserMenuOpen && (
                        <div className="absolute right-0 mt-3 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="p-2 space-y-1">
                                <div className="px-3 py-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                                    사용자 설정
                                </div>
                                <button
                                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors text-left font-medium"
                                    onClick={() => {
                                        window.location.href = "/portfolio/mypage";
                                        setIsUserMenuOpen(false);
                                    }}
                                >
                                    <User className="h-4 w-4" />
                                    <span>내 정보 수정</span>
                                </button>
                                <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800 my-1" />
                                <button
                                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors text-left font-bold"
                                    onClick={() => {
                                        setIsUserMenuOpen(false);
                                        logout();
                                    }}
                                >
                                    <LogOut className="h-4 w-4" />
                                    <span>로그아웃</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Overlay to close menus */}
            {
                (isMenuOpen || isUserMenuOpen || isSearchOpen) && (
                    <div
                        className="fixed inset-0 z-40 bg-transparent"
                        onClick={() => {
                            setIsMenuOpen(false);
                            setIsUserMenuOpen(false);
                            setIsSearchOpen(false);
                            setIsNotificationOpen(false);
                        }}
                    />
                )
            }
            <ProfileModal
                isOpen={isProfileModalOpen}
                onClose={() => setIsProfileModalOpen(false)}
            />
        </header >
    );
}
