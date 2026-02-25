"use client";

import React from "react";
import { ResponsiveContainer, Treemap, Tooltip } from "recharts";
import { useAsset } from "@/context/AssetContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutGrid, Info } from "lucide-react";

// Customized Content for Treemap Node
const CustomizedContent = (props: any) => {
    const { root, depth, x, y, width, height, index, payload, colors, rank, name, value, changePercent } = props;

    // Safely handle changePercent (default to 0 if undefined)
    const safeChangePercent = changePercent ?? 0;

    // Determine color based on changePercent
    let fillColor = "#52525b"; // Neutral Zinc-600
    if (safeChangePercent > 3) fillColor = "#145d56"; // Profit strong
    else if (safeChangePercent > 0) fillColor = "#207b70"; // Profit
    else if (safeChangePercent < -3) fillColor = "#682c35"; // Loss strong
    else if (safeChangePercent < 0) fillColor = "#6c343c"; // Loss
    else fillColor = "#52525b"; // Zinc-600 (Zero change)

    return (
        <g>
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                style={{
                    fill: fillColor,
                    stroke: "#fff",
                    strokeWidth: 2 / (depth + 1e-10),
                    strokeOpacity: 1 / (depth + 1e-10),
                }}
            />
            {width > 30 && height > 30 && (
                <foreignObject x={x} y={y} width={width} height={height}>
                   <div className="flex flex-col items-center justify-center w-full h-full p-1 text-center overflow-hidden">
                        <span className="text-white font-bold text-xs truncate w-full">{name}</span>
                        {height > 50 && (
                             <span className="text-white/90 text-[10px] font-medium">
                                {safeChangePercent > 0 ? "+" : ""}{safeChangePercent.toFixed(2)}%
                            </span>
                        )}
                   </div>
                </foreignObject>
            )}
        </g>
    );
};

const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        const safeChangePercent = data.changePercent ?? 0;
        return (
            <div className="bg-popover border border-border p-3 rounded-xl shadow-xl z-50">
                <p className="font-bold text-sm mb-1">{data.name} ({data.symbol})</p>
                <div className="flex gap-4 text-xs">
                    <div>
                        <span className="text-muted-foreground block">평가금액</span>
                        <span className="font-medium">{Math.floor(data.value).toLocaleString()}원</span>
                    </div>
                     <div>
                        <span className="text-muted-foreground block">변동률</span>
                        <span className={`font-bold ${safeChangePercent >= 0 ? "text-profit" : "text-loss"}`}>
                            {safeChangePercent > 0 ? "+" : ""}{safeChangePercent.toFixed(2)}%
                        </span>
                    </div>
                </div>
            </div>
        );
    }
    return null;
};

export default function PortfolioHeatmap() {
    const { holdings } = useAsset();

    // Transform data for Treemap
    // Treemap needs a tree structure. We'll group everything under "All"
    const data = [
        {
            name: "Portfolio",
            children: holdings.map(h => ({
                name: h.name,
                symbol: h.symbol,
                size: h.value, // Size determined by Value (Market Cap equivalent for portfolio)
                value: h.value,
                changePercent: h.changePercent
            }))
        }
    ];

    if (holdings.length === 0) return null;

    return (
        <Card className="border-none shadow-xl bg-white dark:bg-zinc-900 overflow-hidden">
            <CardHeader className="p-6 pb-2">
                 <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                        <LayoutGrid className="h-5 w-5" />
                        Heatmap
                    </CardTitle>
                    <div className="flex items-center gap-2">
                         <div className="flex items-center gap-1.5 px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                             <div className="w-3 h-3 bg-profit-soft rounded-sm" />
                             <span className="text-[10px] font-bold text-zinc-500">상승</span>
                         </div>
                         <div className="flex items-center gap-1.5 px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                             <div className="w-3 h-3 bg-loss-soft rounded-sm" />
                             <span className="text-[10px] font-bold text-zinc-500">하락</span>
                         </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="h-[300px] md:h-[400px] p-0">
                <ResponsiveContainer width="100%" height="100%">
                    <Treemap
                        data={data}
                        dataKey="size"
                        aspectRatio={4 / 3}
                        stroke="#fff"
                        content={<CustomizedContent />}
                    >
                        <Tooltip content={<CustomTooltip />} />
                    </Treemap>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}
