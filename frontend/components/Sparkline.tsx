"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, IChartApi, ISeriesApi } from "lightweight-charts";
import { useTheme } from "next-themes";

interface SparklineProps {
    data: { value: number; date: string }[];
    color?: string;
    isPositive?: boolean;
    currency?: string;
    width?: number;
    height?: number;
}

export default function Sparkline({ data, color, isPositive = true, currency }: SparklineProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const currencyRef = useRef<string | undefined>(currency);
    const { theme } = useTheme();

    useEffect(() => {
        currencyRef.current = currency;
    }, [currency]);

    // Initial Chart Creation
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: 60,
            layout: {
                background: { type: ColorType.Solid, color: "transparent" },
                textColor: "transparent",
                attributionLogo: false,
            },
            grid: {
                vertLines: { visible: false },
                horzLines: { visible: false },
            },
            rightPriceScale: {
                visible: false,
            },
            timeScale: {
                visible: false,
            },
            handleScale: false,
            handleScroll: false,
            crosshair: {
                vertLine: { visible: true, style: 0, width: 1, color: "rgba(156, 163, 175, 0.5)", labelVisible: false },
                horzLine: { visible: false, labelVisible: false },
            },
        });

        chartRef.current = chart;

        const lineSeries = chart.addLineSeries({
            lineWidth: 2,
            priceLineVisible: false,
        });
        lineSeriesRef.current = lineSeries;

        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        window.addEventListener("resize", handleResize);

        // Tooltip Logic
        chart.subscribeCrosshairMove((param) => {
            const tooltip = tooltipRef.current;
            if (!tooltip || !chartContainerRef.current) return;

            if (
                param.point === undefined ||
                !param.time ||
                param.point.x < 0 ||
                param.point.x > chartContainerRef.current.clientWidth ||
                param.point.y < 0 ||
                param.point.y > chartContainerRef.current.clientHeight
            ) {
                tooltip.style.display = 'none';
                return;
            }

            tooltip.style.display = 'block';
            const seriesData = param.seriesData.get(lineSeries) as { value: number; time: string } | undefined;
            if (!seriesData) return;

            const price = seriesData.value.toLocaleString();
            const date = seriesData.time as string;
            const currentCurrency = currencyRef.current;
            const priceText = currentCurrency ? `${currentCurrency}${price}` : price;

            tooltip.innerHTML = `
                <div class="text-right">
                    <div class="text-lg font-bold text-white">${priceText}</div>
                    <div class="text-xs text-gray-400">${date}</div>
                </div>
            `;

            const coordinate = lineSeries.priceToCoordinate(seriesData.value);
            let left = param.point.x as number;
            const top = (coordinate !== null ? coordinate : 0) as number;

            const tooltipWidth = 100;
            if (left + tooltipWidth > chartContainerRef.current.clientWidth) {
                left = chartContainerRef.current.clientWidth - tooltipWidth;
            }
            if (left < 0) left = 0;

            tooltip.style.left = left + 'px';
            tooltip.style.top = Math.max(0, top - 60) + 'px';
        });

        return () => {
            window.removeEventListener("resize", handleResize);
            chart.remove();
            chartRef.current = null;
        };
    }, []); // Create once

    // Update Series Options (Theme/Color)
    useEffect(() => {
        if (!lineSeriesRef.current) return;
        const resolvedSeriesColor = theme === "dark"
            ? (isPositive ? "rgb(75, 170, 161)" : "rgb(171, 92, 105)")
            : (isPositive ? "rgb(32, 123, 112)" : "rgb(108, 52, 60)");

        const seriesColor = color
            ? color
            : resolvedSeriesColor;

        lineSeriesRef.current.applyOptions({
            color: seriesColor,
            crosshairMarkerBorderColor: seriesColor,
            crosshairMarkerBackgroundColor: theme === 'dark' ? '#000000' : '#ffffff',
        });
    }, [color, isPositive, theme]);

    // Update Data
    useEffect(() => {
        if (!lineSeriesRef.current || !chartRef.current) return;

        const chartData = data.map((item) => ({
            time: item.date.includes('T') ? item.date.split('T')[0] : item.date,
            value: item.value,
        }));

        lineSeriesRef.current.setData(chartData as any);
        chartRef.current.timeScale().fitContent();
    }, [data]);

    return (
        <div className="relative w-full h-[60px]">
            <div ref={chartContainerRef} className="w-full h-full" />
            <div
                ref={tooltipRef}
                className="pointer-events-none absolute z-10 hidden rounded-md bg-zinc-900/90 p-2 shadow-xl backdrop-blur-sm"
                style={{
                    width: '100px',
                    left: 0,
                    top: 0,
                }}
            />
        </div>
    );
}
