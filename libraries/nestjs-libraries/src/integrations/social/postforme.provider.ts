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
const PLATFORMS = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'x', label: 'X (Twitter)' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'threads', label: 'Threads' },
  { value: 'bluesky', label: 'Bluesky' },
];

export class PostForMeProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'postforme';
  name = 'Post for Me';

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
        key: 'platform',
        label: 'Platforma',
        validation: `/^.{2,}$/`,
        type: 'select' as const,
        options: PLATFORMS,
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
    const platform: string = (body.platform || '').trim();
    const wanted: string = (body.accountId || '').trim();

    const all = await this.accounts(apiKey);
    const forPlatform = all.filter((a) => a.platform === platform);

    const account = wanted
      ? forPlatform.find((a) => a.id === wanted)
      : forPlatform[0];

    if (!account) {
      // Wypisujemy, co faktycznie jest polaczone - inaczej user zgaduje,
      // czy pomylil platforme, czy nie polaczyl konta w panelu PFM.
      const available = all
        .map((a) => `${a.platform}:${a.username || a.id}`)
        .join(', ');
      throw new Error(
        `Post for Me: brak konta dla platformy "${platform}". ` +
          `Polaczone konta: ${available || 'brak'}. ` +
          'Polacz konto w panelu postforme.dev albo wybierz inna platforme.'
      );
    }

    return {
      id: account.id,
      name: `${account.username || account.external_id || platform} (PFM)`,
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

