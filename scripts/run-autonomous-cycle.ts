import 'dotenv/config';
import { CollectionType } from '../src/shared/types.js';
import {
  runAutonomousProductionCycle,
  runAutonomousPublishingCycle,
  runAutonomousResearchCycle,
  runFullAutonomousCycle,
} from '../server/autonomousScheduler.js';
import { isGeminiConfigured } from '../server/geminiClient.js';
import { isZaiConfigured } from '../server/zaiClient.js';
import { isGigaChatConfigured } from '../server/aiClient.js';

async function main() {
  const modeEnv = (process.env.AUTONOMOUS_MODE || 'full_cycle').trim();
  const colEnv = (process.env.AUTONOMOUS_COLLECTION || 'alternate').trim();
  const dryRunEnv = process.env.AUTONOMOUS_DRY_RUN?.trim();
  const collectionOverride: CollectionType | undefined =
    colEnv === 'debate' || colEnv === 'romantic' ? colEnv : undefined;

  const dryRunPublish =
    dryRunEnv === 'true'
      ? true
      : dryRunEnv === 'false'
        ? false
        : process.env.TELEGRAM_AUTO_SEND_ENABLED === 'false';

  console.log(
    `MELO_LOVE Autonomous Runner: mode=${modeEnv}, collection=${collectionOverride || 'auto'}, dryRunPublish=${dryRunPublish}`
  );
  console.log(
    `AI-провайдеры: Gemini=${isGeminiConfigured() ? 'настроен' : '—'}, резервный Z.ai (GLM)=${
      isZaiConfigured() ? 'настроен' : '—'
    }, GigaChat=${isGigaChatConfigured() ? 'настроен' : '—'}`
  );

  if (modeEnv === 'research_only') {
    const res = await runAutonomousResearchCycle({
      mode: 'github_actions',
      collectionOverride,
    });
    console.log('Research cycle result:', JSON.stringify(res));
    if (!res.ok) {
      console.error(`Research cycle failed: ${res.error || res.summary}`);
      process.exitCode = 1;
    }
    return;
  }

  if (modeEnv === 'produce_only') {
    const res = await runAutonomousProductionCycle({ mode: 'github_actions' });
    console.log('Production cycle result:', JSON.stringify(res));
    if (!res.ok) {
      console.error(`Production cycle failed: ${res.error || res.summary}`);
      process.exitCode = 1;
    }
    return;
  }

  if (modeEnv === 'publish_only') {
    const res = await runAutonomousPublishingCycle({
      mode: 'github_actions',
      dryRunOverride: dryRunPublish,
    });
    console.log('Publish cycle result:', JSON.stringify(res));
    if (!res.ok) {
      console.error(`Publish cycle failed: ${res.error || res.summary}`);
      process.exitCode = 1;
    }
    return;
  }

  const full = await runFullAutonomousCycle({
    mode: 'github_actions',
    collectionOverride,
    dryRunPublish,
  });
  console.log('Full autonomous cycle result:', JSON.stringify(full));

  const failures: string[] = [];
  if (!full.research.ok) failures.push(`research: ${full.research.error || full.research.summary}`);
  if (!full.production.ok) failures.push(`production: ${full.production.error || full.production.summary}`);
  if (!full.publish.ok) failures.push(`publish: ${full.publish.error || full.publish.summary}`);

  if (failures.length > 0) {
    console.error(`Autonomous cycle encountered errors -> ${failures.join(' | ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Autonomous runner failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
