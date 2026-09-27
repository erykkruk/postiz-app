import { proxyActivities } from '@temporalio/workflow';
import { SyncActivity } from '@gitroom/orchestrator/activities/sync.activity';

const { syncPostStats } = proxyActivities<SyncActivity>({
  startToCloseTimeout: '50 minute',
  heartbeatTimeout: '2 minute',
  // No retry, like the cron task this replaces: the next scheduled run starts
  // from scratch within the hour anyway.
  retry: { maximumAttempts: 1 },
});

// One pass per run; the hourly repetition comes from the cronSchedule it is
// started with in InfiniteWorkflowRegister.
export async function syncPostStatsWorkflow() {
  await syncPostStats();
}
