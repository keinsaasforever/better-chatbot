"use client";

import * as React from "react";
import { Label, Pie, PieChart as RechartsPieChart } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

import type { ChartAppearance } from "@/lib/ai/tools/visualization/chart-appearance";
import { resolveChartAppearance } from "@/lib/ai/tools/visualization/chart-appearance";
import { JsonViewPopup } from "../json-view-popup";
import {
  chartCardBackground,
  chartColorsForPalette,
  sanitizeCssVariableName,
} from "./shared.tool-invocation";

// PieChart component props interface
export interface PieChartProps extends ChartAppearance {
  // Chart title (required)
  title: string;
  // Chart data array (required)
  data: Array<{
    label: string; // Item label
    value: number; // Item value
  }>;
  // Value unit (optional, e.g., "visitors", "users", etc.)
  unit?: string;
  // Chart description (optional)
  description?: string;
  prefix?: string;
  jsonView?: boolean;
}

// Function to format large numbers with k, M, B, T units
function formatLargeNumber(num: number | null | undefined): string {
  // Handle null, undefined, or invalid numbers
  if (num == null || isNaN(num) || !isFinite(num)) {
    return "0";
  }

  // Handle negative numbers
  if (num < 0) {
    return `-${formatLargeNumber(-num)}`;
  }

  // Handle zero
  if (num === 0) {
    return "0";
  }

  if (num < 1000) {
    return num.toString();
  }

  const units = [
    "",
    "k",
    "M",
    "B",
    "T",
    "Qa",
    "Qi",
    "Sx",
    "Sp",
    "Oc",
    "No",
    "Dc",
  ];
  let unitIndex = 0;
  let value = num;

  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex++;
  }

  return `${value.toFixed(1)}${units[unitIndex]}`;
}

export function PieChart(props: PieChartProps) {
  const { title, data, unit, description, prefix, jsonView = true } = props;
  const { palette, background, showValues, showTooltip, showDataDetails } =
    resolveChartAppearance(props);
  const chartColors = chartColorsForPalette(palette);
  const cardBg = chartCardBackground(background);
  // Calculate total value
  const total = React.useMemo(() => {
    return data.reduce((acc, curr) => acc + curr.value, 0);
  }, [data]);

  // Generate chart configuration dynamically
  const chartConfig = React.useMemo(() => {
    const config: ChartConfig = {};

    // Set value unit
    if (unit) {
      config.value = {
        label: unit,
      };
    }

    // Configure each data item
    data.forEach((item, index) => {
      // Colors cycle through chart-1 ~ chart-5
      const colorIndex = index % chartColors.length;
      config[sanitizeCssVariableName(item.label)] = {
        label: item.label,
        color: chartColors[colorIndex],
      };
    });

    return config;
  }, [data, unit]);

  // Generate actual chart data
  const chartData = React.useMemo(() => {
    return data.map((item) => ({
      name: item.label,
      label: item.label,
      value: item.value,
      // Add fill property if needed
      fill: `var(--color-${sanitizeCssVariableName(item.label)})`,
    }));
  }, [data]);

  return (
    <Card className={`flex flex-col ${cardBg.className}`} style={cardBg.style}>
      <CardHeader className="items-center pb-0 flex flex-col gap-2 relative">
        <CardTitle className="flex items-center">
          {prefix ?? "Pie Chart - "}
          {title}
          {jsonView && showDataDetails && (
            <div className="absolute right-4 top-0">
              <JsonViewPopup data={props} />
            </div>
          )}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[300px]"
        >
          <RechartsPieChart>
            {showTooltip && (
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent hideLabel hideValue={!showValues} />
                }
              />
            )}
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={60}
              strokeWidth={5}
            >
              <Label
                content={({ viewBox }) => {
                  if (!showValues) return null;
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {formatLargeNumber(total)}
                        </tspan>
                        {unit && (
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) + 24}
                            className="fill-muted-foreground"
                          >
                            {unit}
                          </tspan>
                        )}
                      </text>
                    );
                  }
                }}
              />
            </Pie>
          </RechartsPieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
