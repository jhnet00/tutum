"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Heart,
  LayoutDashboard,
  LineChart,
  Moon,
  Plus,
  Share2,
  Sparkles,
  Sun,
  Upload,
  User,
} from "lucide-react";
import { useTheme } from "next-themes";

import { AIChatFAB } from "./chat/AIChatFAB";
import SlideInPanel from "./SlideInPanel";
import { Button } from "@/components/ui/button";
import { useAsset } from "@/context/AssetContext";
import { useFavorites } from "@/context/FavoritesContext";
import { useMarketPriceContext } from "@/context/MarketPriceContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLocalWatchlist } from "@/lib/hooks/useLocalWatchlist";
import { allAssets } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

type PanelId = "my" | "watchlist" | "add" | "chatbot" | null;
type QuickToolId = "my" | "watchlist" | "asset" | "chart" | "upload";
type QuickBarPreset = {
  dock: "side" | "corner";
  toolSize: number;
  iconSize: number;
  edgeToggleSize: number;
  barGap: number;
  barPadding: number;
  barRadius: number;
  itemRadius: number;
  collapseHeight: number;
  collapseWidth: number;
  showLabels: boolean;
};

const VISIBLE_TOOLS_KEY = "tutum_quickbar_visible_tools";
const COLLAPSED_KEY = "tutum_quickbar_collapsed";
const TOOL_ORDER_KEY = "tutum_quickbar_tool_order";
const DEFAULT_TOOL_ORDER: QuickToolId[] = ["my", "watchlist", "upload", "asset", "chart"];
const DEFAULT_VISIBLE_TOOLS: QuickToolId[] = ["my", "watchlist", "upload", "asset", "chart"];

function getQuickBarPreset(width: number): QuickBarPreset {
  if (width < 480) {
    return {
      dock: "corner",
      toolSize: 40,
      iconSize: 16,
      edgeToggleSize: 22,
      barGap: 6,
      barPadding: 8,
      barRadius: 20,
      itemRadius: 14,
      collapseHeight: 36,
      collapseWidth: 36,
      showLabels: false,
    };
  }

  if (width < 680) {
    return {
      dock: "corner",
      toolSize: 46,
      iconSize: 17,
      edgeToggleSize: 24,
      barGap: 7,
      barPadding: 9,
      barRadius: 22,
      itemRadius: 16,
      collapseHeight: 40,
      collapseWidth: 40,
      showLabels: false,
    };
  }

  if (width < 1040) {
    return {
      dock: "side",
      toolSize: 50,
      iconSize: 18,
      edgeToggleSize: 24,
      barGap: 8,
      barPadding: 10,
      barRadius: 24,
      itemRadius: 16,
      collapseHeight: 42,
      collapseWidth: 40,
      showLabels: false,
    };
  }

  if (width < 1400) {
    return {
      dock: "side",
      toolSize: 55,
      iconSize: 19,
      edgeToggleSize: 26,
      barGap: 9,
      barPadding: 11,
      barRadius: 26,
      itemRadius: 17,
      collapseHeight: 44,
      collapseWidth: 42,
      showLabels: false,
    };
  }

  return {
    dock: "side",
    toolSize: 60,
    iconSize: 20,
    edgeToggleSize: 28,
    barGap: 10,
    barPadding: 12,
    barRadius: 28,
    itemRadius: 18,
    collapseHeight: 46,
    collapseWidth: 42,
    showLabels: true,
  };
}

const TOOL_META: Record<
  QuickToolId,
  {
    label: string;
    description: string;
    icon: typeof User;
    kind: "panel" | "link";
    href?: string;
  }
