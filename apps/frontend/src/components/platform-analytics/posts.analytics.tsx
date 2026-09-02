'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  RETENTION_MARK,
  formatWatchTime,
  retentionAt,
} from '@gitroom/frontend/components/platform-analytics/post-metrics';
import { PostsChart } from '@gitroom/frontend/components/platform-analytics/posts.chart';

type Totals = Record<string, { value: number; posts: number }>;

type Item = {
  id: string;
  postId?: string;
  publishedAt: string;
  fetchedAt?: string;
  error?: string;
  channel?: { id: string; name: string; provider: string };
  preview: string;
  url?: string;
  // "paid" rows are ad creatives found in the ad account: they never passed
  // through the calendar, so they carry the creative name instead of post text.
  source?: string;
  label?: string;
  metrics: Record<string, any>;
};

// Order matters: this is the order of the tiles, the table columns and the
// metric picker above the chart.
const COLUMNS = [
  { key: 'views', label: 'Views' },
  { key: 'reach', label: 'Reach' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'saves', label: 'Saves' },
  { key: 'followersGained', label: 'Followers' },
] as const;

// Organic and promoted posts live in one table, because the question is nearly
// always "what worked", not "which of the two lists it came from".
const SOURCES = [
  { key: 'all', label: 'All posts' },
  { key: 'organic', label: 'Organic' },
  { key: 'paid', label: 'Ads' },
] as const;

const RANGES = [
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: '180', label: 'Last 180 days' },
  { key: 'custom', label: 'Custom' },
] as const;

/**
 * Adds up the metrics of the posts on screen.
 *
 * A field a platform never reported is skipped rather than counted as zero, and
 * each total says how many posts it covers - otherwise a column only Instagram
 * fills would read as if the whole account underperformed. Watch time is an
 * average, so it is averaged rather than summed.
 */
const sumMetrics = (all: Array<Record<string, any>>) => {
  const totals: Totals = {};

  for (const field of [
    'views',
    'reach',
    'likes',
    'comments',
    'shares',
    'saves',
    'interactions',
    'followersGained',
    'replays',
    'totalWatchMs',
  ]) {
    const values = all
      .map((metrics) => metrics?.[field])
      .filter((value): value is number => typeof value === 'number');

    if (values.length) {
      totals[field] = {
        value: values.reduce((a, b) => a + b, 0),
        posts: values.length,
      };
    }
  }

  const watched = all
    .map((metrics) => metrics?.avgWatchMs)
    .filter((value): value is number => typeof value === 'number');

  if (watched.length) {
    totals.avgWatchMs = {
      value: Math.round(watched.reduce((a, b) => a + b, 0) / watched.length),
      posts: watched.length,
    };
  }

  return totals;
};

const number = (value?: number) =>
  typeof value === 'number' ? Math.round(value).toLocaleString('pl-PL') : '-';

