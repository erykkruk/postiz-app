'use client';

import { FC, useEffect, useMemo, useRef } from 'react';
import DrawChart from 'chart.js/auto';
import dayjs from 'dayjs';
import useCookie from 'react-use-cookie';

// Categorical hues in a fixed order, one per channel. Both columns are the same
// eight hues stepped for their surface, checked against Postiz's own chart
// background (#1e1d1d dark, #f5f7f9 light) for colour-blind separation and
// contrast - not picked by eye.
const SERIES_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];

const SERIES_LIGHT = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
];

// Past eight lines a chart stops being readable and the ninth hue would have to
// be invented, so the tail is summed into one neutral line instead.
const MAX_SERIES = SERIES_DARK.length;
const OTHER_DARK = '#8b8b8b';
const OTHER_LIGHT = '#6b6b6b';

export type ChartItem = {
  publishedAt: string;
  channel?: { id: string; name: string; provider?: string };
  metrics: Record<string, any>;
};

// Channels can carry the same name on two platforms ("Buzzin: TV show" exists
// as both a Facebook page and a YouTube channel), and in a legend those two
// entries would be indistinguishable.
const PLATFORM_SHORT: Record<string, string> = {
  facebook: 'FB',
  instagram: 'IG',
  'instagram-standalone': 'IG',
  youtube: 'YT',
  'linkedin-page': 'LI',
  pinterest: 'PIN',
  threads: 'TH',
  x: 'X',
  gmb: 'GMB',
};

const seriesLabel = (name: string, provider?: string) => {
  const short = provider
    ? PLATFORM_SHORT[provider] || provider.slice(0, 2).toUpperCase()
    : '';

  return short ? `${name} · ${short}` : name;
};

// Writes the channel name at the end of its line. With four or fewer lines the
// legend alone would make the reader match colours back and forth.
const endLabels = {
  id: 'endLabels',
  afterDatasetsDraw(chart: any) {
    if (chart.data.datasets.length > 4) {
      return;
    }

    const { ctx } = chart;
    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'middle';

    chart.data.datasets.forEach((dataset: any, index: number) => {
      const meta = chart.getDatasetMeta(index);
      const last = [...(meta.data || [])]
        .reverse()
        .find((point: any) => point && !isNaN(point.y));

      if (!last) {
        return;
      }

      ctx.fillStyle = dataset.borderColor;
      ctx.fillText(dataset.label, Math.min(last.x + 6, chart.width - 60), last.y);
    });

    ctx.restore();
  },
};

export const PostsChart: FC<{
  items: ChartItem[];
  // Channel ids in the order of the list on the left. Colour is handed out by
  // this order, not by who scored highest, so changing the date range or
  // unticking a channel never repaints the ones that stayed.
  channelOrder: string[];
  from: string;
  to: string;
  metric: string;
  metricLabel: string;
  cumulative: boolean;
}> = ({ items, channelOrder, from, to, metric, metricLabel, cumulative }) => {
  const [mode] = useCookie('mode', 'dark');
  const isDark = mode !== 'light';
  const canvas = useRef<any>(null);
  const chart = useRef<null | DrawChart>(null);

  const { labels, datasets } = useMemo(() => {
    const palette = isDark ? SERIES_DARK : SERIES_LIGHT;
    const start = dayjs(from).startOf('day');
    const end = dayjs(to).startOf('day');

    const days: string[] = [];
    for (let d = start; !d.isAfter(end); d = d.add(1, 'day')) {
      days.push(d.format('YYYY-MM-DD'));
    }

    const names = new Map<string, string>();
    const perChannel = new Map<string, Map<string, number>>();

    for (const item of items) {
      const id = item.channel?.id;
      const value = item.metrics?.[metric];

      if (!id || typeof value !== 'number') {
        continue;
      }

      if (!perChannel.has(id)) {
        perChannel.set(id, new Map());
        names.set(
          id,
          seriesLabel(item.channel!.name, item.channel!.provider)
        );
      }

      const day = dayjs(item.publishedAt).format('YYYY-MM-DD');
      const bucket = perChannel.get(id)!;
      bucket.set(day, (bucket.get(day) || 0) + value);
    }

    const series = (bucket: Map<string, number>) => {
      let running = 0;
      return days.map((day) => {
        const value = bucket.get(day) || 0;
        running += value;
        return cumulative ? running : value;
      });
    };

    const order = channelOrder.filter((id) => perChannel.has(id));
    const named = order.slice(0, MAX_SERIES);
    const rest = order.slice(MAX_SERIES);

    const datasets = named.map((id, index) => ({
      label: names.get(id) || id,
      data: series(perChannel.get(id)!),
      borderColor: palette[index],
      backgroundColor: palette[index],
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.25,
    }));

    if (rest.length) {
      const merged = new Map<string, number>();
      for (const id of rest) {
        for (const [day, value] of perChannel.get(id)!) {
          merged.set(day, (merged.get(day) || 0) + value);
        }
      }

      datasets.push({
        label: `Other (${rest.length})`,
        data: series(merged),
        borderColor: isDark ? OTHER_DARK : OTHER_LIGHT,
        backgroundColor: isDark ? OTHER_DARK : OTHER_LIGHT,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.25,
      });
    }

    return { labels: days, datasets };
  }, [items, channelOrder, from, to, metric, cumulative, isDark]);

  useEffect(() => {
    if (!canvas.current) {
      return;
    }

    const ink = isDark ? '#c3c2b7' : '#4a4a4a';
    const grid = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

    chart.current = new DrawChart(canvas.current, {
      type: 'line',
      plugins: [endLabels],
      options: {
        maintainAspectRatio: false,
        responsive: true,
        // A crosshair reading of every channel on one day, which is the
        // comparison the chart exists for.
        interaction: { mode: 'index', intersect: false },
        // Room for the end labels, which only exist at four series or fewer -
        // reserving it always would leave a bare strip on the right.
        layout: { padding: { right: datasets.length <= 4 ? 60 : 8 } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: ink },
            grid: { color: grid },
          },
          x: {
            ticks: {
              color: ink,
              maxTicksLimit: 10,
              callback(value: any) {
                const label = this.getLabelForValue(value);
                return dayjs(label).format('DD.MM');
              },
            },
            grid: { display: false },
          },
        },
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              color: ink,
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
              pointStyle: 'line',
            },
          },
          tooltip: {
            callbacks: {
              title: (rows: any) =>
                dayjs(rows[0]?.label).format('DD.MM.YYYY'),
            },
          },
        },
      },
      data: { labels, datasets },
    });

    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
  }, [labels, datasets, isDark, metricLabel]);

  if (!datasets.length) {
    return (
      <div className="h-[300px] flex items-center justify-center text-[#8B8B8B]">
        No channel reports {metricLabel.toLowerCase()} in this range.
      </div>
    );
  }

  return (
    <div className="h-[300px]">
      <canvas ref={canvas} />
    </div>
  );
};
