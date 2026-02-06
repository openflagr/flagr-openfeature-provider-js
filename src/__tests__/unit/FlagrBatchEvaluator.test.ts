import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { FlagNotFoundError, GeneralError } from '@openfeature/server-sdk';
import { FlagrBatchEvaluator } from '../../FlagrBatchEvaluator';
import type { FlagrProviderConfig } from '../../types/FlagrProviderConfig';
import { server } from '../mocks/server';
import {
  createBatchHandler,
  createBatchServerErrorHandler,
  createBatchTimeoutHandler,
  createHealthCheckHandler,
} from '../mocks/handlers';
import { http, HttpResponse } from 'msw';

const BASE_URL = 'http://localhost:18000';

const defaultConfig: FlagrProviderConfig = {
  baseUrl: BASE_URL,
  truthyVariants: new Set(['on', 'true', 'enabled']),
  timeout: 5000,
};

const silentLogger = {
  debug: () => {
    /* empty */
  },
  info: () => {
    /* empty */
  },
  warn: () => {
    /* empty */
  },
  error: () => {
    /* empty */
  },
};

describe('FlagrBatchEvaluator', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  it('should batch a single flag evaluation and resolve', async () => {
    server.use(
      createHealthCheckHandler(),
      createBatchHandler({ 'test-flag': { variantKey: 'on' } })
    );

    const evaluator = new FlagrBatchEvaluator(defaultConfig);

    const result = await evaluator.load('test-flag', { targetingKey: 'user-123' }, silentLogger);

    expect(result).not.toBeNull();
    expect(result?.variantKey).toBe('on');
    expect(result?.flagKey).toBe('test-flag');
  });

  it('should coalesce two flags for the same entity into one HTTP request', async () => {
    let requestCount = 0;
    server.use(
      createHealthCheckHandler(),
      http.post(`${BASE_URL}/api/v1/evaluation/batch`, async ({ request }) => {
        requestCount++;
        const body = (await request.json()) as {
          entities: { entityID: string; entityType?: string }[];
          flagKeys: string[];
        };

        expect(body.entities).toHaveLength(1);
        expect(body.flagKeys).toHaveLength(2);

        const evaluationResults = body.flagKeys.map((flagKey) => ({
          flagID: 1,
          flagKey,
          flagSnapshotID: 123,
          segmentID: 1,
          variantID: 1,
          variantKey: 'on',
          evalContext: {
            entityID: body.entities[0].entityID,
            entityType: body.entities[0].entityType ?? 'user',
          },
          timestamp: new Date().toISOString(),
          evalDebugLog: { segmentDebugLogs: [], msg: 'success' },
        }));

        return HttpResponse.json({ evaluationResults });
      })
    );

    const evaluator = new FlagrBatchEvaluator(defaultConfig);
    const context = { targetingKey: 'user-123' };

    const [result1, result2] = await Promise.all([
      evaluator.load('flag-a', context, silentLogger),
      evaluator.load('flag-b', context, silentLogger),
    ]);

    expect(requestCount).toBe(1);
    expect(result1?.flagKey).toBe('flag-a');
    expect(result2?.flagKey).toBe('flag-b');
  });

  it('should send different entities as separate entries in the batch', async () => {
    server.use(
      createHealthCheckHandler(),
      http.post(`${BASE_URL}/api/v1/evaluation/batch`, async ({ request }) => {
        const body = (await request.json()) as {
          entities: { entityID: string; entityType?: string }[];
          flagKeys: string[];
        };

        expect(body.entities).toHaveLength(2);

        const evaluationResults = body.entities.map((entity) => ({
          flagID: 1,
          flagKey: 'test-flag',
          flagSnapshotID: 123,
          segmentID: 1,
          variantID: 1,
          variantKey: 'on',
          evalContext: {
            entityID: entity.entityID,
            entityType: entity.entityType ?? 'user',
          },
          timestamp: new Date().toISOString(),
          evalDebugLog: { segmentDebugLogs: [], msg: 'success' },
        }));

        return HttpResponse.json({ evaluationResults });
      })
    );

    const evaluator = new FlagrBatchEvaluator(defaultConfig);

    const [result1, result2] = await Promise.all([
      evaluator.load('test-flag', { targetingKey: 'user-1' }, silentLogger),
      evaluator.load('test-flag', { targetingKey: 'user-2' }, silentLogger),
    ]);

    expect(result1?.evalContext.entityID).toBe('user-1');
    expect(result2?.evalContext.entityID).toBe('user-2');
  });

  it('should reject with FlagNotFoundError when flag is missing from batch results', async () => {
    server.use(
      createHealthCheckHandler(),
      createBatchHandler({ 'existing-flag': { variantKey: 'on' } })
    );

    const evaluator = new FlagrBatchEvaluator(defaultConfig);

    const existingPromise = evaluator.load(
      'existing-flag',
      { targetingKey: 'user-1' },
      silentLogger
    );
    const missingPromise = evaluator.load('missing-flag', { targetingKey: 'user-1' }, silentLogger);

    const existing = await existingPromise;
    expect(existing?.variantKey).toBe('on');
    await expect(missingPromise).rejects.toThrow(FlagNotFoundError);
  });

  it('should resolve null when variantKey is empty (no segment match)', async () => {
    server.use(
      createHealthCheckHandler(),
      createBatchHandler({ 'test-flag': { variantKey: undefined } })
    );

    const evaluator = new FlagrBatchEvaluator(defaultConfig);

    const result = await evaluator.load('test-flag', { targetingKey: 'user-1' }, silentLogger);

    expect(result).toBeNull();
  });

  it('should reject all promises on batch timeout', async () => {
    server.use(createHealthCheckHandler(), createBatchTimeoutHandler(500));

    const evaluator = new FlagrBatchEvaluator({ ...defaultConfig, timeout: 50 });

    const promise1 = evaluator.load('flag-a', { targetingKey: 'user-1' }, silentLogger);
    const promise2 = evaluator.load('flag-b', { targetingKey: 'user-1' }, silentLogger);

    await expect(promise1).rejects.toThrow(GeneralError);
    await expect(promise2).rejects.toThrow(GeneralError);
  });

  it('should reject all promises on batch server error', async () => {
    server.use(createHealthCheckHandler(), createBatchServerErrorHandler());

    const evaluator = new FlagrBatchEvaluator(defaultConfig);

    const promise1 = evaluator.load('flag-a', { targetingKey: 'user-1' }, silentLogger);
    const promise2 = evaluator.load('flag-b', { targetingKey: 'user-1' }, silentLogger);

    await expect(promise1).rejects.toThrow(GeneralError);
    await expect(promise2).rejects.toThrow(GeneralError);
  });

  it('should split into multiple HTTP requests when maxBatchSize is exceeded', async () => {
    let requestCount = 0;
    server.use(
      createHealthCheckHandler(),
      http.post(`${BASE_URL}/api/v1/evaluation/batch`, async ({ request }) => {
        requestCount++;
        const body = (await request.json()) as {
          entities: { entityID: string; entityType?: string }[];
          flagKeys: string[];
        };

        expect(body.flagKeys.length).toBeLessThanOrEqual(2);

        const evaluationResults = body.flagKeys.map((flagKey) => ({
          flagID: 1,
          flagKey,
          flagSnapshotID: 123,
          segmentID: 1,
          variantID: 1,
          variantKey: 'on',
          evalContext: {
            entityID: body.entities[0].entityID,
            entityType: body.entities[0].entityType ?? 'user',
          },
          timestamp: new Date().toISOString(),
          evalDebugLog: { segmentDebugLogs: [], msg: 'success' },
        }));

        return HttpResponse.json({ evaluationResults });
      })
    );

    const evaluator = new FlagrBatchEvaluator(defaultConfig, { maxBatchSize: 2 });
    const context = { targetingKey: 'user-1' };

    const [r1, r2, r3] = await Promise.all([
      evaluator.load('flag-a', context, silentLogger),
      evaluator.load('flag-b', context, silentLogger),
      evaluator.load('flag-c', context, silentLogger),
    ]);

    expect(requestCount).toBe(2);
    expect(r1?.variantKey).toBe('on');
    expect(r2?.variantKey).toBe('on');
    expect(r3?.variantKey).toBe('on');
  });

  it('should invoke custom scheduleFn', async () => {
    server.use(
      createHealthCheckHandler(),
      createBatchHandler({ 'test-flag': { variantKey: 'on' } })
    );

    const customScheduleFn = vi.fn((fn: () => void) => {
      queueMicrotask(fn);
    });

    const evaluator = new FlagrBatchEvaluator(defaultConfig, {
      scheduleFn: customScheduleFn,
    });

    await evaluator.load('test-flag', { targetingKey: 'user-1' }, silentLogger);

    expect(customScheduleFn).toHaveBeenCalledOnce();
  });
});
