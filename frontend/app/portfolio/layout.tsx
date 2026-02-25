"use client";

import PortfolioHeader from "@/components/PortfolioHeader";
import QuickBar from "@/components/QuickBar";
import { usePathname } from "next/navigation";

export default function PortfolioLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const isChartPage = pathname === "/portfolio/chart";

    return (
        <div className="flex flex-col h-screen w-full overflow-hidden bg-gradient-to-b from-zinc-100 via-zinc-100 to-zinc-200 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-900">
            <PortfolioHeader />
            <div className="relative flex-1 overflow-y-auto overflow-x-hidden">
                <div className={isChartPage ? "h-full w-full px-0" : "mx-auto h-full w-full max-w-7xl px-2 md:px-3 lg:px-4"}>
                {children}
                </div>
            </div>
            <QuickBar />
        </div>
    );
}
