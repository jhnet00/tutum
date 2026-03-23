"use client";

import React from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { LayoutGrid } from "lucide-react";

import { useAsset } from "@/context/AssetContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface HeatmapAssetData {
  symbol: string;
  name: string;
  value: number;
  color?: string;
  changePercent?: number;
}

const CustomizedContent = (props: any) => {
  const { depth, x, y, width, height, payload, name, changePercent } = props;
  const safeChangePercent = changePercent ?? 0;
  const fillColor = payload?.color || "#6366F1";

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
      {width > 30 && height > 30 ? (
        <foreignObject x={x} y={y} width={width} height={height}>
          <div className="flex h-full w-full flex-col items-center justify-center overflow-hidden p-1 text-center">
            <span className="w-full truncate text-xs font-bold text-white">{name}</span>
            {height > 50 ? (
              <span className="text-[10px] font-medium text-white/90">
                {safeChangePercent > 0 ? "+" : ""}
                {safeChangePercent.toFixed(2)}%
              </span>
            ) : null}
          </div>
        </foreignObject>
      ) : null}
    </g>
  );
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!(active && payload && payload.length)) return null;

  const data = payload[0].payload;
  const safeChangePercent = data.changePercent ?? 0;

  return (
    <div className="z-50 rounded-xl border border-border bg-popover p-3 shadow-xl">
      <p className="mb-1 text-sm font-bold">
        {data.name} ({data.symbol})
      </p>
      <div className="flex gap-4 text-xs">
        <div>
          <span className="block text-muted-foreground">평가 금액</span>
          <span className="font-medium">{Math.floor(data.value).toLocaleString()}</span>
        </div>
        <div>
          <span className="block text-muted-foreground">변동률</span>
          <span className={`font-bold ${safeChangePercent >= 0 ? "text-profit" : "text-loss"}`}>
            {safeChangePercent > 0 ? "+" : ""}
            {safeChangePercent.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
};

export default function PortfolioHeatmap({ data: inputData }: { data?: HeatmapAssetData[] }) {
  const { holdings } = useAsset();

  const sourceData =
    inputData && inputData.length > 0
      ? inputData
      : holdings.map((holding) => ({
          name: holding.name,
          symbol: holding.symbol,
          value: holding.value,
          color: "#6366F1",
          changePercent: holding.changePercent,
        }));

  if (sourceData.length === 0) return null;

  const data = [
    {
      name: "Portfolio",
      children: sourceData.map((item) => ({
        name: item.name,
        symbol: item.symbol,
        size: item.value,
        value: item.value,
        color: item.color,
        changePercent: item.changePercent ?? 0,
      })),
    },
  ];

  return (
    <Card className="flex h-full flex-col overflow-hidden border-none bg-white shadow-xl dark:bg-zinc-900">
      <CardHeader className="p-6 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg font-black uppercase tracking-widest text-zinc-500">
            <LayoutGrid className="h-5 w-5" />
            Heatmap
          </CardTitle>
          <div className="hidden items-center gap-2 md:flex">
            {sourceData.slice(0, 3).map((item) => (
              <div key={`${item.symbol}-legend`} className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1 dark:bg-zinc-800">
                <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: item.color || "#6366F1" }} />
                <span className="text-[10px] font-bold text-zinc-500">{item.symbol}</span>
              </div>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-h-[240px] flex-1 p-0">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap data={data} dataKey="size" aspectRatio={4 / 3} stroke="#fff" content={<CustomizedContent />}>
            <Tooltip content={<CustomTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
