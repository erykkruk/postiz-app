import {
  AnalyticsData,
  AuthTokenDetails,
  CommentsQuery,
  PostDetails,
  PostResponse,
  PostStatMetrics,
  SocialComment,
  SocialCommentReply,
  SocialConversation,
  SocialMessage,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { FacebookDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';
import { DribbbleDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';

export class FacebookProvider extends SocialAbstract implements SocialProvider {
  identifier = 'facebook';
  name = 'Facebook Page';
  isBetweenSteps = true;
  scopes = [
    'pages_show_list',
    'business_management',
    'pages_manage_posts',
    'pages_manage_engagement',
    'pages_read_engagement',
    'read_insights',
    // Messaging: the channel has to be reconnected so the token carries it.
    'pages_messaging',
  ];
  override maxConcurrentJob = 3; // Facebook has reasonable rate limits
  editor = 'normal' as const;
  maxLength() {
    return 63206;
  }
  dto = FacebookDto;

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    // Access token validation errors - require re-authentication
    if (body.indexOf('Error validating access token') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Please re-authenticate your Facebook account',
      };
    }

    if (body.indexOf('490') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Access token expired, please re-authenticate',
      };
    }

    if (body.indexOf('REVOKED_ACCESS_TOKEN') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Access token has been revoked, please re-authenticate',
      };
    }

    if (body.indexOf('1366046') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Photos should be smaller than 4 MB and saved as JPG, PNG',
      };
    }

    if (body.indexOf('1390008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'You are posting too fast, please slow down',
      };
    }

    // Content policy violations
    if (body.indexOf('1346003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Content flagged as abusive by Facebook',
      };
    }

    if (body.indexOf('1404006') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          "We couldn't post your comment, A security check in facebook required to proceed.",
      };
    }

    if (body.indexOf('1404102') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Content violates Facebook Community Standards',
      };
    }

    // Permission errors
    if (body.indexOf('1404078') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Page publishing authorization required, please re-authenticate',
      };
    }

    if (body.indexOf('1609008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Cannot post Facebook.com links',
      };
    }

    // Parameter validation errors
    if (body.indexOf('2061006') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid URL format in post content',
      };
    }

    if (body.indexOf('1349125') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid content format',
      };
    }

    if (body.indexOf('Name parameter too long') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Post content is too long',
      };
    }

    // Service errors - checking specific subcodes first
    if (body.indexOf('1363047') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Facebook service temporarily unavailable',
      };
    }

    if (body.indexOf('1609010') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Facebook service temporarily unavailable',
      };
    }

    return undefined;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url:
        'https://www.facebook.com/v20.0/dialog/oauth' +
        `?client_id=${process.env.FACEBOOK_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/facebook`
        )}` +
        `&state=${state}` +
        `&scope=${this.scopes.join(',')}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const information = await this.fetchPageInformation(accessToken, {
      page: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const getAccessToken = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          `?client_id=${process.env.FACEBOOK_APP_ID}` +
          `&redirect_uri=${encodeURIComponent(
            `${process.env.FRONTEND_URL}/integrations/social/facebook${
              params.refresh ? `?refresh=${params.refresh}` : ''
            }`
          )}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&code=${params.code}`
      )
    ).json();

    const { access_token } = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          '?grant_type=fb_exchange_token' +
          `&client_id=${process.env.FACEBOOK_APP_ID}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&fb_exchange_token=${getAccessToken.access_token}&fields=access_token,expires_in`
      )
    ).json();

    const { data } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me/permissions?access_token=${access_token}`
      )
    ).json();

    const permissions = data
      .filter((d: any) => d.status === 'granted')
      .map((p: any) => p.permission);
    this.checkScopes(this.scopes, permissions);

    const { id, name, picture } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me?fields=id,name,picture&access_token=${access_token}`
      )
    ).json();

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(59, 'days').unix() - dayjs().unix(),
      picture: picture?.data?.url || '',
      username: '',
    };
  }

  async pages(accessToken: string) {
    const { data } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me/accounts?fields=id,username,name,picture.type(large)&access_token=${accessToken}`
      )
    ).json();

    return data;
  }

  async fetchPageInformation(accessToken: string, data: { page: string }) {
    const pageId = data.page;
    const {
      id,
      name,
      access_token,
      username,
      picture: {
        data: { url },
      },
    } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/${pageId}?fields=username,access_token,name,picture.type(large)&access_token=${accessToken}`
      )
    ).json();

    return {
      id,
      name,
      access_token,
      picture: url,
      username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<FacebookDto>[]
  ): Promise<PostResponse[]> {
    const [firstPost, ...comments] = postDetails;

    let finalId = '';
    let finalUrl = '';
    if ((firstPost?.media?.[0]?.path?.indexOf('mp4') || -2) > -1) {
      const {
        id: videoId,
        permalink_url,
        ...all
      } = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${id}/videos?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              file_url: firstPost?.media?.[0]?.path!,
              description: firstPost.message,
              published: true,
            }),
          },
          'upload mp4'
        )
      ).json();

      finalUrl = 'https://www.facebook.com/reel/' + videoId;
      finalId = videoId;
    } else {
      const uploadPhotos = !firstPost?.media?.length
        ? []
        : await Promise.all(
            firstPost.media.map(async (media) => {
              const { id: photoId } = await (
                await this.fetch(
                  `https://graph.facebook.com/v20.0/${id}/photos?access_token=${accessToken}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      url: media.path,
                      published: false,
                    }),
                  },
                  'upload images slides'
                )
              ).json();

              return { media_fbid: photoId };
            })
          );

      const {
        id: postId,
        permalink_url,
        ...all
      } = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${id}/feed?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...(uploadPhotos?.length ? { attached_media: uploadPhotos } : {}),
              ...(firstPost?.settings?.url
                ? { link: firstPost.settings.url }
                : {}),
              message: firstPost.message,
              published: true,
            }),
          },
          'finalize upload'
        )
      ).json();

      finalUrl = permalink_url;
      finalId = postId;
    }

    const postsArray = [];
    let commentId = finalId;
    for (const comment of comments) {
      const data = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${commentId}/comments?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...(comment.media?.length
                ? { attachment_url: comment.media[0].path }
                : {}),
              message: comment.message,
            }),
          },
          'add comment'
        )
      ).json();

      commentId = data.id;
      postsArray.push({
        id: comment.id,
        postId: data.id,
        releaseURL: data.permalink_url,
        status: 'success',
      });
    }
    return [
      {
        id: firstPost.id,
        postId: finalId,
        releaseURL: finalUrl,
        status: 'success',
      },
      ...postsArray,
    ];
  }

  // Reads comments other people left under one of our posts.
  // `filter=stream` returns replies alongside top-level comments in one flat
  // list, and `parent` tells them apart - the inbox rebuilds the thread from it.
  async comments(
    id: string,
    postId: string,
    accessToken: string,
    options?: CommentsQuery
  ): Promise<SocialComment[]> {
    const limit = options?.limit ?? 100;

    const { data } = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${postId}/comments?access_token=${accessToken}&filter=stream&order=reverse_chronological&limit=${limit}&fields=id,message,created_time,permalink_url,from{id,name},parent{id}`,
        {},
        'read comments'
      )
    ).json();

    // Meta ignores an unknown `since`, so the window is applied here instead of
    // in the query - a silently unfiltered response would look like a flood of
    // new comments on every poll.
    const since = options?.since;

    return (data || [])
      .map(
        (comment: any): SocialComment => ({
          id: comment.id,
          message: comment.message || '',
          createdAt: dayjs(comment.created_time).toISOString(),
          authorId: comment.from?.id,
          authorName: comment.from?.name,
          permalink: comment.permalink_url,
          parentId: comment.parent?.id,
          // `id` is the page id, so a comment from it is one of ours.
          isOwnComment: !!comment.from?.id && comment.from.id === id,
        })
      )
      .filter(
        (comment: SocialComment) =>
          !since || dayjs(comment.createdAt).unix() > since
      );
  }

  // On Facebook a reply is a comment posted onto the comment itself, which is
  // why this targets /{commentId}/comments and not /{postId}/comments.
  async reply(
    id: string,
    commentId: string,
    message: string,
    accessToken: string
  ): Promise<SocialCommentReply> {
    const data = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${commentId}/comments?access_token=${accessToken}&fields=id,permalink_url`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message }),
        },
        'reply to comment'
      )
    ).json();

    return {
      id: data.id,
      permalink: data.permalink_url,
    };
  }

  async hideComment(
    commentId: string,
    hidden: boolean,
    accessToken: string
  ): Promise<{ success: boolean }> {
    await this.fetch(
      `https://graph.facebook.com/v23.0/${commentId}?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_hidden: hidden }),
      },
      hidden ? 'hide comment' : 'unhide comment'
    );
    return { success: true };
  }

  async deleteComment(
    commentId: string,
    accessToken: string
  ): Promise<{ success: boolean }> {
    await this.fetch(
      `https://graph.facebook.com/v23.0/${commentId}?access_token=${accessToken}`,
      { method: 'DELETE' },
      'delete comment'
    );
    return { success: true };
  }

  async recentComments(
    id: string,
    accessToken: string,
    options?: CommentsQuery
  ): Promise<SocialComment[]> {
    const { data } = await (
      await this.fetch(
        `https://graph.facebook.com/v23.0/${id}/posts?fields=id,message,permalink_url` +
          `&limit=${options?.limit ?? 15}&access_token=${accessToken}`,
        {},
        'read posts'
      )
    ).json();

    // Posts are queried in parallel - sequentially, each channel took as long as
    // the sum of its posts and the Inbox tab sat there loading.
    const perPost = await Promise.all(
      (data || []).map(async (post: any) => {
        const comments = await this.comments(id, post.id, accessToken, options);
        return comments.map((c) => ({
          ...c,
          postId: post.id,
          postText: post.message || '',
          postUrl: post.permalink_url,
        }));
      })
    );

    return perPost.flat();
  }

  // Private conversations of the page. Requires the pages_messaging permission -
  // without it Graph returns (#200) and the UI asks to reconnect the channel.
  async conversations(
    id: string,
    accessToken: string,
    options?: CommentsQuery
  ): Promise<SocialConversation[]> {
    const limit = options?.limit ?? 25;

    const { data } = await (
      await this.fetch(
        `https://graph.facebook.com/v23.0/${id}/conversations?access_token=${accessToken}` +
          `&platform=messenger&limit=${limit}` +
          '&fields=id,updated_time,unread_count,participants,' +
          'messages.limit(25){id,message,created_time,from}',
        {},
        'read conversations'
      )
    ).json();

    return (data || []).map((thread: any): SocialConversation => {
      const other = (thread.participants?.data || []).find(
        (p: any) => String(p.id) !== String(id)
      );

      const messages: SocialMessage[] = (thread.messages?.data || [])
        .map((m: any): SocialMessage => ({
          id: m.id,
          text: m.message || '',
          createdAt: dayjs(m.created_time).toISOString(),
          fromId: m.from?.id,
          fromName: m.from?.name,
          isFromUs: String(m.from?.id) === String(id),
        }))
        .reverse();

      // Meta only allows a free-form reply within 24h of the other person's last
      // message. Outside that window you have to use tagged message types, which
      // is why the UI cannot show a plain reply box then.
      const lastFromThem = [...messages].reverse().find((m) => !m.isFromUs);
      const canReplyFreely = !!lastFromThem &&
        dayjs().diff(dayjs(lastFromThem.createdAt), 'hour') < 24;

      return {
        id: thread.id,
        participantId: other?.id,
        participantName: other?.name,
        updatedAt: dayjs(thread.updated_time).toISOString(),
        unread: (thread.unread_count || 0) > 0,
        canReplyFreely,
        messages,
      };
    });
  }

  async sendMessage(
    id: string,
    recipientId: string,
    message: string,
    accessToken: string
  ): Promise<{ id: string }> {
    const data = await (
      await this.fetch(
        `https://graph.facebook.com/v23.0/${id}/messages?access_token=${accessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: message },
            messaging_type: 'RESPONSE',
          }),
        },
        'send message'
      )
    ).json();

    return { id: data.message_id || data.id };
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const until = dayjs().endOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    // page_impressions_unique and page_posts_impressions_unique used to be here
    // and are gone - Meta retired them, and not just in the newest version:
    // asking for them on v20 returns "The value must be a valid insights metric"
    // too, so those two charts have been silently empty. There is no page-level
    // replacement for reach; the Posts view sums it from the posts instead.
    const metrics = [
      'page_post_engagements',
      'page_daily_follows',
      'page_video_views',
      'page_follows',
      'page_views_total',
    ].join(',');

    const { data } = await (
      await fetch(
        `https://graph.facebook.com/v23.0/${id}/insights?metric=${metrics}&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    return (
      data?.map((d: any) => ({
        label:
          d.name === 'page_post_engagements'
            ? 'Posts Engagement'
            : d.name === 'page_daily_follows'
            ? 'New followers'
            : d.name === 'page_video_views'
            ? 'Videos views'
            : d.name === 'page_follows'
            ? 'Page followers'
            : 'Page views',
        percentageChange: 5,
        data: d?.values?.map((v: any) => ({
          total: v.value,
          date: dayjs(v.end_time).format('YYYY-MM-DD'),
        })),
      })) || []
    );
  }

  /**
   * How one publication performed.
   *
   * Facebook splits this in two and the split is invisible from the outside:
   * a reel is stored under its bare video id and answers /video_insights with
   * plays, reach and a retention curve, while a normal page post is stored as
   * pageId_postId and no longer has an insights edge at all (Meta retired the
   * post_impressions family - asking for it returns "Invalid query"). For a
   * plain post we can therefore only read the public counters.
   */
  async postStats(
    id: string,
    postId: string,
    accessToken: string
  ): Promise<PostStatMetrics> {
    const isReel = !postId.includes('_');

    const fields = isReel
      ? 'permalink_url,views,length,likes.summary(true),comments.summary(true)'
      : 'permalink_url,likes.summary(true),comments.summary(true),' +
        'reactions.summary(true)';

    const post = await this.softJson(
      `https://graph.facebook.com/v23.0/${postId}` +
        `?fields=${fields}&access_token=${accessToken}`,
      'read post stats'
    );

    const metrics: PostStatMetrics = {
      permalink: this.absoluteUrl(post?.permalink_url),
      // Reactions cover more than a thumbs up, so they are the better "likes"
      // when Facebook reports both.
      likes:
        post?.reactions?.summary?.total_count ??
        post?.likes?.summary?.total_count,
      comments: post?.comments?.summary?.total_count,
      views: typeof post?.views === 'number' ? post.views : undefined,
    };

    if (!isReel) {
      return metrics;
    }

    // No metric list on purpose: Facebook then returns everything it has for
    // this reel, which survives Meta renaming individual metrics.
    const insights = await this.softJson(
      `https://graph.facebook.com/v23.0/${postId}/video_insights` +
        `?access_token=${accessToken}`,
      'read reel insights'
    );

    const extra: Record<string, number> = {};

    for (const row of insights?.data || []) {
      const value = row?.values?.[0]?.value;

      switch (row.name) {
        case 'fb_reels_total_plays':
          metrics.views = value ?? metrics.views;
          break;
        case 'post_impressions_unique':
          metrics.reach = value;
          break;
        case 'fb_reels_replay_count':
          metrics.replays = value;
          break;
        case 'post_video_avg_time_watched':
          metrics.avgWatchMs = value;
          break;
        case 'post_video_view_time':
          metrics.totalWatchMs = value;
          break;
        case 'post_video_followers':
          metrics.followersGained = value;
          break;
        case 'post_video_retention_graph':
          metrics.retention = Object.entries(value || {})
            .map(([second, ratio]) => ({
              second: Number(second),
              ratio: Number(ratio),
            }))
            .sort((a, b) => a.second - b.second);
          break;
        default:
          // Everything else is kept as a number when it is one. Breakdowns
          // (reactions by type, social actions) arrive as objects and would
          // only add noise to a table of totals.
          if (typeof value === 'number') {
            extra[row.name] = value;
          }
      }
    }

    if (Object.keys(extra).length) {
      metrics.extra = extra;
    }

    return metrics;
  }

  // Reels answer with a path like /reel/123/ instead of a full address.
  private absoluteUrl(url?: string) {
    if (!url) {
      return undefined;
    }

    return url.startsWith('http') ? url : `https://www.facebook.com${url}`;
  }
}
