import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostStatsService } from '@gitroom/nestjs-libraries/database/prisma/posts/post-stats.service';

/**
 * Keeps the per-post numbers fresh.
 *
 * Runs half past the hour so it never overlaps the inbox sync at :07 - both
 * talk to the same Graph API and two jobs firing together would look like a
 * burst. How much each run actually fetches is decided by the age of the post,
 * not by this schedule: fresh posts are re-read hourly, old ones weekly.
 */
@Injectable()
export class SyncPostStats {
  constructor(private _postStatsService: PostStatsService) {}

  @Cron('30 * * * *')
  async handleCron() {
    await this._postStatsService.registerPublished();
    await this._postStatsService.syncDue();
  }
}
