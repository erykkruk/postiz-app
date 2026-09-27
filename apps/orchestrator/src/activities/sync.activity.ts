import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { PostStatsService } from '@gitroom/nestjs-libraries/database/prisma/posts/post-stats.service';
import { MetaAdsService } from '@gitroom/nestjs-libraries/database/prisma/posts/meta-ads.service';
import { withHeartbeat } from '@gitroom/nestjs-libraries/temporal/temporal.heartbeat';

/**
 * The two background syncs that used to be @Cron tasks in apps/cron, which
 * upstream replaced with Temporal. The bodies are unchanged; only the trigger
 * moved to sync.inbox.workflow and sync.post.stats.workflow.
 */
@Injectable()
@Activity()
export class SyncActivity {
  constructor(
    private _integrationService: IntegrationService,
    private _organizations: PrismaRepository<'organization'>,
    private _postStatsService: PostStatsService,
    private _metaAdsService: MetaAdsService
  ) {}

  /**
   * Pulls comments and conversations from every channel into the local
   * database, so the panel opens instantly on ready rows instead of waiting for
   * the platforms on every visit.
   */
  @ActivityMethod()
  async syncInbox() {
    return withHeartbeat(async () => {
      const organizations =
        await this._organizations.model.organization.findMany({
          select: { id: true },
        });

      // Organizations one at a time, channels inside an organization in
      // parallel - otherwise many accounts would fire an avalanche of Meta
      // calls at once.
      for (const org of organizations) {
        await this._integrationService.syncOrganization(org.id, 'comment');
        await this._integrationService.syncOrganization(org.id, 'conversation');
      }
    });
  }

  /**
   * Keeps the per-post numbers fresh. How much a run fetches is decided by the
   * age of each post, not by the schedule: fresh posts are re-read hourly, old
   * ones weekly.
   */
  @ActivityMethod()
  async syncPostStats() {
    return withHeartbeat(async () => {
      await this._postStatsService.registerPublished();
      // Promoted creatives never pass through our calendar, so they are looked
      // up in the ad account first and then read like any other post.
      await this._metaAdsService.registerAds();
      await this._postStatsService.syncDue();
    });
  }
}
