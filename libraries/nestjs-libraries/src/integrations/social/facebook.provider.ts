import {
  AnalyticsData,
  AuthTokenDetails,
  CommentsQuery,
  PostDetails,
  PostResponse,
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
    // Wiadomosci: wymaga ponownego zalogowania kanalu, zeby token je poniosl.
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

    // Posty odpytujemy rownolegle - sekwencyjnie kazdy kanal trwal tyle, ile
    // suma jego postow, i zakladka Inbox wisiala na wczytywaniu.
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

  // Prywatne rozmowy ze strony. Wymaga uprawnienia pages_messaging - bez niego
  // Graph zwraca (#200) i UI pokazuje prosbe o ponowne zalogowanie kanalu.
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

      // Meta pozwala odpisac swobodnie tylko w ciagu 24h od ostatniej wiadomosci
      // rozmowcy. Poza tym oknem trzeba uzyc oznaczonych typow wiadomosci,
      // dlatego UI nie moze wtedy pokazywac zwyklego pola odpowiedzi.
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

    const { data } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/${id}/insights?metric=page_impressions_unique,page_posts_impressions_unique,page_post_engagements,page_daily_follows,page_video_views&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    return (
      data?.map((d: any) => ({
        label:
          d.name === 'page_impressions_unique'
            ? 'Page Impressions'
            : d.name === 'page_post_engagements'
            ? 'Posts Engagement'
            : d.name === 'page_daily_follows'
            ? 'Page followers'
            : d.name === 'page_video_views'
            ? 'Videos views'
            : 'Posts Impressions',
        percentageChange: 5,
        data: d?.values?.map((v: any) => ({
          total: v.value,
          date: dayjs(v.end_time).format('YYYY-MM-DD'),
        })),
      })) || []
    );
  }
}
