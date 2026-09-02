import { Injectable } from '@nestjs/common';
import { PostStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/post-stats.repository';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { timer } from '@gitroom/helpers/utils/timer';

// One page of ads per call, then a pause. Same reasoning as the post sync: a
// burst of Graph API calls is what got the ad account flagged for "automation
// imitating human activity", and nothing here is urgent.
const PAUSE_BETWEEN_PAGES_MS = 1500;
const ADS_PER_PAGE = 100;
const MAX_PAGES = 10;

const GRAPH = 'https://graph.facebook.com/v23.0';

type AdRow = {
  name?: string;
  created_time?: string;
  creative?: {
    effective_object_story_id?: string;
    effective_instagram_media_id?: string;
    instagram_user_id?: string;
  };
};

/**
 * Brings promoted creatives into the statistics table.
 *
 * An ad never passes through our calendar, so nothing would otherwise know it
 * exists - yet it is a real post on the page, with its own likes and comments,
 * and leaving it out made the totals read as if half the work never happened.
 *
 * This only registers the rows. The numbers are then read by the very same
 * per-post sync that handles our own posts, using the channel tokens we already
 * hold, because a promoted post answers the ordinary Graph API like any other.
 */
@Injectable()
export class MetaAdsService {
  constructor(
    private _postStatsRepository: PostStatsRepository,
    private _integrations: PrismaRepository<'integration'>
  ) {}

  /** Configured only when both the token and at least one account are set. */
  private config() {
    const token = process.env.META_ADS_TOKEN;
    const accounts = (process.env.META_AD_ACCOUNTS || '')
      .split(',')
      .map((account) => account.trim())
      .filter(Boolean)
      // Both "act_123" and a bare id are accepted - the ids are copied out of
      // the Ads Manager URL, which shows them either way.
      .map((account) => (account.startsWith('act_') ? account : `act_${account}`));

    return token && accounts.length ? { token, accounts } : null;
  }

  /**
   * Finds promoted posts and registers them for the statistics sync.
   *
   * A creative points at both a Facebook post and an Instagram media item, so
   * one ad can add a row on each channel. Whatever we cannot match to a channel
   * we own is skipped: without its token there would be no way to read numbers
   * for it anyway.
   */
  async registerAds(days = 180) {
    const config = this.config();
    if (!config) {
      return 0;
    }

    const channels = await this._integrations.model.integration.findMany({
      where: {
        deletedAt: null,
        providerIdentifier: { in: ['facebook', 'instagram'] },
      },
      select: {
        id: true,
        organizationId: true,
        internalId: true,
        providerIdentifier: true,
      },
    });

    const byInternalId = new Map(
      channels.map((channel: any) => [
        `${channel.providerIdentifier}:${channel.internalId}`,
        channel,
      ])
    );

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let registered = 0;

    for (const account of config.accounts) {
      for (const ad of await this.readAds(account, config.token)) {
        const createdAt = ad.created_time ? new Date(ad.created_time) : null;
        if (!createdAt || isNaN(createdAt.getTime()) || createdAt < since) {
          continue;
        }

        const name = ad.name || 'Ad';
        const story = ad.creative?.effective_object_story_id;
        const media = ad.creative?.effective_instagram_media_id;
        const igUser = ad.creative?.instagram_user_id;

        // A Facebook story id is "<pageId>_<postId>" - the page in front is
        // what says which of our channels published it.
        const pageId = story?.includes('_') ? story.split('_')[0] : undefined;

        const targets = [
          pageId
            ? { channel: byInternalId.get(`facebook:${pageId}`), releaseId: story! }
            : null,
          media && igUser
            ? {
                channel: byInternalId.get(`instagram:${igUser}`),
                releaseId: media,
              }
            : null,
        ].filter((target): target is { channel: any; releaseId: string } =>
          !!target?.channel
        );

        for (const target of targets) {
          await this._postStatsRepository.registerExternal(
            target.channel.organizationId,
            target.channel.id,
            target.releaseId,
            createdAt,
            name
          );
          registered++;
        }
      }
    }

    return registered;
  }

  /** Every ad in one account, page by page, paced. */
  private async readAds(account: string, token: string) {
    const fields =
      'name,created_time,creative{effective_object_story_id,' +
      'effective_instagram_media_id,instagram_user_id}';

    let url =
      `${GRAPH}/${account}/ads?fields=${encodeURIComponent(fields)}` +
      `&limit=${ADS_PER_PAGE}&access_token=${encodeURIComponent(token)}`;

    const all: AdRow[] = [];

    for (let page = 0; page < MAX_PAGES && url; page++) {
      const body = await this.read(url);
      if (!body) {
        break;
      }

      all.push(...((body.data || []) as AdRow[]));
      url = body.paging?.next || '';

      if (url) {
        await timer(PAUSE_BETWEEN_PAGES_MS);
      }
    }

    return all;
  }

  /**
   * A read that is allowed to come back empty.
   *
   * An expired ads token must not take the whole statistics run down with it -
   * our own posts are synced by the same cron and they do not depend on it.
   */
  private async read(url: string): Promise<any | null> {
    try {
      const response = await fetch(url);
      const body = await response.json();
      return body?.error ? null : body;
    } catch (err) {
      return null;
    }
  }
}
