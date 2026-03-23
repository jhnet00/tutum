import { useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, ChevronLeft, ChevronRight, List, PieChart as PieIcon, Target } from "lucide-react";

import { Button } from "@/components/ui/button";

interface AssetData {
  symbol: string;
  name: string;
  value: number;
  color: string;
}

interface AssetAllocationChartProps {
  data: AssetData[];
  compact?: boolean;
}

type ChartMode = "pie" | "bar" | "radar" | "list";

const modeOptions = [
  { id: "pie", icon: PieIcon, label: "비중" },
  { id: "bar", icon: BarChart3, label: "순위" },
  { id: "radar", icon: Target, label: "균형" },
  { id: "list", icon: List, label: "목록" },
] as const;

export default function AssetAllocationChart({ data, compact = false }: AssetAllocationChartProps) {
  const [mode, setMode] = useState<ChartMode>("pie");
  const total = data.reduce((acc, curr) => acc + curr.value, 0);
  const chartData = data.map((item) => ({
    ...item,
    percent: total > 0 ? ((item.value / total) * 100).toFixed(1) : "0.0",
  }));

  const cycleMode = (direction: -1 | 1) => {
    const currentIndex = modeOptions.findIndex((item) => item.id === mode);
    const nextIndex = (currentIndex + direction + modeOptions.length) % modeOptions.length;
    setMode(modeOptions[nextIndex].id);
  };

  const renderChart = () => {
    switch (mode) {
      case "pie":
        return (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={compact ? 42 : 60}
                outerRadius={compact ? 76 : 96}
                paddingAngle={compact ? 3 : 4}
                dataKey="value"
              >
                {chartData.map((entry) => (
                  <Cell key={entry.symbol} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  borderRadius: "14px",
                  border: "1px solid hsl(var(--border))",
                  backgroundColor: "hsl(var(--card))",
                  boxShadow: "0 12px 30px rgba(0,0,0,0.08)",
                }}
                itemStyle={{ color: "hsl(var(--foreground))", fontSize: "12px", fontWeight: 700 }}
                formatter={(value: number, _name: string, entry: any) => [`${Math.floor(Number(value)).toLocaleString()}원`, `${entry?.payload?.name || entry?.payload?.symbol || "자산"}${entry?.payload?.symbol ? ` (${entry.payload.symbol})` : ""}`]}
              />
            </PieChart>
          </ResponsiveContainer>
        );
      case "bar":
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: compact ? 0 : 8, right: 8, top: 4, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis
                dataKey="symbol"
                type="category"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--foreground))", fontSize: compact ? 12 : 13, fontWeight: 800 }}
                width={compact ? 42 : 54}
              />
              <Tooltip
                cursor={{ fill: "transparent" }}
                contentStyle={{ borderRadius: "14px", border: "1px solid hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}
                formatter={(value: number, _name: string, entry: any) => [`${Math.floor(Number(value)).toLocaleString()}원`, `${entry?.payload?.name || entry?.payload?.symbol || "자산"}${entry?.payload?.symbol ? ` (${entry.payload.symbol})` : ""}`]}
              />
              <Bar dataKey="value" radius={[0, 999, 999, 0]} barSize={compact ? 14 : 16}>
                {chartData.map((entry) => (
                  <Cell key={entry.symbol} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      case "radar":
        return (
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius={compact ? "62%" : "72%"} data={chartData}>
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis dataKey="symbol" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: compact ? 10 : 11, fontWeight: 800 }} />
              <Radar name="비중" dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.42} />
            </RadarChart>
          </ResponsiveContainer>
        );
      case "list":
        return (
          <div className="h-full overflow-y-auto pr-1">
            <div className="space-y-2">
              {chartData.map((asset) => (
                <div
                  key={`${asset.symbol}-list`}
                  className={`flex items-center gap-3 rounded-2xl border border-border/70 bg-background/75 ${compact ? "px-3 py-2.5" : "px-3.5 py-3"}`}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: asset.color }} />
                  <div className="min-w-0 flex-1">
                    <p className={`${compact ? "text-xs" : "text-sm"} truncate font-black text-foreground`}>{asset.symbol}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{asset.name}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`${compact ? "text-xs" : "text-sm"} font-black text-foreground`}>{asset.percent}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
    }
  };

  return (
    <div className={`flex h-full flex-col ${compact ? "space-y-3" : "space-y-4"}`}>
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          className={`${compact ? "h-8 w-8" : "h-9 w-9"} rounded-full border border-border/70 bg-background/80`}
          onClick={() => cycleMode(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className={`flex min-w-0 flex-1 justify-center rounded-xl bg-muted ${compact ? "p-1" : "p-1.5"}`}>
          {modeOptions.map((option) => (
            <Button
              key={option.id}
              variant={mode === option.id ? "secondary" : "ghost"}
              size="sm"
              className={`${compact ? "h-8 w-8 px-0" : "h-9 gap-2 px-3.5"} rounded-lg ${mode === option.id ? "border-border bg-background shadow-sm" : ""}`}
              onClick={() => setMode(option.id as ChartMode)}
              title={option.label}
            >
              <option.icon className="h-4 w-4" />
              {!compact && <span className="text-xs font-black">{option.label}</span>}
            </Button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className={`${compact ? "h-8 w-8" : "h-9 w-9"} rounded-full border border-border/70 bg-background/80`}
          onClick={() => cycleMode(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {mode === "pie" ? (
        <div className="flex flex-wrap gap-x-3 gap-y-2 px-1">
          {chartData.slice(0, 6).map((asset) => (
            <div key={`${asset.symbol}-label`} className="flex items-center gap-2">
              <span className="text-sm font-black" style={{ color: asset.color }}>
                {asset.symbol}
              </span>
              <span className="text-xs font-bold text-muted-foreground">{asset.percent}%</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className={`${compact ? "h-[190px] md:h-[210px]" : "h-[208px] md:h-[230px]"} relative w-full`}>
        {renderChart()}
        {mode === "pie" ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Total</span>
            <span className={`${compact ? "text-xl" : "text-2xl"} font-black tracking-tighter text-foreground`}>
              {(total / 1000000).toFixed(1)}M
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
