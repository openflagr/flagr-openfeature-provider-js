import * as z from 'zod';

/**
 * Configuration schema for the Flagr OpenFeature provider.
 *
 * @example
 * ```typescript
 * const config: FlagrProviderConfig = {
 *   baseUrl: 'http://localhost:18000',
 *   truthyVariants: new Set(['on', 'true', 'enabled']),
 *   timeout: 5000,
 * };
 * ```
 */
export const FlagrProviderConfig = z.object({
  /**
   * Base URL of the Flagr server.
   *
   * This should be the root URL without trailing slash.
   * The provider will append `/api/v1/evaluation` for flag evaluations
   * and `/api/v1/health` for health checks.
   *
   * @example 'http://localhost:18000'
   * @example 'https://flagr.example.com'
   */
  baseUrl: z.string(),

  /**
   * Set of variant keys that should resolve to `true` for boolean evaluations.
   *
   * The comparison is case-insensitive. Any `variantKey` returned by Flagr
   * that exists in this set (after lowercasing) will resolve to `true`.
   *
   * @example new Set(['on', 'true', 'enabled', '1'])
   */
  truthyVariants: z.set(z.string()),

  /**
   * Request timeout in milliseconds.
   *
   * Applied to both health check requests (during `initialize()`) and
   * flag evaluation requests. If not specified, defaults to 5000ms for
   * health checks.
   *
   * @default undefined (uses 5000ms for health checks)
   */
  timeout: z.number().optional(),
});

/**
 * Configuration options for the Flagr OpenFeature provider.
 */
export type FlagrProviderConfig = z.infer<typeof FlagrProviderConfig>;
