import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/**
 * Pulls comments and conversations from every channel into the local database
 * once an hour, so the panel opens instantly on ready rows instead of waiting
 * for the platforms on every visit.
 */
@Injectable()
export class SyncInbox {
  constructor(
    private _integrationService: IntegrationService,
    private _organizations: PrismaRepository<'organization'>
  ) {}

  @Cron('7 * * * *')
  async handleCron() {
    const organizations = await this._organizations.model.organization.findMany({
      select: { id: true },
    });

    // Organizations one at a time, channels inside an organization in parallel -
    // otherwise many accounts would fire an avalanche of Meta calls at once.
    for (const org of organizations) {
      await this._integrationService.syncOrganization(org.id, 'comment');
      await this._integrationService.syncOrganization(org.id, 'conversation');
    }
  }
}
