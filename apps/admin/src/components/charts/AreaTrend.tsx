'use client';

import type { EChartsOption } from 'echarts';
import { useMemo, useState } from 'react';

import { ReactEChartsCore } from './echarts-core';
import { PALETTE } from './palette';
import { useChartInk } from './useChartInk';

export interface TrendDay {
  day: string;
  newProfiles: number;
  newExpenses: number;
  active: number;
}

enum Metric {
  NewProfiles = 'newProfiles',
  NewExpenses = 'newExpenses',
  Active = 'active',
}

const SERIES: Record<Metric, { label: string; color: string }> = {
  [Metric.NewProfiles]: { label: 'People', color: PALETTE.blue },
  [Metric.NewExpenses]: { label: 'Expenses', color: PALETTE.purple },
  [Metric.Active]: { label: 'Active', color: PALETTE.green },
};

const ORDER: Metric[] = [Metric.NewProfiles, Metric.NewExpenses, Metric.Active];

/**
 * One smooth area over the 30-day series, with a segmented switch to change
 * which count it draws. The switch is why this owns its card head rather than
 * being handed a bare `<div>`: the button state and the chart have to live on
 * the same side of the server/client line.
 */
export function AreaTrend({ days }: { days: TrendDay[] }) {
  const [metric, setMetric] = useState<Metric>(Metric.NewProfiles);
  const ink = useChartInk();
  const active = SERIES[metric];
  const summary = describeTrend(days, metric, active.label);

  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 4, right: 12, top: 12, bottom: 0, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: ink.tooltipBg,
        borderColor: ink.tooltipBorder,
        textStyle: { color: ink.ink, fontSize: 12 },
        axisPointer: { type: 'line', lineStyle: { color: ink.line } },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: days.map((d) => d.day.slice(5)), // MM-DD; the year is the same 30 days
        axisLine: { lineStyle: { color: ink.line } },
        axisTick: { show: false },
        axisLabel: { color: ink.label, fontSize: 11, interval: 4 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: ink.grid } },
        axisLabel: { color: ink.label, fontSize: 11 },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'none',
          name: active.label,
          data: days.map((d) => d[metric]),
          lineStyle: { width: 2, color: active.color },
          itemStyle: { color: active.color },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${active.color}45` },
                { offset: 1, color: `${active.color}00` },
              ],
            },
          },
        },
      ],
    }),
    [active.color, active.label, days, ink, metric],
  );

  return (
    <>
      <div className="card-head">
        <div>
          <div className="eyebrow">Last 30 days</div>
          <h3>Activity</h3>
        </div>
        <div className="seg" role="group" aria-label="Which series to draw">
          {ORDER.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
            >
              {SERIES[key].label}
            </button>
          ))}
        </div>
      </div>
      <figure className="echart" role="img" aria-label={summary}>
        <ReactEChartsCore
          option={option}
          style={{ height: 260 }}
          opts={{ renderer: 'svg' }}
          notMerge
        />
        <figcaption className="sr-only">{summary}</figcaption>
      </figure>
    </>
  );
}

function describeTrend(days: readonly TrendDay[], metric: Metric, label: string): string {
  if (days.length === 0) return `${label}: no data`;
  const total = days.reduce((sum, day) => sum + day[metric], 0);
  const peak = days.reduce((best, day) => (day[metric] > best[metric] ? day : best), days[0]!);
  return `${label}: ${total.toLocaleString('en-IN')} across ${days.length} days, highest ${peak.day} with ${peak[metric].toLocaleString('en-IN')}`;
}
