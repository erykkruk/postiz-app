import React, { FC, Fragment, useCallback, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ChartSocial } from '@gitroom/frontend/components/analytics/chart-social';
import { Select } from '@gitroom/react/form/select';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { MissingReleaseModal } from '@gitroom/frontend/components/launches/missing-release.modal';
import {
  RETENTION_MARK,
  formatWatchTime,
  retentionAt,
} from '@gitroom/frontend/components/platform-analytics/post-metrics';

interface AnalyticsData {
  label: string;
  data: Array<{ total: number; date: string }>;
  percentageChange: number;
  average?: boolean;
}

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
  const [dateRange, setDateRange] = useState(7);

  const loadStatistics = useCallback(async () => {
    return (await fetch(`/posts/${postId}/statistics`)).json();
  }, [postId, fetch]);

  const loadPostAnalytics = useCallback(async () => {
    return (await fetch(`/analytics/post/${postId}?date=${dateRange}`)).json();
  }, [postId, dateRange, fetch]);

  const { data: statisticsData, isLoading: isLoadingStatistics } = useSWR(
    `/posts/${postId}/statistics`,
    loadStatistics
  );

  const { data: analyticsData, isLoading: isLoadingAnalytics, mutate: mutateAnalytics } = useSWR(
    `/analytics/post/${postId}?date=${dateRange}`,
    loadPostAnalytics,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      revalidateOnMount: true,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    }
  );

  const isMissing = analyticsData && !Array.isArray(analyticsData) && analyticsData.missing;

  const dateOptions = useMemo(() => {
    return [
      { key: 7, value: t('7_days', '7 Days') },
      { key: 30, value: t('30_days', '30 Days') },
      { key: 90, value: t('90_days', '90 Days') },
    ];
  }, [t]);

  const totals = useMemo(() => {
    if (!analyticsData || !Array.isArray(analyticsData)) return [];
    return analyticsData.map((p: AnalyticsData) => {
      const value =
        (p?.data?.reduce((acc: number, curr: any) => acc + Number(curr.total), 0) || 0) /
        (p.average ? p.data.length : 1);
      if (p.average) {
        return value.toFixed(2) + '%';
      }
      return Math.round(value);
    });
  }, [analyticsData]);

  const isLoading = isLoadingStatistics || isLoadingAnalytics;

  // Numbers our background sync collected from the platform itself, as
  // opposed to the analytics upstream fetches live above.
  const platform = statisticsData?.platform;
  const platformMetrics = platform?.metrics || {};
  const tiles = TILES.filter(
    (tile) => typeof platformMetrics[tile.key] === 'number'
  );
  const retention = platformMetrics.retention;

  return (
    <div className="relative min-h-[200px]">
      {isLoading ? (
        <div className="flex items-center justify-center py-[40px]">
          <LoadingComponent />
        </div>
      ) : isMissing ? (
        <MissingReleaseModal postId={postId} onSuccess={() => mutateAnalytics()} />
      ) : (
        <div className="flex flex-col gap-[24px]">
          {/* Platform Statistics Section */}
          {!!platform && (
            <div className="flex flex-col gap-[14px]">
              <h3 className="text-[18px] font-[500]">
                {t('platform_statistics', 'Platform Statistics')}
              </h3>
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
                        {Math.round(platformMetrics[tile.key]).toLocaleString('pl-PL')}
                      </div>
                    </div>
                  ))}
                  {typeof platformMetrics.avgWatchMs === 'number' && (
                    <div className="bg-newTableHeader rounded-[8px] py-[12px] px-[16px] flex flex-col gap-[4px]">
                      <div className="text-[13px] text-[#8B8B8B]">
                        {t('avg_watch_time', 'Avg watch time')}
                      </div>
                      <div className="text-[28px] leading-[34px]">
                        {formatWatchTime(platformMetrics.avgWatchMs)}
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
            </div>
          )}

          {/* Post Analytics Section */}
          {analyticsData && Array.isArray(analyticsData) && analyticsData.length > 0 && (
            <div className="flex flex-col gap-[14px]">
              <div className="flex items-center justify-between">
                <h3 className="text-[18px] font-[500]">
                  {t('post_analytics', 'Post Analytics')}
                </h3>
                <div className="max-w-[150px]">
                  <Select
                    label=""
                    name="date"
                    disableForm={true}
                    hideErrors={true}
                    value={dateRange}
                    onChange={(e) => setDateRange(+e.target.value)}
                  >
                    {dateOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.value}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[16px]">
                {analyticsData.map((p: AnalyticsData, index: number) => {
                  const colorVariants = ['purple', 'green', 'blue'] as const;
                  const color = colorVariants[index % colorVariants.length];
                  return (
                    <div key={`analytics-${index}`} className="group">
                      <div className="flex flex-col h-full bg-newTableHeader border border-newTableBorder rounded-[12px] overflow-hidden transition-all duration-200 hover:border-[#612bd3]/50">
                        <div className="flex items-center justify-between px-[16px] pt-[14px] pb-[8px]">
                          <div className="flex items-center gap-[10px]">
                            <div
                              className={`w-[8px] h-[8px] rounded-full ${
                                color === 'purple' ? 'bg-[#612bd3]' : ''
                              } ${color === 'green' ? 'bg-[#32d583]' : ''} ${
                                color === 'blue' ? 'bg-[#1d9bf0]' : ''
                              }`}
                            />
                            <span className="text-[15px] font-medium text-newTableText">
                              {p.label}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1 px-[12px] py-[8px]">
                          <div className="h-[120px] relative">
                            <ChartSocial data={p.data} color={color} key={`chart-${index}`} />
                          </div>
                        </div>
                        <div className="px-[16px] pb-[14px]">
                          <div className="text-[36px] leading-[42px] font-semibold tracking-tight">
                            {totals[index]}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Short Links Statistics Section */}
          <div className="flex flex-col gap-[14px]">
            <h3 className="text-[18px] font-[500]">
              {t('short_links_statistics', 'Short Links Statistics')}
            </h3>
            {statisticsData?.clicks?.length === 0 ? (
              <div className="text-gray-400">
                {t('no_short_link_results', 'No short link results')}
              </div>
            ) : (
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
                {statisticsData?.clicks?.map((p: any) => (
                  <Fragment key={p.short}>
                    <div className="p-[4px] py-[10px] bg-customColor6">
                      {p.short}
                    </div>
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

          {/* No analytics available message */}
          {(!analyticsData || !Array.isArray(analyticsData) || analyticsData.length === 0) &&
            (!statisticsData?.clicks || statisticsData.clicks.length === 0) &&
            !platform && (
              <div className="text-center text-gray-400 py-[20px]">
                {t('no_statistics_available', 'No statistics available for this post')}
              </div>
            )}
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