export const PostsAnalytics: FC<{
  integrations: Array<{ id: string; name: string; identifier: string }>;
}> = (props) => {
  const { integrations } = props;
  const fetch = useFetch();

  const [range, setRange] = useState<string>('30');
  const [customFrom, setCustomFrom] = useState(
    dayjs().subtract(30, 'day').format('YYYY-MM-DD')
  );
  const [customTo, setCustomTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [metric, setMetric] = useState<string>('views');
  const [source, setSource] = useState<string>('all');
  const [cumulative, setCumulative] = useState(true);
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({
    key: 'publishedAt',
    desc: true,
  });

  const ids = integrations.map((i) => i.id);

  const { from, to } = useMemo(() => {
    if (range === 'custom') {
      // A range typed backwards would silently return nothing, so it is flipped.
      const a = dayjs(customFrom);
      const b = dayjs(customTo);
      return a.isAfter(b)
        ? { from: b.format('YYYY-MM-DD'), to: a.format('YYYY-MM-DD') }
        : { from: a.format('YYYY-MM-DD'), to: b.format('YYYY-MM-DD') };
    }

    return {
      from: dayjs().subtract(Number(range), 'day').format('YYYY-MM-DD'),
      to: dayjs().format('YYYY-MM-DD'),
    };
  }, [range, customFrom, customTo]);

  const load = useCallback(async () => {
    const query = new URLSearchParams({
      from: dayjs(from).startOf('day').toISOString(),
      to: dayjs(to).endOf('day').toISOString(),
      integrations: ids.join(','),
    }).toString();

    return (await fetch(`/posts/stats/report?${query}`)).json();
  }, [ids.join(','), from, to]);

  const { data, isLoading } = useSWR(
    `post-stats-${ids.join(',')}-${from}-${to}`,
    load,
    { revalidateOnFocus: false }
  );

  const items: Item[] = data?.items || [];

  const visible = useMemo(
    () =>
      source === 'all'
        ? items
        : items.filter((item) => (item.source || 'organic') === source),
    [items, source]
  );

  // Totals are summed here rather than taken from the response, so the tiles
  // always describe the same set of posts the table and the chart show.
  const totals: Totals = useMemo(
    () => sumMetrics(visible.map((item) => item.metrics)),
    [visible]
  );

  const rows = useMemo(() => {
    const value = (item: Item) =>
      sort.key === 'publishedAt'
        ? new Date(item.publishedAt).getTime()
        : sort.key === 'retention'
        ? retentionAt(item.metrics?.retention, RETENTION_MARK) ?? -1
        : typeof item.metrics?.[sort.key] === 'number'
        ? item.metrics[sort.key]
        : -1;

    return [...visible].sort((a, b) =>
      sort.desc ? value(b) - value(a) : value(a) - value(b)
    );
  }, [visible, sort]);

  const toggle = (key: string) =>
    setSort((prev) =>
      prev.key === key ? { key, desc: !prev.desc } : { key, desc: true }
    );

  if (!integrations.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#8B8B8B]">
        Select at least one channel on the left.
      </div>
    );
  }

  const metricLabel =
    COLUMNS.find((c) => c.key === metric)?.label || 'Views';

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        {RANGES.map((option) => (
          <button
            key={option.key}
            onClick={() => setRange(option.key)}
            className={clsx(
              'text-[13px] px-[12px] py-[6px] rounded-[8px]',
              range === option.key ? 'bg-customColor21' : 'bg-newTableHeader'
            )}
          >
            {option.label}
          </button>
        ))}

        {range === 'custom' && (
          <div className="flex items-center gap-[6px] text-[13px]">
            <input
              type="date"
              value={customFrom}
              max={dayjs().format('YYYY-MM-DD')}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="bg-newTableHeader rounded-[8px] px-[10px] py-[6px] outline-none"
            />
            <span className="text-[#8B8B8B]">to</span>
            <input
              type="date"
              value={customTo}
              max={dayjs().format('YYYY-MM-DD')}
              onChange={(e) => setCustomTo(e.target.value)}
              className="bg-newTableHeader rounded-[8px] px-[10px] py-[6px] outline-none"
            />
          </div>
        )}

        <span className="w-[1px] h-[20px] bg-fifth mx-[4px]" />

        {SOURCES.map((option) => (
          <button
            key={option.key}
            onClick={() => setSource(option.key)}
            className={clsx(
              'text-[13px] px-[12px] py-[6px] rounded-[8px]',
              source === option.key ? 'bg-customColor21' : 'bg-newTableHeader'
            )}
          >
            {option.label}
          </button>
        ))}

        <span className="text-[12px] text-[#8B8B8B] ms-auto">
          {dayjs(from).format('DD.MM.YYYY')} - {dayjs(to).format('DD.MM.YYYY')}
        </span>
      </div>

      {isLoading || !data ? (
        <LoadingComponent />
      ) : !visible.length ? (
        <div className="flex-1 flex items-center justify-center text-[#8B8B8B] py-[40px]">
          {items.length
            ? 'Nothing of this kind in this range.'
            : 'No published posts with statistics in this range yet.'}
        </div>
      ) : (
        <>
          <div className="bg-newTableHeader rounded-[8px] p-[16px] flex flex-col gap-[12px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <div className="text-[18px] me-[8px]">{metricLabel} over time</div>

              {COLUMNS.map((column) => (
                <button
                  key={column.key}
                  onClick={() => setMetric(column.key)}
                  className={clsx(
                    'text-[12px] px-[10px] py-[4px] rounded-[6px]',
                    metric === column.key
                      ? 'bg-customColor21'
                      : 'bg-newBgColorInner'
                  )}
                >
                  {column.label}
                </button>
              ))}

              <button
                onClick={() => setCumulative((prev) => !prev)}
                className="text-[12px] px-[10px] py-[4px] rounded-[6px] bg-newBgColorInner ms-auto"
              >
                {cumulative ? 'Cumulative' : 'Per day'}
              </button>
            </div>

            <PostsChart
              items={visible}
              channelOrder={ids}
              from={from}
              to={to}
              metric={metric}
              metricLabel={metricLabel}
              cumulative={cumulative}
            />

            {/* Says plainly what the line is, because these are lifetime numbers
                filed under the day a post went out - not a record of what each
                day looked like at the time. */}
            <div className="text-[11px] text-[#8B8B8B]">
              {cumulative
                ? `Running total of ${metricLabel.toLowerCase()} earned by everything published up to that day.`
                : `${metricLabel} earned by the posts published on that day.`}{' '}
              Each line is one channel. Figures are current lifetime totals per
              post, so a day only moves when something was published on it.
            </div>
          </div>

          <div className="grid grid-cols-4 gap-[12px]">
            {COLUMNS.map((column) => {
              const total = totals[column.key];
              if (!total) {
                return null;
              }

              return (
                <div
                  key={column.key}
                  className="bg-newTableHeader rounded-[8px] py-[12px] px-[16px] flex flex-col gap-[4px]"
                >
                  <div className="text-[14px] text-[#8B8B8B]">
                    {column.label}
                  </div>
                  <div className="text-[32px] leading-[38px]">
                    {number(total.value)}
                  </div>
                  {/* Says how much of the selection this total actually covers -
                      a platform that reports nothing must not read as a zero. */}
                  <div className="text-[11px] text-[#8B8B8B]">
                    from {total.posts} of {visible.length} posts
                  </div>
                </div>
              );
            })}
            {!!totals.avgWatchMs && (
              <div className="bg-newTableHeader rounded-[8px] py-[12px] px-[16px] flex flex-col gap-[4px]">
                <div className="text-[14px] text-[#8B8B8B]">Avg watch time</div>
                <div className="text-[32px] leading-[38px]">
                  {formatWatchTime(totals.avgWatchMs.value)}
                </div>
                <div className="text-[11px] text-[#8B8B8B]">
                  from {totals.avgWatchMs.posts} of {visible.length} posts
                </div>
              </div>
            )}
          </div>

          <div className="bg-newTableHeader rounded-[8px] p-[16px] overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[#8B8B8B]">
                  <Header
                    label="Published"
                    sortKey="publishedAt"
                    sort={sort}
                    onClick={toggle}
                    align="start"
                  />
                  <th className="text-start font-normal pb-[8px] ps-[14px]">
                    Channel
                  </th>
                  <th className="text-start font-normal pb-[8px] ps-[14px]">
                    Post
                  </th>
                  {COLUMNS.map((column) => (
                    <Header
                      key={column.key}
                      label={column.label}
                      sortKey={column.key}
                      sort={sort}
                      onClick={toggle}
                    />
                  ))}
                  <Header
                    label={`Watched ${Math.round(RETENTION_MARK * 100)}%`}
                    sortKey="retention"
                    sort={sort}
                    onClick={toggle}
                  />
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const retention = retentionAt(
                    item.metrics?.retention,
                    RETENTION_MARK
                  );

                  return (
                    <tr key={item.id} className="border-t border-fifth">
                      <td className="py-[8px] pe-[14px] whitespace-nowrap">
                        {dayjs(item.publishedAt).format('DD.MM.YYYY')}
                      </td>
                      <td className="py-[8px] ps-[14px] whitespace-nowrap">
                        {item.channel?.name || '-'}
                      </td>
                      <td className="py-[8px] ps-[14px] max-w-[320px]">
                        {item.source === 'paid' && (
                          <span className="text-[10px] uppercase tracking-wide bg-customColor21/30 border border-customColor21/40 rounded-[4px] px-[5px] py-[1px] me-[6px]">
                            Ad
                          </span>
                        )}
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {item.preview || '(no text)'}
                          </a>
                        ) : (
                          item.preview || '(no text)'
                        )}
                        {!!item.error && (
                          <div className="text-[11px] text-red-400">
                            {item.error}
                          </div>
                        )}
                      </td>
                      {COLUMNS.map((column) => (
                        <td
                          key={column.key}
                          className="py-[8px] ps-[14px] text-end whitespace-nowrap"
                        >
                          {number(item.metrics?.[column.key])}
                        </td>
                      ))}
                      <td className="py-[8px] ps-[14px] text-end whitespace-nowrap">
                        {retention === null
                          ? '-'
                          : `${Math.round(retention * 100)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!!data.perChannel?.length && (
            <div className="bg-newTableHeader rounded-[8px] p-[16px] overflow-x-auto">
              <div className="text-[18px] mb-[12px]">Per channel</div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[#8B8B8B]">
                    <th className="text-start font-normal pb-[8px]">Channel</th>
                    <th className="text-end font-normal pb-[8px] ps-[14px]">
                      Posts
                    </th>
                    {COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        className="text-end font-normal pb-[8px] ps-[14px]"
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.perChannel.map((row: any) => (
                    <tr key={row.channel.id} className="border-t border-fifth">
                      <td className="py-[8px] pe-[14px] whitespace-nowrap">
                        {row.channel.name}
                      </td>
                      <td className="py-[8px] ps-[14px] text-end">
                        {row.posts}
                      </td>
                      {COLUMNS.map((column) => (
                        <td
                          key={column.key}
                          className="py-[8px] ps-[14px] text-end"
                        >
                          {number(row.totals?.[column.key]?.value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const Header: FC<{
  label: string;
  sortKey: string;
  sort: { key: string; desc: boolean };
  onClick: (key: string) => void;
  align?: 'start' | 'end';
}> = ({ label, sortKey, sort, onClick, align = 'end' }) => (
  <th
    onClick={() => onClick(sortKey)}
    className={clsx(
      'font-normal pb-[8px] cursor-pointer select-none whitespace-nowrap',
      align === 'start' ? 'text-start' : 'text-end ps-[14px]',
      sort.key === sortKey && 'text-white'
    )}
  >
    {label}
    {sort.key === sortKey && (sort.desc ? ' v' : ' ^')}
  </th>
);
