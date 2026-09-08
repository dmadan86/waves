'use client';

import type { EChartsOption } from 'echarts';
import { useMemo } from 'react';

import { ReactEChartsCore } from './echarts-core';
import { WHEEL } from './palette';
import { useChartInk } from './useChartInk';

export interface Slice {
  name: string;
  value: number;
}

/**
 * A doughnut with the total in the hole.
 *
 * Client-only because ECharts needs the DOM to size and paint. The Server
 * Component that renders the surrounding card computes the slices and hands
 * them down as a plain, serialisable array — no echarts import crosses onto
 * the server, no data fetching crosses onto the client.
 */
export function DonutChart({
  slices,
  centerLabel,
  unit,
}: {
  slices: Slice[];
  centerLabel: string;
  unit?: string;
}) {
  const ink = useChartInk();
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const summary = describeSlices(slices, centerLabel, unit);

  const option = useMemo<EChartsOption>(
    () => ({
      color: [...WHEEL],
      tooltip: {
        trigger: 'item',
        backgroundColor: ink.tooltipBg,
        borderColor: ink.tooltipBorder,
        textStyle: { color: ink.ink, fontSize: 12 },
        formatter: (p: unknown) => {
          const point = p as { name: string; value: number; percent: number };
          return `${point.name}<br/><b>${point.value.toLocaleString('en-IN')}</b>${
            unit ? ` ${unit}` : ''
          } · ${point.percent}%`;
        },
      },
      legend: {
        orient: 'vertical',
        right: 4,
        top: 'center',
        itemWidth: 9,
        itemHeight: 9,
        icon: 'circle',
        textStyle: { color: ink.label, fontSize: 12 },
      },
      series: [
        {
          type: 'pie',
          radius: ['58%', '80%'],
          center: ['34%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: { borderRadius: 4, borderColor: ink.tooltipBg, borderWidth: 2 },
          label: {
            show: true,
            position: 'center',
            formatter: () => `{v|${total.toLocaleString('en-IN')}}
{l|${centerLabel}}`,
            rich: {
              v: { fontSize: 22, fontWeight: 700, color: ink.ink },
              l: { fontSize: 12, color: ink.label, padding: [4, 0, 0, 0] },
            },
          },
          emphasis: { label: { show: true }, scaleSize: 4 },
          labelLine: { show: false },
          data: slices,
        },
      ],
    }),
    [centerLabel, ink, slices, total, unit],
  );

  return (
    <figure className="echart" role="img" aria-label={summary}>
      <ReactEChartsCore
        option={option}
        style={{ height: 260 }}
        opts={{ renderer: 'svg' }}
        notMerge
      />
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

function describeSlices(
  slices: readonly Slice[],
  centerLabel: string,
  unit: string | undefined,
): string {
  if (slices.length === 0) return `${centerLabel}: no data`;
  const suffix = unit ? ` ${unit}` : '';
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const largest = slices.reduce(
    (best, slice) => (slice.value > best.value ? slice : best),
    slices[0]!,
  );
  return `${centerLabel}: ${total.toLocaleString('en-IN')}${suffix} across ${slices.length} slices, largest ${largest.name} with ${largest.value.toLocaleString('en-IN')}${suffix}`;
}
