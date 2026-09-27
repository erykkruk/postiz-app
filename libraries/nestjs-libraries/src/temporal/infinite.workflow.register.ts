import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';

const FORK_SYNC_WORKFLOWS = [
  { name: 'syncInboxWorkflow', id: 'sync-inbox-workflow', cronSchedule: '7 * * * *' },
  { name: 'syncPostStatsWorkflow', id: 'sync-post-stats-workflow', cronSchedule: '30 * * * *' },
];

@Injectable()
export class InfiniteWorkflowRegister implements OnModuleInit {
  constructor(private _temporalService: TemporalService) {}

  async onModuleInit(): Promise<void> {
    if (!!process.env.RUN_CRON) {
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('missingPostWorkflow', {
            workflowId: 'missing-post-workflow',
            taskQueue: 'main',
          });
      } catch (err) {}

      // Our two syncs keep the minute offsets the old @Cron tasks had (:07
      // and :30), so they never fire together against the same Graph API.
      // Starting an already running cron workflow throws; that is expected.
      for (const { name, id, cronSchedule } of FORK_SYNC_WORKFLOWS) {
        try {
          await this._temporalService.client
            ?.getRawClient()
            ?.workflow?.start(name, {
              workflowId: id,
              taskQueue: 'main',
              cronSchedule,
            });
        } catch (err) {}
      }
    }
  }
}

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [InfiniteWorkflowRegister],
  get exports() {
    return this.providers;
  },
})
export class InfiniteWorkflowRegisterModule {}
