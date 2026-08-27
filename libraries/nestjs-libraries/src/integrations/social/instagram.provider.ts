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
import { timer } from '@gitroom/helpers/utils/timer';
import dayjs from 'dayjs';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { InstagramDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { Integration } from '@prisma/client';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';

@Rules(
  "Instagram should have at least one attachment, if it's a story, it can have only one picture"
)
export class InstagramProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'instagram';
  name = 'Instagram\n(Facebook Business)';
  isBetweenSteps = true;
  toolTip = 'Instagram must be business and connected to a Facebook page';
  scopes = [
    'instagram_basic',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
    'instagram_content_publish',
    'instagram_manage_comments',
    'instagram_manage_insights',
    // Messaging: also needs the capability on the Meta app side (App Review);
    // having the permission in the token is not enough.
    'instagram_business_manage_messages',
  ];
  override maxConcurrentJob = 10;
  editor = 'normal' as const;
  dto = InstagramDto;
  maxLength() {
    return 2200;
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

  public override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body' | 'retry';
        value: string;
      }
    | undefined {
    if (body.indexOf('An unknown error occurred') > -1) {
      return {
        type: 'retry' as const,
        value: 'An unknown error occurred, please try again later',
      };
    }

    if (body.indexOf('REVOKED_ACCESS_TOKEN') > -1) {
      return {
        type: 'refresh-token' as const,
        value:
          'Something is wrong with your connected user, please re-authenticate',
      };
    }

    if (
      body.toLowerCase().indexOf('the user is not an instagram business') > -1
    ) {
      return {
        type: 'refresh-token' as const,
        value:
          'Your Instagram account is not a business account, please convert it to a business account',
      };
    }

    if (body.toLowerCase().indexOf('session has been invalidated') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Please re-authenticate your Instagram account',
      };
    }

    if (body.indexOf('2207050') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Instagram user is restricted',
      };
    }

    // Media download/upload errors
    if (body.indexOf('2207003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Timeout downloading media, please try again',
      };
    }

    if (body.indexOf('2207020') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media expired, please upload again',
      };
    }

    if (body.indexOf('2207032') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Failed to create media, please try again',
      };
    }

    if (body.indexOf('2207053') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown upload error, please try again',
      };
    }

    if (body.indexOf('2207052') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media fetch failed, please try again',
      };
    }

    if (body.indexOf('2207057') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid thumbnail offset for video',
      };
    }

    if (body.indexOf('2207026') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unsupported video format',
      };
    }

    if (body.indexOf('2207023') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown media type',
      };
    }

    if (body.indexOf('2207006') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media not found, please upload again',
      };
    }

    if (body.indexOf('2207008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media builder expired, please try again',
      };
    }

    // Content validation errors
    if (body.indexOf('2207028') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Carousel validation failed',
      };
    }

    if (body.indexOf('2207010') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Caption is too long',
      };
    }

    // Product tagging errors
    if (body.indexOf('2207035') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag positions not supported for videos',
      };
    }

    if (body.indexOf('2207036') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag positions required for photos',
      };
    }

    if (body.indexOf('2207037') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag validation failed',
      };
    }

    if (body.indexOf('2207040') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Too many product tags',
      };
    }

    // Image format/size errors
    if (body.indexOf('2207004') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Image is too large',
      };
    }

    if (body.indexOf('2207005') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unsupported image format',
      };
    }

    if (body.indexOf('2207009') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Aspect ratio not supported, must be between 4:5 to 1.91:1',
      };
    }

    if (body.indexOf('Page request limit reached') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Page posting for today is limited, please try again tomorrow',
      };
    }

    if (body.indexOf('2207042') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'You have reached the maximum of 25 posts per day, allowed for your account',
      };
    }

    if (body.indexOf('Not enough permissions to post') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Not enough permissions to post',
      };
    }

    if (body.indexOf('36003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Aspect ratio not supported, must be between 4:5 to 1.91:1',
      };
    }

    if (body.indexOf('36001') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid Instagram image resolution max: 1920x1080px',
      };
    }

    if (body.indexOf('2207051') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram blocked your request',
      };
    }

    if (body.indexOf('2207001') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Instagram detected that your post is spam, please try again with different content',
      };
    }

    if (body.indexOf('2207027') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown error, please try again later or contact support',
      };
    }

    return undefined;
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const findPage = (await this.pages(accessToken)).find(
      (p) => p.id === requiredId
    );

    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
      pageId: findPage?.pageId!,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url:
        'https://www.facebook.com/v20.0/dialog/oauth' +
        `?client_id=${process.env.FACEBOOK_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/instagram`
        )}` +
        `&state=${state}` +
        `&scope=${encodeURIComponent(this.scopes.join(','))}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh: string;
  }) {
    const getAccessToken = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          `?client_id=${process.env.FACEBOOK_APP_ID}` +
          `&redirect_uri=${encodeURIComponent(
            `${process.env.FRONTEND_URL}/integrations/social/instagram${
              params.refresh ? `?refresh=${params.refresh}` : ''
            }`
          )}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&code=${params.code}`
      )
    ).json();

    const { access_token, expires_in, ...all } = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          '?grant_type=fb_exchange_token' +
          `&client_id=${process.env.FACEBOOK_APP_ID}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&fb_exchange_token=${getAccessToken.access_token}`
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
        `https://graph.facebook.com/v20.0/me/accounts?fields=id,instagram_business_account,username,name,picture.type(large)&access_token=${accessToken}&limit=500`
      )
    ).json();

    const onlyConnectedAccounts = await Promise.all(
      data
        .filter((f: any) => f.instagram_business_account)
        .map(async (p: any) => {
          return {
            pageId: p.id,
            ...(await (
              await fetch(
                `https://graph.facebook.com/v20.0/${p.instagram_business_account.id}?fields=name,profile_picture_url&access_token=${accessToken}&limit=500`
              )
            ).json()),
            id: p.instagram_business_account.id,
          };
        })
    );

    return onlyConnectedAccounts.map((p: any) => ({
      pageId: p.pageId,
      id: p.id,
      name: p.name,
      picture: { data: { url: p.profile_picture_url } },
    }));
  }

  async fetchPageInformation(
    accessToken: string,
    data: { pageId: string; id: string }
  ) {
    const { access_token, ...all } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/${data.pageId}?fields=access_token,name,picture.type(large)&access_token=${accessToken}`
      )
    ).json();

    const { id, name, profile_picture_url, username } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/${data.id}?fields=username,name,profile_picture_url&access_token=${accessToken}`
      )
    ).json();

    return {
      id,
      name,
      picture: profile_picture_url,
      access_token,
      username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [firstPost, ...theRest] = postDetails;
    console.log('in progress', id);
    const isStory = firstPost.settings.post_type === 'story';
    const medias = await Promise.all(
      firstPost?.media?.map(async (m) => {
        const caption =
          firstPost.media?.length === 1
            ? `&caption=${encodeURIComponent(firstPost.message)}`
            : ``;
        const isCarousel =
          (firstPost?.media?.length || 0) > 1 ? `&is_carousel_item=true` : ``;
        const mediaType =
          m.path.indexOf('.mp4') > -1
            ? firstPost?.media?.length === 1
              ? isStory
                ? `video_url=${m.path}&media_type=STORIES`
                : `video_url=${m.path}&media_type=REELS&thumb_offset=${
                    m?.thumbnailTimestamp || 0
                  }`
              : isStory
              ? `video_url=${m.path}&media_type=STORIES`
              : `video_url=${m.path}&media_type=VIDEO&thumb_offset=${
                  m?.thumbnailTimestamp || 0
                }`
            : isStory
            ? `image_url=${m.path}&media_type=STORIES`
            : `image_url=${m.path}`;
        console.log('in progress1');

        const collaborators =
          firstPost?.settings?.collaborators?.length && !isStory
            ? `&collaborators=${JSON.stringify(
                firstPost?.settings?.collaborators.map((p) => p.label)
              )}`
            : ``;

        console.log(collaborators);
        const { id: photoId } = await (
          await this.fetch(
            `https://${type}/v20.0/${id}/media?${mediaType}${isCarousel}${collaborators}&access_token=${accessToken}${caption}`,
            {
              method: 'POST',
            }
          )
        ).json();
        console.log('in progress2', id);

        let status = 'IN_PROGRESS';
        while (status === 'IN_PROGRESS') {
          const { status_code } = await (
            await this.fetch(
              `https://${type}/v20.0/${photoId}?access_token=${accessToken}&fields=status_code`,
              undefined,
              '',
              0,
              true
            )
          ).json();
          await timer(30000);
          status = status_code;
        }
        console.log('in progress3', id);

        return photoId;
      }) || []
    );

    const arr = [];

    let containerIdGlobal = '';
    let linkGlobal = '';
    if (medias.length === 1) {
      const { id: mediaId } = await (
        await this.fetch(
          `https://${type}/v20.0/${id}/media_publish?creation_id=${medias[0]}&access_token=${accessToken}&field=id`,
          {
            method: 'POST',
          }
        )
      ).json();

      containerIdGlobal = mediaId;

      const { permalink } = await (
        await this.fetch(
          `https://${type}/v20.0/${mediaId}?fields=permalink&access_token=${accessToken}`
        )
      ).json();

      arr.push({
        id: firstPost.id,
        postId: mediaId,
        releaseURL: permalink,
        status: 'success',
      });

      linkGlobal = permalink;
    } else {
      const { id: containerId, ...all3 } = await (
        await this.fetch(
          `https://${type}/v20.0/${id}/media?caption=${encodeURIComponent(
            firstPost?.message
          )}&media_type=CAROUSEL&children=${encodeURIComponent(
            medias.join(',')
          )}&access_token=${accessToken}`,
          {
            method: 'POST',
          }
        )
      ).json();

      let status = 'IN_PROGRESS';
      while (status === 'IN_PROGRESS') {
        const { status_code } = await (
          await this.fetch(
            `https://${type}/v20.0/${containerId}?fields=status_code&access_token=${accessToken}`,
            undefined,
            '',
            0,
            true
          )
        ).json();
        await timer(30000);
        status = status_code;
      }

      const { id: mediaId, ...all4 } = await (
        await this.fetch(
          `https://${type}/v20.0/${id}/media_publish?creation_id=${containerId}&access_token=${accessToken}&field=id`,
          {
            method: 'POST',
          }
        )
      ).json();

      containerIdGlobal = mediaId;

      const { permalink } = await (
        await this.fetch(
          `https://${type}/v20.0/${mediaId}?fields=permalink&access_token=${accessToken}`
        )
      ).json();

      arr.push({
        id: firstPost.id,
        postId: mediaId,
        releaseURL: permalink,
        status: 'success',
      });

      linkGlobal = permalink;
    }

    for (const post of theRest) {
      const { id: commentId } = await (
        await this.fetch(
          `https://${type}/v20.0/${containerIdGlobal}/comments?message=${encodeURIComponent(
            post.message
          )}&access_token=${accessToken}`,
          {
            method: 'POST',
          }
        )
      ).json();

      arr.push({
        id: post.id,
        postId: commentId,
        releaseURL: linkGlobal,
        status: 'success',
      });
    }

    return arr;
  }

  private setTitle(name: string) {
    switch (name) {
      case 'likes': {
        return 'Likes';
      }

      case 'followers': {
        return 'Followers';
      }

      case 'reach': {
        return 'Reach';
      }

      case 'follower_count': {
        return 'Follower Count';
      }

      case 'views': {
        return 'Views';
      }

      case 'comments': {
        return 'Comments';
      }

      case 'shares': {
        return 'Shares';
      }

      case 'saves': {
        return 'Saves';
      }

      case 'replies': {
        return 'Replies';
      }
    }

    return '';
  }

  // Reads comments under one of our media items. Instagram nests replies inside
  // each top-level comment instead of returning a flat stream like Facebook, so
  // they are flattened here and linked back through parentId.
  async comments(
    id: string,
    postId: string,
    accessToken: string,
    options?: CommentsQuery
  ): Promise<SocialComment[]> {
    const limit = options?.limit ?? 100;

    const { data } = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${postId}/comments?access_token=${accessToken}&limit=${limit}&fields=id,text,timestamp,username,replies{id,text,timestamp,username}`,
        {},
        'read comments'
      )
    ).json();

    const since = options?.since;

    // Instagram identifies comment authors by handle only, and the integration
    // name is a display name ("Buzzin: TV show"), not the handle - so there is
    // no reliable way to flag our own comments here. Left undefined on purpose
    // rather than guessing and hiding a real comment from the inbox.
    const toComment = (comment: any, parentId?: string): SocialComment => ({
      id: comment.id,
      message: comment.text || '',
      createdAt: dayjs(comment.timestamp).toISOString(),
      authorName: comment.username,
      parentId,
    });

    const flattened: SocialComment[] = [];
    for (const comment of data || []) {
      flattened.push(toComment(comment));
      for (const reply of comment.replies?.data || []) {
        flattened.push(toComment(reply, comment.id));
      }
    }

    return flattened.filter(
      (comment) => !since || dayjs(comment.createdAt).unix() > since
    );
  }

  // Instagram has a dedicated replies edge, unlike Facebook where a reply is
  // just another comment on the comment.
  async reply(
    id: string,
    commentId: string,
    message: string,
    accessToken: string
  ): Promise<SocialCommentReply> {
    const data = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${commentId}/replies?message=${encodeURIComponent(
          message
        )}&access_token=${accessToken}`,
        {
          method: 'POST',
        },
        'reply to comment'
      )
    ).json();

    return {
      id: data.id,
    };
  }

  // Instagram uses the `hide` field, not `is_hidden` like Facebook.
  async hideComment(
    commentId: string,
    hidden: boolean,
    token: string
  ): Promise<{ success: boolean }> {
    const [accessToken] = token.split('___');
    await this.fetch(
      `https://graph.facebook.com/v20.0/${commentId}?hide=${hidden}&access_token=${accessToken}`,
      { method: 'POST' },
      hidden ? 'hide comment' : 'unhide comment'
    );
    return { success: true };
  }

  async deleteComment(
    commentId: string,
    token: string
  ): Promise<{ success: boolean }> {
    const [accessToken] = token.split('___');
    await this.fetch(
      `https://graph.facebook.com/v20.0/${commentId}?access_token=${accessToken}`,
      { method: 'DELETE' },
      'delete comment'
    );
    return { success: true };
  }

  async recentComments(
    id: string,
    token: string,
    options?: CommentsQuery
  ): Promise<SocialComment[]> {
    const [accessToken] = token.split('___');
    const { data } = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${id}/media?fields=id,caption,permalink` +
          `&limit=${options?.limit ?? 15}&access_token=${accessToken}`,
        {},
        'read media'
      )
    ).json();

    // Posts are queried in parallel - sequentially, each channel took as long as
    // the sum of its posts and the Inbox tab sat there loading.
    const perPost = await Promise.all(
      (data || []).map(async (media: any) => {
        const comments = await this.comments(id, media.id, token, options);
        return comments.map((c) => ({
          ...c,
          postId: media.id,
          postText: media.caption || '',
          postUrl: media.permalink,
        }));
      })
    );

    return perPost.flat();
  }

  // Rozmowy na Instagramie ida przez powiazana strone Facebooka
  // (platform=instagram). Wymaga App Review - bez niego Graph zwraca
  // (#3) "Application does not have the capability".
  async conversations(
    id: string,
    token: string,
    options?: CommentsQuery
  ): Promise<SocialConversation[]> {
    const [accessToken] = token.split('___');
    const limit = options?.limit ?? 25;

    const { data } = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${id}/conversations?access_token=${accessToken}` +
          `&platform=instagram&limit=${limit}` +
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
          fromName: m.from?.username || m.from?.name,
          isFromUs: String(m.from?.id) === String(id),
        }))
        .reverse();

      const lastFromThem = [...messages].reverse().find((m) => !m.isFromUs);
      const canReplyFreely = !!lastFromThem &&
        dayjs().diff(dayjs(lastFromThem.createdAt), 'hour') < 24;

      return {
        id: thread.id,
        participantId: other?.id,
        participantName: other?.username || other?.name,
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
    token: string
  ): Promise<{ id: string }> {
    const [accessToken] = token.split('___');

    const data = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${id}/messages?access_token=${accessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: message },
          }),
        },
        'send message'
      )
    ).json();

    return { id: data.message_id || data.id };
  }

  /**
   * How one publication performed.
   *
   * Instagram keeps post numbers on the media object itself, so unlike Facebook
   * there is no reel/post split here. The metric list does depend on the media
   * type though (a photo has no plays), and Instagram answers an unsupported
   * metric with an error for the whole call rather than skipping it - hence the
   * narrower second attempt before giving up on insights entirely.
   */
  async postStats(
    id: string,
    postId: string,
    accessToken: string,
    integration?: Integration,
    type = 'graph.facebook.com'
  ): Promise<PostStatMetrics> {
    const media = await this.softJson(
      `https://${type}/v21.0/${postId}` +
        `?fields=media_type,permalink,like_count,comments_count` +
        `&access_token=${accessToken}`,
      'read media stats'
    );

    const metrics: PostStatMetrics = {
      permalink: media?.permalink,
      likes: media?.like_count,
      comments: media?.comments_count,
    };

    const full = 'reach,likes,comments,saved,shares,views,total_interactions';
    const withoutViews = 'reach,likes,comments,saved,shares,total_interactions';

    const insights =
      (await this.softJson(
        `https://${type}/v21.0/${postId}/insights?metric=${full}` +
          `&access_token=${accessToken}`,
        'read media insights'
      )) ||
      (await this.softJson(
        `https://${type}/v21.0/${postId}/insights?metric=${withoutViews}` +
          `&access_token=${accessToken}`,
        'read media insights'
      ));

    for (const row of insights?.data || []) {
      const value = row?.values?.[0]?.value;
      if (typeof value !== 'number') {
        continue;
      }

      switch (row.name) {
        case 'reach':
          metrics.reach = value;
          break;
        case 'views':
          metrics.views = value;
          break;
        case 'likes':
          metrics.likes = value;
          break;
        case 'comments':
          metrics.comments = value;
          break;
        case 'saved':
          metrics.saves = value;
          break;
        case 'shares':
          metrics.shares = value;
          break;
        case 'total_interactions':
          metrics.interactions = value;
          break;
      }
    }

    return metrics;
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number,
    type = 'graph.facebook.com'
  ): Promise<AnalyticsData[]> {
    const until = dayjs().endOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    const { data, ...all } = await (
      await fetch(
        `https://${type}/v21.0/${id}/insights?metric=follower_count,reach&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    const { data: data2, ...all2 } = await (
      await fetch(
        `https://${type}/v21.0/${id}/insights?metric_type=total_value&metric=likes,views,comments,shares,saves,replies&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();
    const analytics = [];

    analytics.push(
      ...(data?.map((d: any) => ({
        label: this.setTitle(d.name),
        percentageChange: 5,
        data: d.values.map((v: any) => ({
          total: v.value,
          date: dayjs(v.end_time).format('YYYY-MM-DD'),
        })),
      })) || [])
    );

    analytics.push(
      ...data2.map((d: any) => ({
        label: this.setTitle(d.name),
        percentageChange: 5,
        data: [
          {
            total: d.total_value.value,
            date: dayjs().format('YYYY-MM-DD'),
          },
          {
            total: d.total_value.value,
            date: dayjs().add(1, 'day').format('YYYY-MM-DD'),
          },
        ],
      }))
    );

    return analytics;
  }

  music(accessToken: string, data: { q: string }) {
    return this.fetch(
      `https://graph.facebook.com/v20.0/music/search?q=${encodeURIComponent(
        data.q
      )}&access_token=${accessToken}`
    );
  }
}
