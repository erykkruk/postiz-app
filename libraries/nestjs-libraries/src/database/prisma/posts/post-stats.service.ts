import { Injectable } from '@nestjs/common';
import { PostStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/post-stats.repository';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Organization } from '@prisma/client';
import { timer } from '@gitroom/helpers/utils/timer';
import { PostStatMetrics } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

// Statistics are never urgent, so reads are spaced out. This is the difference
// between traffic that looks like a person opening their own page and the burst
// that got the Meta account flagged for "automation imitating human activity".
const PAUSE_BETWEEN_POSTS_MS = 1200;

// Ceiling per cron run. At the pace above a full batch still finishes well
// inside its hour, and the age-based schedule means a normal run is far smaller.
const POSTS_PER_RUN = 60;

@Injectable()
export class PostStatsService {
  constructor(
    private _postStatsRepository: PostStatsRepository,
    private _integrationRepository: IntegrationRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _posts: PrismaRepository<'post'>,
    private _integrations: PrismaRepository<'integration'>
  ) {}

  /**
   * Adds published posts to the statistics table.
   *
   * Runs before every sync rather than hooking into publishing, so posts that
   * went out before this feature existed are picked up too.
   */
  async registerPublished(days = 180) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const posts = await this._posts.model.post.findMany({
      where: {
        deletedAt: null,
        releaseId: { not: null },
        publishDate: { gte: since },
        // Only the first part of a publication. The follow-ups are the comment
        // we put the link in, and Facebook would happily report the likes under
        // that comment as if it were a post of its own.
        parentPostId: null,
      },
      select: {
        id: true,
        organizationId: true,
        integrationId: true,
        releaseId: true,
        publishDate: true,
      },
    });

    // Channels whose platform reports nothing per post are left out entirely.
    // Registering them would be worse than useless: the sync skips them, so
    // their rows never get a fetchedAt, and they would sit at the top of the
    // queue forever taking slots from posts that do have numbers.
    const measurable = await this.measurableIntegrations(
      posts.map((p) => p.integrationId)
    );

    // Only what is missing. Re-registering every post each hour would be a few
    // hundred pointless writes, and the row never changes once it exists.
    const known = await this._postStatsRepository.knownReleaseIds([
      ...measurable,
    ]);

    const missing = posts.filter(
      (post) =>
        measurable.has(post.integrationId) &&
        !known.has(`${post.integrationId}:${post.releaseId}`)
    );

    for (const post of missing) {
      await this._postStatsRepository.register(
        post.organizationId,
        post.integrationId,
        post.releaseId!,
        post.id,
        post.publishDate
      );
    }

    return missing.length;
  }

  /** Of the given channels, the ones whose provider can report post numbers. */
  private async measurableIntegrations(integrationIds: string[]) {
    const rows = await this._integrations.model.integration.findMany({
      where: { id: { in: [...new Set(integrationIds)] } },
      select: { id: true, providerIdentifier: true },
    });

    return new Set(
      rows
        .filter(
          (row: any) =>
            !!this._integrationManager.getSocialIntegration(
              row.providerIdentifier
            )?.postStats
        )
        .map((row: any) => row.id)
    );
  }

  /**
   * Reads a batch of due posts from the platforms.
   *
   * Sequential on purpose. The numbers are never urgent and a burst of Graph
   * API calls is exactly what got the ad account flagged for "automation
   * imitating human activity" before.
   */
  async syncDue(limit = POSTS_PER_RUN) {
    const due = await this._postStatsRepository.due(limit);
    if (!due.length) {
      return { fetched: 0, failed: 0 };
    }

    // Channels are loaded once and reused: a token refresh per post would
    // multiply the calls we are trying to keep down.
    const integrations = new Map<string, any>();
    let fetched = 0;
    let failed = 0;

    for (const row of due) {
      try {
        if (!integrations.has(row.integrationId)) {
          integrations.set(
            row.integrationId,
            await this._integrationRepository.getIntegrationById(
              row.organizationId,
              row.integrationId
            )
          );
        }

        const integration = integrations.get(row.integrationId);
        if (!integration || integration.disabled || integration.deletedAt) {
          continue;
        }

        const provider = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );

        if (!provider?.postStats) {
          continue;
        }

        const token = await this._integrationService.freshToken(
          { id: row.organizationId } as Organization,
          integration
        );

        if (!token) {
          await this._postStatsRepository.saveMetrics(
            row.integrationId,
            row.releaseId,
            null,
            'RELOGIN'
          );
          failed++;
          continue;
        }

        const metrics = await this._integrationService.withTimeout(
          provider.postStats(
            integration.internalId,
            row.releaseId,
            token,
            integration
          ),
          60000,
          integration.name
        );

        await this._postStatsRepository.saveMetrics(
          row.integrationId,
          row.releaseId,
          this.clean(metrics)
        );
        fetched++;
      } catch (err) {
        await this._postStatsRepository.saveMetrics(
          row.integrationId,
          row.releaseId,
          null,
          this._integrationService.describeError(err)
        );
        failed++;
      }

      await timer(PAUSE_BETWEEN_POSTS_MS);
    }

    return { fetched, failed };
  }

  /** Numbers under one post in the calendar. */
  async forPosts(org: Organization, postIds: string[]) {
    const rows = await this._postStatsRepository.forPost(org.id, postIds);

    return rows.map((row: any) => ({
      postId: row.postId,
      integrationId: row.integrationId,
      metrics: (row.metrics || {}) as PostStatMetrics,
      fetchedAt: row.fetchedAt,
      error: row.lastError,
    }));
  }

  /**
   * Every post in a date range with its numbers, plus totals.
   *
   * Totals skip what a platform never reported instead of counting it as zero,
   * and each total says how many posts it covers - otherwise a column where
   * only Instagram fills a field reads as if the whole account underperformed.
   */
  async report(
    org: Organization,
    from: Date,
    to: Date,
    integrationIds?: string[]
  ) {
    const [rows, integrations] = await Promise.all([
      this._postStatsRepository.list(org.id, from, to, integrationIds),
      this._integrationRepository.getIntegrationsList(org.id),
    ]);

    const byId = new Map(integrations.map((i: any) => [i.id, i]));

    const postIds = rows.map((r: any) => r.postId).filter(Boolean) as string[];
    const posts = postIds.length
      ? await this._posts.model.post.findMany({
          where: { id: { in: postIds } },
          select: { id: true, content: true, releaseURL: true },
        })
      : [];

    const postById = new Map(posts.map((p: any) => [p.id, p]));

    const items = rows.map((row: any) => {
      const integration = byId.get(row.integrationId) as any;
      const post = row.postId ? postById.get(row.postId) : undefined;
      const metrics = (row.metrics || {}) as PostStatMetrics;

      return {
        id: row.id,
        postId: row.postId,
        releaseId: row.releaseId,
        publishedAt: row.publishedAt,
        fetchedAt: row.fetchedAt,
        error: row.lastError,
        channel: integration
          ? {
              id: integration.id,
              name: integration.name,
              picture: integration.picture,
              provider: integration.providerIdentifier,
            }
          : undefined,
        // The editor stores HTML; the table only needs something to read.
        preview: this.plainText(post?.content).slice(0, 140),
        url: metrics.permalink || post?.releaseURL,
        metrics,
      };
    });

    return {
      items,
      totals: this.sum(items.map((i) => i.metrics)),
      perChannel: this.perChannel(items),
    };
  }

  private perChannel(items: Array<{ channel?: any; metrics: PostStatMetrics }>) {
    const groups = new Map<string, { channel: any; metrics: PostStatMetrics[] }>();

    for (const item of items) {
      if (!item.channel) {
        continue;
      }

      const group = groups.get(item.channel.id) || {
        channel: item.channel,
        metrics: [],
      };

      group.metrics.push(item.metrics);
      groups.set(item.channel.id, group);
    }

    return [...groups.values()]
      .map((group) => ({
        channel: group.channel,
        posts: group.metrics.length,
        totals: this.sum(group.metrics),
      }))
      .sort((a, b) => (b.totals.views?.value || 0) - (a.totals.views?.value || 0));
  }

  private sum(all: PostStatMetrics[]) {
    const fields = [
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
    ] as const;

    const totals: Record<string, { value: number; posts: number }> = {};

    for (const field of fields) {
      const values = all
        .map((m) => m?.[field])
        .filter((v): v is number => typeof v === 'number');

      if (values.length) {
        totals[field] = {
          value: values.reduce((a, b) => a + b, 0),
          posts: values.length,
        };
      }
    }

    // An average of averages would be wrong, so watch time per post is derived
    // from the totals instead.
    const watched = all
      .map((m) => m?.avgWatchMs)
      .filter((v): v is number => typeof v === 'number');

    if (watched.length) {
      totals.avgWatchMs = {
        value: Math.round(
          watched.reduce((a, b) => a + b, 0) / watched.length
        ),
        posts: watched.length,
      };
    }

    return totals;
  }

  private plainText(html?: string) {
    return (html || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Drops empty fields so a platform that reports nothing does not store a wall
  // of nulls that the UI would then have to filter again.
  private clean(metrics: PostStatMetrics): PostStatMetrics {
    return Object.fromEntries(
      Object.entries(metrics || {}).filter(
        ([, value]) => value !== undefined && value !== null
      )
    );
  }
}
