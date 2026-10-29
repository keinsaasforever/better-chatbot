"use client";

import * as React from "react";
import {
  Bar,
  CartesianGrid,
  BarChart as RechartsBarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

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
import { generateUniqueKey } from "lib/utils";
import { JsonViewPopup } from "../json-view-popup";
import {
  chartCardBackground,
  chartColorsForPalette,
  sanitizeCssVariableName,
} from "./shared.tool-invocation";

// BarChart component props interface
export interface BarChartProps extends ChartAppearance {
  // Chart title (required)
  title: string;
  // Chart data array (required)
  data: Array<{
    xAxisLabel: string; // X-axis label name
    series: Array<{
      seriesName: string; // Series name
      value: number; // Value for this series
    }>;
  }>;
  // Chart description (optional)
  description?: string;
  // Y-axis label (optional)
  yAxisLabel?: string;
}

export function BarChart(props: BarChartProps) {
  const { title, data, description, yAxisLabel } = props;
  const { palette, background, showValues, showTooltip, showDataDetails } =
    resolveChartAppearance(props);
  const chartColors = chartColorsForPalette(palette);
  const cardBg = chartCardBackground(background);

  const deduplicateData = React.useMemo(() => {
    return data.reduce(
      (acc, item) => {
        const names = acc.map((item) => item.xAxisLabel);
        const newXAxisLabel = generateUniqueKey(item.xAxisLabel, names);
        return [
          ...acc,
          {
            xAxisLabel: newXAxisLabel,
            series: item.series.reduce(
              (acc, item) => {
                const names = acc.map((item) => item.seriesName);
                const newSeriesName = generateUniqueKey(item.seriesName, names);
                return [
                  ...acc,
                  {
                    ...item,
                    seriesName: newSeriesName,
                  },
                ];
              },
              [] as BarChartProps["data"][number]["series"],
            ),
          },
        ];
      },
      [] as BarChartProps["data"],
    );
  }, [data]);

  // Get series names from the first data item (assuming all items have the same series)
  const seriesNames =
    deduplicateData[0]?.series.map((item) => item.seriesName) || [];

  // Generate chart configuration dynamically
  const chartConfig = React.useMemo(() => {
    const config: ChartConfig = {};

    // Configure each series
    seriesNames.forEach((seriesName, index) => {
      // Colors cycle through chart-1 ~ chart-5
      const colorIndex = index % chartColors.length;

      config[sanitizeCssVariableName(seriesName)] = {
        label: seriesName,
        color: chartColors[colorIndex],
      };
    });

    return config;
  }, [seriesNames]);

  // Generate chart data for Recharts
  const chartData = React.useMemo(() => {
    return deduplicateData.map((item) => {
      const result: any = {
        name: item.xAxisLabel,
      };

      // Add each series value to the result
      item.series.forEach(({ seriesName, value }) => {
        result[sanitizeCssVariableName(seriesName)] = value;
      });

      return result;
    });
  }, [deduplicateData]);

  return (
    <Card className={cardBg.className} style={cardBg.style}>
      <CardHeader className="flex flex-col gap-2 relative">
        <CardTitle className="flex items-center">
          Bar Chart - {title}
          {showDataDetails && (
            <div className="absolute right-4 top-0">
              <JsonViewPopup
                data={{
                  ...props,
                  data: deduplicateData,
                }}
              />
            </div>
          )}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div>
          <ChartContainer config={chartConfig}>
            <ResponsiveContainer width="100%" height="400px">
              <RechartsBarChart data={chartData}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={showValues}
                  tickMargin={10}
                  label={
                    yAxisLabel
                      ? {
                          value: yAxisLabel,
                          angle: -90,
                          position: "insideLeft",
                        }
                      : undefined
                  }
                />
                {showTooltip && (
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        indicator="dashed"
                        hideValue={!showValues}
                      />
                    }
                  />
                )}
                {seriesNames.map((seriesName, index) => {
                  return (
                    <Bar
                      key={index}
                      dataKey={sanitizeCssVariableName(seriesName)}
                      fill={`var(--color-${sanitizeCssVariableName(seriesName)})`}
                      radius={4}
                    />
                  );
                })}
              </RechartsBarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}
