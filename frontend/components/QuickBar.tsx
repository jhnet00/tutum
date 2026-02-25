"use client";

import { useState, useEffect } from "react";
import { UserIcon, HeartIcon, ChatIcon, PlusIcon, MoonIcon, SunIcon } from "./Icons";
import SlideInPanel from "./SlideInPanel";
import { useLocalWatchlist } from "../lib/hooks/useLocalWatchlist";
import { MOCK_COINS } from "../lib/mock-data";
import { AIChatFAB } from "./chat/AIChatFAB";

export default function QuickBar() {
  const [activePanel, setActivePanel] = useState<"my" | "watchlist" | "chatbot" | "add" | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [uiScale, setUiScale] = useState({
    sidePadding: 12,
    sideGap: 10,
    buttonSize: 54,
    iconSize: 21,
    labelSize: 10,
    panelOffsetPercent: 45,
    showLabels: true,
    showThemeToggle: true,
    useBottomDock: false,
  });
  const { watchlist } = useLocalWatchlist();

  // Initialize theme from localStorage or system preference
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      setIsDark(true);
      document.documentElement.className = 'dark';
    } else {
      setIsDark(false);
      document.documentElement.className = '';
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    
    if (newTheme) {
      document.documentElement.className = 'dark';
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.className = '';
      localStorage.setItem('theme', 'light');
    }
  };

  useEffect(() => {
    const updateLayout = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      const compactWidth = width < 768;
      const compactHeight = height < 760;
      const useBottomDock = compactWidth || height < 640;
      const baseSize = compactWidth
        ? Math.max(34, Math.round(Math.min(40, width * 0.085)))
        : Math.min(58, Math.max(46, Math.round(width * 0.038)));
      const buttonSize = compactHeight ? Math.max(32, Math.round(baseSize * 0.84)) : baseSize;
      const normalizedHeight = compactHeight ? 0.35 : 0.3;
      const sideGap = compactWidth ? Math.max(6, Math.round(buttonSize * 0.3)) : Math.max(6, Math.round(buttonSize * 0.35));
      const sidePadding = compactWidth ? Math.max(8, Math.round(buttonSize * 0.18)) : Math.max(8, Math.round(buttonSize * 0.22));
      const iconSize = compactWidth ? Math.max(15, Math.round(buttonSize * 0.4)) : Math.max(16, Math.round(buttonSize * 0.45));
      const labelSize = compactWidth ? 0 : Math.max(9, Math.min(11, Math.round(buttonSize * 0.2)));
      const panelOffsetPercent = compactHeight ? 40 : 45;

      setUiScale({
        buttonSize,
        sideGap: compactWidth ? Math.max(7, Math.round(sideGap * normalizedHeight)) : sideGap,
        sidePadding,
        iconSize,
        labelSize,
        panelOffsetPercent,
        showLabels: !compactWidth,
        showThemeToggle: !compactWidth,
        useBottomDock,
      });
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);

  const buttons = [
    { id: "chatbot", label: "AI", icon: ChatIcon, isPrimary: false, tone: "chatbot" },
    { id: "my", label: "MY", icon: UserIcon, isPrimary: false, tone: "neutral" },
    { id: "watchlist", label: "관심", icon: HeartIcon, isPrimary: false, tone: "neutral" },
    { id: "add", label: "추가", icon: PlusIcon, isPrimary: false, tone: "add" },
  ] as const satisfies Array<{
    id: "my" | "watchlist" | "chatbot" | "add";
    label: string;
    icon: React.ComponentType<any>;
    isPrimary: boolean;
    tone: "chatbot" | "add" | "neutral";
  }>;

  // Get watchlist coins
  const watchlistCoins = MOCK_COINS.filter(coin => watchlist.includes(coin.symbol));
  const isChatbotOpen = activePanel === "chatbot";

  return (
    <>
      {!isChatbotOpen && (
        <div
          className={`fixed z-50 flex flex-col border border-white/35 dark:border-zinc-700/45 bg-white/50 dark:bg-zinc-800/55 backdrop-blur-xl shadow-[0_20px_45px_-28px_rgba(0,0,0,0.35)] ${
            uiScale.useBottomDock ? "rounded-2xl" : "rounded-l-3xl"
          }`}
          style={{
            right: uiScale.useBottomDock
              ? "calc(6px + env(safe-area-inset-right))"
              : "7px",
            top: uiScale.useBottomDock ? "auto" : "50%",
            bottom: uiScale.useBottomDock ? "calc(6px + env(safe-area-inset-bottom))" : "auto",
            transform: uiScale.useBottomDock
              ? "translateY(0)"
              : `translateY(-${uiScale.panelOffsetPercent}%)`,
            gap: `${uiScale.sideGap}px`,
            padding: `${uiScale.sidePadding}px`,
            marginTop: "env(safe-area-inset-top)",
            marginBottom: "env(safe-area-inset-bottom)",
          }}
        >
          {buttons.map((btn) => (
            <button
              key={btn.id}
              onClick={() => setActivePanel(btn.id)}
              className={`group relative flex flex-col items-center justify-center gap-1 rounded-2xl transition-all duration-300 ${
                btn.tone === "chatbot"
                  ? "bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-600 text-zinc-100 border border-fuchsia-300/25 shadow-[0_10px_26px_-20px_rgba(139,92,246,0.5)] hover:bg-gradient-to-br hover:from-indigo-700 hover:via-purple-700 hover:to-fuchsia-700 focus-visible:ring-2 focus-visible:ring-purple-300/70"
                  : btn.tone === "add"
                  ? "bg-gradient-to-br from-zinc-100 to-zinc-200 text-zinc-800 border border-purple-300/55 shadow-[0_6px_16px_-16px_rgba(168,85,247,0.25)] hover:from-zinc-50 hover:to-zinc-100 dark:from-zinc-800 dark:to-zinc-900 dark:border-fuchsia-300/45 dark:text-zinc-100 dark:hover:from-zinc-700 dark:hover:to-zinc-800"
                    : "border border-transparent hover:bg-gradient-to-br hover:from-zinc-200/35 hover:to-zinc-300/20 dark:hover:bg-gradient-to-br dark:hover:from-zinc-800/35 dark:hover:to-zinc-700/20 hover:scale-105"
              }`}
              title={btn.label}
              style={{
                width: `${uiScale.buttonSize}px`,
                height: `${uiScale.buttonSize}px`,
                ...(uiScale.useBottomDock
                  ? { width: `${uiScale.buttonSize + 2}px`, height: `${uiScale.buttonSize + 2}px` }
                  : {}),
              }}
            >
              <btn.icon
                className={`${
                  btn.tone === "chatbot"
                    ? "text-white/95"
                    : btn.tone === "add"
                      ? "text-zinc-800 dark:text-zinc-100"
                      : "text-zinc-500 dark:text-zinc-400"
                } transition-colors`}
                style={{ width: `${uiScale.iconSize}px`, height: `${uiScale.iconSize}px` }}
              />
              <span
                className={`font-bold transition-colors ${
                btn.tone === "chatbot"
                    ? "text-white/95"
                    : btn.tone === "add"
                      ? "text-zinc-800 dark:text-zinc-100"
                      : "text-zinc-500 dark:text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-blue-400"
                } ${uiScale.showLabels ? "" : "sr-only"}`}
                style={{ fontSize: `${uiScale.labelSize}px` }}
              >
                {btn.label}
              </span>
              {btn.id === "watchlist" && watchlist.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {watchlist.length}
                </span>
              )}
              <div
                className={`absolute inset-0 -z-10 rounded-2xl blur-xl transition-opacity ${
                  btn.tone === "chatbot"
                    ? "bg-gradient-to-br from-fuchsia-400/35 via-purple-500/20 to-indigo-600/35 opacity-0 group-hover:opacity-45"
                    : btn.tone === "add"
                      ? "bg-gradient-to-br from-zinc-300/45 to-zinc-100/25 opacity-0 group-hover:opacity-35 dark:from-zinc-700/45 dark:to-zinc-800/30"
                      : "bg-gradient-to-br from-zinc-200/35 to-zinc-500/15 opacity-0 group-hover:opacity-35"
                }`
              } />
            </button>
          ))}

          {/* Theme Toggle Button */}
          {uiScale.showThemeToggle && (
            <>
              <div className="my-2 h-px bg-zinc-300 dark:bg-zinc-700" />
              <button
                onClick={toggleTheme}
                className="group relative flex flex-col items-center gap-1 rounded-2xl p-4 transition-all duration-300 hover:bg-gradient-to-br hover:from-yellow-500/20 hover:to-orange-500/20 hover:scale-110"
                title={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
              >
                {isDark ? (
                  <MoonIcon className="h-6 w-6 text-zinc-500 transition-colors group-hover:text-yellow-500 dark:text-zinc-400" />
                ) : (
                  <SunIcon className="h-6 w-6 text-zinc-500 transition-colors group-hover:text-orange-500" />
                )}
                <span className="text-[10px] font-bold text-zinc-400 transition-colors group-hover:text-yellow-600 dark:group-hover:text-yellow-400">
                  {isDark ? "다크" : "라이트"}
                </span>
              </button>
            </>
          )}
        </div>
      )}

      <SlideInPanel
        isOpen={activePanel !== null && activePanel !== "chatbot"}
        onClose={() => setActivePanel(null)}
        title={buttons.find((b) => b.id === activePanel)?.label ?? ""}
      >
        {activePanel === "watchlist" ? (
          <div className="pt-4">
            {watchlistCoins.length > 0 ? (
              <div className="space-y-2">
                {watchlistCoins.map((coin) => (
                  <div
                    key={coin.symbol}
                    className="flex items-center justify-between rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800"
                  >
                    <div>
                      <p className="font-bold text-zinc-900 dark:text-zinc-100">{coin.symbol}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">{coin.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                        ${coin.price?.toLocaleString()}
                      </p>
                      <p className={`text-sm ${
                        (coin.change24h ?? 0) >= 0
                          ? "text-profit"
                          : "text-loss"
                      }`}>
                        {(coin.change24h ?? 0) >= 0 ? "+" : ""}
                        {coin.change24h?.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 pt-20">
                <div className="h-12 w-12 animate-bounce rounded-full bg-red-100 p-3 dark:bg-red-900/30">
                  <HeartIcon className="text-red-600" fill="none" />
                </div>
                <p className="text-sm font-medium text-zinc-500">
                  관심 코인이 없습니다
                </p>
                <p className="text-xs text-zinc-400">
                  하트를 눌러 추가해보세요
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 pt-20">
            <div className="h-12 w-12 animate-bounce rounded-full bg-blue-100 p-3 dark:bg-blue-900/30">
              <HeartIcon className="text-blue-600" fill="none" />
            </div>
            <p className="text-sm font-medium text-zinc-500">
              로그인이 필요한 서비스입니다.
            </p>
          </div>
        )}
      </SlideInPanel>

      {activePanel === "chatbot" && (
        <AIChatFAB
          showLauncher={false}
          isOpen
          onOpenChange={(open) => {
            if (!open) setActivePanel(null);
          }}
        />
      )}
    </>
  );
}
