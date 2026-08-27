import React, { FC, Fragment, useCallback } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  RETENTION_MARK,
  formatWatchTime,
  retentionAt,
} from '@gitroom/frontend/components/platform-analytics/post-metrics';

// The same fields the analytics table shows, in the same order, so a number
// means the same thing wherever it is read.
const TILES: Array<{ key: string; label: string }> = [
  { key: 'views', label: 'Views' },
  { key: 'reach', label: 'Reach' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'saves', label: 'Saves' },
  { key: 'interactions', label: 'Interactions' },
  { key: 'followersGained', label: 'Followers' },
  { key: 'replays', label: 'Replays' },
];

export const StatisticsModal: FC<{
  postId: string;
}> = (props) => {
  const { postId } = props;
  const t = useT();
  const fetch = useFetch();
  const loadStatistics = useCallback(async () => {
    return (await fetch(`/posts/${postId}/statistics`)).json();
  }, [postId]);
  const { data, isLoading } = useSWR(
    `/posts/${postId}/statistics`,
    loadStatistics
  );

  if (isLoading) {
    return <div>{t('loading', 'Loading')}</div>;
  }

  const platform = data?.platform;
  const metrics = platform?.metrics || {};
  const tiles = TILES.filter(
    (tile) => typeof metrics[tile.key] === 'number'
  );
  const retention = metrics.retention;

  return (
    <div className="relative flex flex-col gap-[20px] mt-[20px]">
      {!platform ? (
        <div className="text-[#8B8B8B]">
          {t(
            'no_platform_statistics_yet',
            'No platform statistics yet. Numbers are collected in the background after a post is published.'
          )}
        </div>
      ) : (
        <>
          {!!platform.error && (
            <div className="text-[13px] text-red-400">{platform.error}</div>
          )}

          {!tiles.length && !platform.error ? (
            <div className="text-[#8B8B8B]">
              {t(
                'platform_reported_nothing',
                'This platform reports no numbers for this post.'
              )}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-[12px]">
              {tiles.map((tile) => (
                <div
                  key={tile.key}
                  className="bg-newTableHeader rounded-[8px] py-[12px] px-[16px] flex flex-col gap-[4px]"
                >
                  <div className="text-[13px] text-[#8B8B8B]">{tile.label}</div>
                  <div className="text-[28px] leading-[34px]">
                    {Math.round(metrics[tile.key]).toLocaleString('pl-PL')}
                  </div>
                </div>
              ))}
              {typeof metrics.avgWatchMs === 'number' && (
                <div className="bg-newTableHeader rounded-[8px] py-[12px] px-[16px] flex flex-col gap-[4px]">
                  <div className="text-[13px] text-[#8B8B8B]">
                    {t('avg_watch_time', 'Avg watch time')}
                  </div>
                  <div className="text-[28px] leading-[34px]">
                    {formatWatchTime(metrics.avgWatchMs)}
                  </div>
                </div>
              )}
            </div>
          )}

          {!!retention?.length && (
            <div className="bg-newTableHeader rounded-[8px] p-[16px] flex flex-col gap-[10px]">
              <div className="flex items-baseline gap-[10px]">
                <div className="text-[18px]">
                  {t('retention', 'Retention')}
                </div>
                <div className="text-[13px] text-[#8B8B8B]">
                  {t('still_watching_at', 'still watching at')}{' '}
                  {Math.round(RETENTION_MARK * 100)}%:{' '}
                  {formatRatio(retentionAt(retention, RETENTION_MARK))}
                </div>
              </div>
              <RetentionCurve points={retention} />
            </div>
          )}

          {!!platform.fetchedAt && (
            <div className="text-[11px] text-[#8B8B8B]">
              {t('updated', 'Updated')}{' '}
              {dayjs(platform.fetchedAt).format('DD.MM.YYYY HH:mm')}
            </div>
          )}
        </>
      )}

      {!!data?.clicks?.length && (
        <div className="grid grid-cols-3">
          <div className="bg-forth p-[4px] rounded-tl-lg">
            {t('short_link', 'Short Link')}
          </div>
          <div className="bg-forth p-[4px]">
            {t('original_link', 'Original Link')}
          </div>
          <div className="bg-forth p-[4px] rounded-tr-lg">
            {t('clicks', 'Clicks')}
          </div>
          {data.clicks.map((p: any) => (
            <Fragment key={p.short}>
              <div className="p-[4px] py-[10px] bg-customColor6">{p.short}</div>
              <div className="p-[4px] py-[10px] bg-customColor6">
                {p.original}
              </div>
              <div className="p-[4px] py-[10px] bg-customColor6">
                {p.clicks}
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

const formatRatio = (ratio: number | null) =>
  ratio === null ? '-' : `${Math.round(ratio * 100)}%`;

/**
 * The retention curve as a plain SVG.
 *
 * Deliberately not the shared chart component: this axis is the length of one
 * video, not a calendar, and the interesting part is the shape of the drop
 * rather than any single value.
 */
const RetentionCurve: FC<{ points: Array<{ second: number; ratio: number }> }> = ({
  points,
}) => {
  const sorted = [...points].sort((a, b) => a.second - b.second);
  const lastSecond = sorted[sorted.length - 1]?.second || 1;
  const highest = Math.max(...sorted.map((p) => p.ratio), 1);

  const width = 600;
  const height = 120;

  const path = sorted
    .map((point, index) => {
      const x = (point.second / lastSecond) * width;
      const y = height - (point.ratio / highest) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-[120px]"
      >
        <line
          x1={width * RETENTION_MARK}
          y1="0"
          x2={width * RETENTION_MARK}
          y2={height}
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeDasharray="4 4"
        />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      <div className="flex justify-between text-[11px] text-[#8B8B8B]">
        <span>0</span>
        <span>{lastSecond <= 1 ? '100%' : `${Math.round(lastSecond)}s`}</span>
      </div>
    </div>
  );
};
