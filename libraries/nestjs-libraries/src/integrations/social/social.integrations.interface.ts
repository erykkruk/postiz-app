import { Integration } from '@prisma/client';

export interface ClientInformation {
  client_id: string;
  client_secret: string;
  instanceUrl: string;
}
export interface IAuthenticator {
  authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ): Promise<AuthTokenDetails | string>;
  refreshToken(refreshToken: string): Promise<AuthTokenDetails>;
  reConnect?(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>>;
  generateAuthUrl(
    clientInformation?: ClientInformation
  ): Promise<GenerateAuthUrlResponse>;
  analytics?(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]>;
  changeNickname?(
    id: string,
    accessToken: string,
    name: string
  ): Promise<{ name: string }>;
  changeProfilePicture?(
    id: string,
    accessToken: string,
    url: string
  ): Promise<{ url: string }>;
}

export interface AnalyticsData {
  label: string;
  data: Array<{ total: string; date: string }>;
  percentageChange: number;
}

export type GenerateAuthUrlResponse = {
  url: string;
  codeVerifier: string;
  state: string;
};

export type AuthTokenDetails = {
  id: string;
  name: string;
  error?: string;
  accessToken: string; // The obtained access token
  refreshToken?: string; // The refresh token, if applicable
  expiresIn?: number; // The duration in seconds for which the access token is valid
  picture?: string;
  username: string;
  additionalSettings?: {
    title: string;
    description: string;
    type: 'checkbox' | 'text' | 'textarea';
    value: any;
    regex?: string;
  }[];
};

export interface ISocialMediaIntegration {
  post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]>; // Schedules a new post

  // --- Inbox ---
  // Reading and answering comments written by other people. Publishing our own
  // first comment already happens inside `post`; this is the opposite
  // direction. Providers normalize their payload into SocialComment so that
  // generic inbox code never has to branch per platform.

  comments?(
    id: string,
    postId: string,
    accessToken: string,
    options?: CommentsQuery
  ): Promise<SocialComment[]>; // Reads comments under one published post

  reply?(
    id: string,
    commentId: string,
    message: string,
    accessToken: string
  ): Promise<SocialCommentReply>; // Answers one specific comment
}

export type CommentsQuery = {
  limit?: number; // Provider default when omitted
  since?: number; // Unix seconds, only comments created after this moment
};

// One comment, normalized across providers.
export type SocialComment = {
  id: string; // Platform comment id, the handle `reply` takes
  message: string;
  createdAt: string; // ISO 8601, normalized from each platform's own format
  authorId?: string; // Missing on platforms that hide it, never invent one
  authorName?: string;
  permalink?: string;
  parentId?: string; // Set when this comment answers another comment
  isOwnComment?: boolean; // Undefined when the platform gives no way to tell
  replies?: SocialComment[]; // Only filled by providers that return them inline
};

export type SocialCommentReply = {
  id: string; // Platform id of the reply we just created
  permalink?: string;
};

export type PostResponse = {
  id: string; // The db internal id of the post
  postId: string; // The ID of the scheduled post returned by the platform
  releaseURL: string; // The URL of the post on the platform
  status: string; // Status of the operation or initial post status
};

export type PostDetails<T = any> = {
  id: string;
  message: string;
  settings: T;
  media?: MediaContent[];
  poll?: PollDetails;
};

export type PollDetails = {
  options: string[]; // Array of poll options
  duration: number; // Duration in hours for which the poll will be active
};

export type MediaContent = {
  type: 'image' | 'video'; // Type of the media content
  path: string;
  alt?: string;
  thumbnail?: string;
  thumbnailTimestamp?: number;
};

export type FetchPageInformationResult = {
  id: string;
  name: string;
  access_token: string;
  picture: string;
  username: string;
};

export interface SocialProvider
  extends IAuthenticator,
    ISocialMediaIntegration {
  identifier: string;
  refreshWait?: boolean;
  convertToJPEG?: boolean;
  dto?: any;
  maxLength: (additionalSettings?: any) => number;
  isWeb3?: boolean;
  editor: 'normal' | 'markdown' | 'html';
  customFields?: () => Promise<
    {
      key: string;
      label: string;
      defaultValue?: string;
      validation: string;
      type: 'text' | 'password';
    }[]
  >;
  name: string;
  toolTip?: string;
  oneTimeToken?: boolean;
  isBetweenSteps: boolean;
  scopes: string[];
  externalUrl?: (
    url: string
  ) => Promise<{ client_id: string; client_secret: string }>;
  mention?: (
    token: string, data: { query: string }, id: string, integration: Integration
  ) => Promise<{ id: string; label: string; image: string, doNotCache?: boolean }[] | {none: true}>;
  mentionFormat?(idOrHandle: string, name: string): string;
  fetchPageInformation?(
    accessToken: string,
    data: any
  ): Promise<FetchPageInformationResult>;
}
