import {
  ErrorCode,
  EvaluationContext,
  FlagNotFoundError,
  JsonValue,
  Logger,
  OpenFeatureEventEmitter,
  Provider,
  ResolutionDetails,
  StandardResolutionReasons,
} from '@openfeature/server-sdk';
import { FlagrProviderConfig } from './types/FlagrProviderConfig';
import { evaluateFlag } from './evaluateFlag';
import { FlagrBatchEvaluator } from './FlagrBatchEvaluator';

/**
 * OpenFeature provider for Flagr feature flagging service.
 *
 * This provider implements the OpenFeature {@link Provider} interface to enable
 * Flagr as a backend for feature flag evaluations. It uses Flagr's remote evaluation
 * API (`/api/v1/evaluation`) for all flag resolutions.
 *
 * **Server-only:** This provider is designed for server-side usage only, as Flagr
 * uses remote evaluation via HTTP calls.
 *
 * @example
 * ```typescript
 * import { OpenFeature } from '@openfeature/server-sdk';
 * import { FlagrProvider } from '@flagr/flagr-openfeature-provider-js';
 *
 * OpenFeature.setProvider(new FlagrProvider({
 *   baseUrl: 'http://localhost:18000',
 *   truthyVariants: new Set(['on', 'true', 'enabled']),
 * }));
 *
 * const client = OpenFeature.getClient();
 * const isEnabled = await client.getBooleanValue('my-flag', false);
 * ```
 *
 * @see {@link https://openflagr.github.io/flagr/|Flagr Documentation}
 * @see {@link https://openfeature.dev/|OpenFeature Documentation}
 */
export class FlagrProvider implements Provider {
  readonly metadata = {
    name: 'Flagr Provider',
  } as const;

  readonly runsOn = 'server';

  readonly events = new OpenFeatureEventEmitter();

  private readonly config: FlagrProviderConfig;
  private readonly batchEvaluator: FlagrBatchEvaluator | null;

  /**
   * Creates a new FlagrProvider instance.
   *
   * @param config - Provider configuration options
   * @param config.baseUrl - Base URL of the Flagr server (e.g., 'http://localhost:18000')
   * @param config.truthyVariants - Set of variant keys that should resolve to `true` for boolean evaluations (case-insensitive)
   * @param config.timeout - Optional request timeout in milliseconds (default: 5000ms for health check)
   * @param config.batching - Optional batching configuration for coalescing concurrent evaluations
   */
  constructor(config: FlagrProviderConfig) {
    this.config = config;
    this.batchEvaluator = config.batching?.enabled
      ? new FlagrBatchEvaluator(config, {
          maxBatchSize: config.batching.maxBatchSize,
          scheduleFn: config.batching.scheduleFn,
        })
      : null;
  }

  private evaluateForFlag(flagKey: string, context: EvaluationContext, logger: Logger) {
    return this.batchEvaluator
      ? this.batchEvaluator.load(flagKey, context, logger)
      : evaluateFlag(flagKey, context, this.config, logger);
  }

  /**
   * Initializes the provider by verifying connectivity to the Flagr server.
   *
   * Performs a health check against Flagr's `/api/v1/health` endpoint.
   * If the health check fails or times out, the provider will emit a
   * `PROVIDER_ERROR` event (handled automatically by the OpenFeature SDK).
   *
   * @throws Error if the health check fails or times out
   */
  async initialize(): Promise<void> {
    const healthUrl = `${this.config.baseUrl}/api/v1/health`;
    const timeout = this.config.timeout ?? 5000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeout);

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Flagr health check failed with status ${String(response.status)}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Flagr health check timed out after ${String(timeout)}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Cleans up provider resources on shutdown.
   *
   * This is a no-op for the Flagr provider since it uses native `fetch()`
   * which doesn't maintain persistent connections requiring cleanup.
   */
  async onClose(): Promise<void> {
    // No persistent resources to clean up
    // Native fetch() doesn't require explicit cleanup
  }

