import {
  EvaluationContext,
  FlagNotFoundError,
  GeneralError,
  Logger,
} from '@openfeature/server-sdk';
import {
  FlagrEvaluationResponse,
  type FlagrEvaluationResponse as FlagrEvaluationResponseType,
} from './types/flagr/evaluation/FlagrEvaluationResponse';
import type { FlagrEvaluationRequest } from './types/flagr/evaluation/FlagrEvaluationRequest';
import type { FlagrProviderConfig } from './types/FlagrProviderConfig';

/**
 * Transforms OpenFeature EvaluationContext to Flagr entityContext format.
 * Flagr expects string values, so we convert all values appropriately.
 */
export function transformContext(context: EvaluationContext): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(context)) {
    // Skip targetingKey and entityType — they're mapped to entityID and entityType
    if (key === 'targetingKey' || key === 'entityType') continue;

    if (value === null) continue;

    if (typeof value === 'string') {
      result[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = String(value);
    } else {
      // Objects/arrays get JSON stringified
      result[key] = JSON.stringify(value);
    }
  }

  return result;
}

/**
 * Evaluates a flag against the Flagr API.
 * @returns The evaluation response, or null if no segment matched (flag exists but no variant assigned)
 * @throws {FlagNotFoundError} If the flag does not exist
 * @throws {GeneralError} For network errors, timeouts, or other failures
 */
export const evaluateFlag = async (
  flagKey: string,
  context: EvaluationContext,
  config: FlagrProviderConfig,
  logger: Logger = console
): Promise<FlagrEvaluationResponseType | null> => {
  const request: FlagrEvaluationRequest = {
    flagKey,
    entityID: context.targetingKey ?? 'anonymous',
    entityType: typeof context.entityType === 'string' ? context.entityType : 'user',
    entityContext: transformContext(context),
    enableDebug: true,
  };

  logger.debug(`Flagr evaluation request: ${JSON.stringify(request)}`);
  logger.debug(`Flagr evaluation URL: ${config.baseUrl}/api/v1/evaluation`);

  const controller = new AbortController();
  const timeout = config.timeout ?? 5000; // Default 5 second timeout
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(`${config.baseUrl}/api/v1/evaluation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    logger.debug(`Flagr evaluation response: ${response.status.toString()}`);

    if (response.status === 404) {
      throw new FlagNotFoundError(`Flag '${flagKey}' not found`);
    }

    if (!response.ok) {
      throw new GeneralError(
        `Flagr returned ${response.status.toString()}: ${response.statusText}`
      );
    }

    const data = FlagrEvaluationResponse.parse(await response.json());

    // Flagr returns empty variantKey when no segment matches
    if (!data.variantKey) {
      return null;
    }

    return data;
  } catch (e) {
    // Re-throw OpenFeature errors as-is
    if (e instanceof FlagNotFoundError || e instanceof GeneralError) {
      throw e;
    }

    // Wrap other errors (network, timeout, parse errors) in GeneralError
    const message = e instanceof Error ? e.message : 'Unknown error during flag evaluation';
    logger.error(`Flag evaluation error: ${message}`);
    throw new GeneralError(message);
  } finally {
    clearTimeout(timeoutId);
  }
};
