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
  metrics: Record<string, any>;
};

// Order matters: this is the order of the tiles and of the table columns.
const COLUMNS = [
  { key: 'views', label: 'Views' },
  { key: 'reach', label: 'Reach' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'saves', label: 'Saves' },
  { key: 'followersGained', label: 'Followers' },
] as const;

const number = (value?: number) =>
  typeof value === 'number' ? Math.round(value).toLocaleString('pl-PL') : '-';

export const PostsAnalytics: FC<{
  integrations: Array<{ id: string; name: string; identifier: string }>;
  date: number;
}> = (props) => {
  const { integrations, date } = props;
  const fetch = useFetch();
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({
    key: 'publishedAt',
    desc: true,
  });

  const ids = integrations.map((i) => i.id);

  const load = useCallback(async () => {
    const from = dayjs().subtract(date, 'day').toISOString();
    const to = dayjs().toISOString();

    return (
      await fetch(
        `/posts/stats/report?from=${from}&to=${to}&integrations=${ids.join(',')}`
      )
    ).json();
  }, [ids.join(','), date]);

  const { data, isLoading } = useSWR(
    `post-stats-${ids.join(',')}-${date}`,
    load,
    { revalidateOnFocus: false }
  );

  const items: Item[] = data?.items || [];
  const totals: Totals = data?.totals || {};

  const rows = useMemo(() => {
    const value = (item: Item) =>
      sort.key === 'publishedAt'
        ? new Date(item.publishedAt).getTime()
        : sort.key === 'retention'
        ? retentionAt(item.metrics?.retention, RETENTION_MARK) ?? -1
        : typeof item.metrics?.[sort.key] === 'number'
        ? item.metrics[sort.key]
        : -1;

    return [...items].sort((a, b) =>
      sort.desc ? value(b) - value(a) : value(a) - value(b)
    );
  }, [items, sort]);

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

  if (isLoading || !data) {
    return <LoadingComponent />;
  }

  if (!items.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#8B8B8B]">
        No published posts with statistics in this range yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[20px]">
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
              <div className="text-[14px] text-[#8B8B8B]">{column.label}</div>
              <div className="text-[32px] leading-[38px]">
                {number(total.value)}
              </div>
              {/* Says how much of the selection this total actually covers -
                  a platform that reports nothing must not read as a zero. */}
              <div className="text-[11px] text-[#8B8B8B]">
                from {total.posts} of {items.length} posts
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
              from {totals.avgWatchMs.posts} of {items.length} posts
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
                    {retention === null ? '-' : `${Math.round(retention * 100)}%`}
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
                  <td className="py-[8px] ps-[14px] text-end">{row.posts}</td>
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
