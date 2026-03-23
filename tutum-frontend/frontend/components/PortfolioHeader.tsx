"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  LayoutDashboard,
  LineChart,
  LogOut,
  Search,
  Star,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { allAssets } from "@/lib/mock-data";
import { useAuth } from "@/contexts/AuthContext";
import { useAsset } from "@/context/AssetContext";
import { useFavorites } from "@/context/FavoritesContext";
import { useLocalWatchlist } from "@/lib/hooks/useLocalWatchlist";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  created_at: string;
  is_read: boolean;
};

function getTimeAgo(dateString: string) {
  const now = new Date();
  const date = new Date(dateString);
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "방금 전";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}분 전`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}시간 전`;
  return `${Math.floor(diffInSeconds / 86400)}일 전`;
}

export default function PortfolioHeader() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { holdings } = useAsset();
  const { favorites, toggleFavorite, isFavorite } = useFavorites();
  const { watchlist } = useLocalWatchlist();

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeSearchTab, setActiveSearchTab] = useState<"주식" | "코인">("주식");
  const [searchQuery, setSearchQuery] = useState("");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const trackedTerms = useMemo(() => {
    const terms = new Set<string>();

    holdings.forEach((asset) => {
      const symbol = String(asset.symbol || "").replace("KRW-", "").trim().toUpperCase();
      const name = String(asset.name || "").trim().toUpperCase();
      if (symbol) terms.add(symbol);
      if (name) terms.add(name);
    });

    [...favorites, ...watchlist].forEach((symbol) => {
      const normalized = String(symbol || "").replace("KRW-", "").trim().toUpperCase();
      if (normalized) terms.add(normalized);
      const assetMeta = allAssets.find((asset) => asset.symbol.toUpperCase() === normalized);
      if (assetMeta?.name) terms.add(assetMeta.name.toUpperCase());
    });

    return [...terms].filter((term) => term.length >= 2);
  }, [favorites, holdings, watchlist]);

  const filteredNotifications = useMemo(() => {
    if (trackedTerms.length === 0) return [];
    return notifications.filter((notification) => {
      const haystack = `${notification.title} ${notification.message}`.toUpperCase();
      return trackedTerms.some((term) => haystack.includes(term));
    });
  }, [notifications, trackedTerms]);

  const unreadCount = filteredNotifications.filter((notification) => !notification.is_read).length;

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await fetch("/api/proxy/api/v1/notifications?limit=20", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      } catch (error) {
        console.error("Failed to fetch notifications:", error);
      }
    };

    fetchNotifications();
    const interval = window.setInterval(fetchNotifications, 30000);
    return () => window.clearInterval(interval);
  }, []);

  const filteredAssets = useMemo(() => {
    let next = allAssets.filter((asset) =>
      activeSearchTab === "주식" ? asset.type === "주식" : asset.type === "코인"
    );

    if (!searchQuery.trim()) return next;

    const query = searchQuery.trim().toLowerCase();
    return next.filter(
      (asset) =>
        asset.name.toLowerCase().includes(query) ||
        asset.symbol.toLowerCase().includes(query)
    );
  }, [activeSearchTab, searchQuery]);

  return (
    <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-6 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-8">
        <Link
          href="/portfolio/asset"
          onClick={() => window.dispatchEvent(new Event("reset-asset-tab"))}
          className="group flex items-center gap-2"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white shadow-lg shadow-indigo-500/20 transition-transform group-hover:scale-105">
            <Activity className="h-5 w-5" />
          </div>
          <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600 bg-clip-text text-2xl font-black text-transparent dark:from-indigo-400 dark:via-purple-400 dark:to-fuchsia-400">
            tutum
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <Link href="/portfolio/chart">
            <Button
              variant="ghost"
              className={cn(
                "h-9 gap-2 px-4 text-base font-medium",
                pathname.startsWith("/portfolio/chart")
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
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
                "h-9 gap-2 px-4 text-base font-medium",
                pathname.startsWith("/portfolio/asset")
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
              )}
            >
              <LayoutDashboard className="h-4 w-4" />
              자산
            </Button>
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <div className="relative z-50 flex items-center">
            <Search className="absolute left-3 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="주식, 코인 검색"
              className={cn(
                "w-96 rounded-2xl bg-zinc-100 py-2 pl-9 pr-12 text-sm text-zinc-900 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-300 dark:bg-zinc-900 dark:text-white dark:focus:ring-zinc-700",
                isSearchOpen && "rounded-b-none bg-white ring-1 ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-700"
              )}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onFocus={() => {
                setIsSearchOpen(true);
                setIsNotificationOpen(false);
                setIsUserMenuOpen(false);
              }}
            />
            <div className="absolute right-3 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
              Ctrl K
            </div>
          </div>

          {isSearchOpen && (
            <>
              <div
                className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
                onClick={() => setIsSearchOpen(false)}
              />
              <div className="absolute left-0 right-0 top-full z-50 overflow-hidden rounded-b-2xl border-x border-b border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
                <div className="flex items-center gap-1 border-b border-zinc-100 p-2 dark:border-zinc-800">
                  {(["주식", "코인"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveSearchTab(tab)}
                      className={cn(
                        "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
                        activeSearchTab === tab
                          ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                          : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="max-h-[400px] overflow-y-auto p-2">
                  <div className="mb-1 px-2 py-1 text-[10px] font-semibold text-zinc-400">
                    {searchQuery ? "검색 결과" : `인기 ${activeSearchTab}`}
                  </div>

                  {filteredAssets.length > 0 ? (
                    <div className="space-y-0.5">
                      {filteredAssets.slice(0, 10).map((asset) => (
                        <button
                          key={asset.symbol}
                          type="button"
                          className="group flex w-full items-center justify-between rounded-lg px-2 py-2 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
                          onClick={() => setIsSearchOpen(false)}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-zinc-100 text-[10px] font-bold text-white dark:border-zinc-700",
                                asset.logoColor || "bg-zinc-500"
                              )}
                            >
                              {asset.logo}
                            </div>
                            <div>
                              <div className="text-sm font-bold text-zinc-900 transition-colors group-hover:text-emerald-500 dark:text-zinc-100">
                                {asset.name}
                              </div>
                              <div className="text-xs font-medium text-zinc-400">
                                {asset.symbol}
                              </div>
                            </div>
                          </div>
                          <div
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleFavorite(asset.symbol);
                            }}
                            className="rounded-full p-1 transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-700"
                          >
                            <Star
                              className={cn(
                                "h-4 w-4 transition-all",
                                isFavorite(asset.symbol)
                                  ? "fill-yellow-400 text-yellow-400"
                                  : "text-zinc-300 group-hover:text-zinc-400 dark:text-zinc-600"
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

        <div className="mx-2 hidden h-6 w-px bg-zinc-200 dark:bg-zinc-800 md:block" />

        <Popover
          open={isNotificationOpen}
          onOpenChange={(open) => {
            setIsNotificationOpen(open);
            if (open) {
              setIsUserMenuOpen(false);
              setIsSearchOpen(false);
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-rose-500 dark:border-zinc-950" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <span className="text-sm font-semibold">알림</span>
              <span className="text-xs text-zinc-400">보유/관심 자산 기준</span>
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {filteredNotifications.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-400">
                  보유 또는 관심 자산 알림이 없습니다.
                </div>
              ) : (
                filteredNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={cn(
                      "border-b border-zinc-50 px-4 py-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-900 last:border-0",
                      !notification.is_read && "bg-blue-50/30 dark:bg-blue-900/10"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          !notification.is_read
                            ? "text-zinc-900 dark:text-zinc-100"
                            : "text-zinc-500 dark:text-zinc-400"
                        )}
                      >
                        {notification.title}
                      </span>
                      <span className="whitespace-nowrap text-[10px] text-zinc-400">
                        {getTimeAgo(notification.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {notification.message}
                    </p>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <div className="relative">
          <button
            type="button"
            className="ml-2 flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-transparent bg-zinc-900 text-sm font-bold text-white shadow-sm transition-all hover:border-emerald-500 hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
            onClick={() => setIsUserMenuOpen((prev) => !prev)}
          >
            {user?.profile_image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.profile_image}
                alt="profile"
                className="h-full w-full object-cover"
              />
            ) : (
              <User className="h-5 w-5" />
            )}
          </button>

          {isUserMenuOpen && (
            <div className="absolute right-0 z-50 mt-3 w-48 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl animate-in fade-in slide-in-from-top-2 duration-200 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="space-y-1 p-2">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  사용자 설정
                </div>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  onClick={() => {
                    window.location.href = "/portfolio/mypage";
                    setIsUserMenuOpen(false);
                  }}
                >
                  <User className="h-4 w-4" />
                  내 정보 수정
                </button>
                <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-rose-500 transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    logout();
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  로그아웃
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {(isUserMenuOpen || isSearchOpen || isNotificationOpen) && (
        <div
          className="fixed inset-0 z-40 bg-transparent"
          onClick={() => {
            setIsUserMenuOpen(false);
            setIsSearchOpen(false);
            setIsNotificationOpen(false);
          }}
        />
      )}
    </header>
  );
}
