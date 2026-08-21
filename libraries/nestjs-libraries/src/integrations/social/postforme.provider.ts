import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { Integration } from '@prisma/client';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

const API = 'https://api.postforme.dev/v1';

// Klucz projektu Post for Me nie wygasa, ale interfejs wymaga liczby sekund.
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365;

type PfmAccount = {
  id: string;
  platform: string;
  username: string;
  profile_photo_url?: string;
  external_id?: string;
  status?: string;
};

/**
 * Publikacja przez Post for Me (postforme.dev) zamiast bezposrednio przez API
 * platformy. Sensowne tam, gdzie wlasna aplikacja deweloperska jest
 * niedostepna albo czeka na weryfikacje - Post for Me trzyma OAuth u siebie,
 * my podajemy tylko klucz projektu.
 *
 * Token integracji w Postizie to `apiKey`, a `internalId` to identyfikator
 * konta po stronie Post for Me (`spc_...`).
 */
export abstract class PostForMeProvider
  extends SocialAbstract
  implements SocialProvider
{
  /** Nazwa platformy w Post for Me, np. "tiktok", "instagram". */
  abstract platform: string;
  abstract identifier: string;
  abstract name: string;

  isBetweenSteps = false;
  editor = 'normal' as const;
  scopes = [] as string[];
  override maxConcurrentJob = 2;

  maxLength() {
    return 2200;
  }

  async generateAuthUrl() {
    return { url: '', codeVerifier: makeId(10), state: makeId(6) };
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    // Post for Me odswieza tokeny platform po swojej stronie, my trzymamy
    // tylko klucz projektu, ktory nie wygasa.
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

  async customFields() {
    return [
      {
        key: 'apiKey',
        label: 'Post for Me - klucz projektu (pfm_live_...)',
        validation: `/^pfm_.{10,}$/`,
        type: 'password' as const,
      },
      {
        key: 'accountId',
        label: 'ID konta (spc_...) - zostaw puste, aby wziac pierwsze konto tej platformy',
        validation: `/^(|spc_.{5,})$/`,
        type: 'text' as const,
      },
    ];
  }

  private async accounts(apiKey: string): Promise<PfmAccount[]> {
    const { data } = await (
      await this.fetch(`${API}/social-accounts`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
    ).json();
    return data || [];
  }

  async authenticate(params: { code: string }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString());
    const apiKey: string = body.apiKey;
    const wanted: string = (body.accountId || '').trim();

    const all = await this.accounts(apiKey);
    const forPlatform = all.filter((a) => a.platform === this.platform);

    const account = wanted
      ? forPlatform.find((a) => a.id === wanted)
      : forPlatform[0];

    if (!account) {
      throw new Error(
        `Post for Me: brak polaczonego konta ${this.platform}. Polacz je najpierw w panelu postforme.dev.`
      );
    }

    return {
      id: account.id,
      name: account.username || account.external_id || this.platform,
      accessToken: apiKey,
      refreshToken: apiKey,
      expiresIn: TOKEN_TTL_SECONDS,
      picture: account.profile_photo_url || '',
      username: account.username || account.external_id || '',
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [first, ...rest] = postDetails;

    const media = (first.media || []).map((m) => ({ url: m.path }));

    const { data, id: postId } = await (
      await this.fetch(`${API}/social-posts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caption: first.message,
          social_accounts: [id],
          ...(media.length ? { media } : {}),
        }),
      })
    ).json();

    const created = data || { id: postId };

    return [
      {
        id: first.id,
        postId: String(created.id || ''),
        releaseURL: created.platform_url || '',
        status: 'success',
      },
      // Watki nie sa wspierane przez Post for Me - kazda kolejna czesc
      // musialaby byc osobnym postem, wiec je pomijamy zamiast cicho gubic.
      ...rest.map((r) => ({
        id: r.id,
        postId: '',
        releaseURL: '',
        status: 'success',
      })),
    ];
  }
}

export class TikTokPfmProvider extends PostForMeProvider {
  platform = 'tiktok';
  identifier = 'tiktok-pfm';
  name = 'TikTok (PFM)';
}

export class InstagramPfmProvider extends PostForMeProvider {
  platform = 'instagram';
  identifier = 'instagram-pfm';
  name = 'Instagram (PFM)';
}

export class FacebookPfmProvider extends PostForMeProvider {
  platform = 'facebook';
  identifier = 'facebook-pfm';
  name = 'Facebook (PFM)';
}

export class YoutubePfmProvider extends PostForMeProvider {
  platform = 'youtube';
  identifier = 'youtube-pfm';
  name = 'YouTube (PFM)';
}

export class XPfmProvider extends PostForMeProvider {
  platform = 'x';
  identifier = 'x-pfm';
  name = 'X (PFM)';
}

export class LinkedinPfmProvider extends PostForMeProvider {
  platform = 'linkedin';
  identifier = 'linkedin-pfm';
  name = 'LinkedIn (PFM)';
}

export class PinterestPfmProvider extends PostForMeProvider {
  platform = 'pinterest';
  identifier = 'pinterest-pfm';
  name = 'Pinterest (PFM)';
}

export class ThreadsPfmProvider extends PostForMeProvider {
  platform = 'threads';
  identifier = 'threads-pfm';
  name = 'Threads (PFM)';
}

export class BlueskyPfmProvider extends PostForMeProvider {
  platform = 'bluesky';
  identifier = 'bluesky-pfm';
  name = 'Bluesky (PFM)';
}