  /**
   * Resolves a boolean flag evaluation by checking if the Flagr `variantKey`
   * exists in the configured `truthyVariants` set.
   *
   * The comparison is case-insensitive. If Flagr returns no matching segment
   * (empty response), the `defaultValue` is returned with reason `DEFAULT`.
   *
   * **Mapping:**
   * | variantKey | truthyVariants contains? | Result |
   * |------------|-------------------------|--------|
   * | `"on"` | `"on"` ∈ set | `true` |
   * | `"off"` | `"off"` ∉ set | `false` |
   * | `"ON"` | `"on"` ∈ set | `true` (case-insensitive) |
   *
   * @param flagKey - The Flagr flag key to evaluate
   * @param defaultValue - Value returned when flag not found or no segment matches
   * @param context - OpenFeature evaluation context (transformed to Flagr `entityContext`)
   * @param logger - Logger instance for debug output
   * @returns ResolutionDetails with boolean value, reason, variant, and optional flag metadata
   *
   * @example
   * ```typescript
   * // With truthyVariants: new Set(['on', 'enabled', 'true'])
   * // Flagr returns variantKey: 'on' → true
   * // Flagr returns variantKey: 'off' → false
   * // Flagr returns variantKey: 'ON' → true (case-insensitive)
   * ```
   */
  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
    logger: Logger
  ): Promise<ResolutionDetails<boolean>> {
    try {
      const response = await this.evaluateForFlag(flagKey, context, logger);
      logger.debug(`Flagr evaluation response: ${JSON.stringify(response)}`);

      // No segment matched - flag exists but no variant assigned
      if (!response?.variantKey) {
        return {
          value: defaultValue,
          reason: StandardResolutionReasons.DEFAULT,
        };
      }

      const value = this.config.truthyVariants.has(response.variantKey.toLowerCase());
      return {
        value,
        variant: response.variantKey,
        reason: StandardResolutionReasons.TARGETING_MATCH,
        flagMetadata: {
          flagSnapshotID: response.flagSnapshotID,
          ...(response.segmentID !== undefined && { segmentID: response.segmentID }),
        },
      };
    } catch (e) {
      logger.error(e);

      // Map OpenFeature errors to appropriate error codes
      if (e instanceof FlagNotFoundError) {
        return {
          value: defaultValue,
          reason: StandardResolutionReasons.ERROR,
          errorCode: ErrorCode.FLAG_NOT_FOUND,
          errorMessage: e.message,
        };
      }

      // General errors (network, timeout, etc.)
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.GENERAL,
        errorMessage,
      };
    }
  }

  /**
   * Resolves a number flag evaluation using a two-tier resolution strategy.
   *
   * **Resolution Tiers:**
   * 1. **Tier 1:** Parse `variantKey` as a number (e.g., `"42"` → `42`)
   * 2. **Tier 2:** Fall back to `variantAttachment.value` if tier 1 fails
   *
   * If both tiers fail, returns `defaultValue` with `PARSE_ERROR`.
   *
   * **Mapping:**
   * | variantKey | variantAttachment | Result |
   * |------------|-------------------|--------|
   * | `"42"` | `{}` | `42` |
   * | `"control"` | `{ value: 100 }` | `100` |
   * | `"control"` | `{}` | `defaultValue` + PARSE_ERROR |
   *
   * @param flagKey - The Flagr flag key to evaluate
   * @param defaultValue - Value returned when parsing fails or no segment matches
   * @param context - OpenFeature evaluation context (transformed to Flagr `entityContext`)
   * @param logger - Logger instance for debug output
   * @returns ResolutionDetails with number value, reason, and error info if parsing failed
   */
  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
    logger: Logger
  ): Promise<ResolutionDetails<number>> {
    try {
      const response = await this.evaluateForFlag(flagKey, context, logger);
      logger.debug(`Flagr evaluation response: ${JSON.stringify(response)}`);

      // No segment matched - flag exists but no variant assigned
      if (!response?.variantKey) {
        return {
          value: defaultValue,
          reason: StandardResolutionReasons.DEFAULT,
        };
      }

      // Tier 1: Parse from variantKey
      const parsedValue = Number(response.variantKey);

      if (!isNaN(parsedValue)) {
        return {
          value: parsedValue,
          variant: response.variantKey,
          reason: StandardResolutionReasons.TARGETING_MATCH,
          flagMetadata: {
            flagSnapshotID: response.flagSnapshotID,
            ...(response.segmentID !== undefined && { segmentID: response.segmentID }),
          },
        };
      }

      // Tier 2: Fallback to variantAttachment.value
      if (response.variantAttachment?.value !== undefined) {
        const attachmentValue = response.variantAttachment.value;

        if (typeof attachmentValue === 'number') {
          return {
            value: attachmentValue,
            variant: response.variantKey,
            reason: StandardResolutionReasons.TARGETING_MATCH,
            flagMetadata: {
              flagSnapshotID: response.flagSnapshotID,
              ...(response.segmentID !== undefined && { segmentID: response.segmentID }),
            },
          };
        }

        // variantAttachment.value exists but is not a number
        return {
          value: defaultValue,
          reason: StandardResolutionReasons.ERROR,
          errorCode: ErrorCode.TYPE_MISMATCH,
          errorMessage: `variantAttachment.value is not a number (got ${typeof attachmentValue})`,
        };
      }

      // variantKey is not numeric and no valid attachment
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.PARSE_ERROR,
        errorMessage: `Unable to parse '${response.variantKey}' as a number`,
      };
    } catch (e) {
      logger.error(e);

      // Map OpenFeature errors to appropriate error codes
      if (e instanceof FlagNotFoundError) {
        return {
          value: defaultValue,
          reason: StandardResolutionReasons.ERROR,
          errorCode: ErrorCode.FLAG_NOT_FOUND,
          errorMessage: e.message,
        };
      }

      // General errors (network, timeout, etc.)
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.GENERAL,
        errorMessage,
      };
    }
  }

  /**
   * Resolves an object flag evaluation by returning the Flagr `variantAttachment` directly.
   *
   * The `variantAttachment` in Flagr is a JSON object that can contain any structured data.
   * If `variantAttachment` is missing or undefined, returns `defaultValue`.
   *
   * **Mapping:**
   * | variantAttachment | Result |
   * |-------------------|--------|
   * | `{ theme: "dark", limit: 10 }` | `{ theme: "dark", limit: 10 }` |
   * | `null` / `undefined` | `defaultValue` |
   *
   * @typeParam T - The expected shape of the object value (extends JsonValue)
   * @param flagKey - The Flagr flag key to evaluate
   * @param defaultValue - Value returned when variantAttachment is missing
   * @param context - OpenFeature evaluation context (transformed to Flagr `entityContext`)
   * @param logger - Logger instance for debug output
   * @returns ResolutionDetails with object value cast to type T
   */
  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    logger: Logger
  ): Promise<ResolutionDetails<T>> {
    try {
      const response = await this.evaluateForFlag(flagKey, context, logger);
      logger.debug(`Flagr evaluation response: ${JSON.stringify(response)}`);

      // No segment matched - flag exists but no variant assigned
      if (!response?.variantKey) {
        return {
          value: defaultValue,
          reason: StandardResolutionReasons.DEFAULT,
        };
      }

      // variantAttachment is missing - return defaultValue
      if (response.variantAttachment === undefined) {
        return {
          value: defaultValue,
          reason: StandardResolutionReasons.DEFAULT,
        };
      }

      // Return variantAttachment as object value
      return {
        value: response.variantAttachment as T,
        variant: response.variantKey,
        reason: StandardResolutionReasons.TARGETING_MATCH,
        flagMetadata: {
          flagSnapshotID: response.flagSnapshotID,
          ...(response.segmentID !== undefined && { segmentID: response.segmentID }),
        },
      };
    } catch (e) {
      logger.error(e);

      if (e instanceof FlagNotFoundError) {
        return {
          value: defaultValue,
          reason: StandardResolutionReasons.ERROR,
          errorCode: ErrorCode.FLAG_NOT_FOUND,
          errorMessage: e.message,
        };
      }

      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.GENERAL,
        errorMessage,
      };
    }
  }

  /**
   * Resolves a string flag evaluation by returning the Flagr `variantKey` directly.
   *
   * This is the simplest mapping - the variant key from Flagr is returned as-is.
   * If Flagr returns no matching segment (empty response), the `defaultValue` is returned.
   *
   * **Mapping:**
   * | Flagr variantKey | OpenFeature Result |
   * |------------------|-------------------|
   * | `"variant-a"` | `"variant-a"` |
   * | `"control"` | `"control"` |
   * | (no match) | `defaultValue` |
   *
   * @param flagKey - The Flagr flag key to evaluate
   * @param defaultValue - Value returned when flag not found or no segment matches
   * @param context - OpenFeature evaluation context (transformed to Flagr `entityContext`)
   * @param logger - Logger instance for debug output
   * @returns ResolutionDetails with string value (the variantKey)
   */
  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
    logger: Logger
  ): Promise<ResolutionDetails<string>> {
    try {
      const response = await this.evaluateForFlag(flagKey, context, logger);
      logger.debug(`Flagr evaluation response: ${JSON.stringify(response)}`);

      // No segment matched - flag exists but no variant assigned
      if (!response?.variantKey) {
        return {
          value: defaultValue,
          reason: StandardResolutionReasons.DEFAULT,
        };
      }

      return {
        value: response.variantKey,
        variant: response.variantKey,
        reason: StandardResolutionReasons.TARGETING_MATCH,
        flagMetadata: {
          flagSnapshotID: response.flagSnapshotID,
          ...(response.segmentID !== undefined && { segmentID: response.segmentID }),
        },
      };
    } catch (e) {
      logger.error(e);

      if (e instanceof FlagNotFoundError) {
        return {
          value: defaultValue,
          reason: StandardResolutionReasons.ERROR,
          errorCode: ErrorCode.FLAG_NOT_FOUND,
          errorMessage: e.message,
        };
      }

      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.GENERAL,
        errorMessage,
      };
    }
  }
}
