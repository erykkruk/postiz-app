'use client';

import { FC, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { ChartSocial } from '@gitroom/frontend/components/analytics/chart-social';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';

type Point = { date: string; total: number };
type Metric = { label: string; average?: boolean; data: Point[] };

// Inbox metrics are computed from our own database rather than the platforms, so
// "how many people write to us" works the same on every channel and costs no API quota.
const INBOX_METRICS = {
  comment: 'Comments from people',
  message: 'Messages from people',
  people: 'People who wrote to us',
} as const;

const day = (iso: string) => dayjs(iso).format('YYYY-MM-DD');

// Summed per date so one point is one day, no matter how many channels are selected.
const mergeByDate = (metrics: Metric[]): Metric[] => {
  const byLabel = new Map<
    string,
    { average: boolean; dates: Map<string, number>; sources: number }
  >();

  metrics.forEach((metric) => {
    if (!metric?.label || !Array.isArray(metric.data)) return;
    const entry = byLabel.get(metric.label) || {
      average: !!metric.average,
      dates: new Map<string, number>(),
      sources: 0,
    };
    entry.sources += 1;
    metric.data.forEach((point) => {
      const key = String(point?.date ?? '');
      if (!key) return;
      entry.dates.set(
        key,
        (entry.dates.get(key) || 0) + (Number(point.total) || 0)
      );
    });
    byLabel.set(metric.label, entry);
  });

  return Array.from(byLabel.entries()).map(([label, entry]) => ({
    label,
    average: entry.average,
    data: Array.from(entry.dates.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      // Percentages do not add up across channels - average them instead.
      .map(([date, total]) => ({
        date,
        total:
          entry.average && entry.sources > 1 ? total / entry.sources : total,
      })),
  }));
};

// An empty day scaffold, so a gap in the data does not read as a measured zero.
const fillDays = (data: Point[], days: number): Point[] => {
  const byDate = new Map(data.map((p) => [p.date, p.total]));
  const out: Point[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
    out.push({ date, total: byDate.get(date) || 0 });
  }
  return out;
};

const sum = (data: Point[]) => data.reduce((acc, p) => acc + p.total, 0);

const format = (metric: Metric) => {
  const value =
    sum(metric.data) / (metric.average ? metric.data.length || 1 : 1);
  return metric.average
    ? `${value.toFixed(2)}%`
    : Math.round(value).toLocaleString('pl-PL');
};

// Change against the previous window of the same length - without it the bare
// number says nothing about direction.
const trend = (data: Point[]) => {
  if (data.length < 4) return null;
  const half = Math.floor(data.length / 2);
  const before = sum(data.slice(0, half));
  const after = sum(data.slice(half));
  if (!before) return null;
  return Math.round(((after - before) / before) * 100);
};

export const GeneralAnalytics: FC<{
  integrations: Array<{ id: string; name: string; identifier: string }>;
  date: number;
}> = ({ integrations, date }) => {
  const fetch = useFetch();
  const ids = integrations.map((i) => i.id);

  const load = useCallback(async () => {
    const [platform, comments, conversations] = await Promise.all([
      Promise.all(
        ids.map(async (id) => {
          try {
            const res = await (
              await fetch(`/analytics/${id}?date=${date}`)
            ).json();
            return { id, metrics: (res || []) as Metric[] };
          } catch {
            return { id, metrics: [] as Metric[] };
          }
        })
      ),
      (await fetch('/inbox/db/comment')).json().catch(() => ({ items: [] })),
      (await fetch('/inbox/db/conversation'))
        .json()
        .catch(() => ({ items: [] })),
    ]);

    return {
      platform,
      comments: comments?.items || [],
      conversations: conversations?.items || [],
    };
  }, [fetch, ids.join(','), date]);

  const { data, isLoading } = useSWR(
    `general-analytics-${ids.join(',')}-${date}`,
    load,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
    }
  );

  // Comments and messages from other people, day by day, for the selected channels only.
  const inboxMetrics: Metric[] = useMemo(() => {
    if (!data) return [];
    const since = dayjs().subtract(date, 'day');
    const selected = new Set(ids);

    const bucket = (rows: any[]) => {
      const perDay = new Map<string, number>();
      const peoplePerDay = new Map<string, Set<string>>();
      rows
        .filter(
          (r) =>
            !r.isOwn &&
            selected.has(r.integrationId) &&
            dayjs(r.createdAt).isAfter(since)
        )
        .forEach((r) => {
          const key = day(r.createdAt);
          perDay.set(key, (perDay.get(key) || 0) + 1);
          const who = r.authorName || r.conversation?.participantId || r.id;
          if (!peoplePerDay.has(key)) peoplePerDay.set(key, new Set());
          peoplePerDay.get(key)!.add(String(who));
        });
      return { perDay, peoplePerDay };
    };

    const c = bucket(data.comments);
    const m = bucket(data.conversations);

    const toPoints = (map: Map<string, number>) =>
      Array.from(map.entries()).map(([date, total]) => ({ date, total }));

    const people = new Map<string, number>();
    [c.peoplePerDay, m.peoplePerDay].forEach((source) =>
      source.forEach((set, key) => {
        people.set(key, (people.get(key) || 0) + set.size);
      })
    );

    return [
      {
        label: INBOX_METRICS.comment,
        data: fillDays(toPoints(c.perDay), date),
      },
      {
        label: INBOX_METRICS.message,
        data: fillDays(toPoints(m.perDay), date),
      },
      { label: INBOX_METRICS.people, data: fillDays(toPoints(people), date) },
    ];
  }, [data, ids.join(','), date]);

  const metrics = useMemo(() => {
    if (!data) return [];
    const platform = mergeByDate(data.platform.flatMap((p) => p.metrics));
    return [...platform, ...inboxMetrics].filter((m) => m.data.length);
  }, [data, inboxMetrics]);

  // What a single channel contributes - the answer to "how much of this comes from where".
  const perChannel = useMemo(() => {
    if (!data) return [];
    return data.platform
      .map(({ id, metrics }) => {
        const channel = integrations.find((i) => i.id === id);
        const totals: Record<string, number> = {};
        metrics.forEach((m) => {
          if (!m?.label || m.average) return;
          totals[m.label] = (totals[m.label] || 0) + sum(m.data || []);
        });
        return {
          id,
          name: channel?.name || id,
          identifier: channel?.identifier,
          totals,
        };
      })
      .filter((row) => Object.keys(row.totals).length);
  }, [data, integrations]);

  const columns = useMemo(
    () =>
      Array.from(
        new Set(perChannel.flatMap((row) => Object.keys(row.totals)))
      ).sort(),
    [perChannel]
  );

  if (!integrations.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#8B8B8B]">
        Select at least one channel on the left.
      </div>
    );
  }

  if (isLoading || !data) {
    return <LoadingComponent />;
  }

  if (!metrics.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#8B8B8B]">
        No data for the selected channels.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="grid grid-cols-3 gap-[20px]">
        {metrics.map((metric, index) => {
          const change = trend(metric.data);
          return (
            <div key={`${metric.label}-${index}`} className="flex">
              <div className="flex-1 bg-newTableHeader rounded-[8px] py-[10px] px-[16px] gap-[10px] flex flex-col">
                <div className="flex items-center gap-[10px]">
                  <div className="text-[20px]">{metric.label}</div>
                  {change !== null && (
                    <span
                      className={`text-[12px] ${
                        change >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}
                      title="Second half of the range vs the first half"
                    >
                      {change >= 0 ? '+' : ''}
                      {change}%
                    </span>
                  )}
                </div>
                <div className="flex-1">
                  <div className="h-[156px] relative">
                    <ChartSocial
                      data={metric.data}
                      key={`general-${metric.label}-${date}`}
                    />
                  </div>
                </div>
                <div className="text-[50px] leading-[60px]">
                  {format(metric)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!!perChannel.length && (
        <div className="bg-newTableHeader rounded-[8px] p-[16px] overflow-x-auto">
          <div className="text-[18px] mb-[12px]">Per channel</div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[#8B8B8B] text-start">
                <th className="text-start font-normal pb-[8px]">Channel</th>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="text-end font-normal pb-[8px] ps-[14px]"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perChannel.map((row) => (
                <tr key={row.id} className="border-t border-fifth">
                  <td className="py-[8px] pe-[14px] whitespace-nowrap">
                    {row.name}
                  </td>
                  {columns.map((column) => (
                    <td key={column} className="py-[8px] ps-[14px] text-end">
                      {Math.round(row.totals[column] || 0).toLocaleString(
                        'pl-PL'
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