> = {
  my: {
    label: "MY",
    description: "마이페이지 요약",
    icon: User,
    kind: "panel",
  },
  watchlist: {
    label: "관심",
    description: "보유/관심 자산 요약",
    icon: Heart,
    kind: "panel",
  },
  asset: {
    label: "자산",
    description: "포트폴리오 대시보드",
    icon: LayoutDashboard,
    kind: "link",
    href: "/portfolio/asset",
  },
  chart: {
    label: "차트",
    description: "차트 화면 바로가기",
    icon: LineChart,
    kind: "link",
    href: "/portfolio/chart",
  },
  upload: {
    label: "입력",
    description: "자산 입력 바로가기",
    icon: Upload,
    kind: "link",
    href: "/asset-upload/direct",
  },
};

function formatCompactCurrency(value: number) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMarketPrice(price: number | null, isKrW = true) {
  if (price == null || !Number.isFinite(price)) return "실시간 대기";
  return isKrW
    ? `${price.toLocaleString("ko-KR")}원`
    : `$${price.toLocaleString("en-US")}`;
}

export default function QuickBar() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const { holdings } = useAsset();
  const { favorites, toggleFavorite } = useFavorites();
  const { watchlist } = useLocalWatchlist();
  const { priceMap } = useMarketPriceContext();

  const [mounted, setMounted] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const [visibleTools, setVisibleTools] = useState<QuickToolId[]>(DEFAULT_VISIBLE_TOOLS);
  const [toolOrder, setToolOrder] = useState<QuickToolId[]>(DEFAULT_TOOL_ORDER);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [viewportWidth, setViewportWidth] = useState(1440);
  const [draggingToolId, setDraggingToolId] = useState<QuickToolId | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const savedTools = localStorage.getItem(VISIBLE_TOOLS_KEY);
      const savedCollapsed = localStorage.getItem(COLLAPSED_KEY);
      const savedOrder = localStorage.getItem(TOOL_ORDER_KEY);
      if (savedTools) {
        const parsed = JSON.parse(savedTools);
        if (Array.isArray(parsed)) {
          const next = parsed.filter(
            (tool): tool is QuickToolId => typeof tool === "string" && tool in TOOL_META
          );
          if (next.length > 0) {
            setVisibleTools(next);
            if (!savedOrder) {
              setToolOrder([
                ...next,
                ...DEFAULT_TOOL_ORDER.filter((toolId) => !next.includes(toolId)),
              ]);
            }
          }
        }
      }
      if (savedOrder) {
        const parsed = JSON.parse(savedOrder);
        if (Array.isArray(parsed)) {
          const next = parsed.filter(
            (tool): tool is QuickToolId => typeof tool === "string" && tool in TOOL_META
          );
          if (next.length === DEFAULT_TOOL_ORDER.length) {
            setToolOrder(next);
          }
        }
      }
      if (savedCollapsed === "true") setIsCollapsed(true);
    } catch {
      // Keep defaults when localStorage is malformed.
    }
  }, []);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(VISIBLE_TOOLS_KEY, JSON.stringify(visibleTools));
  }, [mounted, visibleTools]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(TOOL_ORDER_KEY, JSON.stringify(toolOrder));
  }, [mounted, toolOrder]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(COLLAPSED_KEY, String(isCollapsed));
  }, [mounted, isCollapsed]);

  useEffect(() => {
    if (!shareMessage) return;
    const id = window.setTimeout(() => setShareMessage(""), 1800);
    return () => window.clearTimeout(id);
  }, [shareMessage]);

  const interestSymbols = useMemo(() => {
    return [...new Set([...watchlist, ...favorites].map((value) => value.toUpperCase()))];
  }, [favorites, watchlist]);

  const watchlistRows = useMemo(() => {
    return interestSymbols.map((symbol) => {
      const priceEntry = priceMap[symbol];
      const holding = holdings.find((item) => item.symbol.toUpperCase() === symbol);
      const assetMeta = allAssets.find((asset) => asset.symbol.toUpperCase() === symbol);
      const isKrW =
        priceEntry?.isKRW ??
        (/^\d{6}$/.test(symbol) ||
          ["BTC", "ETH", "SOL", "ADA", "XRP", "DOGE", "AVAX", "DOT", "USDT"].includes(symbol));

      return {
        symbol,
        name: holding?.name || assetMeta?.name || symbol,
        price: priceEntry?.price ?? holding?.currentPrice ?? null,
        changePercent: priceEntry?.changePercent ?? holding?.changePercent ?? null,
        isKrW,
        isHolding: Boolean(holding),
      };
    });
  }, [holdings, interestSymbols, priceMap]);

  const portfolioTotal = useMemo(
    () => holdings.reduce((sum, asset) => sum + (Number(asset.value) || 0), 0),
    [holdings]
  );

  const handleShareDashboard = useCallback(async () => {
    const shareUrl =
      typeof window !== "undefined"
        ? new URL("/portfolio/asset", window.location.origin).toString()
        : "/portfolio/asset";

    try {
      if (navigator.share) {
        await navigator.share({
          title: "TUTUM Portfolio",
          text: "TUTUM 포트폴리오 페이지",
          url: shareUrl,
        });
        setShareMessage("공유 창을 열었습니다.");
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setShareMessage("대시보드 링크를 복사했습니다.");
    } catch {
      setShareMessage("링크 공유를 완료하지 못했습니다.");
    }
  }, []);

  const toggleTool = useCallback((toolId: QuickToolId) => {
    setVisibleTools((current) => {
      if (current.includes(toolId)) {
        const next = current.filter((tool) => tool !== toolId);
        return next.length > 0 ? next : current;
      }
      return toolOrder.filter((tool) => current.includes(tool) || tool === toolId);
    });
  }, [toolOrder]);

  const reorderTools = useCallback((fromId: QuickToolId, toId: QuickToolId) => {
    if (fromId === toId) return;

    setToolOrder((current) => {
      const next = [...current];
      const fromIndex = next.indexOf(fromId);
      const toIndex = next.indexOf(toId);
      if (fromIndex === -1 || toIndex === -1) return current;

      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, fromId);
      return next;
    });
  }, []);

  const handleToolClick = useCallback((toolId: QuickToolId) => {
    const tool = TOOL_META[toolId];
    if (tool.kind === "panel") {
      setActivePanel(toolId as "my" | "watchlist");
      return;
    }
    if (tool.href) {
      window.location.href = tool.href;
    }
  }, []);

  const isDark = mounted && theme === "dark";
  const orderedTools = toolOrder.filter((toolId) => visibleTools.includes(toolId));
  const watchBadgeCount = interestSymbols.length;
  const collapseLabel = isCollapsed ? "퀵바 열기" : "퀵바 접기";
  const quickBarPreset = getQuickBarPreset(viewportWidth);
  const isCornerDock = quickBarPreset.dock === "corner";
  const isChatOpen = activePanel === "chatbot";

  return (
    <>
      {!isChatOpen && isCollapsed ? (
        <button
          type="button"
          aria-label={collapseLabel}
          onClick={() => setIsCollapsed(false)}
          className="fixed z-50 flex items-center justify-center border border-zinc-300/75 bg-zinc-100/92 text-zinc-700 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.45)] backdrop-blur-xl transition hover:border-zinc-400 hover:bg-zinc-200 hover:text-zinc-950 dark:border-zinc-600/80 dark:bg-zinc-900/88 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
          style={{
            right: isCornerDock ? "calc(10px + env(safe-area-inset-right))" : "10px",
            top: isCornerDock ? "auto" : "50%",
            bottom: isCornerDock ? "calc(12px + env(safe-area-inset-bottom))" : "auto",
            transform: isCornerDock ? "none" : "translateY(-45%)",
            width: quickBarPreset.collapseWidth,
            height: quickBarPreset.collapseHeight,
            borderRadius: isCornerDock
              ? quickBarPreset.itemRadius
              : `${quickBarPreset.itemRadius}px 0 0 ${quickBarPreset.itemRadius}px`,
          }}
        >
          <ChevronLeft
            style={{ width: quickBarPreset.iconSize, height: quickBarPreset.iconSize }}
          />
        </button>
      ) : !isChatOpen ? (
        <div
          className={cn(
            "fixed z-50 flex flex-col border border-white/35 bg-white/68 shadow-[0_20px_45px_-28px_rgba(0,0,0,0.35)] backdrop-blur-xl dark:border-zinc-700/45 dark:bg-zinc-900/72"
          )}
          style={{
            right: isCornerDock ? "calc(10px + env(safe-area-inset-right))" : "10px",
            top: isCornerDock ? "auto" : "50%",
            bottom: isCornerDock ? "calc(12px + env(safe-area-inset-bottom))" : "auto",
            transform: isCornerDock ? "none" : "translateY(-45%)",
            gap: quickBarPreset.barGap,
            padding: quickBarPreset.barPadding,
            borderRadius: isCornerDock
              ? quickBarPreset.barRadius
              : `${quickBarPreset.barRadius}px 0 0 ${quickBarPreset.barRadius}px`,
          }}
        >
          <button
            type="button"
            aria-label={collapseLabel}
            onClick={() => setIsCollapsed(true)}
            className="absolute z-10 flex items-center justify-center rounded-full border border-zinc-300/85 bg-zinc-100/95 text-zinc-700 shadow-[0_12px_26px_-18px_rgba(15,23,42,0.55)] transition hover:border-zinc-400 hover:bg-zinc-200 hover:text-zinc-950 dark:border-zinc-600/90 dark:bg-zinc-900/95 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
            style={{
              width: quickBarPreset.edgeToggleSize,
              height: quickBarPreset.edgeToggleSize,
              right: -Math.round(quickBarPreset.edgeToggleSize / 2),
              top: "50%",
              transform: "translateY(-50%)",
            }}
          >
            <ChevronRight
              style={{
                width: Math.max(12, quickBarPreset.iconSize - 4),
                height: Math.max(12, quickBarPreset.iconSize - 4),
              }}
            />
          </button>

          <button
            type="button"
            onClick={() => setActivePanel("chatbot")}
            className="group flex flex-col items-center justify-center gap-1 border border-fuchsia-300/25 bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-600 text-zinc-100 shadow-[0_10px_26px_-20px_rgba(139,92,246,0.5)] transition hover:scale-[1.03] hover:from-fuchsia-500 hover:via-pink-500 hover:to-rose-500"
            style={{
              width: quickBarPreset.toolSize,
              height: quickBarPreset.toolSize,
              borderRadius: quickBarPreset.itemRadius,
            }}
            title="AI"
          >
            <Sparkles
              className="text-white/95"
              style={{ width: quickBarPreset.iconSize, height: quickBarPreset.iconSize }}
            />
            {quickBarPreset.showLabels && (
              <span className="text-[10px] font-bold text-white/95">AI</span>
            )}
          </button>

          {orderedTools.map((toolId) => {
            const tool = TOOL_META[toolId];
            const Icon = tool.icon;
            return (
              <button
                key={toolId}
                type="button"
                onClick={() => handleToolClick(toolId)}
                title={tool.label}
                className="group relative flex flex-col items-center justify-center gap-1 border border-zinc-200/80 bg-white/72 text-zinc-700 shadow-sm transition hover:scale-[1.03] hover:border-zinc-400 hover:bg-zinc-200 hover:text-zinc-950 dark:border-zinc-700/80 dark:bg-zinc-800/78 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-white"
                style={{
                  width: quickBarPreset.toolSize,
                  height: quickBarPreset.toolSize,
                  borderRadius: quickBarPreset.itemRadius,
                }}
              >
                <Icon style={{ width: quickBarPreset.iconSize, height: quickBarPreset.iconSize }} />
                {quickBarPreset.showLabels && (
                  <span className="text-[10px] font-bold">{tool.label}</span>
                )}
                {toolId === "watchlist" && watchBadgeCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {watchBadgeCount}
                  </span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setActivePanel("add")}
            className="group flex flex-col items-center justify-center gap-1 border border-zinc-300/70 bg-gradient-to-br from-zinc-100 to-zinc-200 text-zinc-800 shadow-[0_6px_16px_-16px_rgba(168,85,247,0.25)] transition hover:scale-[1.03] hover:border-zinc-400 hover:from-zinc-200 hover:to-zinc-300 hover:text-zinc-950 dark:border-fuchsia-300/45 dark:from-zinc-800 dark:to-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:from-zinc-700 dark:hover:to-zinc-800"
            style={{
              width: quickBarPreset.toolSize,
              height: quickBarPreset.toolSize,
              borderRadius: quickBarPreset.itemRadius,
            }}
            title="추가"
          >
            <Plus style={{ width: quickBarPreset.iconSize, height: quickBarPreset.iconSize }} />
            {quickBarPreset.showLabels && <span className="text-[10px] font-bold">추가</span>}
          </button>

          <div className="h-px bg-zinc-300/80 dark:bg-zinc-700/80" />

          <button
            type="button"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className={cn(
              "group flex flex-col items-center justify-center gap-1 border border-zinc-200/80 bg-white/72 text-zinc-700 shadow-sm transition dark:border-zinc-700/80 dark:bg-zinc-800/78 dark:text-zinc-200",
              isDark
                ? "hover:border-zinc-600 hover:bg-gradient-to-br hover:from-zinc-700 hover:via-zinc-700 hover:to-zinc-600 hover:text-zinc-50 dark:hover:border-zinc-600 dark:hover:bg-gradient-to-br dark:hover:from-zinc-700 dark:hover:via-zinc-700 dark:hover:to-zinc-600 dark:hover:text-zinc-50"
                : "hover:border-slate-400 hover:bg-gradient-to-br hover:from-zinc-100 hover:via-slate-200 hover:to-zinc-300 hover:text-zinc-900 dark:hover:border-slate-500 dark:hover:bg-gradient-to-br dark:hover:from-zinc-200 dark:hover:via-slate-300 dark:hover:to-zinc-400 dark:hover:text-zinc-950"
            )}
            style={{
              width: quickBarPreset.toolSize,
              height: quickBarPreset.toolSize,
              borderRadius: quickBarPreset.itemRadius,
            }}
            title={isDark ? "라이트 모드" : "다크 모드"}
          >
            {isDark ? (
              <Sun style={{ width: quickBarPreset.iconSize, height: quickBarPreset.iconSize }} />
            ) : (
              <Moon style={{ width: quickBarPreset.iconSize, height: quickBarPreset.iconSize }} />
            )}
            {quickBarPreset.showLabels && (
              <span className="text-[10px] font-bold">{isDark ? "라이트" : "다크"}</span>
            )}
          </button>
        </div>
      ) : null}

      <AIChatFAB
        showLauncher={false}
        isOpen={isChatOpen}
        onOpenChange={(open) => {
          setActivePanel(open ? "chatbot" : null);
        }}
      />

      {!isChatOpen && (
        <SlideInPanel
          isOpen={activePanel !== null}
          onClose={() => setActivePanel(null)}
          title={
            activePanel === "my"
              ? "MY"
              : activePanel === "watchlist"
                ? "관심 자산"
                : "퀵바 편집"
          }
        >
        {activePanel === "my" && (
          <div className="space-y-5 py-5">
            {user ? (
              <>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 dark:bg-white/[0.02]">
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-zinc-900 text-xl font-black text-white dark:bg-zinc-100 dark:text-zinc-900">
                      {user.profile_image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={user.profile_image}
                          alt="profile"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        user.nickname?.slice(0, 1).toUpperCase() || "U"
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-lg font-bold text-zinc-900 dark:text-zinc-100">
                        {user.nickname}
                      </p>
                      <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                        {user.email}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                        로그인 방식 {user.login_type?.toUpperCase() || "LOCAL"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">보유 자산 수</p>
                    <p className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      {holdings.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">평가 금액</p>
                    <p className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      {formatCompactCurrency(portfolioTotal)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Link href="/portfolio/mypage" className="block">
                    <Button className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900">
                      마이페이지
                    </Button>
                  </Link>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full rounded-xl"
                    onClick={handleShareDashboard}
                  >
                    <Share2 className="mr-2 h-4 w-4" />
                    대시보드 공유
                  </Button>
                </div>

                {shareMessage && (
                  <p className="text-xs text-emerald-500">{shareMessage}</p>
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-300 p-5 text-center dark:border-zinc-700">
                <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                  로그인 후 MY 요약을 사용할 수 있습니다.
                </p>
                <Link href="/login" className="mt-4 inline-block">
                  <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900">
                    로그인
                  </Button>
                </Link>
              </div>
            )}
          </div>
        )}

        {activePanel === "watchlist" && (
          <div className="space-y-3 py-5">
            {watchlistRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 p-5 text-center dark:border-zinc-700">
                <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                  관심 자산이 아직 없습니다.
                </p>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  하트 또는 즐겨찾기로 추가한 종목만 여기에 표시됩니다.
                </p>
              </div>
            ) : (
              watchlistRows.map((item) => (
                <div
                  key={item.symbol}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {item.symbol}
                        </p>
                        {item.isHolding && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                            보유중
                          </span>
                        )}
                      </div>
                      <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                        {item.name}
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => toggleFavorite(item.symbol)}
                        className="rounded-full p-1.5 transition-colors hover:bg-white/10"
                        aria-label={favorites.includes(item.symbol) ? "관심 자산 해제" : "관심 자산 추가"}
                      >
                        <Heart
                          className={cn(
                            "h-4 w-4 transition-all",
                            favorites.includes(item.symbol) ? "fill-fuchsia-500 text-fuchsia-500" : "text-zinc-400"
                          )}
                        />
                      </button>
                      <div className="text-right">
                        <p className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {formatMarketPrice(item.price, item.isKrW)}
                        </p>
                        <p
                          className={cn(
                            "text-xs font-semibold",
                            item.changePercent == null
                              ? "text-zinc-400"
                              : item.changePercent >= 0
                                ? "text-fuchsia-500"
                                : "text-zinc-400"
                          )}
                        >
                          {item.changePercent == null
                            ? "실시간 대기"
                            : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activePanel === "add" && (
          <div className="space-y-5 py-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                퀵바 편집
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                AI와 추가 버튼은 고정입니다. 아래 항목은 드래그로 순서를 바꾸고 표시 여부를 직접 조절할 수 있습니다.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {toolOrder.map((toolId) => {
                const tool = TOOL_META[toolId];
                const Icon = tool.icon;
                const enabled = visibleTools.includes(toolId);
                return (
                  <div
                    key={toolId}
                    draggable
                    onDragStart={() => setDraggingToolId(toolId)}
                    onDragEnd={() => setDraggingToolId(null)}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggingToolId) {
                        reorderTools(draggingToolId, toolId);
                      }
                      setDraggingToolId(null);
                    }}
                    className={cn(
                      "flex items-center justify-between rounded-2xl border p-4 text-left transition cursor-grab active:cursor-grabbing",
                      draggingToolId === toolId && "opacity-60",
                      enabled
                        ? "border-emerald-500/30 bg-emerald-500/10"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="rounded-xl bg-white/70 p-2 text-zinc-500 dark:bg-zinc-900/70 dark:text-zinc-400">
                        <GripVertical className="h-4 w-4" />
                      </div>
                      <div className="rounded-xl bg-zinc-900/90 p-2 text-white dark:bg-zinc-100 dark:text-zinc-900">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {tool.label}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {tool.description}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleTool(toolId)}
                      className={cn(
                        "shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold",
                        enabled
                          ? "bg-emerald-500/15 text-emerald-500"
                          : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      )}
                    >
                      {enabled ? "표시중" : "숨김"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </SlideInPanel>
      )}
    </>
  );
}
