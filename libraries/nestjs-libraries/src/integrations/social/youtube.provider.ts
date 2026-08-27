import {
  AnalyticsData,
  AuthTokenDetails,
  CommentsQuery,
  PostDetails,
  PostResponse,
  PostStatMetrics,
  SocialComment,
  SocialCommentReply,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library/build/src/auth/oauth2client';
import axios from 'axios';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import {
  BadBody,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import * as process from 'node:process';
import dayjs from 'dayjs';
import { GaxiosResponse } from 'gaxios/build/src/common';
import Schema$Video = youtube_v3.Schema$Video;
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';

const clientAndYoutube = () => {
  const client = new google.auth.OAuth2({
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: `${process.env.FRONTEND_URL}/integrations/social/youtube`,
  });

  const youtube = (newClient: OAuth2Client) =>
    google.youtube({
      version: 'v3',
      auth: newClient,
    });

  const youtubeAnalytics = (newClient: OAuth2Client) =>
    google.youtubeAnalytics({
      version: 'v2',
      auth: newClient,
    });

  const oauth2 = (newClient: OAuth2Client) =>
    google.oauth2({
      version: 'v2',
      auth: newClient,
    });

  return { client, youtube, oauth2, youtubeAnalytics };
};

@Rules('YouTube must have on video attachment, it cannot be empty')
export class YoutubeProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 1; // YouTube has strict upload quotas
  identifier = 'youtube';
  name = 'YouTube';
  isBetweenSteps = true;
  dto = YoutubeSettingsDto;
  scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtubepartner',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ];

  editor = 'normal' as const;
  maxLength() {
    return 5000;
  }

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    if (body.includes('invalidTitle')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but we could not set the title. Title is too long.',
      };
    }

    if (body.includes('failedPrecondition')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but we could not set the thumbnail. Thumbnail size is too large.',
      };
    }

    if (body.includes('uploadLimitExceeded')) {
      return {
        type: 'bad-body',
        value:
          'You have reached your daily upload limit, please try again tomorrow.',
      };
    }

    if (body.includes('youtubeSignupRequired')) {
      return {
        type: 'bad-body',
        value:
          'You have to link your youtube account to your google account first.',
      };
    }

    if (body.includes('youtube.thumbnail')) {
      return {
        type: 'bad-body',
        value:
          'Your account is not verified, we have uploaded your video but we could not set the thumbnail. Please verify your account and try again.',
      };
    }

    return undefined;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    const { client, oauth2 } = clientAndYoutube();
    client.setCredentials({ refresh_token });
    const { credentials } = await client.refreshAccessToken();
    const user = oauth2(client);
    const expiryDate = new Date(credentials.expiry_date!);
    const unixTimestamp =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(new Date().getTime() / 1000);

    const { data } = await user.userinfo.get();

    return {
      accessToken: credentials.access_token!,
      expiresIn: unixTimestamp!,
      refreshToken: credentials.refresh_token!,
      id: data.id!,
      name: data.name!,
      picture: data?.picture || '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeId(7);
    const { client } = clientAndYoutube();
    return {
      url: client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        state,
        redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/youtube`,
        scope: this.scopes.slice(0),
      }),
      codeVerifier: makeId(11),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const { client, oauth2 } = clientAndYoutube();
    const { tokens } = await client.getToken(params.code);
    client.setCredentials(tokens);
    const { scopes } = await client.getTokenInfo(tokens.access_token!);
    this.checkScopes(this.scopes, scopes);

    const user = oauth2(client);
    const { data } = await user.userinfo.get();

    const expiryDate = new Date(tokens.expiry_date!);
    const unixTimestamp =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(new Date().getTime() / 1000);

    return {
      accessToken: tokens.access_token!,
      expiresIn: unixTimestamp,
      refreshToken: tokens.refresh_token!,
      id: data.id!,
      name: data.name!,
      picture: data?.picture || '',
      username: '',
    };
  }

  async pages(accessToken: string) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      // Get all channels the user has access to
      const response = await youtubeClient.channels.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        mine: true,
      });

      const channels = response.data.items || [];

      return channels.map((channel) => ({
        id: channel.id!,
        name: channel.snippet?.title || 'Unnamed Channel',
        picture: {
          data: {
            url: channel.snippet?.thumbnails?.default?.url || '',
          },
        },
        username: channel.snippet?.customUrl || '',
        subscriberCount: channel.statistics?.subscriberCount || '0',
      }));
    } catch (error) {
      console.error('Failed to fetch YouTube channels:', error);
      return [];
    }
  }

  async fetchPageInformation(
    accessToken: string,
    data: { id: string }
  ) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      const response = await youtubeClient.channels.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        id: [data.id],
      });

      const channel = response.data.items?.[0];

      if (!channel) {
        throw new Error('Channel not found');
      }

      return {
        id: channel.id!,
        name: channel.snippet?.title || 'Unnamed Channel',
        access_token: accessToken,
        picture: channel.snippet?.thumbnails?.default?.url || '',
        username: channel.snippet?.customUrl || '',
      };
    } catch (error) {
      console.error('Failed to fetch YouTube channel information:', error);
      throw error;
    }
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const pages = await this.pages(accessToken);
    const findPage = pages.find((p) => p.id === requiredId);

    if (!findPage) {
      throw new Error('Channel not found');
    }

    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost, ...comments] = postDetails;

    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    const { settings }: { settings: YoutubeSettingsDto } = firstPost;

    const response = await axios({
      url: firstPost?.media?.[0]?.path,
      method: 'GET',
      responseType: 'stream',
    });

    const all: GaxiosResponse<Schema$Video> = await this.runInConcurrent(
      async () =>
        youtubeClient.videos.insert({
          part: ['id', 'snippet', 'status'],
          notifySubscribers: true,
          requestBody: {
            snippet: {
              title: settings.title,
              description: firstPost?.message,
              ...(settings?.tags?.length
                ? { tags: settings.tags.map((p) => p.label) }
                : {}),
            },
            status: {
              privacyStatus: settings.type,
              selfDeclaredMadeForKids:
                settings.selfDeclaredMadeForKids === 'yes',
            },
          },
          media: {
            body: response.data,
          },
        }),
      true
    );

    if (settings?.thumbnail?.path) {
      await this.runInConcurrent(async () =>
        youtubeClient.thumbnails.set({
          videoId: all?.data?.id!,
          media: {
            body: (
              await axios({
                url: settings?.thumbnail?.path,
                method: 'GET',
                responseType: 'stream',
              })
            ).data,
          },
        })
      );
    }

    return [
      {
        id: firstPost.id,
        releaseURL: `https://www.youtube.com/watch?v=${all?.data?.id}`,
        postId: all?.data?.id!,
        status: 'success',
      },
    ];
  }

  // Reads comments under one of our videos. YouTube returns threads rather than
  // single comments, so the top-level comment and its replies are flattened
  // into the shared shape and linked through parentId.
  async comments(
    id: string,
    postId: string,
    accessToken: string,
    options?: CommentsQuery
  ): Promise<SocialComment[]> {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    const { data } = await youtubeClient.commentThreads.list({
      part: ['snippet', 'replies'],
      videoId: postId,
      // The API caps this at 100 per page, asking for more is rejected.
      maxResults: Math.min(options?.limit ?? 100, 100),
      order: 'time',
    });

    const since = options?.since;

    const toComment = (comment: any, parentId?: string): SocialComment => ({
      id: comment.id,
      message:
        comment.snippet?.textOriginal || comment.snippet?.textDisplay || '',
      createdAt: dayjs(comment.snippet?.publishedAt).toISOString(),
      authorId: comment.snippet?.authorChannelId?.value,
      authorName: comment.snippet?.authorDisplayName,
      // Deep link that opens the video with this comment highlighted.
      permalink: `https://www.youtube.com/watch?v=${postId}&lc=${comment.id}`,
      parentId,
      isOwnComment: comment.snippet?.authorChannelId?.value === id,
    });

    const flattened: SocialComment[] = [];
    for (const thread of data?.items || []) {
      const topLevel = thread.snippet?.topLevelComment;
      if (!topLevel) {
        continue;
      }

      flattened.push(toComment(topLevel));
      for (const reply of thread.replies?.comments || []) {
        flattened.push(toComment(reply, topLevel.id!));
      }
    }

    return flattened.filter(
      (comment) => !since || dayjs(comment.createdAt).unix() > since
    );
  }

  // YouTube replies always attach to the top-level comment of a thread, so
  // passing a reply's id as parentId is rejected by the API.
  async reply(
    id: string,
    commentId: string,
    message: string,
    accessToken: string
  ): Promise<SocialCommentReply> {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    const { data } = await youtubeClient.comments.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          parentId: commentId,
          textOriginal: message,
        },
      },
    });

    return {
      id: data.id!,
    };
  }

  /**
   * How one video performed.
   *
   * Two sources, because they answer different questions. The Data API returns
   * the public counters everyone sees (views, likes, comments). The Analytics
   * API adds what only the owner can see: watch time, the share of the video an
   * average viewer sits through, subscribers gained, and the retention curve -
   * the number we actually pick creatives by.
   */
  async postStats(
    id: string,
    postId: string,
    accessToken: string
  ): Promise<PostStatMetrics> {
    const { client, youtube, youtubeAnalytics } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });

    const metrics: PostStatMetrics = {
      permalink: `https://www.youtube.com/watch?v=${postId}`,
    };

    try {
      const { data } = await youtube(client).videos.list({
        id: [postId],
        part: ['statistics'],
      });

      const stats = data?.items?.[0]?.statistics;
      if (stats) {
        metrics.views = Number(stats.viewCount ?? 0);
        metrics.likes = Number(stats.likeCount ?? 0);
        metrics.comments = Number(stats.commentCount ?? 0);
      }
    } catch (err) {
      // A deleted or private video still has a row in our calendar - leave the
      // public counters unset rather than failing the whole sync.
    }

    // The owner-only numbers need a date range. Counting from the day YouTube
    // started (2005) is simply "everything", the API has no lifetime shortcut.
    const startDate = '2005-01-01';
    const endDate = dayjs().format('YYYY-MM-DD');

    try {
      const { data } = await youtubeAnalytics(client).reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        filters: `video==${postId}`,
        metrics:
          'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,' +
          'subscribersGained,shares',
      });

      const columns = data?.columnHeaders?.map((c) => c.name) || [];
      const row = data?.rows?.[0] || [];
      const value = (name: string) => {
        const index = columns.indexOf(name);
        return index === -1 ? undefined : Number(row[index]);
      };

      const minutesWatched = value('estimatedMinutesWatched');
      const averageSeconds = value('averageViewDuration');

      metrics.totalWatchMs =
        minutesWatched === undefined ? undefined : minutesWatched * 60_000;
      metrics.avgWatchMs =
        averageSeconds === undefined ? undefined : averageSeconds * 1000;
      metrics.followersGained = value('subscribersGained');
      metrics.shares = value('shares');

      const averagePercentage = value('averageViewPercentage');
      if (averagePercentage !== undefined) {
        metrics.extra = {
          ...(metrics.extra || {}),
          averageViewPercentage: averagePercentage,
        };
      }
    } catch (err) {
      // Analytics lags behind publication by a day or two and answers 400 for a
      // video it has no data on yet. The public counters above still stand.
    }

    try {
      const { data } = await youtubeAnalytics(client).reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        filters: `video==${postId};audienceType==ORGANIC`,
        metrics: 'audienceWatchRatio',
        dimensions: 'elapsedVideoTimeRatio',
        sort: 'elapsedVideoTimeRatio',
      });

      // YouTube reports retention as a share of the video length, Facebook as
      // seconds. We keep the platform's own unit and let the chart label it.
      const retention = (data?.rows || []).map((r: any) => ({
        second: Number(r[0]),
        ratio: Number(r[1]),
      }));

      if (retention.length) {
        metrics.retention = retention;
      }
    } catch (err) {
      // Retention needs a minimum number of views before YouTube will show it.
    }

    return metrics;
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    try {
      const endDate = dayjs().format('YYYY-MM-DD');
      const startDate = dayjs().subtract(date, 'day').format('YYYY-MM-DD');

      const { client, youtubeAnalytics } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });

      const youtubeClient = youtubeAnalytics(client);
      const { data } = await youtubeClient.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics:
          'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,subscribersLost',
        dimensions: 'day',
        sort: 'day',
      });

      const columns = data?.columnHeaders?.map((p) => p.name)!;
      const mappedData = data?.rows?.map((p) => {
        return columns.reduce((acc, curr, index) => {
          acc[curr!] = p[index];
          return acc;
        }, {} as any);
      });

      const acc = [] as any[];
      acc.push({
        label: 'Estimated Minutes Watched',
        data: mappedData?.map((p: any) => ({
          total: p.estimatedMinutesWatched,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Average View Duration',
        average: true,
        data: mappedData?.map((p: any) => ({
          total: p.averageViewDuration,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Average View Percentage',
        average: true,
        data: mappedData?.map((p: any) => ({
          total: p.averageViewPercentage,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Subscribers Gained',
        data: mappedData?.map((p: any) => ({
          total: p.subscribersGained,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Subscribers Lost',
        data: mappedData?.map((p: any) => ({
          total: p.subscribersLost,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Likes',
        data: mappedData?.map((p: any) => ({
          total: p.likes,
          date: p.day,
        })),
      });

      return acc;
    } catch (err) {
      return [];
    }
  }
}
