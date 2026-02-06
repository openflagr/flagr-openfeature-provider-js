import {
  FlagNotFoundError,
  GeneralError,
  Logger,
  type EvaluationContext,
} from '@openfeature/server-sdk';
import { FlagrBatchEvaluationResponse } from './types/flagr/evaluation/FlagrBatchEvaluationResponse';
import type { FlagrEvaluationResponse } from './types/flagr/evaluation/FlagrEvaluationResponse';
import type { FlagrBatchEntity } from './types/flagr/evaluation/FlagrBatchEvaluationRequest';
import type { FlagrProviderConfig } from './types/FlagrProviderConfig';
import { transformContext } from './evaluateFlag';

interface PendingEvaluation {
  flagKey: string;
  entity: FlagrBatchEntity;
  entityDedupKey: string;
  resolve: (value: FlagrEvaluationResponse | null) => void;
  reject: (error: Error) => void;
}

interface FlagrBatchEvaluatorOptions {
  maxBatchSize?: number;
  scheduleFn?: (fn: () => void) => void;
}

const DEFAULT_MAX_BATCH_SIZE = 50;

/**
 * DataLoader-style batch evaluator that coalesces individual flag evaluation
 * requests within the same microtask tick into a single batch HTTP request
 * to Flagr's `/api/v1/evaluation/batch` endpoint.
 */
export class FlagrBatchEvaluator {
  private readonly config: FlagrProviderConfig;
  private readonly maxBatchSize: number;
  private readonly scheduleFn: (fn: () => void) => void;
  private pending: PendingEvaluation[] = [];
  private scheduled = false;

  constructor(config: FlagrProviderConfig, options?: FlagrBatchEvaluatorOptions) {
    this.config = config;
    this.maxBatchSize = options?.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
    this.scheduleFn = options?.scheduleFn ?? queueMicrotask;
  }

  /**
   * Enqueues a flag evaluation to be batched. Returns a promise that resolves
   * with the evaluation response, or null if no segment matched.
   */
  load(
    flagKey: string,
    context: EvaluationContext,
    logger: Logger
  ): Promise<FlagrEvaluationResponse | null> {
    return new Promise<FlagrEvaluationResponse | null>((resolve, reject) => {
      const entityID = context.targetingKey ?? 'anonymous';
      const entityType = typeof context.entityType === 'string' ? context.entityType : 'user';
      const entityContext = transformContext(context);

      const sortedEntries = Object.entries(entityContext).sort(([a], [b]) => a.localeCompare(b));
      const entityDedupKey = `${entityID}::${JSON.stringify(sortedEntries)}`;

      this.pending.push({
        flagKey,
        entity: { entityID, entityType, entityContext },
        entityDedupKey,
        resolve,
        reject,
      });

      if (!this.scheduled) {
        this.scheduled = true;
        this.scheduleFn(() => {
          void this.flush(logger);
        });
      }
    });
  }

  private async flush(logger: Logger): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    this.scheduled = false;

    if (batch.length === 0) return;

    // Deduplicate entities
    const entityMap = new Map<string, FlagrBatchEntity>();
    for (const item of batch) {
      if (!entityMap.has(item.entityDedupKey)) {
        entityMap.set(item.entityDedupKey, item.entity);
      }
    }
    const entities = [...entityMap.values()];

    // Collect unique flag keys
    const flagKeySet = new Set<string>();
    for (const item of batch) {
      flagKeySet.add(item.flagKey);
    }
    const allFlagKeys = [...flagKeySet];

    // Split flag keys into chunks if maxBatchSize is set
    const chunks: string[][] = [];
    if (this.maxBatchSize === Infinity) {
      chunks.push(allFlagKeys);
    } else {
      for (let i = 0; i < allFlagKeys.length; i += this.maxBatchSize) {
        chunks.push(allFlagKeys.slice(i, i + this.maxBatchSize));
      }
    }

    try {
      // Build result map from all chunks
      const resultMap = new Map<string, FlagrEvaluationResponse>();

      for (const flagKeys of chunks) {
        const requestBody = {
          entities,
          flagKeys,
          enableDebug: true,
        };

        logger.debug(`Flagr batch evaluation request: ${JSON.stringify(requestBody)}`);

        const controller = new AbortController();
        const timeout = this.config.timeout ?? 5000;
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, timeout);

        try {
          const response = await fetch(`${this.config.baseUrl}/api/v1/evaluation/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new GeneralError(
              `Flagr batch returned ${response.status.toString()}: ${response.statusText}`
            );
          }

          const data = FlagrBatchEvaluationResponse.parse(await response.json());

          for (const result of data.evaluationResults) {
            const key = `${result.flagKey}::${result.evalContext.entityID}`;
            resultMap.set(key, result);
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }

      // Resolve each pending promise
      for (const item of batch) {
        const key = `${item.flagKey}::${item.entity.entityID}`;
        const result = resultMap.get(key);

        if (result === undefined) {
          item.reject(new FlagNotFoundError(`Flag '${item.flagKey}' not found`));
        } else if (!result.variantKey) {
          item.resolve(null);
        } else {
          item.resolve(result);
        }
      }
    } catch (e) {
      // On any error, reject all pending promises
      const error =
        e instanceof GeneralError
          ? e
          : new GeneralError(e instanceof Error ? e.message : 'Unknown batch evaluation error');

      for (const item of batch) {
        item.reject(error);
      }
    }
  }
}
