import 'dotenv/config';
import { runAutonomousPublishingCycle } from '../server/autonomousScheduler.js';
import { recoverInterruptedPublications } from '../server/publishingStorage.js';

async function main() {
  recoverInterruptedPublications();

  const envFlag = process.env.TELEGRAM_AUTO_SEND_ENABLED?.trim();
  const dryRunOverride = envFlag === 'false' ? true : undefined;

  if (dryRunOverride) {
    console.log(
      'MELO_LOVE publishing scheduler: TELEGRAM_AUTO_SEND_ENABLED is "false". Running in safe dry-run mode (no real Telegram messages sent).'
    );
  }

  const summary = await runAutonomousPublishingCycle({
    mode: 'github_actions',
    dryRunOverride,
  });
  console.log('Publishing scheduler summary:', JSON.stringify(summary));

  if (!summary.ok) {
    console.error(`Publishing scheduler error: ${summary.error || summary.summary}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Publishing scheduler failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
