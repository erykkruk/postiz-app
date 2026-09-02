import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/**
 * A local copy of how each published post performed.
 *
 * Same reasoning as the inbox: the views read only from here, so they open on
 * ready rows instead of waiting on a dozen Graph API calls. Freshness is the
 * cron's job.
 */
@Injectable()
export class PostStatsRepository {
  constructor(
    private _stats: PrismaRepository<'postStat'>,
    private _days: PrismaRepository<'postStatDay'>
  ) {}

  /**
   * Keeps one row per publication per day.
   *
   * PostStat only ever holds the latest reading, so without this there is no way
   * to draw how the numbers grew: no platform hands back a history, which makes
   * writing one down from today the only option.
   */
  saveDay(
    org: string,
    integrationId: string,
    releaseId: string,
    metrics: any
  ) {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);

    return this._days.model.postStatDay.upsert({
      where: {
        integrationId_releaseId_day: { integrationId, releaseId, day },
      },
      create: { organizationId: org, integrationId, releaseId, day, metrics },
      update: { metrics },
    });
  }

  /**
   * Posts whose numbers are worth asking the platform about again.
   *
   * Refresh rate follows the age of the post, because that is how the numbers
   * behave: a reel published an hour ago is still climbing, one from spring is
   * finished. Without this the hourly cron would re-read every post we ever
   * made - hundreds of calls to Meta each hour, which is exactly the kind of
   * traffic that got the ad account flagged before.
   */
  async due(limit: number) {
    const hoursAgo = (hours: number) =>
      new Date(Date.now() - hours * 60 * 60 * 1000);

    const staleFor = (maxAgeHours: number | null, intervalHours: number) => ({
      ...(maxAgeHours === null
        ? {}
        : { publishedAt: { gte: hoursAgo(maxAgeHours) } }),
      OR: [
        { fetchedAt: null },
        { fetchedAt: { lt: hoursAgo(intervalHours) } },
      ],
    });

    return this._stats.model.postStat.findMany({
      where: {
        OR: [
          // First two days: hourly, this is when a post is actually moving.
          staleFor(48, 1),
          // Up to two weeks: four times a day.
          {
            AND: [
              { publishedAt: { lt: hoursAgo(48) } },
              staleFor(24 * 14, 6),
            ],
          },
          // Up to two months: daily.
          {
            AND: [
              { publishedAt: { lt: hoursAgo(24 * 14) } },
              staleFor(24 * 60, 24),
            ],
          },
          // Older than that: weekly, just to keep totals honest.
          {
            AND: [
              { publishedAt: { lt: hoursAgo(24 * 60) } },
              staleFor(null, 24 * 7),
            ],
          },
        ],
      },
      // A publication we have never read comes first, then whichever was read
      // longest ago. Ordering by publication date alone starved everything that
      // was not brand new: the newest sixty filled the batch every hour, so the
      // rows behind them - the older ads especially - were never reached at all.
      orderBy: [
        { fetchedAt: { sort: 'asc', nulls: 'first' } },
        { publishedAt: 'desc' },
      ],
      take: limit,
    });
  }

  /**
   * Registers a published post so the cron knows to fetch numbers for it.
   * Called with the calendar's own rows, so it never invents a publication.
   */
  register(
    org: string,
    integrationId: string,
    releaseId: string,
    postId: string,
    publishedAt: Date
  ) {
    return this._stats.model.postStat.upsert({
      where: { integrationId_releaseId: { integrationId, releaseId } },
      create: {
        organizationId: org,
        integrationId,
        releaseId,
        postId,
        publishedAt,
        metrics: {},
      },
      // The post itself never changes here - only the link back to our
      // calendar row, which matters after a post is recreated.
      update: { postId, publishedAt },
    });
  }

  /**
   * A publication that is not ours to begin with - today an ad creative.
   *
   * Kept in the same table as our own posts so one query feeds the table and
   * the totals. `source` is what tells them apart, and `label` stands in for
   * the post text an ad never had.
   */
  registerExternal(
    org: string,
    integrationId: string,
    releaseId: string,
    publishedAt: Date,
    label: string,
    source = 'paid'
  ) {
    return this._stats.model.postStat.upsert({
      where: { integrationId_releaseId: { integrationId, releaseId } },
      create: {
        organizationId: org,
        integrationId,
        releaseId,
        publishedAt,
        label,
        source,
        metrics: {},
      },
      // A creative can be renamed, and the same post can be promoted after we
      // published it organically - in that case it keeps its own row and only
      // gains the ad name.
      update: { label },
    });
  }

  /** Which publications are already registered, as "integrationId:releaseId". */
  async knownReleaseIds(integrationIds: string[]) {
    const rows = await this._stats.model.postStat.findMany({
      where: { integrationId: { in: [...new Set(integrationIds)] } },
      select: { integrationId: true, releaseId: true },
    });

    return new Set(
      rows.map((row: any) => `${row.integrationId}:${row.releaseId}`)
    );
  }

  saveMetrics(
    integrationId: string,
    releaseId: string,
    metrics: any,
    error?: string
  ) {
    return this._stats.model.postStat.updateMany({
      where: { integrationId, releaseId },
      data: {
        // A failed read keeps the previous numbers: an expired token would
        // otherwise wipe a month of history from the totals.
        ...(error ? {} : { metrics }),
        fetchedAt: new Date(),
        lastError: error || null,
      },
    });
  }

  forPost(org: string, postIds: string[]) {
    return this._stats.model.postStat.findMany({
      where: { organizationId: org, postId: { in: postIds } },
    });
  }

  list(org: string, from: Date, to: Date, integrationIds?: string[]) {
    return this._stats.model.postStat.findMany({
      where: {
        organizationId: org,
        publishedAt: { gte: from, lte: to },
        ...(integrationIds?.length
          ? { integrationId: { in: integrationIds } }
          : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: 1000,
    });
  }
}
