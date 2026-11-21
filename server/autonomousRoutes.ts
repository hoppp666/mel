import { Router } from 'express';
import { CollectionType } from '../src/shared/types.js';
import {
  loadAutonomousState,
  saveAutonomousState,
} from './autonomousStorage.js';
import {
  buildAutonomousMonitoringSnapshot,
  isAutonomousCycleRunning,
  runAutonomousProductionCycle,
  runAutonomousPublishingCycle,
  runAutonomousResearchCycle,
  runFullAutonomousCycle,
} from './autonomousScheduler.js';

export function createAutonomousRouter(): Router {
  const router = Router();

  router.get('/state', async (_req, res) => {
    const snapshot = await buildAutonomousMonitoringSnapshot();
    res.json(snapshot);
  });

  router.put('/config', async (req, res) => {
    const state = loadAutonomousState();
    const b = req.body || {};
    state.config = {
      ...state.config,
      researchEnabled:
        typeof b.researchEnabled === 'boolean'
          ? b.researchEnabled
          : state.config.researchEnabled,
      autoPublishEnabled:
        typeof b.autoPublishEnabled === 'boolean'
          ? b.autoPublishEnabled
          : state.config.autoPublishEnabled,
      researchIntervalHours:
        typeof b.researchIntervalHours === 'number'
          ? Math.max(1, Math.min(48, Math.round(b.researchIntervalHours)))
          : state.config.researchIntervalHours,
      researchBatchSize:
        typeof b.researchBatchSize === 'number'
          ? Math.max(1, Math.min(10, Math.round(b.researchBatchSize)))
          : state.config.researchBatchSize,
      productionBatchSize:
        typeof b.productionBatchSize === 'number'
          ? Math.max(1, Math.min(5, Math.round(b.productionBatchSize)))
          : state.config.productionBatchSize,
      publishMinIntervalHours:
        typeof b.publishMinIntervalHours === 'number'
          ? Math.max(1, Math.min(24, Math.round(b.publishMinIntervalHours)))
          : state.config.publishMinIntervalHours,
      maxPublishesPerDay:
        typeof b.maxPublishesPerDay === 'number'
          ? Math.max(1, Math.min(12, Math.round(b.maxPublishesPerDay)))
          : state.config.maxPublishesPerDay,
      collectionsRotation:
        b.collectionsRotation === 'debate' ||
        b.collectionsRotation === 'romantic' ||
        b.collectionsRotation === 'alternate'
          ? b.collectionsRotation
          : state.config.collectionsRotation,
      stopRequested:
        typeof b.stopRequested === 'boolean'
          ? b.stopRequested
          : state.config.stopRequested,
      githubRepo:
        b.githubRepo !== undefined
          ? String(b.githubRepo).trim()
          : state.config.githubRepo,
      updatedAt: new Date().toISOString(),
    };
    state.nextScheduledResearchAt = new Date(
      Date.now() + state.config.researchIntervalHours * 3600_000
    ).toISOString();
    saveAutonomousState(state);
    const snapshot = await buildAutonomousMonitoringSnapshot();
    res.json(snapshot);
  });

  router.post('/stop', async (_req, res) => {
    const state = loadAutonomousState();
    state.config.stopRequested = true;
    state.config.updatedAt = new Date().toISOString();
    saveAutonomousState(state);
    res.json(await buildAutonomousMonitoringSnapshot());
  });

  router.post('/resume', async (_req, res) => {
    const state = loadAutonomousState();
    state.config.stopRequested = false;
    state.config.updatedAt = new Date().toISOString();
    saveAutonomousState(state);
    res.json(await buildAutonomousMonitoringSnapshot());
  });

  router.post('/run-research', async (req, res) => {
    if (isAutonomousCycleRunning()) {
      return res.status(409).json({ error: 'Автономный цикл уже выполняется.' });
    }
    const col = req.body?.collectionOverride as CollectionType | undefined;
    const log = await runAutonomousResearchCycle({
      mode: 'manual',
      collectionOverride: col === 'debate' || col === 'romantic' ? col : undefined,
      ignoreStopFlag: Boolean(req.body?.ignoreStopFlag ?? true),
    });
    res.json({ log, snapshot: await buildAutonomousMonitoringSnapshot() });
  });

  router.post('/run-production', async (req, res) => {
    if (isAutonomousCycleRunning()) {
      return res.status(409).json({ error: 'Автономный цикл уже выполняется.' });
    }
    const log = await runAutonomousProductionCycle({
      mode: 'manual',
      ignoreStopFlag: Boolean(req.body?.ignoreStopFlag ?? true),
    });
    res.json({ log, snapshot: await buildAutonomousMonitoringSnapshot() });
  });

  router.post('/run-publish', async (req, res) => {
    if (isAutonomousCycleRunning()) {
      return res.status(409).json({ error: 'Автономный цикл уже выполняется.' });
    }
    const dryRun =
      typeof req.body?.dryRun === 'boolean' ? req.body.dryRun : true;
    const log = await runAutonomousPublishingCycle({
      mode: 'manual',
      dryRunOverride: dryRun,
      ignoreStopFlag: Boolean(req.body?.ignoreStopFlag ?? true),
    });
    res.json({ log, snapshot: await buildAutonomousMonitoringSnapshot() });
  });

  router.post('/run-full-cycle', async (req, res) => {
    try {
      const col = req.body?.collectionOverride as CollectionType | undefined;
      const dryRun =
        typeof req.body?.dryRunPublish === 'boolean' ? req.body.dryRunPublish : true;
      const result = await runFullAutonomousCycle({
        mode: 'manual',
        dryRunPublish: dryRun,
        collectionOverride: col === 'debate' || col === 'romantic' ? col : undefined,
        ignoreStopFlag: Boolean(req.body?.ignoreStopFlag ?? true),
      });
      res.json({ result, snapshot: await buildAutonomousMonitoringSnapshot() });
    } catch (err) {
      const status = (err as { status?: number }).status || 500;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Ошибка цикла' });
    }
  });

  return router;
}
