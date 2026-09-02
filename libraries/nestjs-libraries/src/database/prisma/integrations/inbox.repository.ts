import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/**
 * A local copy of the comments and conversations from the platforms.
 *
 * The panel reads only from here, which is why it opens instantly instead of
 * waiting on the Graph API. Freshness is handled by the cron that syncs the
 * channels in the background.
 */
@Injectable()
export class InboxRepository {
  constructor(
    private _items: PrismaRepository<'inboxItem'>,
    private _sync: PrismaRepository<'inboxSync'>
  ) {}

  list(org: string, kind: string, integrationIds?: string[]) {
    return this._items.model.inboxItem.findMany({
      where: {
        // Our own comments are fetched too: they never reach the list, but they
        // are needed to show our reply inside the thread under a comment.
        organizationId: org,
        kind,
        ...(integrationIds?.length
          ? { integrationId: { in: integrationIds } }
          : {}),
      },
      orderBy: { happenedAt: 'desc' },
      take: 500,
    });
  }

  /**
   * Comments under one publication, ours included.
   *
   * Keyed by the platform's own post id (Post.releaseId), because that is the
   * only identifier both sides share: the inbox knows nothing about our
   * calendar rows.
   */
  commentsForPost(org: string, integrationId: string, postId: string) {
    return this._items.model.inboxItem.findMany({
      where: {
        organizationId: org,
        integrationId,
        kind: 'comment',
        postId,
      },
      orderBy: { happenedAt: 'asc' },
      take: 500,
    });
  }

  /**
   * Stores fetched items. The (integrationId, externalId, kind) key makes a
   * re-sync update the existing row instead of creating a duplicate, so an
   * `isRead` flag survives later runs.
   */
  async upsertMany(
    org: string,
    integrationId: string,
    kind: string,
    items: Array<{
      externalId: string;
      authorName?: string;
      authorId?: string;
      content: string;
      permalink?: string;
      parentId?: string;
      postId?: string;
      postText?: string;
      postUrl?: string;
      payload?: any;
      happenedAt: Date;
      isOwn?: boolean;
    }>
  ) {
    for (const item of items) {
      const data = {
        authorName: item.authorName,
        authorId: item.authorId,
        content: item.content,
        permalink: item.permalink,
        parentId: item.parentId,
        postId: item.postId,
        postText: item.postText,
        postUrl: item.postUrl,
        payload: item.payload ?? undefined,
        happenedAt: item.happenedAt,
        isOwn: !!item.isOwn,
      };

      await this._items.model.inboxItem.upsert({
        where: {
          integrationId_externalId_kind: {
            integrationId,
            externalId: item.externalId,
            kind,
          },
        },
        create: {
          organizationId: org,
          integrationId,
          externalId: item.externalId,
          kind,
          ...data,
        },
        update: data,
      });
    }
  }

  markRead(org: string, ids: string[], read: boolean) {
    return this._items.model.inboxItem.updateMany({
      where: { organizationId: org, externalId: { in: ids } },
      data: { isRead: read },
    });
  }

  syncState(org: string) {
    return this._sync.model.inboxSync.findMany({
      where: { organizationId: org },
    });
  }

  saveSync(org: string, integrationId: string, kind: string, error?: string) {
    const data = { lastSyncAt: new Date(), lastError: error || null };
    return this._sync.model.inboxSync.upsert({
      where: { integrationId_kind: { integrationId, kind } },
      create: { organizationId: org, integrationId, kind, ...data },
      update: data,
    });
  }
}
