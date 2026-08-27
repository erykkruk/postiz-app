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
  constructor(private _stats: PrismaRepository<'postStat'>) {}

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
      orderBy: { publishedAt: 'desc' },
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
