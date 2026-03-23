"use client";

import React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DashboardAssetData {
  symbol: string;
  name: string;
  value: number;
  color: string;
}

interface PortfolioDashboardChartsProps {
  data: DashboardAssetData[];
}

function getTotalValue(data: DashboardAssetData[]) {
  return data.reduce((acc, curr) => acc + curr.value, 0);
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!(active && payload && payload.length)) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-xl">
      <p className="mb-1 text-sm font-black text-foreground">{label}</p>
      <p className="text-xs font-black text-primary">평가 금액: {payload[0].value.toLocaleString()}</p>
      {payload[0].payload.percent ? (
        <p className="text-[11px] font-bold text-muted-foreground">비중: {payload[0].payload.percent}%</p>
      ) : null}
    </div>
  );
};

export function TopAssetsChartCard({ data }: PortfolioDashboardChartsProps) {
  const total = getTotalValue(data);
  const barData = data.slice(0, 5).map((item) => ({
    name: item.symbol,
    value: item.value,
    color: item.color,
    percent: total > 0 ? ((item.value / total) * 100).toFixed(1) : "0.0",
  }));

  return (
    <Card className="flex h-full flex-col overflow-hidden border-border bg-card shadow-none">
      <CardHeader className="shrink-0 p-4 pb-3 md:p-5 md:pb-3">
        <CardTitle className="text-sm font-black md:text-lg">Top 자산</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 p-3 pt-0 md:px-5 md:pb-5">
        <div className="h-full min-h-[190px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 4, right: 6, left: -26, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontWeight: 700 }}
                height={28}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontWeight: 600 }}
                width={42}
                domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.25)]}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "transparent", opacity: 0.1 }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={18}>
                {barData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.88} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function TrendChartCard({ data }: PortfolioDashboardChartsProps) {
  const total = getTotalValue(data);
  const performanceData = [
    { name: "Jan", value: total * 0.61 },
    { name: "Feb", value: total * 0.56 },
    { name: "Mar", value: total * 0.73 },
    { name: "Apr", value: total * 0.69 },
    { name: "May", value: total * 0.82 },
    { name: "Jun", value: total * 0.78 },
    { name: "Jul", value: total },
  ];

  return (
    <Card className="flex h-full flex-col overflow-hidden border-border bg-card shadow-none">
      <CardHeader className="shrink-0 p-4 pb-3 md:p-5 md:pb-3">
        <CardTitle className="text-sm font-black md:text-lg">추이</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 p-3 pt-0 md:px-5 md:pb-5">
        <div className="h-full min-h-[190px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={performanceData} margin={{ top: 4, right: 6, left: -26, bottom: 8 }}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.32} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontWeight: 700 }}
                height={28}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontWeight: 600 }}
                width={42}
                domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.25)]}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "12px",
                  border: "1px solid hsl(var(--border))",
                  backgroundColor: "hsl(var(--card))",
                  fontSize: "14px",
                  fontWeight: "800",
                }}
              />
              <Area type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PortfolioDashboardCharts({ data }: PortfolioDashboardChartsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-6">
      <TopAssetsChartCard data={data} />
      <TrendChartCard data={data} />
    </div>
  );
}
